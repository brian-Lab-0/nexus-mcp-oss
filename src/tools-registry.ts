export type ToolCategory = "core" | "pro" | "meta";
export type WorkflowPhase = "session-start" | "during" | "session-end" | "always";

export interface ToolExample {
  description: string;
  input: Record<string, unknown>;
  expectedOutput?: string;
}

export interface ToolEntry {
  name: string;
  category: ToolCategory;
  phase: WorkflowPhase[];
  trigger: string;
  description: string;
  why: string;
  example: ToolExample;
  tokenImpact?: string;
}

export const TOOL_REGISTRY: ToolEntry[] = [
  // ─── Meta ──────────────────────────────────────────────────────────────────
  {
    name: "nexus_agent_guide",
    category: "meta",
    phase: ["session-start"],
    trigger: "At the very start of a new session, or when unsure how to use Nexus",
    description: "Fetch the complete Nexus Pro usage guide. Returns tool descriptions, workflow steps, examples, and token optimization strategy.",
    why: "Gives the agent full situational awareness of Nexus capabilities without needing any prior context.",
    example: {
      description: "Fetch the full guide",
      input: { format: "markdown" }
    }
  },

  // ─── Core ──────────────────────────────────────────────────────────────────
  {
    name: "nexus_register_agent",
    category: "core",
    phase: ["session-start"],
    trigger: "Once at the beginning of every session",
    description: "Register or update this agent instance in Nexus. Required before sending activity events.",
    why: "Enables Nexus to track which agent generated which activities and costs.",
    example: {
      description: "Register a Claude Code agent",
      input: {
        id: "claude-code-ws",
        name: "Claude Code Workspace",
        platform: "claude-code",
        instanceId: "dev-001",
        tags: ["workspace", "primary"]
      }
    }
  },
  {
    name: "nexus_send_activity",
    category: "core",
    phase: ["during"],
    trigger: "After each significant task step — especially when you know input/output token counts",
    description: "Emit a lifecycle activity event. Include token metadata to enable session-level cost tracking.",
    why: "Feeds the session analytics engine. Token metadata (tokensInput, tokensOutput, tokensSaved) is how Nexus calculates compression rate and cost savings.",
    tokenImpact: "No direct savings — feeds the tracking system that measures savings from Pro tools.",
    example: {
      description: "Report a completed task step with token data",
      input: {
        agentId: "claude-code-ws",
        kind: "task.execution",
        status: "completed",
        details: "Refactored auth module",
        sessionId: "session-abc",
        tokensInput: 2400,
        tokensOutput: 800,
        tokensSaved: 720
      }
    }
  },
  {
    name: "nexus_list_sessions",
    category: "core",
    phase: ["session-end", "always"],
    trigger: "At session end, or when reporting cost savings to the user",
    description: "List session analytics: compression rates, tokens saved, estimated cost saved per session.",
    why: "Lets the agent report real token savings data back to the user at session end.",
    example: {
      description: "Get session summary",
      input: { limit: 10 }
    }
  },
  {
    name: "nexus_list_activities",
    category: "core",
    phase: ["always"],
    trigger: "When debugging agent behaviour or auditing recent steps",
    description: "List recent activity events across all agents.",
    why: "Full audit trail of what happened in recent sessions.",
    example: {
      description: "Get last 20 activities",
      input: { limit: 20 }
    }
  },
  {
    name: "nexus_overview",
    category: "core",
    phase: ["session-start", "always"],
    trigger: "To check Nexus server status and active agent count",
    description: "Fetch Nexus service overview: total agents, activities, status counts, and available endpoints.",
    why: "Quick health check — confirms the server is up before relying on other tools.",
    example: {
      description: "Check server status",
      input: {}
    }
  },
  {
    name: "nexus_send_control",
    category: "core",
    phase: ["always"],
    trigger: "To pause, resume, or query the status of another agent",
    description: "Send a control command (ping / pause / resume / status) to an agent via Nexus.",
    why: "Enables multi-agent coordination — one agent can pause another while they share a resource.",
    example: {
      description: "Ping an agent",
      input: { agentId: "claude-code-ws", command: "ping" }
    }
  },

  // ─── Pro ───────────────────────────────────────────────────────────────────
  {
    name: "nexus_compress_prompt",
    category: "pro",
    phase: ["during"],
    trigger: "BEFORE every expensive LLM API call — especially on long system prompts with multiple sections",
    description: "Strip irrelevant sections from a prompt before sending to an LLM. Detects the task topic automatically and removes sections that don't match, while always keeping identity/persona/critical sections.",
    why: "System prompts often contain sections for many capabilities (calendar, SSH, web search, code) but the current task only needs one. Removing irrelevant sections saves 20–50% of input tokens with zero quality loss.",
    tokenImpact: "20–50% input token reduction per call. On a 4,000-token system prompt, saves 800–2,000 tokens every call.",
    example: {
      description: "Compress a multi-section system prompt for a code task",
      input: {
        task: "fix the TypeScript type error",
        aggressiveness: "medium",
        prompt: "You are a helpful assistant.\n\nCore behavior: always be accurate.\n\nFor calendar tasks: check schedule and send invites.\n\nFor code tasks: write clean TypeScript with proper types.\n\nFor SSH tasks: connect to servers and run commands."
      },
      expectedOutput: "Removes calendar and SSH sections — returns only identity + code section. ~35% savings."
    }
  },
  {
    name: "nexus_distill_session",
    category: "pro",
    phase: ["session-end"],
    trigger: "At the end of every session before closing",
    description: "Compress the full session into a compact cold-start snapshot (~30–50 tokens). Captures: primary goal, key outputs, tools used, steps completed, and token efficiency.",
    why: "Instead of replaying thousands of tokens of history at the next session start, inject a 45-token snapshot that gives the agent full context immediately.",
    tokenImpact: "Saves 2,000–15,000+ tokens per session start. One-time cost of ~200 tokens to distill; recovered on the very next session.",
    example: {
      description: "Distill a 6-step session",
      input: {
        agentId: "claude-code-ws",
        taskGoal: "Implement token optimization MCP server",
        sessionStandardTokens: 12000,
        sessionNexusTokens: 7800,
        steps: 6,
        messages: [
          { role: "user", content: "Build a Pro MCP for token optimization" },
          { role: "assistant", content: "Implemented compress, distill, analyze, and memory tools." }
        ]
      },
      expectedOutput: "Returns a snapshot object. Store agentId → snapshot mapping for next session."
    }
  },
  {
    name: "nexus_get_memory",
    category: "pro",
    phase: ["session-start"],
    trigger: "Immediately after nexus_register_agent — before starting any work",
    description: "Retrieve a distilled session snapshot from a previous session. Inject the returned summary into the current context to restore goal + progress without replaying full history.",
    why: "Cold-starting from a 45-token summary vs. re-processing a full previous conversation saves thousands of tokens on every subsequent session.",
    tokenImpact: "Eliminates context replay cost. For a 10,000-token previous session, saves ~9,950 tokens on cold start.",
    example: {
      description: "Restore prior session context",
      input: { agentId: "claude-code-ws" },
      expectedOutput: "{ found: true, snapshot: { primaryGoal, keyOutputs, stepsCompleted, tokenEfficiency } }"
    }
  },
  {
    name: "nexus_analyze_step",
    category: "pro",
    phase: ["during"],
    trigger: "Every 3–5 steps, or whenever you suspect the output is drifting from the original goal",
    description: "Analyze a step's output for: FSM phase (PLAN/EXECUTE/VERIFY/CONCLUDE), drift score (repetition vs previous outputs), goal alignment, and completion probability. Returns a correction patch if needed.",
    why: "Agents can get stuck in repetition loops or drift from the original goal, burning tokens on low-value work. Early drift detection + correction patch stops this before it compounds.",
    tokenImpact: "Prevents wasted loops. A 5-step repetition loop at 800 tokens/step = 4,000 wasted tokens. One analyze call costs ~200 tokens and stops it.",
    example: {
      description: "Check step 4 for drift",
      input: {
        agentId: "claude-code-ws",
        step: 4,
        output: "I have written the compress function and tested it.",
        taskGoal: "Implement token optimization MCP server",
        previousOutputs: [
          "Started the compress implementation",
          "Added the compress endpoint",
          "Wrote tests for compress"
        ]
      },
      expectedOutput: "{ fsmPhase: 'EXECUTE', driftScore: 0.18, completionProb: 0.4, needsCorrection: false }"
    }
  },

  // ─── Workspace Memory ─────────────────────────────────────────────────────
  {
    name: "nexus_read_cached",
    category: "pro",
    phase: ["during"],
    trigger: "Instead of raw file reads — especially for files the agent has already seen",
    description: "Read a file through the workspace memory cache. First read returns full content. Subsequent reads of unchanged files return only a summary + metadata, saving the full token cost.",
    why: "Agents re-read the same files repeatedly across steps. A 500-line file costs ~2,000 tokens each time. After the first read, the cache returns a 50-token summary instead.",
    tokenImpact: "Saves 90–98% of tokens on repeated file reads. A file read 5 times saves ~8,000 tokens.",
    example: {
      description: "Read a file (second read returns cached summary)",
      input: { path: "/project/src/server.ts" },
      expectedOutput: "{ status: 'unchanged', summary: 'server.ts: 330 lines, 5 imports, 12 exports', tokensSaved: 2100 }"
    }
  },
  {
    name: "nexus_file_digest",
    category: "pro",
    phase: ["during"],
    trigger: "When you need to check if a file changed without reading it",
    description: "Get file metadata: hash, size, token count, summary, symbol count. Zero content tokens — just enough to decide whether a full read is needed.",
    why: "Checking 'did this file change?' should cost 0 content tokens, not 2,000.",
    tokenImpact: "~20 tokens vs full file read. Use before deciding to re-read.",
    example: {
      description: "Check if a file changed",
      input: { path: "/project/src/pro.ts" },
      expectedOutput: "{ exists: true, hash: 'a1b2c3d4', tokens: 1850, symbolCount: 12 }"
    }
  },
  {
    name: "nexus_list_symbols",
    category: "pro",
    phase: ["during"],
    trigger: "When you need to understand a file's structure without reading all of it",
    description: "List all symbols (functions, classes, interfaces, types, variables) in a TS/JS file. Returns name, kind, line, and signature.",
    why: "Understanding a 500-line file's API surface should cost ~100 tokens, not 2,000.",
    tokenImpact: "~100 tokens for a full symbol index vs ~2,000 for the whole file.",
    example: {
      description: "List symbols in a TypeScript file",
      input: { path: "/project/src/pro.ts" },
      expectedOutput: "[{ name: 'compressPrompt', kind: 'function', line: 95, signature: 'function compressPrompt(req: CompressRequest)' }]"
    }
  },
  {
    name: "nexus_get_symbol",
    category: "pro",
    phase: ["during"],
    trigger: "When you need one specific function/class from a file",
    description: "Extract a single symbol with surrounding context lines. Returns only the relevant code slice — typically 20–80 tokens instead of the full file.",
    why: "Reading a 500-line file to see one 15-line function wastes 97% of the tokens.",
    tokenImpact: "20–80 tokens vs full file. 95%+ savings on targeted lookups.",
    example: {
      description: "Get the detectTopic function",
      input: { path: "/project/src/pro.ts", name: "detectTopic", context: 3 },
      expectedOutput: "{ found: true, kind: 'function', content: '...function detectTopic(text, taskHint)...', tokens: 45 }"
    }
  },
  {
    name: "nexus_segment_episodes",
    category: "pro",
    phase: ["during", "session-end"],
    trigger: "Periodically during long sessions, or at session end",
    description: "Segment activities into coherent episodes by time gaps, phase transitions, and file-set changes. Each episode gets a summary, entities, and phase label.",
    why: "Raw activity lists grow linearly. Episodes compress N activities into a single summary, making session history queryable without replaying everything.",
    tokenImpact: "Compresses 50+ activities into 5–10 episode summaries (~200 tokens total).",
    example: {
      description: "Segment recent activities",
      input: {
        sessionId: "session-abc",
        activities: [
          { id: "a1", timestamp: "2026-04-21T10:00:00Z", details: "Read server.ts", status: "completed" },
          { id: "a2", timestamp: "2026-04-21T10:01:00Z", details: "Fixed auth bug", status: "completed" }
        ]
      }
    }
  },
  {
    name: "nexus_recall_episode",
    category: "pro",
    phase: ["session-start", "during"],
    trigger: "When you need context about prior work — 'what did we do with auth?' or 'what files did we touch for the API?'",
    description: "Retrieve the most relevant past episodes for a query. Uses keyword + recency scoring. Returns summaries, entities, and files involved.",
    why: "Instead of replaying full session history, retrieve only the relevant episodes. Turns O(session_length) into O(relevant_knowledge).",
    tokenImpact: "~50 tokens per recalled episode vs thousands for full history replay.",
    example: {
      description: "Recall episodes about authentication",
      input: { query: "authentication middleware fix", k: 3 }
    }
  },
  {
    name: "nexus_context_budget",
    category: "pro",
    phase: ["during", "always"],
    trigger: "Every 5–10 steps, or when approaching context limits",
    description: "Check or manage the session's token budget. Returns used/remaining tokens, utilization %, cache hit ratio, eviction candidates, and a recommendation.",
    why: "Agents hit context limits silently and start losing information. The budget governor warns early and suggests what to evict.",
    tokenImpact: "Prevents context overflow — the single most expensive failure mode in long sessions.",
    example: {
      description: "Check budget status",
      input: { sessionId: "session-abc", action: "get" },
      expectedOutput: "{ used: 45000, remaining: 155000, utilizationPct: 22.5, recommendation: 'Budget healthy' }"
    }
  },
  {
    name: "nexus_session_handoff",
    category: "pro",
    phase: ["session-end", "session-start"],
    trigger: "At session end to generate, at next session start to consume",
    description: "Generate a warm handoff: episode summaries, outstanding goals, files modified, tokens saved. Inject at next session start for instant context restoration.",
    why: "Cold-starting a new session without context wastes the first 5–10 minutes re-discovering what was done. A handoff restores full context in ~200 tokens.",
    tokenImpact: "Saves 5,000–50,000 tokens on session resume vs replaying history.",
    example: {
      description: "Generate handoff for current session",
      input: { sessionId: "session-abc" },
      expectedOutput: "{ episodeSummaries: [...], outstandingGoals: [...], filesModified: [...] }"
    }
  },
  {
    name: "nexus_cache_stats",
    category: "pro",
    phase: ["always"],
    trigger: "When monitoring workspace memory effectiveness",
    description: "Get cache statistics: total entries, hit/miss counts, hit ratio. Use to verify the cache is working and measure token savings.",
    why: "You can't improve what you don't measure. Cache hit ratio is the primary health metric for workspace memory.",
    example: {
      description: "Check cache health",
      input: {},
      expectedOutput: "{ entries: 12, hits: 34, misses: 8, hitRatio: 0.81 }"
    }
  }
];

