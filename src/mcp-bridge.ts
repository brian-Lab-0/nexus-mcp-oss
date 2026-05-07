import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const nexusUrl = process.env.NEXUS_URL ?? "http://127.0.0.1:8787";
const server = new McpServer({
  name: "nexus-mcp-bridge",
  version: "1.0.0"
});

const apiKey = process.env.NEXUS_API_KEY?.trim();

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  if (apiKey) h["x-api-key"] = apiKey;
  return h;
}

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(`${nexusUrl}${path}`, { headers: authHeaders() });
  if (!response.ok) {
    throw new Error(`Nexus request failed (${response.status}) for ${path}`);
  }
  return response.json();
}

async function postJson(path: string, payload: unknown): Promise<unknown> {
  const response = await fetch(`${nexusUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(`Nexus request failed (${response.status}) for ${path}`);
  }
  return response.json();
}

function asTextResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

server.tool("nexus_overview", "Fetch Nexus service overview.", async () => {
  const result = await getJson("/nexus");
  return asTextResult(result);
});

server.tool(
  "nexus_register_agent",
  "Register or update a connected agent instance.",
  {
    id: z.string().min(2),
    name: z.string().min(1),
    platform: z.enum(["claude-code", "codex", "local-ollama", "vscode", "antigravity", "custom"]),
    instanceId: z.string().min(2),
    version: z.string().optional(),
    tags: z.array(z.string()).optional()
  },
  async (args) => {
    const result = await postJson("/nexus/agents", args);
    return asTextResult(result);
  }
);

server.tool(
  "nexus_send_activity",
  "Send lifecycle activity event to Nexus with optional session and token metadata.",
  {
    agentId: z.string().min(2),
    kind: z.string().min(1),
    status: z.enum(["started", "running", "completed", "failed"]),
    details: z.string().min(1),
    sessionId: z.string().optional(),
    tokensInput: z.number().nonnegative().optional(),
    tokensOutput: z.number().nonnegative().optional(),
    tokensSaved: z.number().nonnegative().optional()
  },
  async (args) => {
    const metadata: Record<string, unknown> = {};
    if (args.sessionId) metadata.sessionId = args.sessionId;
    if (typeof args.tokensInput === "number") metadata.tokensInput = args.tokensInput;
    if (typeof args.tokensOutput === "number") metadata.tokensOutput = args.tokensOutput;
    if (typeof args.tokensSaved === "number") metadata.tokensSaved = args.tokensSaved;

    const result = await postJson("/nexus/activities", {
      agentId: args.agentId,
      kind: args.kind,
      status: args.status,
      details: args.details,
      metadata
    });
    return asTextResult(result);
  }
);

server.tool(
  "nexus_list_activities",
  "List recent Nexus activity events.",
  {
    limit: z.number().int().positive().max(1000).optional()
  },
  async (args) => {
    const limit = args.limit ?? 100;
    const result = await getJson(`/nexus/activities?limit=${limit}`);
    return asTextResult(result);
  }
);

server.tool(
  "nexus_list_sessions",
  "List session analytics including compression and cost estimates.",
  {
    limit: z.number().int().positive().max(1000).optional()
  },
  async (args) => {
    const limit = args.limit ?? 200;
    const result = await getJson(`/nexus/sessions?limit=${limit}`);
    return asTextResult(result);
  }
);

server.tool(
  "nexus_send_control",
  "Send control command to agent via Nexus.",
  {
    agentId: z.string().min(2),
    command: z.enum(["ping", "pause", "resume", "status"]),
    reason: z.string().optional()
  },
  async (args) => {
    const result = await postJson(`/nexus/agents/${encodeURIComponent(args.agentId)}/control`, {
      command: args.command,
      reason: args.reason
    });
    return asTextResult(result);
  }
);

// ─── Meta tools ──────────────────────────────────────────────────────────────

server.tool(
  "nexus_agent_guide",
  "Fetch the complete Nexus Pro usage guide — tool descriptions, workflow steps, token optimization strategy, and copy-paste examples. Call this at session start if you are unfamiliar with Nexus, or pass format='markdown' for a structured document.",
  {
    format: z.enum(["json", "markdown"]).optional().describe("Response format. 'markdown' is easier to read; 'json' is structured. Defaults to markdown.")
  },
  async (args) => {
    const fmt = args.format ?? "markdown";
    const url = fmt === "markdown" ? `${nexusUrl}/nexus/guide.md` : `${nexusUrl}/nexus/guide`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Guide fetch failed (${res.status})`);
    const text = fmt === "markdown" ? await res.text() : JSON.stringify(await res.json(), null, 2);
    return { content: [{ type: "text" as const, text }] };
  }
);

