import http from "node:http";
import path from "node:path";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { WebSocketServer } from "ws";
import { z } from "zod";
import pino from "pino";
import {
  addActivity,
  addControlCommand,
  getControlLog,
  getOverview,
  getSessionSummary,
  getSessions,
  listActivities,
  listAgents,
  removeAgent,
  upsertAgent
} from "./store";
import { activityCounter, agentGauge, controlCounter, getPrometheusContentType, getPrometheusMetrics } from "./metrics";
import { analyzeStep, compressPrompt, distillSession, getMemory } from "./pro";
import {
  recordBenchmark,
  listBenchmarkEvents,
  summarizeBenchmarks,
  exportBenchmarks,
  clearBenchmarks,
  type NexusAbility
} from "./benchmark";
import {
  sessionRecorderMiddleware,
  listSessions,
  getSessionRecording,
  analyzeSession
} from "./session-recorder";
import { generateGuideJson, generateGuideMarkdown } from "./guide";
import {
  readCached, fileDigest, listSymbols, getSymbol,
  autoSegmentActivities, recallEpisodes, getEpisodes,
  getContextBudget, setSessionBudget, trackTokenUsage,
  generateHandoff, getCacheStats, getCacheEntries
} from "./workspace-memory";
import type { AgentPlatform } from "./types";

const logger = pino({
  level: process.env.LOG_LEVEL ?? "info"
});

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cors());
app.use(helmet());
app.use(morgan("combined"));
app.use("/assets", express.static(path.join(__dirname, "../public")));

// Full interaction recorder — captures every /nexus/* request+response to per-session JSONL
app.use(sessionRecorderMiddleware);

// Optional API-key auth. When NEXUS_API_KEY is set, all /nexus/* routes require
// an `x-api-key` header (or `?apiKey=`) that matches. /healthz, /metrics, and
// the static UI are always public so probes and dashboards keep working.
const apiKey = process.env.NEXUS_API_KEY?.trim();
if (apiKey) {
  app.use((req, res, next) => {
    if (!req.path.startsWith("/nexus/")) return next();
    const provided = (req.header("x-api-key") || (req.query.apiKey as string) || "").trim();
    if (provided && provided === apiKey) return next();
    res.status(401).json({ error: "Missing or invalid API key" });
  });
  logger.info("NEXUS_API_KEY enabled — /nexus/* routes require x-api-key header");
}

const port = Number(process.env.PORT ?? "8787");
const host = process.env.HOST ?? "127.0.0.1";

const agentSchema = z.object({
  id: z.string().min(2),
  name: z.string().min(1),
  platform: z.enum(["claude-code", "codex", "local-ollama", "vscode", "antigravity", "custom"] as [AgentPlatform, ...AgentPlatform[]]),
  instanceId: z.string().min(2),
  version: z.string().optional(),
  tags: z.array(z.string()).optional()
});

const activitySchema = z.object({
  agentId: z.string().min(2),
  kind: z.string().min(1),
  status: z.enum(["started", "running", "completed", "failed"]),
  details: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional()
});

const controlSchema = z.object({
  command: z.enum(["ping", "pause", "resume", "status"]),
  reason: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional()
});

function broadcast(type: string, payload: unknown): void {
  const data = JSON.stringify({ type, payload, sentAt: new Date().toISOString() });
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(data);
    }
  }
}

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "nexus-mcp-oss", now: new Date().toISOString() });
});

const publicDir = path.resolve(__dirname, "../public");

const sendOpts = { root: publicDir, dotfiles: "allow" as const };

app.get("/", (_req, res) => {
  res.sendFile("dashboard.html", sendOpts);
});

app.get("/dashboard", (_req, res) => {
  res.redirect("/");
});

app.get("/pro-metrics", (_req, res) => {
  res.sendFile("pro-metrics.html", sendOpts);
});

app.get("/connection-helper", (_req, res) => {
  res.sendFile("connection-helper.html", sendOpts);
});

