import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Benchmark recorder: append-only JSONL log of every Nexus operation that
 * exercises a "Nexus ability" (compress / distill / analyze / cache read /
 * symbol extract / handoff). Each event is self-describing and intended for
 * later offline analysis (paper writing, regression tracking, ablations).
 *
 * Storage:
 *  - In-memory ring buffer (last MAX_RING events) for live dashboards
 *  - data/benchmarks.jsonl on disk for permanent record
 */

export type NexusAbility =
  | "compress_prompt"
  | "distill_session"
  | "analyze_step"
  | "read_cached"
  | "file_digest"
  | "list_symbols"
  | "get_symbol"
  | "segment_episodes"
  | "recall_episode"
  | "context_budget"
  | "session_handoff"
  | "register_agent"
  | "send_activity"
  | "send_control";

export interface BenchmarkEvent {
  eventId: string;
  recordedAt: string;
  ability: NexusAbility;
  agentId?: string;
  sessionId?: string;
  taskId?: string;
  taskGoal?: string;
  inputTokens?: number;
  outputTokens?: number;
  tokensSaved?: number;
  compressionRatePct?: number;
  estimatedCostSavedUsd?: number;
  latencyMs?: number;
  cacheHit?: boolean;
  status?: "ok" | "noop" | "error";
  meta?: Record<string, unknown>;
}

const MAX_RING = 5000;
const COST_PER_1K_TOKENS = 0.003;

const ring: BenchmarkEvent[] = [];

const dataDir = path.resolve(__dirname, "..", "data");
const jsonlPath = path.join(dataDir, "benchmarks.jsonl");
const ROTATE_AT_BYTES = Number(process.env.NEXUS_BENCHMARK_ROTATE_BYTES ?? 50 * 1024 * 1024); // 50 MB

function ensureDir(): void {
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  } catch {
    /* best effort */
  }
}

ensureDir();

let lastRotationDay = new Date().toISOString().slice(0, 10);

function rotateIfNeeded(): void {
  try {
    const today = new Date().toISOString().slice(0, 10);
    let shouldRotate = false;
    let reason = "";

    if (today !== lastRotationDay) {
      shouldRotate = true;
      reason = lastRotationDay;
      lastRotationDay = today;
    } else if (fs.existsSync(jsonlPath) && fs.statSync(jsonlPath).size >= ROTATE_AT_BYTES) {
      shouldRotate = true;
      reason = `${today}-${Date.now()}`;
    }

    if (shouldRotate && fs.existsSync(jsonlPath)) {
      fs.renameSync(jsonlPath, path.join(dataDir, `benchmarks-${reason}.jsonl`));
    }
  } catch {
    /* rotation is best-effort; never break the request path */
  }
}

export function recordBenchmark(
  event: Omit<BenchmarkEvent, "eventId" | "recordedAt"> & {
    eventId?: string;
    recordedAt?: string;
  }
): BenchmarkEvent {
  const tokensSaved = event.tokensSaved ?? 0;
  const estimatedCostSavedUsd =
    event.estimatedCostSavedUsd ??
    Number(((tokensSaved / 1000) * COST_PER_1K_TOKENS).toFixed(6));

  const full: BenchmarkEvent = {
    eventId: event.eventId ?? randomUUID(),
    recordedAt: event.recordedAt ?? new Date().toISOString(),
    status: "ok",
    ...event,
    tokensSaved,
    estimatedCostSavedUsd
  };

  ring.unshift(full);
  if (ring.length > MAX_RING) ring.length = MAX_RING;

  try {
    rotateIfNeeded();
    fs.appendFileSync(jsonlPath, JSON.stringify(full) + "\n", "utf8");
  } catch {
    /* disk failure must not break the request path */
  }

  return full;
}

export function listBenchmarkEvents(limit = 500, ability?: NexusAbility): BenchmarkEvent[] {
  const filtered = ability ? ring.filter((e) => e.ability === ability) : ring;
  return filtered.slice(0, Math.max(1, Math.min(limit, MAX_RING)));
}

export interface BenchmarkSummary {
  generatedAt: string;
  totalEvents: number;
  eventsByAbility: Record<string, number>;
  totals: {
    inputTokens: number;
    outputTokens: number;
    tokensSaved: number;
    estimatedCostSavedUsd: number;
  };
  averages: {
    latencyMsByAbility: Record<string, number>;
    compressionRatePct: number;
    cacheHitRatio: number;
  };
  perSession: Array<{
    sessionId: string;
    events: number;
    tokensSaved: number;
    estimatedCostSavedUsd: number;
    abilitiesUsed: string[];
  }>;
  perAgent: Array<{
    agentId: string;
    events: number;
    tokensSaved: number;
    abilitiesUsed: string[];
  }>;
  jsonlPath: string;
}

