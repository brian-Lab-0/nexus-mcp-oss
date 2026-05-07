/**
 * Session recorder — captures every Nexus interaction end-to-end.
 *
 * Records per session: agent registration, every activity event, every Pro
 * operation (compress / distill / analyze), every workspace-memory call, every
 * control command, and the full request/response bodies. Stored as NDJSON under
 * data/sessions/<sessionId>.jsonl so offline analysis can reconstruct the full
 * task-solving procedure that happened while the agent was connected to Nexus.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

export interface InteractionRecord {
  recordId: string;
  sessionId: string;
  agentId?: string;
  taskId?: string;
  recordedAt: string;
  // request
  method: string;
  path: string;
  requestBody?: unknown;
  // response
  statusCode: number;
  responseBody?: unknown;
  // derived
  latencyMs: number;
  category: InteractionCategory;
}

export type InteractionCategory =
  | "agent_lifecycle"   // register / remove
  | "activity"          // task lifecycle events
  | "control"           // ping / pause / resume / status
  | "compress"          // prompt compression
  | "distill"           // session distillation
  | "analyze"           // step analysis / drift
  | "memory"            // distilled memory retrieval
  | "workspace_memory"  // file cache / symbols / episodes / budget / handoff
  | "session_query"     // list sessions / activities
  | "benchmark"         // benchmark reads
  | "other";

const SESSIONS_DIR = path.resolve(__dirname, "..", "data", "sessions");

function ensureDir(d: string): void {
  try { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); } catch { /* ignore */ }
}

ensureDir(SESSIONS_DIR);

function categorize(method: string, p: string): InteractionCategory {
  if (p.startsWith("/nexus/agents") && (method === "POST" || method === "DELETE")) return "agent_lifecycle";
  if (p === "/nexus/activities" && method === "POST") return "activity";
  if (p.match(/\/nexus\/agents\/.+\/control/)) return "control";
  if (p === "/nexus/compress") return "compress";
  if (p === "/nexus/distill") return "distill";
  if (p === "/nexus/analyze") return "analyze";
  if (p.startsWith("/nexus/memory")) return "memory";
  if (p.startsWith("/nexus/wm/")) return "workspace_memory";
  if (p.startsWith("/nexus/sessions") || p.startsWith("/nexus/activities")) return "session_query";
  if (p.startsWith("/nexus/benchmark")) return "benchmark";
  return "other";
}

function extractIds(reqBody: unknown, resBody: unknown): { agentId?: string; sessionId?: string; taskId?: string } {
  const b = (reqBody ?? {}) as Record<string, unknown>;
  const r = (resBody ?? {}) as Record<string, unknown>;
  const meta = (b.metadata ?? r.metadata ?? {}) as Record<string, unknown>;
  const agentId =
    (typeof b.agentId === "string" ? b.agentId : undefined) ||
    (typeof b.id === "string" ? b.id : undefined) ||
    (typeof r.agentId === "string" ? r.agentId : undefined) ||
    (typeof r.id === "string" ? r.id : undefined);
  const sessionId =
    (typeof b.sessionId === "string" ? b.sessionId : undefined) ||
    (typeof meta.sessionId === "string" ? meta.sessionId : undefined) ||
    (typeof r.sessionId === "string" ? r.sessionId : undefined);
  const taskId =
    (typeof b.taskId === "string" ? b.taskId : undefined) ||
    (typeof meta.taskId === "string" ? meta.taskId : undefined);
  return { agentId, sessionId, taskId };
}

const FALLBACK_SESSION = "nexus-default";

function sessionFile(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 120);
  return path.join(SESSIONS_DIR, `${safe}.jsonl`);
}

export function sessionRecorderMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!req.path.startsWith("/nexus/")) { next(); return; }

  const t0 = performance.now();
  const originalJson = res.json.bind(res);
  let capturedBody: unknown;

  res.json = function (body: unknown) {
    capturedBody = body;
    return originalJson(body);
  };

  res.on("finish", () => {
    try {
      const latencyMs = Number((performance.now() - t0).toFixed(2));
      const category = categorize(req.method, req.path);
      if (category === "benchmark" || category === "other") return; // skip meta reads

      const { agentId, sessionId, taskId } = extractIds(req.body, capturedBody);
      const sid = sessionId ?? `agent-${agentId ?? FALLBACK_SESSION}`;

      const record: InteractionRecord = {
        recordId: randomUUID(),
        sessionId: sid,
        agentId,
        taskId,
        recordedAt: new Date().toISOString(),
        method: req.method,
        path: req.path,
        requestBody: req.body && Object.keys(req.body).length ? req.body : undefined,
        statusCode: res.statusCode,
        responseBody: capturedBody,
        latencyMs,
        category
      };

      ensureDir(SESSIONS_DIR);
      fs.appendFileSync(sessionFile(sid), JSON.stringify(record) + "\n", "utf8");
      sessionIndex.add(sid);
    } catch { /* never crash the request */ }
  });

  next();
}

// ─── Session index (in-memory, rebuilt from disk on startup) ─────────────────