app.get("/nexus", (_req, res) => {
  res.json({
    service: "nexus-mcp-oss",
    overview: getOverview(),
    endpoints: [
      "/nexus/agents",
      "/nexus/activities",
      "/nexus/control-log",
      "/nexus/sessions",
      "/nexus/compatibility",
      "/nexus/compress",
      "/nexus/distill",
      "/nexus/memory/:agentId",
      "/nexus/analyze",
      "/nexus/guide",
      "/nexus/guide.md",
      "/nexus/wm/read",
      "/nexus/wm/digest",
      "/nexus/wm/symbols",
      "/nexus/wm/symbol",
      "/nexus/wm/episodes",
      "/nexus/wm/episodes/segment",
      "/nexus/wm/episodes/recall",
      "/nexus/wm/budget",
      "/nexus/wm/handoff/:sessionId",
      "/nexus/wm/stats",
      "/nexus/benchmark/events",
      "/nexus/benchmark/summary",
      "/nexus/benchmark/export",
      "/nexus/recordings",
      "/nexus/recordings/:sessionId",
      "/nexus/recordings/:sessionId/analysis",
      "/metrics",
      "/healthz"
    ]
  });
});

app.get("/nexus/agents", (_req, res) => {
  const agents = listAgents();
  agentGauge.set(agents.length);
  res.json({ total: agents.length, items: agents });
});

app.post("/nexus/agents", (req, res) => {
  const parsed = agentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid agent payload", details: parsed.error.flatten() });
    return;
  }
  const agent = upsertAgent(parsed.data);
  agentGauge.set(listAgents().length);
  broadcast("agent.upserted", agent);
  recordBenchmark({
    ability: "register_agent",
    agentId: agent.id,
    meta: { platform: agent.platform, instanceId: agent.instanceId, tags: agent.tags }
  });
  res.status(201).json(agent);
});

app.delete("/nexus/agents/:id", (req, res) => {
  const removed = removeAgent(req.params.id);
  agentGauge.set(listAgents().length);
  if (!removed) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  broadcast("agent.removed", { id: req.params.id });
  res.status(204).send();
});

app.get("/nexus/activities", (req, res) => {
  const limit = Number(req.query.limit ?? "100");
  res.json({ total: listActivities(limit).length, items: listActivities(limit) });
});

app.post("/nexus/activities", (req, res) => {
  const parsed = activitySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid activity payload", details: parsed.error.flatten() });
    return;
  }
  const activity = addActivity(parsed.data);
  activityCounter.inc({ status: activity.status, kind: activity.kind });
  broadcast("activity.created", activity);
  const meta = (activity.metadata ?? {}) as Record<string, unknown>;
  const sessionId = typeof meta.sessionId === "string" ? meta.sessionId : undefined;
  const taskId = typeof meta.taskId === "string" ? meta.taskId : undefined;
  recordBenchmark({
    ability: "send_activity",
    agentId: activity.agentId,
    sessionId,
    taskId,
    inputTokens: typeof meta.tokensInput === "number" ? meta.tokensInput : undefined,
    outputTokens: typeof meta.tokensOutput === "number" ? meta.tokensOutput : undefined,
    tokensSaved: typeof meta.tokensSaved === "number" ? meta.tokensSaved : undefined,
    meta: { kind: activity.kind, status: activity.status, details: activity.details.slice(0, 240) }
  });
  res.status(201).json(activity);
});

app.post("/nexus/agents/:id/control", (req, res) => {
  const parsed = controlSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid control payload", details: parsed.error.flatten() });
    return;
  }
  addControlCommand(req.params.id, parsed.data);
  controlCounter.inc({ command: parsed.data.command });
  recordBenchmark({
    ability: "send_control",
    agentId: req.params.id,
    meta: { command: parsed.data.command, reason: parsed.data.reason }
  });
  const response = {
    queued: true,
    agentId: req.params.id,
    command: parsed.data,
    queuedAt: new Date().toISOString()
  };
  broadcast("control.queued", response);
  res.status(202).json(response);
});

app.get("/nexus/control-log", (req, res) => {
  const limit = Number(req.query.limit ?? "100");
  res.json({ total: getControlLog(limit).length, items: getControlLog(limit) });
});

app.get("/nexus/sessions", (req, res) => {
  const limit = Number(req.query.limit ?? "200");
  const items = getSessions(limit);
  res.json({ total: items.length, summary: getSessionSummary(), items });
});

app.get("/nexus/compatibility", (_req, res) => {
  res.json({
    tools: [
      { name: "Claude Code", id: "claude-code", transport: ["http", "websocket"], notes: "Use MCP-compatible wrapper script or direct HTTP events." },
      { name: "Codex", id: "codex", transport: ["http"], notes: "Send activities via POST /nexus/activities and register agent via /nexus/agents." },
      { name: "Local Ollama", id: "local-ollama", transport: ["http"], notes: "Wrap local tasks and push events to Nexus endpoint." },
      { name: "VS Code Agents", id: "vscode", transport: ["http", "websocket"], notes: "Use extension task hooks to emit activity events." },
      { name: "Antigravity", id: "antigravity", transport: ["http"], notes: "Map internal task state to Nexus activity status values." },
      { name: "Custom", id: "custom", transport: ["http", "websocket"], notes: "Implement register + activity + optional control endpoints." }
    ],
    mcpShape: {
      register: "POST /nexus/agents",
      event: "POST /nexus/activities",
      control: "POST /nexus/agents/:id/control"
    }
  });
});