export const WORKFLOWS = {
  sessionStart: {
    label: "Session Start",
    description: "Run these tools at the beginning of every new session.",
    steps: [
      { tool: "nexus_get_memory", note: "Restore prior session context (if any)" },
      { tool: "nexus_session_handoff", note: "Load warm handoff from previous session" },
      { tool: "nexus_register_agent", note: "Register this agent instance" },
      { tool: "nexus_context_budget", note: "Set session token budget (action='set')" },
      { tool: "nexus_overview", note: "Optional: verify server is healthy" }
    ]
  },
  duringExecution: {
    label: "During Execution",
    description: "Use these tools throughout the session to optimize tokens and track progress.",
    steps: [
      { tool: "nexus_read_cached", note: "INSTEAD of raw file reads — returns cached summary on repeat reads" },
      { tool: "nexus_get_symbol", note: "Extract single functions/classes instead of reading full files" },
      { tool: "nexus_compress_prompt", note: "BEFORE each expensive LLM call — strip irrelevant prompt sections" },
      { tool: "nexus_send_activity", note: "AFTER each step — report kind, status, and token metadata" },
      { tool: "nexus_analyze_step", note: "EVERY 3–5 steps — check for drift and get corrections" },
      { tool: "nexus_context_budget", note: "EVERY 5–10 steps — check remaining budget, evict if needed" }
    ]
  },
  sessionEnd: {
    label: "Session End",
    description: "Run these tools before closing the session.",
    steps: [
      { tool: "nexus_segment_episodes", note: "Segment activities into episodes for future recall" },
      { tool: "nexus_distill_session", note: "Compress session to cold-start snapshot" },
      { tool: "nexus_session_handoff", note: "Generate warm handoff for next session" },
      { tool: "nexus_list_sessions", note: "Report total tokens saved and cost estimate to user" },
      { tool: "nexus_cache_stats", note: "Report cache effectiveness" }
    ]
  }
};

export const TOKEN_STRATEGY = {
  headline: "Expected token savings with full Workspace Memory + Pro workflow",
  savings: [
    { source: "nexus_read_cached (file cache)", estimate: "90–98% on repeated file reads", type: "input" },
    { source: "nexus_get_symbol (symbol slicing)", estimate: "95%+ on targeted code lookups", type: "input" },
    { source: "nexus_compress_prompt", estimate: "20–50% per LLM call", type: "input" },
    { source: "nexus_recall_episode (episodic memory)", estimate: "80–95% vs full history replay", type: "input" },
    { source: "nexus_get_memory (cold start)", estimate: "90–99% of context replay cost", type: "input" },
    { source: "nexus_session_handoff (warm resume)", estimate: "5,000–50,000 tokens per session start", type: "input" },
    { source: "nexus_analyze_step (drift prevention)", estimate: "Prevents 3,000–20,000 wasted tokens per loop", type: "both" },
    { source: "nexus_context_budget (governor)", estimate: "Prevents context overflow — most expensive failure mode", type: "both" }
  ],
  totalEstimate: "50–80% reduction in total session token cost with Workspace Memory + Pro tools active."
};