// ─── Pro tools ────────────────────────────────────────────────────────────────

server.tool(
  "nexus_compress_prompt",
  "Compress a prompt by stripping irrelevant sections before sending to an AI model. Returns compressed text + token savings estimate. Use this before every expensive LLM call to reduce input token cost.",
  {
    prompt: z.string().min(1).describe("The full prompt text to compress"),
    task: z.string().optional().describe("Short description of the current task (improves relevance detection)"),
    aggressiveness: z.enum(["low", "medium", "high"]).optional().describe("Compression level: low=safe, medium=default, high=aggressive")
  },
  async (args) => {
    const result = await postJson("/nexus/compress", args);
    return asTextResult(result);
  }
);

server.tool(
  "nexus_distill_session",
  "Distill the current session into a compact cold-start snapshot (~150 tokens). Store this at session end and inject it at the next session start instead of replaying full history — saves thousands of tokens on long sessions.",
  {
    agentId: z.string().min(2),
    messages: z.array(z.object({
      role: z.enum(["user", "assistant", "tool", "system"]),
      content: z.string()
    })).min(1).describe("Session messages to distill"),
    taskGoal: z.string().optional().describe("The primary task goal for this session"),
    sessionStandardTokens: z.number().nonnegative().optional().describe("Tokens that would have been used without compression"),
    sessionNexusTokens: z.number().nonnegative().optional().describe("Actual tokens used with Nexus compression"),
    steps: z.number().int().nonnegative().optional().describe("Number of steps completed")
  },
  async (args) => {
    const result = await postJson("/nexus/distill", args);
    return asTextResult(result);
  }
);

server.tool(
  "nexus_get_memory",
  "Retrieve the distilled cold-start memory snapshot for an agent. Inject the returned summary at the start of a new session to restore context without replaying full history.",
  {
    agentId: z.string().min(2).describe("Agent ID to retrieve memory for")
  },
  async (args) => {
    const result = await getJson(`/nexus/memory/${encodeURIComponent(args.agentId)}`);
    return asTextResult(result);
  }
);

server.tool(
  "nexus_analyze_step",
  "Analyze an agent's step output for drift, repetition, and goal alignment. Returns FSM phase, drift score, completion probability, and an optional correction patch. Call this periodically to catch when an agent is going off-track before burning more tokens.",
  {
    agentId: z.string().min(2),
    step: z.number().int().nonnegative().describe("Current step number"),
    output: z.string().min(1).describe("The agent's output for this step"),
    taskGoal: z.string().min(1).describe("The original task goal"),
    previousOutputs: z.array(z.string()).optional().describe("Previous step outputs for repetition detection")
  },
  async (args) => {
    const result = await postJson("/nexus/analyze", args);
    return asTextResult(result);
  }
);

// ─── Workspace Memory tools ─────────────────────────────────────────────────

server.tool(
  "nexus_read_cached",
  "Read a file through the workspace memory cache. On first read, returns full content and caches it. On subsequent reads of an unchanged file, returns only a summary + metadata — saving the full token cost. Use this instead of raw file reads to avoid re-digesting files the agent has already seen.",
  {
    path: z.string().min(1).describe("Absolute path to the file"),
    forceFull: z.boolean().optional().describe("Force full content even if cached (default: false)")
  },
  async (args) => {
    const result = await postJson("/nexus/wm/read", args);
    return asTextResult(result);
  }
);

