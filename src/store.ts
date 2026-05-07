import { randomUUID } from "node:crypto";
import type { ActivityEvent, ControlCommand, NexusAgent } from "./types";

const agents = new Map<string, NexusAgent>();
const activities: ActivityEvent[] = [];
const controlLog: Array<{ at: string; agentId: string; command: ControlCommand }> = [];

const MAX_ACTIVITY_EVENTS = 2000;
const ESTIMATED_COST_PER_1K_TOKENS = 0.003;

interface SessionAccumulator {
  sessionId: string;
  agentId: string;
  eventCount: number;
  startedAt: string;
  lastActivityAt: string;
  lastStatus: ActivityEvent["status"];
  tokensInput: number;
  tokensOutput: number;
  tokensSaved: number;
}

export function upsertAgent(
  input: Omit<NexusAgent, "connectedAt" | "lastSeenAt"> & { connectedAt?: string; lastSeenAt?: string }
): NexusAgent {
  const now = new Date().toISOString();
  const existing = agents.get(input.id);
  const connectedAt = existing?.connectedAt ?? input.connectedAt ?? now;
  const agent: NexusAgent = {
    ...input,
    connectedAt,
    lastSeenAt: input.lastSeenAt ?? now
  };
  agents.set(agent.id, agent);
  return agent;
}

export function touchAgent(agentId: string): NexusAgent | undefined {
  const existing = agents.get(agentId);
  if (!existing) {
    return undefined;
  }
  const updated = { ...existing, lastSeenAt: new Date().toISOString() };
  agents.set(agentId, updated);
  return updated;
}

export function removeAgent(agentId: string): boolean {
  return agents.delete(agentId);
}

export function listAgents(): NexusAgent[] {
  return Array.from(agents.values()).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

export function addActivity(
  payload: Omit<ActivityEvent, "id" | "timestamp"> & { timestamp?: string }
): ActivityEvent {
  const event: ActivityEvent = {
    ...payload,
    id: randomUUID(),
    timestamp: payload.timestamp ?? new Date().toISOString()
  };
  activities.unshift(event);
  if (activities.length > MAX_ACTIVITY_EVENTS) {
    activities.length = MAX_ACTIVITY_EVENTS;
  }
  touchAgent(payload.agentId);
  return event;
}

export function listActivities(limit = 100): ActivityEvent[] {
  return activities.slice(0, Math.max(1, Math.min(limit, MAX_ACTIVITY_EVENTS)));
}

export function addControlCommand(agentId: string, command: ControlCommand): void {
  controlLog.unshift({ at: new Date().toISOString(), agentId, command });
  if (controlLog.length > 500) {
    controlLog.length = 500;
  }
}

export function getControlLog(limit = 100): Array<{ at: string; agentId: string; command: ControlCommand }> {
  return controlLog.slice(0, Math.max(1, Math.min(limit, 500)));
}

export function getOverview() {
  const byStatus = activities.reduce<Record<string, number>>((acc, event) => {
    acc[event.status] = (acc[event.status] ?? 0) + 1;
    return acc;
  }, {});

  const byPlatform = Array.from(agents.values()).reduce<Record<string, number>>((acc, agent) => {
    acc[agent.platform] = (acc[agent.platform] ?? 0) + 1;
    return acc;
  }, {});

  return {
    generatedAt: new Date().toISOString(),
    totalAgents: agents.size,
    totalActivities: activities.length,
    statusCounts: byStatus,
    platformCounts: byPlatform
  };
}

function getNumericMetadataValue(metadata: Record<string, unknown> | undefined, keys: string[]): number {
  if (!metadata) {
    return 0;
  }
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }
  return 0;
}

export function getSessions(limit = 200) {
  const sessions = new Map<string, SessionAccumulator>();
  const ordered = [...activities].reverse();

  for (const event of ordered) {
    const metadata = (event.metadata ?? {}) as Record<string, unknown>;
    const sessionIdCandidate = metadata.sessionId ?? metadata.session_id ?? metadata.workflowId ?? metadata.workflow_id;
    const sessionId =
      typeof sessionIdCandidate === "string" && sessionIdCandidate.trim().length > 0
        ? sessionIdCandidate
        : `${event.agentId}-default`;

    const current = sessions.get(sessionId);
    const tokensInput = getNumericMetadataValue(metadata, ["tokensInput", "tokens_in", "promptTokens", "input_tokens"]);
    const tokensOutput = getNumericMetadataValue(metadata, ["tokensOutput", "tokens_out", "completionTokens", "output_tokens"]);
    const tokensSaved = getNumericMetadataValue(metadata, [
      "tokensSaved",
      "tokens_saved",
      "compressedTokensSaved",
      "compression_saved_tokens"
    ]);

    if (!current) {
      sessions.set(sessionId, {
        sessionId,
        agentId: event.agentId,
        eventCount: 1,
        startedAt: event.timestamp,
        lastActivityAt: event.timestamp,
        lastStatus: event.status,
        tokensInput,
        tokensOutput,
        tokensSaved
      });
      continue;
    }

    current.eventCount += 1;
    current.lastActivityAt = event.timestamp;
    current.lastStatus = event.status;
    current.tokensInput += tokensInput;
    current.tokensOutput += tokensOutput;
    current.tokensSaved += tokensSaved;
  }

  return Array.from(sessions.values())
    .map((session) => {
      const baseline = session.tokensInput + session.tokensSaved;
      const compressionRate = baseline > 0 ? (session.tokensSaved / baseline) * 100 : 0;
      const estimatedCostSavedUsd = (session.tokensSaved / 1000) * ESTIMATED_COST_PER_1K_TOKENS;
      return {
        ...session,
        isActive: session.lastStatus === "started" || session.lastStatus === "running",
        compressionRatePct: Number(compressionRate.toFixed(2)),
        estimatedCostSavedUsd: Number(estimatedCostSavedUsd.toFixed(6))
      };
    })
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
    .slice(0, Math.max(1, Math.min(limit, 1000)));
}

export function getSessionSummary() {
  const sessions = getSessions(1000);
  const totals = sessions.reduce(
    (acc, session) => {
      acc.activeSessions += session.isActive ? 1 : 0;
      acc.totalTokensSaved += session.tokensSaved;
      acc.totalEstimatedCostSavedUsd += session.estimatedCostSavedUsd;
      return acc;
    },
    {
      totalSessions: sessions.length,
      activeSessions: 0,
      totalTokensSaved: 0,
      totalEstimatedCostSavedUsd: 0
    }
  );

  return {
    ...totals,
    totalEstimatedCostSavedUsd: Number(totals.totalEstimatedCostSavedUsd.toFixed(6)),
    generatedAt: new Date().toISOString()
  };
}
