import { randomUUID } from "node:crypto";
import { recordBenchmark } from "./benchmark";
import type {
  AnalyzeRequest,
  AnalyzeResult,
  CompressRequest,
  CompressResult,
  DistillRequest,
  DistillResult,
  DistillSnapshot
} from "./types";

// ─── Token estimation (real BPE via tiktoken) ────────────────────────────────

let _enc: { encode: (text: string) => number[] } | null = null;
let _encLoading: Promise<void> | null = null;

function loadEncoder(): Promise<void> {
  if (_encLoading) return _encLoading;
  _encLoading = (async () => {
    try {
      const mod = await import("js-tiktoken");
      _enc = mod.encodingForModel("gpt-4o");
    } catch { /* fallback to heuristic */ }
  })();
  return _encLoading;
}

loadEncoder();

export function estimateTokens(text: string): number {
  if (_enc) {
    try { return _enc.encode(text).length; } catch { /* fallback */ }
  }
  return Math.max(1, Math.ceil(text.length / 4));
}

// ─── Compression ─────────────────────────────────────────────────────────────

const TOOL_KEYWORDS: Record<string, string[]> = {
  "web-search":  ["search", "find", "look up", "browse", "web", "internet", "url", "website", "news"],
  "ssh":         ["run", "execute", "command", "terminal", "server", "deploy", "ssh", "bash", "shell"],
  "browser":     ["navigate", "open", "visit", "go to", "page", "click", "screenshot"],
  "doc-reader":  ["pdf", "document", "file", "read", "extract", "paper", "docx"],
  "analyze":     ["analyze", "examine", "review", "summarize", "compare", "evaluate", "assess"],
  "code":        ["code", "write", "implement", "function", "program", "script", "class", "fix", "debug"],
  "message":     ["send", "message", "notify", "tell", "inform", "contact"],
  "event":       ["event", "calendar", "schedule", "meeting", "invite", "rsvp"],
};

const ALWAYS_KEEP_MARKERS = [
  "identity", "persona", "you are", "core behavior", "tone", "style",
  "critical", "imperative", "never", "always", "must", "important",
  "system", "instruction", "rule",
];

const SECTION_RELEVANCE: Record<string, string[]> = {
  "code":       ["code", "write", "script", "function", "program", "debug", "fix", "typescript", "javascript", "python", "class", "implement"],
  "web-search": ["search", "find", "look up", "web", "internet", "browse", "url", "news"],
  "analyze":    ["analyze", "examine", "review", "summarize", "compare", "evaluate"],
  "ssh":        ["ssh", "terminal", "server", "command", "shell", "bash"],
  "doc-reader": ["pdf", "document", "file", "read", "extract"],
  "message":    ["send", "message", "notify", "dm", "contact"],
  "event":      ["event", "calendar", "schedule", "meeting"],
};

function detectTopic(text: string, taskHint?: string): string {
  const textLower = text.toLowerCase();
  const taskLower = (taskHint ?? "").toLowerCase();
  let best = "general";
  let bestScore = 0;

  for (const [topic, keywords] of Object.entries(TOOL_KEYWORDS)) {
    // Task hint matches count 3x — intent beats content
    const taskScore = keywords.filter((kw) => taskLower.includes(kw)).length * 3;
    const textScore = keywords.filter((kw) => textLower.includes(kw)).length;
    const score = taskScore + textScore;
    if (score > bestScore) {
      bestScore = score;
      best = topic;
    }
  }
  return best;
}

function isAlwaysKeep(section: string): boolean {
  const lower = section.toLowerCase();
  return ALWAYS_KEEP_MARKERS.some((marker) => lower.includes(marker));
}

function sectionRelevant(section: string, topic: string, aggressiveness: "low" | "medium" | "high"): boolean {
  if (isAlwaysKeep(section)) return true;

  const relevantKeywords = SECTION_RELEVANCE[topic] ?? [];
  const lower = section.toLowerCase();
  const hasRelevantKeyword = relevantKeywords.some((kw) => lower.includes(kw));

  if (aggressiveness === "low") {
    // Only remove sections with zero relevant keywords AND at least 2 irrelevant-topic keywords
    const irrelevantTopics = Object.entries(SECTION_RELEVANCE)
      .filter(([t]) => t !== topic)
      .flatMap(([, kws]) => kws);
    const irrelevantHits = irrelevantTopics.filter((kw) => lower.includes(kw)).length;
    return hasRelevantKeyword || irrelevantHits < 2;
  }

  if (aggressiveness === "medium") {
    return hasRelevantKeyword;
  }

  // high: keep only clearly relevant sections
  return hasRelevantKeyword;
}