server.tool(
  "nexus_file_digest",
  "Get metadata about a file without reading its content: hash, size, token count, summary, symbol count. Zero-token way to check if a file has changed since last read.",
  {
    path: z.string().min(1).describe("Absolute path to the file")
  },
  async (args) => {
    const result = await postJson("/nexus/wm/digest", args);
    return asTextResult(result);
  }
);

server.tool(
  "nexus_list_symbols",
  "List all symbols (functions, classes, interfaces, types, variables) in a TypeScript/JavaScript file. Returns name, kind, line number, and signature for each. Use this to understand file structure without reading the full file.",
  {
    path: z.string().min(1).describe("Absolute path to a .ts/.tsx/.js/.jsx file")
  },
  async (args) => {
    const result = await postJson("/nexus/wm/symbols", args);
    return asTextResult(result);
  }
);

server.tool(
  "nexus_get_symbol",
  "Extract a single symbol (function, class, etc.) from a file with surrounding context lines. Returns only the relevant code slice instead of the entire file — typically 10-50 tokens instead of hundreds.",
  {
    path: z.string().min(1).describe("Absolute path to the file"),
    name: z.string().min(1).describe("Symbol name to extract"),
    context: z.number().int().min(0).max(50).optional().describe("Lines of context above/below (default: 5)")
  },
  async (args) => {
    const result = await postJson("/nexus/wm/symbol", args);
    return asTextResult(result);
  }
);

server.tool(
  "nexus_segment_episodes",
  "Segment a batch of activities into coherent episodes by detecting time gaps, phase transitions, and file-set changes. Each episode gets a summary, entity list, and phase label. Call this periodically or at session end to build the episode store.",
  {
    sessionId: z.string().min(1).describe("Session ID to segment activities for"),
    activities: z.array(z.object({
      id: z.string(),
      timestamp: z.string(),
      details: z.string(),
      status: z.string(),
      metadata: z.record(z.string(), z.unknown()).optional()
    })).describe("Activities to segment into episodes")
  },
  async (args) => {
    const result = await postJson("/nexus/wm/episodes/segment", args);
    return asTextResult(result);
  }
);

server.tool(
  "nexus_recall_episode",
  "Retrieve the most relevant past episodes for a query. Uses keyword matching + recency scoring. Returns episode summaries, entities, and files involved. Use this to restore context about prior work without replaying full history.",
  {
    query: z.string().min(1).describe("Natural language query to search episodes"),
    k: z.number().int().min(1).max(20).optional().describe("Number of episodes to return (default: 3)")
  },
  async (args) => {
    const result = await postJson("/nexus/wm/episodes/recall", args);
    return asTextResult(result);
  }
);

server.tool(
  "nexus_context_budget",
  "Check or manage the session's token budget. Returns: used/remaining tokens, utilization %, cache hit ratio, eviction candidates, and a recommendation. Use 'set' to declare budget, 'track' to log usage, 'get' to check status.",
  {
    sessionId: z.string().min(1).describe("Session ID"),
    action: z.enum(["get", "set", "track"]).describe("'get' = check budget, 'set' = declare budget limit, 'track' = log token usage"),
    budget: z.number().int().positive().optional().describe("Token budget to set (only for action='set')"),
    tokens: z.number().int().nonnegative().optional().describe("Tokens to track (only for action='track')")
  },
  async (args) => {
    const result = await postJson("/nexus/wm/budget", args);
    return asTextResult(result);
  }
);

server.tool(
  "nexus_session_handoff",
  "Generate a warm handoff for a session. Returns episode summaries, outstanding goals, files modified, and total tokens saved. Inject this at the start of the next session for instant context restoration.",
  {
    sessionId: z.string().min(1).describe("Session ID to generate handoff for")
  },
  async (args) => {
    const result = await getJson(`/nexus/wm/handoff/${encodeURIComponent(args.sessionId)}`);
    return asTextResult(result);
  }
);

