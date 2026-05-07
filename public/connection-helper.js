const presets = {
  "claude-code": {
    title: "Claude Code — Full Install & Connect Guide",
    commands: `# ── Step 1: Install Claude Code CLI ─────────────────────────────
npm install -g @anthropic-ai/claude-code

# Verify
claude --version

# ── Step 2: Clone and start Nexus ────────────────────────────────
git clone https://github.com/brian-Lab-0/nexus-mcp-oss.git
cd nexus-mcp-oss
npm install
cp .env.example .env
npm start
# Nexus is now live at http://127.0.0.1:8787

# Verify Nexus is running
curl http://127.0.0.1:8787/healthz
# → {"ok":true,"service":"nexus-mcp-oss","now":"..."}

# ── Step 3: Connect Claude Code via MCP ──────────────────────────
# Add to .claude/settings.json inside your project
# (or ~/.claude/settings.json for global use)
{
  "mcpServers": {
    "nexus": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/nexus-mcp-oss/dist/mcp-bridge.js"],
      "env": {
        "NEXUS_URL": "http://127.0.0.1:8787"
      }
    }
  }
}

# ── Step 4: Copy the agent instruction file ───────────────────────
# Drop .claude.md from this repo into your project root.
# Claude Code reads it at session start — it teaches Claude
# exactly when and how to call each Nexus tool.
cp /path/to/nexus-mcp-oss/.claude.md /path/to/your-project/.claude.md

# ── Step 5: Start Claude Code in your project ─────────────────────
cd /path/to/your-project
claude

# Claude will automatically:
#  - Register itself with Nexus
#  - Compress long prompts (35–94% token savings)
#  - Cache file reads (66%+ savings on repeated reads)
#  - Analyze steps for drift and apply corrections
#  - Distill the session at the end for warm restart
#  - Record every interaction to data/sessions/<id>.jsonl

# ── Monitor in real time ──────────────────────────────────────────
# Dashboard:       http://127.0.0.1:8787/
# Pro metrics:     http://127.0.0.1:8787/pro-metrics
# Session data:    http://127.0.0.1:8787/nexus/recordings
# Benchmark JSON:  http://127.0.0.1:8787/nexus/benchmark/summary

# ── Optional: API-key auth for production ────────────────────────
NEXUS_API_KEY=your-secret npm start
# Add to MCP env: "NEXUS_API_KEY": "your-secret"`
  },
  codex: {
    title: "Codex Setup",
    commands: `# Register agent at startup
curl -X POST $NEXUS_URL/nexus/agents \\
  -H "Content-Type: application/json" \\
  -d '{
    "id": "codex-agent-01",
    "name": "Codex Agent",
    "platform": "codex",
    "instanceId": "codex-workspace"
  }'

# Emit activity events with token metadata
curl -X POST $NEXUS_URL/nexus/activities \\
  -H "Content-Type: application/json" \\
  -d '{
    "agentId": "codex-agent-01",
    "kind": "generation",
    "status": "completed",
    "details": "Patch generated",
    "metadata": {
      "sessionId": "session-xyz",
      "tokensInput": 2300,
      "tokensOutput": 1400,
      "tokensSaved": 510
    }
  }'`
  },
  "local-ollama": {
    title: "Ollama Local Setup",
    commands: `# Register local worker
curl -X POST $NEXUS_URL/nexus/agents \\
  -H "Content-Type: application/json" \\
  -d '{
    "id": "ollama-local-01",
    "name": "Ollama Local Worker",
    "platform": "local-ollama",
    "instanceId": "localhost"
  }'

# Use /nexus/compress before each LLM call to cut token costs
curl -X POST $NEXUS_URL/nexus/compress \\
  -H "Content-Type: application/json" \\
  -d '{
    "task": "your current task description",
    "aggressiveness": "medium",
    "prompt": "YOUR FULL SYSTEM PROMPT HERE"
  }'

# Send the compressed prompt to Ollama instead of the original`
  },
  custom: {
    title: "Custom MCP Client",
    commands: `# Minimum required endpoints
POST /nexus/agents       — register agent
POST /nexus/activities   — send events
GET  /nexus/sessions     — session analytics

# Pro endpoints (token optimization)
POST /nexus/compress     — compress prompt before LLM call
POST /nexus/distill      — distill session to cold-start snapshot
GET  /nexus/memory/:id   — retrieve cold-start snapshot
POST /nexus/analyze      — drift detection + FSM phase

# Minimum activity payload
{
  "agentId": "custom-agent",
  "kind": "workflow.step",
  "status": "running",
  "details": "Current operation",
  "metadata": {
    "sessionId": "workflow-123",
    "tokensInput": 1600,
    "tokensOutput": 900,
    "tokensSaved": 260
  }
}`
  }
};

const universalTemplate = `You are connected to Nexus MCP OSS (http://127.0.0.1:8787).
GitHub: https://github.com/brian-Lab-0/nexus-mcp-oss

SESSION START:
1. nexus_register_agent — register this instance (platform, instanceId, tags)
2. nexus_get_memory     — restore prior session context if available
3. nexus_context_budget — declare token budget: { action:"set", budget:80000 }

DURING EVERY TASK:
- nexus_compress_prompt  — call before any prompt >200 tokens or with multiple sections
- nexus_read_cached      — use for EVERY file read instead of raw reads
- nexus_list_symbols     — understand file structure without reading full content
- nexus_get_symbol       — extract single function/class (saves ~94% vs full read)
- nexus_analyze_step     — call every 2-3 steps; apply correctionPatch if needsCorrection=true
- nexus_send_activity    — emit started/running/completed/failed with sessionId+taskId in metadata
- nexus_context_budget   — track usage: { action:"track", tokens:<n> }

SESSION END:
- nexus_distill_session  — compress conversation to ~45-token cold-start snapshot
- nexus_segment_episodes — segment activities into labelled episodes
- nexus_session_handoff  — generate structured handoff for next session

MONITORING (call anytime):
- nexus_benchmark_summary  — total tokens saved, cost saved, per-ability latency
- nexus_cache_stats         — file cache hit ratio
- nexus_session_analysis    — full reconstruction of current session interactions`;

// DOM refs
const titleEl = document.getElementById("preset-title");
const commandEl = document.getElementById("preset-commands");
const templateEl = document.getElementById("universal-template");
const tabs = document.querySelectorAll(".preset-tab");

function activatePreset(key) {
  const preset = presets[key];
  if (!preset) return;
  titleEl.textContent = preset.title;
  commandEl.textContent = preset.commands;
  tabs.forEach(t => t.classList.toggle("active", t.dataset.target === key));
}

tabs.forEach(t => t.addEventListener("click", () => activatePreset(t.dataset.target)));
templateEl.textContent = universalTemplate;
activatePreset("claude-code");

// Copy to clipboard
window.copyCode = function(elId, btn) {
  const text = document.getElementById(elId).textContent;
  navigator.clipboard.writeText(text).then(() => {
    btn.classList.add("copied");
    const orig = btn.innerHTML;
    btn.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg> Copied`;
    setTimeout(() => { btn.innerHTML = orig; btn.classList.remove("copied"); }, 2000);
  });
};