// ─── Pro endpoints ────────────────────────────────────────────────────────────

const compressSchema = z.object({
  prompt: z.string().min(1),
  task: z.string().optional(),
  aggressiveness: z.enum(["low", "medium", "high"]).optional()
});

app.post("/nexus/compress", (req, res) => {
  const parsed = compressSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid compress payload", details: parsed.error.flatten() });
    return;
  }
  const result = compressPrompt(parsed.data);
  res.json(result);
});

const distillMessageSchema = z.object({
  role: z.enum(["user", "assistant", "tool", "system"]),
  content: z.string()
});

const distillSchema = z.object({
  agentId: z.string().min(2),
  messages: z.array(distillMessageSchema).min(1),
  taskGoal: z.string().optional(),
  sessionStandardTokens: z.number().nonnegative().optional(),
  sessionNexusTokens: z.number().nonnegative().optional(),
  steps: z.number().int().nonnegative().optional()
});

app.post("/nexus/distill", (req, res) => {
  const parsed = distillSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid distill payload", details: parsed.error.flatten() });
    return;
  }
  const result = distillSession(parsed.data);
  res.json(result);
});

app.get("/nexus/memory/:agentId", (req, res) => {
  const result = getMemory(req.params.agentId);
  res.json(result);
});

const analyzeSchema = z.object({
  agentId: z.string().min(2),
  step: z.number().int().nonnegative(),
  output: z.string().min(1),
  taskGoal: z.string().min(1),
  previousOutputs: z.array(z.string()).optional()
});

app.get("/nexus/guide", (_req, res) => {
  const nexusUrl = `http://${host}:${port}`;
  res.json(generateGuideJson(nexusUrl));
});

app.get("/nexus/guide.md", (_req, res) => {
  const nexusUrl = `http://${host}:${port}`;
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.send(generateGuideMarkdown(nexusUrl));
});

app.get("/agent-guide", (_req, res) => {
  res.sendFile("agent-guide.html", sendOpts);
});

app.post("/nexus/analyze", (req, res) => {
  const parsed = analyzeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid analyze payload", details: parsed.error.flatten() });
    return;
  }
  const result = analyzeStep(parsed.data);
  res.json(result);
});

// ─── Workspace Memory endpoints ──────────────────────────────────────────────

const readCachedSchema = z.object({
  path: z.string().min(1),
  forceFull: z.boolean().optional()
});

app.post("/nexus/wm/read", (req, res) => {
  const parsed = readCachedSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }
  const result = readCached(parsed.data.path, parsed.data.forceFull);
  recordBenchmark({
    ability: "read_cached",
    inputTokens: result.tokens + result.tokensSaved,
    outputTokens: result.tokens,
    tokensSaved: result.tokensSaved,
    cacheHit: result.cacheHit,
    latencyMs: result.latencyMs,
    meta: { path: result.path, status: result.status, readCount: result.readCount }
  });
  res.json(result);
});

