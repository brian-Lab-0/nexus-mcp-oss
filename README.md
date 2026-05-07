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

## What it can do

- Run continuously in the background as a local or hosted service
- Monitor active instances across multiple agent platforms
- Collect activity timeline (`started`, `running`, `completed`, `failed`)
- Offer control channel endpoints (`ping`, `pause`, `resume`, `status`)
- Stream live status over WebSocket
- Expose `/metrics` for Prometheus/Grafana
- Integrate with Claude Code, Codex, local Ollama wrappers, VS Code agents, Antigravity, and custom tools

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
