import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  recordBenchmark,
  listBenchmarkEvents,
  summarizeBenchmarks,
  clearBenchmarks,
  getBenchmarkPath
} from "../src/benchmark";

test("recordBenchmark persists to ring + JSONL with computed cost", () => {
  clearBenchmarks();
  const ev = recordBenchmark({
    ability: "compress_prompt",
    agentId: "test-agent",
    sessionId: "sess-1",
    inputTokens: 1000,
    outputTokens: 600,
    tokensSaved: 400,
    compressionRatePct: 40,
    latencyMs: 1.5
  });
  assert.equal(typeof ev.eventId, "string");
  assert.equal(ev.estimatedCostSavedUsd, 0.0012); // 400/1000 * 0.003
  const events = listBenchmarkEvents(10);
  assert.equal(events.length, 1);
  assert.equal(events[0].ability, "compress_prompt");

  const jsonl = fs.readFileSync(getBenchmarkPath(), "utf8").trim().split("\n");
  assert.equal(jsonl.length, 1);
  assert.equal(JSON.parse(jsonl[0]).eventId, ev.eventId);
});

test("summarizeBenchmarks rolls up per-session and per-agent", () => {
  clearBenchmarks();
  recordBenchmark({ ability: "compress_prompt", agentId: "a1", sessionId: "s1", tokensSaved: 100, compressionRatePct: 25, latencyMs: 1 });
  recordBenchmark({ ability: "read_cached", agentId: "a1", sessionId: "s1", tokensSaved: 500, cacheHit: true, latencyMs: 0.3 });
  recordBenchmark({ ability: "read_cached", agentId: "a2", sessionId: "s2", tokensSaved: 0, cacheHit: false, latencyMs: 5 });
  const sum = summarizeBenchmarks();
  assert.equal(sum.totalEvents, 3);
  assert.equal(sum.totals.tokensSaved, 600);
  assert.equal(sum.eventsByAbility.read_cached, 2);
  assert.equal(sum.averages.cacheHitRatio, 0.5);
  const s1 = sum.perSession.find((s) => s.sessionId === "s1");
  assert.ok(s1);
  assert.equal(s1!.tokensSaved, 600);
  const a1 = sum.perAgent.find((a) => a.agentId === "a1");
  assert.ok(a1);
  assert.deepEqual(new Set(a1!.abilitiesUsed), new Set(["compress_prompt", "read_cached"]));
});

test("clearBenchmarks empties ring + removes JSONL", () => {
  recordBenchmark({ ability: "analyze_step", latencyMs: 1 });
  assert.ok(fs.existsSync(getBenchmarkPath()));
  const r = clearBenchmarks();
  assert.ok(r.cleared >= 1);
  assert.equal(listBenchmarkEvents(10).length, 0);
  assert.equal(fs.existsSync(getBenchmarkPath()), false);
});
