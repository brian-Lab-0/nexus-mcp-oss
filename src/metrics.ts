import client from "prom-client";

client.collectDefaultMetrics();

export const agentGauge = new client.Gauge({
  name: "nexus_connected_agents_total",
  help: "Number of currently connected agents"
});

export const activityCounter = new client.Counter({
  name: "nexus_activity_events_total",
  help: "Total number of activity events received",
  labelNames: ["status", "kind"]
});

export const controlCounter = new client.Counter({
  name: "nexus_control_commands_total",
  help: "Total number of control commands sent",
  labelNames: ["command"]
});

export async function getPrometheusMetrics(): Promise<string> {
  return client.register.metrics();
}

export function getPrometheusContentType(): string {
  return client.register.contentType;
}
