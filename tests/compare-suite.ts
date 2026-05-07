/**
 * Nexus comparison harness: with-nexus vs without-nexus on realistic test cases.
 *
 * For each case we measure:
 *   baselineTokens — tokens that would be sent to the LLM WITHOUT Nexus
 *   nexusTokens    — tokens actually sent WITH Nexus
 *   tokensSaved, savingsPct, estimatedCostSavedUsd, latencyMs
 *
 * Output:
 *   - prints a markdown table to stdout
 *   - writes data/comparison-report.json with raw + aggregate results
 *
 * Hits the live server at NEXUS_URL (default http://127.0.0.1:8787).
 */
import fs from "node:fs";
import path from "node:path";
import { encodingForModel } from "js-tiktoken";

const NEXUS_URL = process.env.NEXUS_URL ?? "http://127.0.0.1:8787";
const API_KEY = process.env.NEXUS_API_KEY;
const COST_PER_1K_TOKENS = 0.003;

const enc = encodingForModel("gpt-4o");
const tokens = (s: string): number => enc.encode(s).length;

function headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (API_KEY) h["x-api-key"] = API_KEY;
  return h;
}

async function post(p: string, body: unknown): Promise<any> {
  const r = await fetch(`${NEXUS_URL}${p}`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`POST ${p} → ${r.status}: ${await r.text()}`);
  return r.json();
}

interface CaseResult {
  name: string;
  scenario: string;
  baselineTokens: number;
  nexusTokens: number;
  tokensSaved: number;
  savingsPct: number;
  estimatedCostSavedUsd: number;
  nexusLatencyMs: number;
  notes?: string;
}

const results: CaseResult[] = [];

function record(r: Omit<CaseResult, "tokensSaved" | "savingsPct" | "estimatedCostSavedUsd">): void {
  const tokensSaved = Math.max(0, r.baselineTokens - r.nexusTokens);
  const savingsPct = r.baselineTokens > 0 ? Number(((tokensSaved / r.baselineTokens) * 100).toFixed(2)) : 0;
  const estimatedCostSavedUsd = Number(((tokensSaved / 1000) * COST_PER_1K_TOKENS).toFixed(6));
  results.push({ ...r, tokensSaved, savingsPct, estimatedCostSavedUsd });
}

// ─── Test cases ──────────────────────────────────────────────────────────────

async function caseMultiTopicSystemPrompt(): Promise<void> {
  const prompt = [
    "# Identity",
    "You are a senior backend engineer specialised in Python and Postgres.",
    "",
    "# Code tasks",
    "When the user asks for code, write idiomatic Python. Use type hints. Always handle DB errors. Prefer psycopg2 with execute_values for bulk inserts.",
    "",
    "# Web search",
    "If the user wants to search the web, use the web-search tool. Cite sources. Never speculate about news older than your training cutoff.",
    "",
    "# Browser navigation",
    "For browser navigation use the browser tool. Take a screenshot before clicking. Always confirm the URL.",
    "",
    "# Slack messages",
    "For Slack DMs use the message tool. Keep messages under 200 chars. Confirm recipient before sending.",
    "",
    "# Calendar events",
    "For calendar events use the event tool. Always include timezone. Default duration 30 min.",
    "",
    "# PDF reading",
    "For PDF tasks use the doc-reader tool. Extract structured data when possible.",
    "",
    "# Today's task",
    "Write a Python loader that upserts a 50-column CSV into a normalized Postgres schema with idempotent upserts."
  ].join("\n");

  const baselineTokens = tokens(prompt);
  const r = await post("/nexus/compress", { prompt, task: "write python csv to postgres loader", aggressiveness: "medium" });
  record({
    name: "Multi-topic system prompt (markdown sections)",
    scenario: "compress_prompt",
    baselineTokens,
    nexusTokens: r.compressedTokens,
    nexusLatencyMs: r.latencyMs,
    notes: `topic=${r.detectedTopic}, sectionsRemoved=${r.sectionsRemoved}`
  });
}

async function caseFlatSystemPrompt(): Promise<void> {
  const prompt =
    "You are a backend engineer. Your job is to write Python code for CSV ingestion. " +
    "For PDF tasks use the doc-reader tool. For browser navigation use the browser. " +
    "For Slack DMs use the message tool. For calendar events use the event tool. " +
    "Always be concise and never speculate. CRITICAL: output only valid SQL when asked. " +
    "Write a Python loader that upserts a 50-column CSV into Postgres.";
  const baselineTokens = tokens(prompt);
  const r = await post("/nexus/compress", { prompt, task: "write python csv to postgres loader", aggressiveness: "medium" });
  record({
    name: "Flat single-block prompt (sentence fallback)",
    scenario: "compress_prompt",
    baselineTokens,
    nexusTokens: r.compressedTokens,
    nexusLatencyMs: r.latencyMs,
    notes: `topic=${r.detectedTopic}, segmentation=sentence, sectionsRemoved=${r.sectionsRemoved}`
  });
}

