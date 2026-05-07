# Agent Integration Guide

This server is tool-agnostic and supports any code agent/tool that can send HTTP JSON.

## Quick integration steps

1. Register each running agent instance through `POST /nexus/agents`.
2. Send lifecycle updates through `POST /nexus/activities`.
3. Subscribe to `ws://localhost:8080/nexus/ws` for live status snapshots and events.
4. Expose `/metrics` to Prometheus/Grafana for long-term monitoring.

## Compatibility matrix

- Claude Code: supported
- Codex: supported
- Local Ollama wrappers: supported
- VS Code agent extensions/hooks: supported
- Antigravity: supported
- Any custom autonomous tool: supported

## Recommended event mapping

- Task begins: `status = started`
- Task in progress: `status = running`
- Task done: `status = completed`
- Task error: `status = failed`

## Minimum secure deployment guidance

- Run behind reverse proxy (Caddy/Nginx/Traefik) with TLS.
- Add API key middleware before exposing outside localhost.
- Restrict CORS origins in production.
- Place access logs in central SIEM if handling sensitive workloads.