export function summarizeBenchmarks(): BenchmarkSummary {
  const eventsByAbility: Record<string, number> = {};
  const latencyAcc: Record<string, { sum: number; n: number }> = {};
  const totals = { inputTokens: 0, outputTokens: 0, tokensSaved: 0, estimatedCostSavedUsd: 0 };
  let compressionSum = 0;
  let compressionN = 0;
  let cacheHits = 0;
  let cacheChecks = 0;

  const sessionMap = new Map<
    string,
    { events: number; tokensSaved: number; estimatedCostSavedUsd: number; abilities: Set<string> }
  >();
  const agentMap = new Map<
    string,
    { events: number; tokensSaved: number; abilities: Set<string> }
  >();

  for (const e of ring) {
    eventsByAbility[e.ability] = (eventsByAbility[e.ability] ?? 0) + 1;

    if (typeof e.latencyMs === "number") {
      const slot = latencyAcc[e.ability] ?? { sum: 0, n: 0 };
      slot.sum += e.latencyMs;
      slot.n += 1;
      latencyAcc[e.ability] = slot;
    }

    totals.inputTokens += e.inputTokens ?? 0;
    totals.outputTokens += e.outputTokens ?? 0;
    totals.tokensSaved += e.tokensSaved ?? 0;
    totals.estimatedCostSavedUsd += e.estimatedCostSavedUsd ?? 0;

    if (typeof e.compressionRatePct === "number") {
      compressionSum += e.compressionRatePct;
      compressionN += 1;
    }
    if (typeof e.cacheHit === "boolean") {
      cacheChecks += 1;
      if (e.cacheHit) cacheHits += 1;
    }

    if (e.sessionId) {
      const s = sessionMap.get(e.sessionId) ?? {
        events: 0,
        tokensSaved: 0,
        estimatedCostSavedUsd: 0,
        abilities: new Set<string>()
      };
      s.events += 1;
      s.tokensSaved += e.tokensSaved ?? 0;
      s.estimatedCostSavedUsd += e.estimatedCostSavedUsd ?? 0;
      s.abilities.add(e.ability);
      sessionMap.set(e.sessionId, s);
    }
    if (e.agentId) {
      const a = agentMap.get(e.agentId) ?? {
        events: 0,
        tokensSaved: 0,
        abilities: new Set<string>()
      };
      a.events += 1;
      a.tokensSaved += e.tokensSaved ?? 0;
      a.abilities.add(e.ability);
      agentMap.set(e.agentId, a);
    }
  }

  const latencyMsByAbility: Record<string, number> = {};
  for (const [k, v] of Object.entries(latencyAcc)) {
    latencyMsByAbility[k] = Number((v.sum / v.n).toFixed(3));
  }

  return {
    generatedAt: new Date().toISOString(),
    totalEvents: ring.length,
    eventsByAbility,
    totals: {
      ...totals,
      estimatedCostSavedUsd: Number(totals.estimatedCostSavedUsd.toFixed(6))
    },
    averages: {
      latencyMsByAbility,
      compressionRatePct: compressionN > 0 ? Number((compressionSum / compressionN).toFixed(2)) : 0,
      cacheHitRatio: cacheChecks > 0 ? Number((cacheHits / cacheChecks).toFixed(3)) : 0
    },
    perSession: Array.from(sessionMap.entries())
      .map(([sessionId, v]) => ({
        sessionId,
        events: v.events,
        tokensSaved: v.tokensSaved,
        estimatedCostSavedUsd: Number(v.estimatedCostSavedUsd.toFixed(6)),
        abilitiesUsed: Array.from(v.abilities)
      }))
      .sort((a, b) => b.tokensSaved - a.tokensSaved),
    perAgent: Array.from(agentMap.entries())
      .map(([agentId, v]) => ({
        agentId,
        events: v.events,
        tokensSaved: v.tokensSaved,
        abilitiesUsed: Array.from(v.abilities)
      }))
      .sort((a, b) => b.tokensSaved - a.tokensSaved),
    jsonlPath
  };
}

export function exportBenchmarks(): { format: "jsonl"; path: string; events: BenchmarkEvent[] } {
  return { format: "jsonl", path: jsonlPath, events: listBenchmarkEvents(MAX_RING) };
}

export function clearBenchmarks(): { cleared: number } {
  const n = ring.length;
  ring.length = 0;
  try {
    if (fs.existsSync(jsonlPath)) fs.unlinkSync(jsonlPath);
  } catch {
    /* ignore */
  }
  return { cleared: n };
}

export function getBenchmarkPath(): string {
  return jsonlPath;
}
