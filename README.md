# Nexus MCP OSS

<p align="center">
  <img src="public/favicon.svg" alt="OpenBnet Nexus" width="120" />
</p>

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![MCP Compatible](https://img.shields.io/badge/MCP-compatible-blue.svg)](https://modelcontextprotocol.io)
[![Made by OpenBnet](https://img.shields.io/badge/made%20by-OpenBnet-27CFBA.svg)](https://spaces.openbnet.com)

Open-source Nexus monitoring/control server for MCP-style code agents and tools.

> **Origin.** Nexus MCP OSS is the public TypeScript port of **Project NEXUS** — the neural intelligence layer that ships inside [OpenBnet Spaces](https://spaces.openbnet.com) v0.7+. The in-product NEXUS runs a Python/FastAPI sidecar with trained metacontrol models (BTBSTracker, FSM-NHC, DriftDetector, SubTaskClassifier — 6.29M parameters total) on `localhost:8765`. This OSS repository extracts the same compress / distill / analyze / drift-correct algorithms in a portable TypeScript MCP server so any agent — Claude Code, Codex, Ollama wrappers, VS Code agents, Antigravity, custom — can use them without depending on the full Spaces stack.

This project provides a centralized endpoint (`/nexus`) that tracks connected agent instances, activity status, and control actions while exposing Prometheus metrics and live WebSocket events.

## Dashboard

![Nexus dashboard — live agent + token savings view](res/screenshot-dashboard.png)

![Nexus Pro Metrics — compression leaderboard](res/screenshot-pro-metrics.png)

## What it can do

- Run continuously in the background as a local or hosted service
- Monitor active instances across multiple agent platforms
- Collect activity timeline (`started`, `running`, `completed`, `failed`)
- Offer control channel endpoints (`ping`, `pause`, `resume`, `status`)
- Stream live status over WebSocket
- Expose `/metrics` for Prometheus/Grafana
- Integrate with Claude Code, Codex, local Ollama wrappers, VS Code agents, Antigravity, and custom tools

## Use Cases

### Claude Code — always-on token optimization (recommended)

The fastest way to get Claude Code saving tokens on every session. Five steps, copy-paste ready.

```bash
# 1 — install Claude Code CLI (skip if already installed)
npm install -g @anthropic-ai/claude-code

# 2 — clone and start Nexus
git clone https://github.com/brian-Lab-0/nexus-mcp-oss.git
cd nexus-mcp-oss && npm install && cp .env.example .env && npm start
# → Nexus running at http://127.0.0.1:8787

# 3 — tell Claude Code where the MCP server is
#    add to .claude/settings.json in your project (or ~/.claude/settings.json globally)
```

```json
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
```

```bash
# 4 — drop the instruction file into your project so Claude always uses Nexus
cp /path/to/nexus-mcp-oss/.claude.md /path/to/your-project/.claude.md

# 5 — start Claude Code — it will register, compress, cache, and record automatically
cd /path/to/your-project && claude
```

Once connected, Claude Code automatically:

- Compresses long prompts before expensive LLM calls (35–94% token savings)
- Reads files through the workspace memory cache (66%+ savings on repeated reads)
- Extracts single functions/classes instead of reading whole files (94% savings)
- Analyzes each step for drift and applies corrections
- Distills the session at end for warm restart next time
- Records every interaction to `data/sessions/<id>.jsonl` for offline analysis

Measured aggregate savings across realistic workloads: **72.86% fewer tokens** sent to the LLM vs no Nexus.

---

### Tell your agent to always use Nexus (system prompt / CLAUDE.md)

Drop this into your project's `CLAUDE.md` (or agent system prompt) to make Nexus usage automatic on every session, without relying on the agent remembering:

```markdown
## Agent setup — always required at session start

You are connected to Nexus MCP (http://127.0.0.1:8787) via the `nexus` MCP server.

At the START of every session:
1. Call `nexus_register_agent` to register this instance.
2. Call `nexus_get_memory` to restore prior session context.
3. Call `nexus_context_budget` with `{ action: "set", budget: 80000 }`.

DURING every task:
- `nexus_compress_prompt` — before any prompt > 200 tokens.
- `nexus_read_cached` — for EVERY file read instead of raw reads.
- `nexus_get_symbol` — to extract a single function (saves ~94% vs full file read).
- `nexus_analyze_step` — every 2–3 steps to catch drift early.
- `nexus_send_activity` — signal started / running / completed / failed.

At the END of every session:
- `nexus_distill_session` — compress conversation to cold-start snapshot.
- `nexus_session_handoff` — generate warm handoff for next session.
```

This pattern ensures Nexus is used even if the `.claude.md` file is not present — the instruction lives in the model's context from the start.

---

### Multi-agent fleet monitoring

Register each agent at startup with a unique `id` and monitor all of them from a single dashboard at `http://127.0.0.1:8787`:

```bash
# Agent A (Claude Code on machine-1)
curl -X POST http://127.0.0.1:8787/nexus/agents \
  -H "Content-Type: application/json" \
  -d '{"id":"cc-machine-1","name":"Claude Code — machine-1","platform":"claude-code","instanceId":"machine-1"}'

# Agent B (Codex on CI)
curl -X POST http://127.0.0.1:8787/nexus/agents \
  -H "Content-Type: application/json" \
  -d '{"id":"codex-ci","name":"Codex CI Worker","platform":"codex","instanceId":"gh-actions-runner"}'
```

All agents appear live on the dashboard with token savings, activity timeline, and cache stats.

---

### Local Ollama — token-cut before every LLM call

Use Nexus as a compression middleware in front of any local model:

```bash
# Compress your system prompt before sending to Ollama
COMPRESSED=$(curl -s -X POST http://127.0.0.1:8787/nexus/compress \
  -H "Content-Type: application/json" \
  -d '{"prompt":"YOUR LONG SYSTEM PROMPT...","task":"current task","aggressiveness":"medium"}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['compressedPrompt'])")

# Send the compressed prompt to Ollama
curl http://localhost:11434/api/generate \
  -d "{\"model\":\"llama3\",\"prompt\":\"$COMPRESSED\"}"
```

---

### Research / paper data collection

Every ability call is recorded with full token metadata. Pull aggregate stats at any time:

```bash
# Summary: totals, per-ability latency, per-session rollups
curl http://127.0.0.1:8787/nexus/benchmark/summary

# Export full NDJSON for analysis pipelines
curl http://127.0.0.1:8787/nexus/benchmark/export.jsonl > data/run-$(date +%Y%m%d).jsonl
```

See [CLAUDE_CODE_SETUP.md](CLAUDE_CODE_SETUP.md) for the full Claude Code install and connect guide.

## Project structure

- `src/server.ts`: API + WebSocket server
- `src/store.ts`: in-memory instance/activity/control state
- `src/metrics.ts`: Prometheus metrics registration
- `.claude.md`: agent instruction template for Claude
- `AGENT_INTEGRATION.md`: generic integration instructions for all agent tools

## API overview

- `GET /nexus`: service overview and endpoint list
- `GET /`: modern live monitoring UI (main)
- `GET /dashboard`: alias redirect to `/`
- `GET /pro-metrics`: advanced metrics/sessions/compression monitor
- `GET /connection-helper`: install and connection helper per agent platform
- `GET /nexus/agents`: list connected agents
- `POST /nexus/agents`: register/update agent
- `DELETE /nexus/agents/:id`: remove agent
- `GET /nexus/activities?limit=100`: list recent activity
- `POST /nexus/activities`: push activity event
- `POST /nexus/agents/:id/control`: queue control command
- `GET /nexus/control-log?limit=100`: list recent control commands
- `GET /nexus/sessions?limit=200`: session analytics, active sessions, compression and cost estimates
- `GET /nexus/compatibility`: compatibility matrix and MCP shape
- `GET /metrics`: Prometheus endpoint
- `GET /healthz`: health check
- `WS /nexus/ws`: live event stream

## Local install

### Requirements

- Node.js 20+
- npm 10+

### Steps

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy environment file:

   ```bash
   cp .env.example .env
   ```

3. Start in development mode:

   ```bash
   npm run dev
   ```

4. Open:

- Nexus dashboard UI: [http://localhost:8787/](http://localhost:8787/)
- Pro metrics page: [http://localhost:8787/pro-metrics](http://localhost:8787/pro-metrics)
- Connection helper: [http://localhost:8787/connection-helper](http://localhost:8787/connection-helper)
- Nexus overview JSON: [http://localhost:8787/nexus](http://localhost:8787/nexus)
- Metrics: [http://localhost:8787/metrics](http://localhost:8787/metrics)

## Pro mode

`/pro-metrics` is a dedicated advanced monitoring page for connected agent sessions and workflows.

It includes:

- Active/idle session tracking
- Session-level token compression totals
- Estimated cost savings from compressed tokens
- Per-session activity status timeline
- Session cards for live monitoring in standalone Nexus deployments

To power compression analytics, include these fields in activity metadata whenever possible:

- `sessionId`
- `tokensInput`
- `tokensOutput`
- `tokensSaved`

## Connection helper

`/connection-helper` provides platform-specific quick setup instructions for:

- Claude Code
- Codex
- Local Ollama
- Custom MCP clients

It also includes a universal agent prompt template you can reuse across providers (Claude/GPT/Kimi/custom) to enforce auto-registration and lifecycle event posting.

## Benchmark / paper data collection

Every Nexus ability call (compress, distill, analyze, cached read, symbol extract, episode segmentation, agent register, activity, control) is recorded as a structured benchmark event. Events are kept in an in-memory ring (last 5000) and appended to `data/benchmarks.jsonl` on disk for permanent record.

Each event carries: `eventId`, `recordedAt`, `ability`, `agentId`, `sessionId`, `taskId`, `taskGoal`, `inputTokens`, `outputTokens`, `tokensSaved`, `compressionRatePct`, `estimatedCostSavedUsd`, `latencyMs`, `cacheHit`, and a free-form `meta` block with ability-specific fields (FSM phase, drift score, detected topic, etc.).

### Endpoints

- `GET /nexus/benchmark/summary` — aggregate stats: totals, per-ability latency, per-session/per-agent rollups, cache hit ratio, total tokens & USD saved
- `GET /nexus/benchmark/events?limit=500&ability=compress_prompt` — raw events, filterable by ability
- `GET /nexus/benchmark/export` — full JSON dump (in-memory + on-disk path)
- `GET /nexus/benchmark/export.jsonl` — downloadable NDJSON for analysis pipelines
- `DELETE /nexus/benchmark` — reset the ring + delete the JSONL

### MCP tools

- `nexus_benchmark_summary`
- `nexus_benchmark_events`
- `nexus_benchmark_export`

Use these to pull real-world session/task/ability data into the paper.

### Rotation

`data/benchmarks.jsonl` rotates automatically: at the first event of a new UTC day, or when the file passes `NEXUS_BENCHMARK_ROTATE_BYTES` (default 50 MB). Rotated files are renamed to `benchmarks-YYYY-MM-DD.jsonl`.

## API-key auth (optional)

Set `NEXUS_API_KEY=<secret>` to require an `x-api-key` header (or `?apiKey=`) on every `/nexus/*` route. `/healthz`, `/metrics`, and the static UI remain public so probes and dashboards keep working. Leave the env var unset for local dev.

## Production build

```bash
npm run build
npm start
```

## Docker deployment

### Build and run

```bash
docker compose up --build -d
```

### Check service

```bash
curl http://localhost:8787/healthz
```

## Example integration payloads

### Register agent

```json
{
  "id": "codex-instance-42",
  "name": "Codex Worker",
  "platform": "codex",
  "instanceId": "workstation-brian",
  "version": "1.0.0",
  "tags": ["repository-a", "backend"]
}
```

### Send activity

```json
{
  "agentId": "codex-instance-42",
  "kind": "task.execution",
  "status": "running",
  "details": "Implementing Nexus endpoint support",
  "metadata": {
    "branch": "feature/nexus",
    "filesTouched": 5
  }
}
```

### Queue control command

```json
{
  "command": "status",
  "reason": "Periodic heartbeat request"
}
```

## Deployment plan (easy path)

1. Run locally with `docker compose up --build -d`.
2. Put behind reverse proxy (Nginx/Caddy/Traefik) with HTTPS.
3. Configure firewall to allow only required ingress.
4. Add API-key auth middleware before internet exposure.
5. Plug `/metrics` into Prometheus + Grafana dashboards.

## GitHub publish checklist

1. Create new GitHub repo (example: `nexus-mcp-oss`).
2. Push this folder as root project.
3. Add repository topics: `mcp`, `agent-monitoring`, `observability`, `automation`.
4. Enable GitHub Actions later for CI (`npm run typecheck`, `npm run build`).
5. Keep this README as primary project documentation.

## Ecosystem & references

Nexus MCP OSS is part of the **OpenBnet** open-source initiative led by Brian Obot.

| Project | Role | Link |
| --- | --- | --- |
| **OpenBnet Spaces** | Parent product — real-time collaboration platform with autonomous agent workspace, multi-task tiling, WebRTC media engine | [spaces.openbnet.com](https://spaces.openbnet.com) |
| **Project NEXUS (in-product)** | Neural intelligence sidecar (Python/FastAPI, port 8765) with trained metacontrol models — original implementation | See `chatp/Openbnet_Spaces_v0.7_NEXUS.md` |
| **nexus-mcp-oss** | This repo — portable TypeScript MCP port of NEXUS (compress / distill / analyze / workspace memory) | You are here |
| **Research papers** | Architecture and distributed systems design of Spaces; NEXUS implementation paper | `chatp/docs/paper/research_paper_v4.md`, `chatp/docs/NEXUS_Implementation_Report.md` |

### Track Nexus progress

- Spaces release notes: `Openbnet_Spaces_v0.5_Update.md`, `_v0.7_NEXUS.md`, `_v2.md` in the Spaces repo
- This repo's commit log + `data/comparison-report.json` for empirical numbers
- Live Spaces deployment: [spaces.openbnet.com](https://spaces.openbnet.com)

### How this OSS relates to in-product NEXUS

| Aspect | In-product NEXUS (Spaces) | nexus-mcp-oss (this repo) |
| --- | --- | --- |
| Language | Python / FastAPI | TypeScript / Express |
| Port | 8765 | 8787 |
| Models | 6.29M trained parameters (BTBSTracker, FSM-NHC, DriftDetector, SubTaskClassifier) | Heuristic ports of the same algorithms (no checkpoints) |
| Inference | CPU, on-device | None — pure algorithmic |
| MCP transport | Internal HTTP only | Stdio MCP bridge + HTTP + WebSocket |
| Audience | Spaces users | Any MCP-capable agent |

The OSS port is intentionally **heuristic-only** so it can run anywhere with no model files. When trained checkpoints are present in Spaces, the in-product NEXUS upgrades to the neural path with identical response schemas — drop-in compatible.

## License

MIT — Copyright (c) Brian Obot / OpenBnet
