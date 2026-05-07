export type AgentPlatform =
  | "claude-code"
  | "codex"
  | "local-ollama"
  | "vscode"
  | "antigravity"
  | "custom";

export interface NexusAgent {
  id: string;
  name: string;
  platform: AgentPlatform;
  instanceId: string;
  version?: string;
  tags?: string[];
  connectedAt: string;
  lastSeenAt: string;
}

export interface ActivityEvent {
  id: string;
  agentId: string;
  kind: string;
  status: "started" | "running" | "completed" | "failed";
  details: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface ControlCommand {
  command: "ping" | "pause" | "resume" | "status";
  reason?: string;
  payload?: Record<string, unknown>;
}

// Pro: prompt compression
export interface CompressRequest {
  prompt: string;
  task?: string;
  aggressiveness?: "low" | "medium" | "high";
}

export interface CompressResult {
  original: string;
  compressed: string;
  originalTokens: number;
  compressedTokens: number;
  tokensSaved: number;
  compressionRatePct: number;
  detectedTopic: string;
  sectionsRemoved: number;
  latencyMs: number;
}

// Pro: session distillation
export interface DistillMessage {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
}

export interface DistillRequest {
  agentId: string;
  messages: DistillMessage[];
  taskGoal?: string;
  sessionStandardTokens?: number;
  sessionNexusTokens?: number;
  steps?: number;
}

export interface DistillSnapshot {
  version: string;
  agentId: string;
  distilledAt: string;
  primaryGoal: string;
  keyOutputs: string[];
  toolsUsed: string[];
  stepsCompleted: number;
  tokenEfficiency: {
    standard: number;
    nexus: number;
    savingsPct: number;
  };
  beliefAtClose: {
    completion: number;
    steps: number;
  };
}

export interface DistillResult {
  agentId: string;
  snapshot: DistillSnapshot;
  summaryTokens: number;
  latencyMs: number;
}

// Pro: step analysis
export interface AnalyzeRequest {
  agentId: string;
  step: number;
  output: string;
  taskGoal: string;
  previousOutputs?: string[];
}

export interface AnalyzeResult {
  agentId: string;
  step: number;
  fsmPhase: "PLAN" | "EXECUTE" | "VERIFY" | "CONCLUDE";
  driftScore: number;
  completionProb: number;
  toolSuggestion: string;
  needsCorrection: boolean;
  correctionPatch?: string;
  latencyMs: number;
}

// ─── Workspace Memory ────────────────────────────────────────────────────────

export interface FileCacheEntry {
  absPath: string;
  contentHash: string;
  mtime: number;
  size: number;
  lastReadTurn: number;
  readCount: number;
  tokens: number;
  summary?: string;
  symbols?: SymbolInfo[];
}

export interface SymbolInfo {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "variable" | "enum" | "method";
  line: number;
  endLine: number;
  signature: string;
}

export interface ReadCachedResult {
  path: string;
  status: "full" | "unchanged" | "diff";
  content?: string;
  diff?: string;
  tokens: number;
  tokensSaved: number;
  cacheHit: boolean;
  summary?: string;
  turnLastRead: number;
  readCount: number;
  latencyMs: number;
}

export interface FileDigestResult {
  path: string;
  exists: boolean;
  hash?: string;
  size?: number;
  tokens?: number;
  summary?: string;
  symbolCount?: number;
  lastReadTurn?: number;
  latencyMs: number;
}

export interface Episode {
  id: string;
  sessionId: string;
  summary: string;
  entities: string[];
  activityIds: string[];
  filesInvolved: string[];
  startTs: string;
  endTs: string;
  phase: string;
  tokensCost: number;
}

export interface ContextBudgetResult {
  sessionId: string;
  totalBudget: number;
  used: number;
  remaining: number;
  utilizationPct: number;
  episodesInWindow: number;
  cachedFiles: number;
  cacheHitRatio: number;
  evictionCandidates: string[];
  recommendation: string;
  latencyMs: number;
}

export interface SessionHandoff {
  sessionId: string;
  episodeSummaries: string[];
  outstandingGoals: string[];
  filesModified: string[];
  tokensSavedTotal: number;
  handoffTokens: number;
  generatedAt: string;
}
