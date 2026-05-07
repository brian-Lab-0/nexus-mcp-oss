import { TOOL_REGISTRY, WORKFLOWS, TOKEN_STRATEGY, type ToolEntry } from "./tools-registry";
import { getSessionSummary } from "./store";

function toolsByCategory(cat: ToolEntry["category"]) {
  return TOOL_REGISTRY.filter(t => t.category === cat);
}

export function generateGuideJson(nexusUrl = "http://127.0.0.1:8787") {
  const summary = getSessionSummary();
  return {
    _meta: {
      version: "1.0.0",
      generatedAt: new Date().toISOString(),
      nexusUrl,
      serverStats: {
        totalSessions: summary.totalSessions,
        totalTokensSaved: summary.totalTokensSaved,
        estimatedCostSavedUsd: summary.totalEstimatedCostSavedUsd
      }
    },
    overview: "Nexus Pro is an MCP server that sits between Claude Code and its LLM calls. Its primary purpose is token cost reduction through prompt compression, session distillation, drift detection, and cold-start memory.",
    quickStart: {
      description: "Minimal setup to start saving tokens immediately.",
      steps: [
        "1. Register your agent: call nexus_register_agent once at session start.",
        "2. Compress every prompt: call nexus_compress_prompt before each expensive LLM call.",
        "3. Track tokens: include tokensInput/tokensOutput/tokensSaved in nexus_send_activity metadata.",
        "4. Distill at end: call nexus_distill_session before closing.",
        "5. Restore next session: call nexus_get_memory at the start of the next session."
      ]
    },
    workflows: WORKFLOWS,
    tokenStrategy: TOKEN_STRATEGY,
    tools: {
      meta: toolsByCategory("meta"),
      core: toolsByCategory("core"),
      pro: toolsByCategory("pro")
    }
  };
}

function badge(cat: ToolEntry["category"]) {
  return cat === "pro" ? "[PRO]" : cat === "meta" ? "[META]" : "[CORE]";
}

export function generateGuideMarkdown(nexusUrl = "http://127.0.0.1:8787"): string {
  const summary = getSessionSummary();
  const lines: string[] = [];

  lines.push("# Nexus Pro — Agent Usage Guide");
  lines.push(`> Auto-generated · ${new Date().toISOString()} · Server: ${nexusUrl}`);
  lines.push("");
  lines.push("## Overview");
  lines.push("");
  lines.push("Nexus Pro is an MCP server that reduces token cost for AI agents in workspace environments.");
  lines.push("Connect once and you gain: prompt compression, session memory, drift detection, and cost analytics.");
  lines.push("");
  lines.push(`**Server stats:** ${summary.totalSessions} sessions tracked · ${summary.totalTokensSaved.toLocaleString()} tokens saved · \\$${summary.totalEstimatedCostSavedUsd.toFixed(4)} estimated cost saved`);
  lines.push("");

  // Quick start
  lines.push("## Quick Start");
  lines.push("");
  lines.push("```");
  lines.push("Session start    →  nexus_get_memory (restore context)");
  lines.push("                 →  nexus_register_agent");
  lines.push("");
  lines.push("During session   →  nexus_compress_prompt (BEFORE each LLM call)");
  lines.push("                 →  nexus_send_activity   (AFTER each step)");
  lines.push("                 →  nexus_analyze_step    (every 3-5 steps)");
  lines.push("");
  lines.push("Session end      →  nexus_distill_session (save snapshot)");
  lines.push("                 →  nexus_list_sessions   (report savings to user)");
  lines.push("```");
  lines.push("");

  // Workflows
  lines.push("## Workflows");
  lines.push("");
  for (const [, wf] of Object.entries(WORKFLOWS)) {
    lines.push(`### ${wf.label}`);
    lines.push("");
    lines.push(wf.description);
    lines.push("");
    for (const step of wf.steps) {
      lines.push(`- **\`${step.tool}\`** — ${step.note}`);
    }
    lines.push("");
  }

  // Token strategy
  lines.push("## Token Optimization Strategy");
  lines.push("");
  lines.push(TOKEN_STRATEGY.headline);
  lines.push("");
  for (const s of TOKEN_STRATEGY.savings) {
    lines.push(`| ${s.source} | ${s.estimate} | ${s.type} tokens |`);
  }
  lines.push("");
  lines.push(`> **${TOKEN_STRATEGY.totalEstimate}**`);
  lines.push("");

  // Tools — PRO first
  lines.push("## Tool Reference");
  lines.push("");

  for (const cat of ["pro", "core", "meta"] as const) {
    const tools = toolsByCategory(cat);
    if (!tools.length) continue;
    lines.push(`### ${cat.toUpperCase()} Tools`);
    lines.push("");
    for (const tool of tools) {
      lines.push(`#### \`${tool.name}\` ${badge(tool.category)}`);
      lines.push("");
      lines.push(`**Trigger:** ${tool.trigger}`);
      lines.push("");
      lines.push(tool.description);
      lines.push("");
      lines.push(`**Why it matters:** ${tool.why}`);
      lines.push("");
      if (tool.tokenImpact) {
        lines.push(`**Token impact:** ${tool.tokenImpact}`);
        lines.push("");
      }
      lines.push(`**Example:** ${tool.example.description}`);
      lines.push("```json");
      lines.push(JSON.stringify(tool.example.input, null, 2));
      lines.push("```");
      if (tool.example.expectedOutput) {
        lines.push(`*Expected: ${tool.example.expectedOutput}*`);
      }
      lines.push("");
    }
  }

  // Footer
  lines.push("---");
  lines.push(`*Nexus Pro · nexus-mcp-oss · Guide generated at ${new Date().toISOString()}*`);

  return lines.join("\n");
}
