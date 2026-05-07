import { test } from "node:test";
import assert from "node:assert/strict";
import { compressPrompt } from "../src/pro";
import { clearBenchmarks } from "../src/benchmark";

test("compressPrompt drops irrelevant sentences in flat single-block prompts", () => {
  clearBenchmarks();
  const prompt =
    "You are a backend engineer. Your job is to write Python code for CSV ingestion. " +
    "For PDF tasks use the doc-reader tool. " +
    "For browser navigation use the browser. " +
    "For Slack DMs use the message tool. " +
    "For calendar events use the event tool. " +
    "Write a Python loader that upserts a 50-column CSV into Postgres.";
  const r = compressPrompt({ prompt, task: "write python csv to postgres loader", aggressiveness: "medium" });
  assert.ok(r.compressedTokens < r.originalTokens, `expected savings, got ${r.tokensSaved}`);
  assert.ok(r.tokensSaved > 0);
  assert.equal(r.detectedTopic, "code");
});

test("compressPrompt always keeps at least the original prompt as fallback", () => {
  clearBenchmarks();
  const prompt = "Search the web for recent climate news.";
  const r = compressPrompt({ prompt, task: "browse", aggressiveness: "high" });
  assert.ok(r.compressed.length > 0);
  assert.ok(r.originalTokens > 0);
});