app.post("/nexus/wm/digest", (req, res) => {
  const parsed = z.object({ path: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }
  res.json(fileDigest(parsed.data.path));
});

app.post("/nexus/wm/symbols", (req, res) => {
  const parsed = z.object({ path: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }
  res.json(listSymbols(parsed.data.path));
});

app.post("/nexus/wm/symbol", (req, res) => {
  const parsed = z.object({
    path: z.string().min(1),
    name: z.string().min(1),
    context: z.number().int().min(0).max(50).optional()
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }
  res.json(getSymbol(parsed.data.path, parsed.data.name, parsed.data.context ?? 5));
});

app.post("/nexus/wm/episodes/segment", (req, res) => {
  const parsed = z.object({
    sessionId: z.string().min(1),
    activities: z.array(z.object({
      id: z.string(),
      timestamp: z.string(),
      details: z.string(),
      status: z.string(),
      metadata: z.record(z.string(), z.unknown()).optional()
    }))
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }
  res.json(autoSegmentActivities(parsed.data.sessionId, parsed.data.activities));
});

app.post("/nexus/wm/episodes/recall", (req, res) => {
  const parsed = z.object({
    query: z.string().min(1),
    k: z.number().int().min(1).max(20).optional()
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }
  res.json(recallEpisodes(parsed.data.query, parsed.data.k ?? 3));
});

app.get("/nexus/wm/episodes", (_req, res) => {
  res.json({ total: getEpisodes().length, items: getEpisodes() });
});

app.post("/nexus/wm/budget", (req, res) => {
  const parsed = z.object({
    sessionId: z.string().min(1),
    action: z.enum(["get", "set", "track"]),
    budget: z.number().int().positive().optional(),
    tokens: z.number().int().nonnegative().optional()
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }
  const { sessionId, action, budget, tokens } = parsed.data;
  if (action === "set" && budget) setSessionBudget(sessionId, budget);
  if (action === "track" && tokens) trackTokenUsage(sessionId, tokens);
  res.json(getContextBudget(sessionId));
});

app.get("/nexus/wm/handoff/:sessionId", (req, res) => {
  res.json(generateHandoff(req.params.sessionId));
});

app.get("/nexus/wm/stats", (_req, res) => {
  res.json(getCacheStats());
});

app.get("/nexus/wm/cache-entries", (_req, res) => {
  const entries = getCacheEntries();
  res.json({ total: entries.length, items: entries });
});

app.get("/workspace-memory", (_req, res) => {
  res.sendFile("workspace-memory.html", sendOpts);
});

// ─── Benchmark / paper-data export endpoints ────────────────────────────────

app.get("/nexus/benchmark/events", (req, res) => {
  const limit = Number(req.query.limit ?? "500");
  const ability = typeof req.query.ability === "string" ? (req.query.ability as NexusAbility) : undefined;
  const items = listBenchmarkEvents(limit, ability);
  res.json({ total: items.length, items });
});

app.get("/nexus/benchmark/summary", (_req, res) => {
  res.json(summarizeBenchmarks());
});

app.get("/nexus/benchmark/export", (_req, res) => {
  res.json(exportBenchmarks());
});

app.get("/nexus/benchmark/export.jsonl", (_req, res) => {
  const events = listBenchmarkEvents(5000);
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=nexus-benchmarks.jsonl");
  for (const e of events) res.write(JSON.stringify(e) + "\n");
  res.end();
});

app.delete("/nexus/benchmark", (_req, res) => {
  res.json(clearBenchmarks());
});

// ─── Session recording endpoints ─────────────────────────────────────────────

app.get("/nexus/recordings", (_req, res) => {
  const sessions = listSessions();
  res.json({ total: sessions.length, items: sessions });
});

app.get("/nexus/recordings/:sessionId", (req, res) => {
  const records = getSessionRecording(req.params.sessionId);
  if (records.length === 0) {
    res.status(404).json({ error: "Session not found or empty" });
    return;
  }
  res.json({ sessionId: req.params.sessionId, total: records.length, records });
});

app.get("/nexus/recordings/:sessionId/analysis", (req, res) => {
  const analysis = analyzeSession(req.params.sessionId);
  if (analysis.totalInteractions === 0) {
    res.status(404).json({ error: "Session not found or empty" });
    return;
  }
  res.json(analysis);
});

app.get("/nexus/recordings/:sessionId/export.jsonl", (req, res) => {
  const records = getSessionRecording(req.params.sessionId);
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename=session-${req.params.sessionId}.jsonl`);
  for (const r of records) res.write(JSON.stringify(r) + "\n");
  res.end();
});

app.get("/metrics", async (_req, res) => {
  res.setHeader("Content-Type", getPrometheusContentType());
  const metrics = await getPrometheusMetrics();
  res.send(metrics);
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/nexus/ws" });

wss.on("connection", (socket) => {
  logger.info("WebSocket client connected");
  socket.send(
    JSON.stringify({
      type: "nexus.snapshot",
      payload: {
        overview: getOverview(),
        agents: listAgents(),
        recentActivities: listActivities(25)
      },
      sentAt: new Date().toISOString()
    })
  );
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EACCES") {
    logger.error(
      `Permission denied binding ${host}:${port}. Try: set PORT=8788 (or another free port) and HOST=127.0.0.1.`
    );
    process.exit(1);
  }
  if (error.code === "EADDRINUSE") {
    logger.error(`Address already in use at ${host}:${port}. Choose another PORT.`);
    process.exit(1);
  }
  logger.error({ err: error }, "Server failed to start");
  process.exit(1);
});

server.listen(port, host, () => {
  logger.info(`Nexus MCP OSS listening on http://${host}:${port}`);
});