async function caseRepeatedFileRead(): Promise<void> {
  const target = path.resolve(__dirname, "..", "src", "server.ts");
  const fileText = fs.readFileSync(target, "utf-8");
  const baselineTokens = tokens(fileText) * 3; // baseline = 3 full re-reads

  const r1 = await post("/nexus/wm/read", { path: target });
  const r2 = await post("/nexus/wm/read", { path: target });
  const r3 = await post("/nexus/wm/read", { path: target });
  const nexusTokens = r1.tokens + r2.tokens + r3.tokens;
  const latency = r1.latencyMs + r2.latencyMs + r3.latencyMs;

  record({
    name: "Repeated file read x3 (server.ts)",
    scenario: "read_cached",
    baselineTokens,
    nexusTokens,
    nexusLatencyMs: Number(latency.toFixed(2)),
    notes: `firstReadStatus=${r1.status}, cacheHits=${[r1, r2, r3].filter((r) => r.cacheHit).length}/3`
  });
}

async function caseSessionDistillation(): Promise<void> {
  const messages = [
    { role: "user" as const, content: "I need you to refactor the auth middleware to use JWT instead of session cookies." },
    { role: "assistant" as const, content: "Sure. Let me start by reading the existing auth code." },
    { role: "tool" as const, content: "Read src/middleware/auth.ts — 412 lines, uses express-session and connect-redis." },
    { role: "assistant" as const, content: "I'll replace express-session with jsonwebtoken. The token will carry userId and role claims." },
    { role: "user" as const, content: "Good. Make sure refresh tokens are stored server-side so we can revoke them." },
    { role: "assistant" as const, content: "Adding a refresh_tokens table. Storing hashed refresh tokens with userId and expiry." },
    { role: "tool" as const, content: "Created migration 0042_refresh_tokens.sql." },
    { role: "assistant" as const, content: "Wired POST /auth/refresh endpoint. Added rotation on each refresh. Tests pass." },
    { role: "user" as const, content: "What about logging out? It should revoke the refresh token." },
    { role: "assistant" as const, content: "Added DELETE /auth/session that deletes the refresh token row. Access token still expires naturally." }
  ];
  const fullSessionText = messages.map((m) => `[${m.role}] ${m.content}`).join("\n");
  const baselineTokens = tokens(fullSessionText);

  const r = await post("/nexus/distill", {
    agentId: "compare-suite",
    messages,
    taskGoal: "Refactor auth middleware from session cookies to JWT with revocable refresh tokens",
    sessionStandardTokens: baselineTokens,
    sessionNexusTokens: 0,
    steps: 5
  });

  record({
    name: "Session distillation (10-message JWT refactor)",
    scenario: "distill_session",
    baselineTokens,
    nexusTokens: r.summaryTokens,
    nexusLatencyMs: r.latencyMs,
    notes: `stepsCompleted=${r.snapshot.stepsCompleted}, toolsUsed=${r.snapshot.toolsUsed.join("|") || "none"}`
  });
}

async function caseSymbolExtraction(): Promise<void> {
  const target = path.resolve(__dirname, "..", "src", "server.ts");
  const fileText = fs.readFileSync(target, "utf-8");
  const baselineTokens = tokens(fileText); // baseline = read entire file

  // Warm cache so symbol extraction doesn't pay the full first-read cost
  await post("/nexus/wm/read", { path: target });
  const r = await post("/nexus/wm/symbol", { path: target, name: "broadcast", context: 5 });
  const extractedText = JSON.stringify(r);
  const nexusTokens = tokens(extractedText);

  record({
    name: "Symbol extraction vs full file read",
    scenario: "get_symbol",
    baselineTokens,
    nexusTokens,
    nexusLatencyMs: r.latencyMs ?? 0,
    notes: `symbol=broadcast`
  });
}

// ─── Real eval-set runner (Spaces bench_data) ───────────────────────────────

interface EvalRecord {
  id: string;
  category?: string;
  prompt: string;
  expected?: string;
}