server.tool(
  "nexus_cache_stats",
  "Get workspace memory cache statistics: total entries, hit/miss counts, hit ratio. Use to monitor cache effectiveness.",
  {},
  async () => {
    const result = await getJson("/nexus/wm/stats");
    return asTextResult(result);
  }
);

// ─── Session recording tools ─────────────────────────────────────────────────

server.tool(
  "nexus_list_recordings",
  "List all recorded sessions — every session that had at least one Nexus interaction. Returns sessionId, file path, and size. Use to discover sessions for offline analysis.",
  {},
  async () => {
    const result = await getJson("/nexus/recordings");
    return asTextResult(result);
  }
);

server.tool(
  "nexus_session_analysis",
  "Full offline analysis of a recorded session: total interactions, breakdown by category (compress/distill/analyze/activity/control/workspace_memory), task IDs, agent IDs, tokens sent to Nexus, tokens saved, activity timeline, captured user prompts, and agent outputs. Use this to reconstruct exactly what happened during a task-solving session.",
  {
    sessionId: z.string().min(1).describe("Session ID to analyze")
  },
  async (args) => {
    const result = await getJson(`/nexus/recordings/${encodeURIComponent(args.sessionId)}/analysis`);
    return asTextResult(result);
  }
);

server.tool(
  "nexus_session_recording",
  "Retrieve the raw interaction log for a session — every request/response pair recorded by Nexus, including full request bodies (user prompts, messages, file paths) and response bodies (compressed prompts, distill snapshots, analyze results). Filtered by optional category.",
  {
    sessionId: z.string().min(1).describe("Session ID"),
    category: z.enum([
      "agent_lifecycle", "activity", "control", "compress", "distill",
      "analyze", "memory", "workspace_memory", "session_query"
    ]).optional().describe("Filter to a specific interaction category")
  },
  async (args) => {
    const raw = await getJson(`/nexus/recordings/${encodeURIComponent(args.sessionId)}`) as { records: unknown[] };
    if (args.category && raw.records) {
      raw.records = (raw.records as Array<{ category: string }>).filter((r) => r.category === args.category);
    }
    return asTextResult(raw);
  }
);

// ─── Benchmark / paper-data tools ────────────────────────────────────────────

server.tool(
  "nexus_benchmark_summary",
  "Aggregate benchmark stats across all recorded Nexus operations: totals, per-ability latency, per-session and per-agent rollups, cache hit ratio, total tokens saved, estimated USD saved. Use this to report on real-world Nexus impact.",
  {},
  async () => {
    const result = await getJson("/nexus/benchmark/summary");
    return asTextResult(result);
  }
);

server.tool(
  "nexus_benchmark_events",
  "List raw benchmark events (one per Nexus ability call). Filter by ability and limit count. Returned as structured JSON suitable for paper-writing data tables.",
  {
    limit: z.number().int().positive().max(5000).optional(),
    ability: z.enum([
      "compress_prompt", "distill_session", "analyze_step",
      "read_cached", "file_digest", "list_symbols", "get_symbol",
      "segment_episodes", "recall_episode", "context_budget",
      "session_handoff", "register_agent", "send_activity", "send_control"
    ]).optional()
  },
  async (args) => {
    const params = new URLSearchParams();
    if (args.limit) params.set("limit", String(args.limit));
    if (args.ability) params.set("ability", args.ability);
    const qs = params.toString();
    const result = await getJson(`/nexus/benchmark/events${qs ? `?${qs}` : ""}`);
    return asTextResult(result);
  }
);

server.tool(
  "nexus_benchmark_export",
  "Export the full benchmark log (in-memory ring + on-disk JSONL path). Returns the full JSON payload — pipe into your paper analysis pipeline.",
  {},
  async () => {
    const result = await getJson("/nexus/benchmark/export");
    return asTextResult(result);
  }
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start Nexus MCP bridge:", error);
  process.exit(1);
});