const sessionIndex = new Set<string>();

export function initSessionIndex(): void {
  try {
    for (const f of fs.readdirSync(SESSIONS_DIR)) {
      if (f.endsWith(".jsonl")) sessionIndex.add(f.replace(/\.jsonl$/, ""));
    }
  } catch { /* dir may not exist yet */ }
}

initSessionIndex();

export function listSessions(): Array<{ sessionId: string; file: string; sizeBytes: number }> {
  return Array.from(sessionIndex).map((sid) => {
    const file = sessionFile(sid);
    let sizeBytes = 0;
    try { sizeBytes = fs.statSync(file).size; } catch { /* ok */ }
    return { sessionId: sid, file, sizeBytes };
  }).sort((a, b) => b.sizeBytes - a.sizeBytes);
}

export function getSessionRecording(sessionId: string): InteractionRecord[] {
  const file = sessionFile(sessionId);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as InteractionRecord);
}

export interface SessionAnalysis {
  sessionId: string;
  agentId?: string;
  totalInteractions: number;
  byCategory: Record<string, number>;
  taskIds: string[];
  agentIds: string[];
  firstInteractionAt?: string;
  lastInteractionAt?: string;
  totalLatencyMs: number;
  avgLatencyMs: number;
  // Token-level summary extracted from request/response bodies
  tokensSentToNexus: number;
  tokensSavedByNexus: number;
  compressEvents: number;
  distillEvents: number;
  analyzeEvents: number;
  activityTimeline: Array<{ recordedAt: string; category: string; path: string; status?: string; details?: string }>;
  userPrompts: string[];
  agentOutputs: string[];
}

export function analyzeSession(sessionId: string): SessionAnalysis {
  const records = getSessionRecording(sessionId);
  const byCategory: Record<string, number> = {};
  const taskIds = new Set<string>();
  const agentIds = new Set<string>();
  let totalLatencyMs = 0;
  let tokensSentToNexus = 0;
  let tokensSavedByNexus = 0;
  let compressEvents = 0;
  let distillEvents = 0;
  let analyzeEvents = 0;
  const timeline: SessionAnalysis["activityTimeline"] = [];
  const userPrompts: string[] = [];
  const agentOutputs: string[] = [];

  for (const r of records) {
    byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
    if (r.taskId) taskIds.add(r.taskId);
    if (r.agentId) agentIds.add(r.agentId);
    totalLatencyMs += r.latencyMs;

    const req = (r.requestBody ?? {}) as Record<string, unknown>;
    const res = (r.responseBody ?? {}) as Record<string, unknown>;

    if (r.category === "compress") {
      compressEvents++;
      if (typeof res.originalTokens === "number") tokensSentToNexus += res.originalTokens;
      if (typeof res.tokensSaved === "number") tokensSavedByNexus += res.tokensSaved;
      if (typeof req.prompt === "string") userPrompts.push(req.prompt.slice(0, 500));
    }
    if (r.category === "distill") {
      distillEvents++;
      if (typeof res.summaryTokens === "number") agentOutputs.push(`[distill snapshot: ${res.summaryTokens} tok]`);
      if (Array.isArray(req.messages)) {
        for (const m of req.messages as Array<{ role: string; content: string }>) {
          if (m.role === "user" && typeof m.content === "string") userPrompts.push(m.content.slice(0, 500));
          if (m.role === "assistant" && typeof m.content === "string") agentOutputs.push(m.content.slice(0, 500));
        }
      }
    }
    if (r.category === "analyze") {
      analyzeEvents++;
      if (typeof req.output === "string") agentOutputs.push(req.output.slice(0, 500));
    }
    if (r.category === "activity") {
      const meta = (req.metadata ?? {}) as Record<string, unknown>;
      if (typeof meta.tokensSaved === "number") tokensSavedByNexus += meta.tokensSaved;
      const status = typeof req.status === "string" ? req.status : undefined;
      const details = typeof req.details === "string" ? req.details : undefined;
      timeline.push({ recordedAt: r.recordedAt, category: r.category, path: r.path, status, details });
    } else {
      timeline.push({ recordedAt: r.recordedAt, category: r.category, path: r.path });
    }
  }

  const agentId = records.find((r) => r.agentId)?.agentId;
  const first = records[0]?.recordedAt;
  const last = records[records.length - 1]?.recordedAt;

  return {
    sessionId,
    agentId,
    totalInteractions: records.length,
    byCategory,
    taskIds: Array.from(taskIds),
    agentIds: Array.from(agentIds),
    firstInteractionAt: first,
    lastInteractionAt: last,
    totalLatencyMs: Number(totalLatencyMs.toFixed(2)),
    avgLatencyMs: records.length > 0 ? Number((totalLatencyMs / records.length).toFixed(2)) : 0,
    tokensSentToNexus,
    tokensSavedByNexus,
    compressEvents,
    distillEvents,
    analyzeEvents,
    activityTimeline: timeline,
    userPrompts: [...new Set(userPrompts)],
    agentOutputs: [...new Set(agentOutputs)]
  };
}