export function compressPrompt(req: CompressRequest): CompressResult {
  const t0 = performance.now();
  const { prompt, task = "", aggressiveness = "medium" } = req;

  const detectedTopic = detectTopic(prompt, task);

  // Split into sections by double newlines or markdown headers. If the prompt
  // is a flat single block (common for short instructional prompts), fall back
  // to sentence-level segmentation so compression still has units to drop.
  let rawSections = prompt.split(/\n{2,}|(?=^#{1,3} )/m).filter((s) => s.trim().length > 0);
  let segmentation: "section" | "sentence" = "section";
  if (rawSections.length <= 1) {
    const sentences = prompt
      .split(/(?<=[.!?])\s+(?=[A-Z])/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (sentences.length > 1) {
      rawSections = sentences;
      segmentation = "sentence";
    }
  }

  const kept: string[] = [];
  let removed = 0;

  for (const section of rawSections) {
    if (sectionRelevant(section, detectedTopic, aggressiveness)) {
      kept.push(section);
    } else {
      removed++;
    }
  }

  // Always keep at least 1 section
  const joiner = segmentation === "sentence" ? " " : "\n\n";
  const compressed = kept.length > 0 ? kept.join(joiner) : prompt;
  const originalTokens = estimateTokens(prompt);
  const compressedTokens = estimateTokens(compressed);
  const tokensSaved = Math.max(0, originalTokens - compressedTokens);
  const compressionRatePct = originalTokens > 0
    ? Number(((tokensSaved / originalTokens) * 100).toFixed(2))
    : 0;

  const latencyMs = Number((performance.now() - t0).toFixed(2));

  recordBenchmark({
    ability: "compress_prompt",
    inputTokens: originalTokens,
    outputTokens: compressedTokens,
    tokensSaved,
    compressionRatePct,
    latencyMs,
    meta: { detectedTopic, sectionsRemoved: removed, aggressiveness, taskHint: task || undefined, segmentation }
  });

  return {
    original: prompt,
    compressed,
    originalTokens,
    compressedTokens,
    tokensSaved,
    compressionRatePct,
    detectedTopic,
    sectionsRemoved: removed,
    latencyMs,
  };
}

// ─── Session distillation ─────────────────────────────────────────────────────

const sessionMemory = new Map<string, DistillSnapshot>();

export function distillSession(req: DistillRequest): DistillResult {
  const t0 = performance.now();
  const {
    agentId,
    messages,
    taskGoal,
    sessionStandardTokens = 0,
    sessionNexusTokens = 0,
    steps = 0,
  } = req;

  const userMsgs = messages.filter((m) => m.role === "user").map((m) => m.content);
  const asstMsgs = messages.filter((m) => m.role === "assistant").map((m) => m.content);
  const toolMsgs = messages.filter((m) => m.role === "tool").map((m) => m.content);

  const primaryGoal = taskGoal || (userMsgs[0]?.slice(0, 200) ?? "Unknown");
  const keyOutputs = asstMsgs.slice(-2).filter((a) => a.trim().length > 0).map((a) => a.slice(0, 200));

  const toolsUsed: string[] = [];
  for (const tm of toolMsgs) {
    for (const toolName of Object.keys(TOOL_KEYWORDS)) {
      if (tm.toLowerCase().includes(toolName.replace("-", " ")) && !toolsUsed.includes(toolName)) {
        toolsUsed.push(toolName);
      }
    }
  }

  const savingsPct = sessionStandardTokens > 0
    ? Number(((1 - sessionNexusTokens / sessionStandardTokens) * 100).toFixed(1))
    : 0;

  const snapshot: DistillSnapshot = {
    version: "1.0.0",
    agentId,
    distilledAt: new Date().toISOString(),
    primaryGoal,
    keyOutputs,
    toolsUsed,
    stepsCompleted: steps,
    tokenEfficiency: {
      standard: sessionStandardTokens,
      nexus: sessionNexusTokens,
      savingsPct,
    },
    beliefAtClose: {
      completion: Math.min(0.08 + steps * 0.09, 0.99),
      steps,
    },
  };

  sessionMemory.set(agentId, snapshot);

  const summaryText = [
    `Previous session: ${primaryGoal.slice(0, 100)}.`,
    `Completed ${steps} steps.`,
    keyOutputs[0] ? `Key finding: ${keyOutputs[0].slice(0, 100)}.` : "",
  ].filter(Boolean).join(" ");

  const latencyMs = Number((performance.now() - t0).toFixed(2));
  const summaryTokens = estimateTokens(summaryText);
  const tokensSaved = Math.max(0, sessionStandardTokens - sessionNexusTokens);

  recordBenchmark({
    ability: "distill_session",
    agentId,
    taskGoal: primaryGoal,
    inputTokens: sessionStandardTokens,
    outputTokens: summaryTokens,
    tokensSaved,
    latencyMs,
    meta: { stepsCompleted: steps, toolsUsed, savingsPct, keyOutputCount: keyOutputs.length }
  });

  return {
    agentId,
    snapshot,
    summaryTokens,
    latencyMs,
  };
}

export function getMemory(agentId: string): { found: boolean; snapshot?: DistillSnapshot } {
  const snapshot = sessionMemory.get(agentId);
  return snapshot ? { found: true, snapshot } : { found: false };
}

// ─── Step analysis & drift correction ────────────────────────────────────────

const REPEAT_THRESHOLD = 0.7;

function cosineSimilarityApprox(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\s+/));
  const setB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = [...setA].filter((w) => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? intersection / union : 0;
}

function detectFsmPhase(step: number, completionProb: number): AnalyzeResult["fsmPhase"] {
  if (step <= 1) return "PLAN";
  if (completionProb > 0.85) return "CONCLUDE";
  if (completionProb > 0.55) return "VERIFY";
  return "EXECUTE";
}

export function analyzeStep(req: AnalyzeRequest): AnalyzeResult {
  const t0 = performance.now();
  const { agentId, step, output, taskGoal, previousOutputs = [] } = req;

  // Drift: check similarity to previous outputs (repetition detection)
  const maxSim = previousOutputs.reduce(
    (max, prev) => Math.max(max, cosineSimilarityApprox(output, prev)),
    0
  );
  const driftScore = Number(maxSim.toFixed(3));
  const isRepeat = driftScore > REPEAT_THRESHOLD;

  // Goal alignment: check if output references goal keywords
  const goalWords = new Set(taskGoal.toLowerCase().split(/\s+/).filter((w) => w.length > 4));
  const outputLower = output.toLowerCase();
  const alignedWords = [...goalWords].filter((w) => outputLower.includes(w)).length;
  const goalAlignment = goalWords.size > 0 ? alignedWords / goalWords.size : 1;

  // Completion probability
  const stepFactor = Math.min(step * 0.08, 0.6);
  const completionProb = Number(Math.min(stepFactor + goalAlignment * 0.4, 0.99).toFixed(3));

  const fsmPhase = detectFsmPhase(step, completionProb);
  const suggestedTool = detectTopic(output);
  const needsCorrection = isRepeat || (goalAlignment < 0.15 && step > 2);

  let correctionPatch: string | undefined;
  if (needsCorrection) {
    if (isRepeat) {
      correctionPatch = `[NEXUS] You are repeating previous output. Advance to the next step toward: ${taskGoal.slice(0, 100)}`;
    } else {
      correctionPatch = `[NEXUS] Output is drifting from objective. Refocus on: ${taskGoal.slice(0, 100)}`;
    }
  }

  const latencyMs = Number((performance.now() - t0).toFixed(2));

  recordBenchmark({
    ability: "analyze_step",
    agentId,
    taskGoal,
    latencyMs,
    meta: {
      step,
      fsmPhase,
      driftScore,
      completionProb,
      toolSuggestion: suggestedTool,
      needsCorrection,
      correctionEmitted: Boolean(correctionPatch)
    }
  });

  return {
    agentId,
    step,
    fsmPhase,
    driftScore,
    completionProb,
    toolSuggestion: suggestedTool,
    needsCorrection,
    correctionPatch,
    latencyMs,
  };
}
