# Claude Code — Nexus MCP Setup Guide

Connect Claude Code to Nexus MCP OSS in 3 steps: clone, start, configure.

## Step 1 — Clone and start Nexus

```bash
git clone https://github.com/brian-Lab-0/nexus-mcp-oss.git
cd nexus-mcp-oss
npm install
cp .env.example .env
npm start
```

Nexus is now running at `http://127.0.0.1:8787`. Verify:

```bash
curl http://127.0.0.1:8787/healthz
# {"ok":true,"service":"nexus-mcp-oss","now":"..."}
```

Open the live dashboard: [http://127.0.0.1:8787](http://127.0.0.1:8787)

## Step 2 — Connect Claude Code via MCP

Add Nexus as an MCP server in your Claude Code config (`.claude/settings.json` or global `~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "nexus": {
      "command": "node",
      "args": ["/absolute/path/to/nexus-mcp-oss/dist/mcp-bridge.js"],
      "env": {
        "NEXUS_URL": "http://127.0.0.1:8787"
      }
    }
  }
}
```

Restart Claude Code. You should see the Nexus MCP tools available (`nexus_register_agent`, `nexus_compress_prompt`, etc.).

Alternatively run the bridge in dev mode (auto-reloads):

```bash
npm run dev:mcp
```

And point the MCP config at `tsx src/mcp-bridge.ts` instead of the compiled `dist/mcp-bridge.js`.

## Step 3 — Start your session

Copy `.claude.md` from this repo into your project root (or the content into your existing CLAUDE.md). Claude Code will read it at session start and know exactly how to use Nexus.

```bash
cp /path/to/nexus-mcp-oss/.claude.md /path/to/your-project/.claude.md
```

Claude will then automatically:

- Register itself with Nexus
- Compress long prompts before expensive LLM calls
- Read files through the workspace memory cache (saving repeated read tokens)
- Emit activity events for monitoring
- Analyze each step for drift and apply corrections
- Distill the session at the end for warm restart

---

## What Claude Code gains from Nexus

| Ability | How it helps |
|---|---|
| `nexus_compress_prompt` | Strips irrelevant sections from system prompts — 35–94% token savings on multi-section prompts |
| `nexus_read_cached` | First file read cached; repeat reads cost only a summary — 66%+ savings on files read >1× |
| `nexus_get_symbol` | Extracts one function instead of reading the whole file — 94% savings vs full-file read |
| `nexus_analyze_step` | Drift + repetition detection every few steps — catches goal divergence before burning more tokens |
| `nexus_distill_session` | Compresses full conversation to ~45-token snapshot — warm restart without full history replay |
| `nexus_session_handoff` | Generates structured handoff for the next session |
| `nexus_context_budget` | Tracks token spend against a budget — signals when to wrap up |

Measured aggregate savings across realistic workloads: **72.86%** fewer tokens sent to the LLM vs no Nexus. See `data/comparison-report.json` after running `npm run bench:compare`.

---

## Monitor in real time

Once Claude Code is running tasks with Nexus connected:

| URL | What you see |
|---|---|
| [/](http://127.0.0.1:8787/) | Live agent dashboard — active agents, recent activities |
| [/pro-metrics](http://127.0.0.1:8787/pro-metrics) | Token compression leaderboard, session cost savings |
| [/connection-helper](http://127.0.0.1:8787/connection-helper) | Platform-specific setup for any agent type |
| [/nexus/benchmark/summary](http://127.0.0.1:8787/nexus/benchmark/summary) | Aggregate benchmark JSON |
| [/nexus/recordings](http://127.0.0.1:8787/nexus/recordings) | All recorded sessions |
| [/nexus/recordings/{id}/analysis](http://127.0.0.1:8787/nexus/recordings/your-session-id/analysis) | Full offline analysis of one session |

---

## Docker (optional)

```bash
docker compose up --build -d
curl http://localhost:8787/healthz
```

## Production (with API-key auth)

```bash
NEXUS_API_KEY=your-secret npm start
```

All `/nexus/*` routes then require `x-api-key: your-secret` header. Add it to the MCP config:

```json
{
  "mcpServers": {
    "nexus": {
      "command": "node",
      "args": ["/path/to/nexus-mcp-oss/dist/mcp-bridge.js"],
      "env": {
        "NEXUS_URL": "http://127.0.0.1:8787",
        "NEXUS_API_KEY": "your-secret"
      }
    }
  }
}
