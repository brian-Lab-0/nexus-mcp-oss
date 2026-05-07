const presets = {
  "claude-code": {
    title: "Claude Code Setup",
    commands: `# 1. Add Nexus MCP to .claude/settings.json in your project
{
  "mcpServers": {
    "nexus": {
      "command": "node_modules/.bin/tsx",
      "args": ["src/mcp-bridge.ts"],
      "env": { "NEXUS_URL": "http://127.0.0.1:8787" }
    }
  }
}

# 2. Keep the HTTP server running in a separate terminal
npm run dev

# 3. Restart Claude Code — the nexus MCP will auto-connect
# Then use these tools in your conversations:
#   nexus_compress_prompt   — strip irrelevant prompt sections
#   nexus_distill_session   — save cold-start snapshot at session end
#   nexus_get_memory        — inject past session context
#   nexus_analyze_step      — detect drift + get correction patch`
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

const universalTemplate = `You are connected to Nexus Pro MCP (http://127.0.0.1:8787).

Session start:
- Call nexus_register_agent to identify yourself
- Call nexus_get_memory to restore any prior session context

During execution:
- Call nexus_compress_prompt before expensive LLM calls to reduce token cost
- Call nexus_send_activity with token metadata (tokensInput, tokensOutput, tokensSaved)
- Call nexus_analyze_step periodically to detect drift and get corrections

Session end:
- Call nexus_distill_session to save a cold-start snapshot for next session
- Call nexus_list_sessions to review total tokens saved and cost estimate`;

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