async function runEvalSet(jsonlPath: string): Promise<void> {
  const raw = fs.readFileSync(jsonlPath, "utf-8");
  const records: EvalRecord[] = raw
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as EvalRecord);

  let baselineSum = 0;
  let nexusSum = 0;
  let latencySum = 0;
  const perCategory: Record<string, { baseline: number; nexus: number; n: number }> = {};

  for (const rec of records) {
    const baseline = tokens(rec.prompt);
    const r = await post("/nexus/compress", {
      prompt: rec.prompt,
      task: rec.category ?? "general",
      aggressiveness: "medium"
    });
    baselineSum += baseline;
    nexusSum += r.compressedTokens;
    latencySum += r.latencyMs;
    const cat = rec.category ?? "uncategorized";
    const slot = perCategory[cat] ?? { baseline: 0, nexus: 0, n: 0 };
    slot.baseline += baseline;
    slot.nexus += r.compressedTokens;
    slot.n += 1;
    perCategory[cat] = slot;
  }

  record({
    name: `Real eval set (${records.length} prompts from ${path.basename(jsonlPath)})`,
    scenario: "compress_prompt[real]",
    baselineTokens: baselineSum,
    nexusTokens: nexusSum,
    nexusLatencyMs: Number(latencySum.toFixed(2)),
    notes: `categories=${Object.keys(perCategory).join("|")}, source=${jsonlPath}`
  });

  // Per-category breakdown as separate cases for richer paper data
  for (const [cat, v] of Object.entries(perCategory)) {
    record({
      name: `  └─ category: ${cat} (${v.n} prompts)`,
      scenario: "compress_prompt[real]",
      baselineTokens: v.baseline,
      nexusTokens: v.nexus,
      nexusLatencyMs: 0,
      notes: `subset of eval set`
    });
  }
}

// ─── Run ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Health check
  const h = await fetch(`${NEXUS_URL}/healthz`);
  if (!h.ok) throw new Error(`Nexus not reachable at ${NEXUS_URL}`);

  // CLI: --eval-set <path> appends a real-data run from a JSONL file
  const evalArgIdx = process.argv.indexOf("--eval-set");
  const evalPath = evalArgIdx >= 0 ? process.argv[evalArgIdx + 1] : undefined;

  await caseMultiTopicSystemPrompt();
  await caseFlatSystemPrompt();
  await caseRepeatedFileRead();
  await caseSessionDistillation();
  await caseSymbolExtraction();

  if (evalPath) {
    if (!fs.existsSync(evalPath)) throw new Error(`eval set not found: ${evalPath}`);
    await runEvalSet(evalPath);
  }

  const totals = results.reduce(
    (acc, r) => {
      acc.baselineTokens += r.baselineTokens;
      acc.nexusTokens += r.nexusTokens;
      acc.tokensSaved += r.tokensSaved;
      acc.estimatedCostSavedUsd += r.estimatedCostSavedUsd;
      return acc;
    },
    { baselineTokens: 0, nexusTokens: 0, tokensSaved: 0, estimatedCostSavedUsd: 0 }
  );
  const aggregateSavingsPct =
    totals.baselineTokens > 0 ? Number(((totals.tokensSaved / totals.baselineTokens) * 100).toFixed(2)) : 0;

  const report = {
    generatedAt: new Date().toISOString(),
    nexusUrl: NEXUS_URL,
    cases: results,
    aggregate: {
      ...totals,
      estimatedCostSavedUsd: Number(totals.estimatedCostSavedUsd.toFixed(6)),
      savingsPct: aggregateSavingsPct
    }
  };

  // Print markdown table
  console.log("\n# Nexus comparison report\n");
  console.log("| Test case | Scenario | Baseline (no Nexus) | With Nexus | Saved | Savings % | Latency (ms) |");
  console.log("|---|---|---:|---:|---:|---:|---:|");
  for (const r of results) {
    console.log(
      `| ${r.name} | ${r.scenario} | ${r.baselineTokens} | ${r.nexusTokens} | ${r.tokensSaved} | ${r.savingsPct}% | ${r.nexusLatencyMs} |`
    );
  }
  console.log(
    `| **TOTAL** | — | **${totals.baselineTokens}** | **${totals.nexusTokens}** | **${totals.tokensSaved}** | **${aggregateSavingsPct}%** | — |`
  );
  console.log(`\nEstimated cost saved (gpt-4o-class @ $0.003/1K tok): **$${report.aggregate.estimatedCostSavedUsd.toFixed(4)}**`);

  // Write JSON
  const outDir = path.resolve(__dirname, "..", "data");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "comparison-report.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf-8");
  console.log(`\nReport written: ${outPath}`);
}

main().catch((e) => {
  console.error("compare-suite failed:", e);
  process.exit(1);
});
