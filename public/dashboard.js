const els = {
  connChip: document.getElementById("conn-chip"),
  connLabel: document.getElementById("conn-label"),
  totalAgents: document.getElementById("total-agents"),
  totalActivities: document.getElementById("total-activities"),
  runningCount: document.getElementById("running-count"),
  failedCount: document.getElementById("failed-count"),
  tokensSavedKpi: document.getElementById("tokens-saved-kpi"),
  cacheHitRatio: document.getElementById("cache-hit-ratio"),
  platformBars: document.getElementById("platform-bars"),
  statusBars: document.getElementById("status-bars"),
  agentsBody: document.getElementById("agents-body"),
  agentsCount: document.getElementById("agents-count"),
  controlLog: document.getElementById("control-log"),
  controlCount: document.getElementById("control-count"),
  activityLog: document.getElementById("activity-log"),
  activityCount: document.getElementById("activity-count"),
  metricsState: document.getElementById("metrics-state"),
  metricCpu: document.getElementById("metric-cpu"),
  metricMemoryLabel: document.getElementById("metric-memory-label"),
  metricMemory: document.getElementById("metric-memory"),
  metricLag: document.getElementById("metric-lag"),
  metricUptime: document.getElementById("metric-uptime"),
  trendCanvas: document.getElementById("trend-canvas"),
  memoryUnit: document.getElementById("memory-unit"),
  lastUpdated: document.getElementById("last-updated")
};

const trend = { cpu: [], memoryMb: [], lag: [], uptime: [] };
const MAX_TREND = 48;
let memoryUnitMode = "auto";

function fmt(n) { return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n); }
function fmtTime(iso) { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
function fmtDate(iso) { return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
function fmtTokens(n) { return n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `${(n/1e3).toFixed(1)}K` : String(n); }

function setConn(state, label) {
  els.connChip.classList.remove("online", "offline");
  if (state) els.connChip.classList.add(state);
  els.connLabel.textContent = label;
}

function getMemDisplay(bytes) {
  if (memoryUnitMode === "mb") return { label: "Memory (MB)", value: bytes / (1024 ** 2) };
  if (memoryUnitMode === "gb") return { label: "Memory (GB)", value: bytes / (1024 ** 3) };
  return bytes >= 1024 ** 3
    ? { label: "Memory (GB)", value: bytes / (1024 ** 3) }
    : { label: "Memory (MB)", value: bytes / (1024 ** 2) };
}

function pushTrend(arr, v) { arr.push(v); if (arr.length > MAX_TREND) arr.shift(); }

function renderBars(el, map) {
  const entries = Object.entries(map || {});
  const total = entries.reduce((s, [, v]) => s + Number(v), 0) || 1;
  if (!entries.length) { el.innerHTML = '<p class="empty">No data yet.</p>'; return; }
  el.innerHTML = entries.map(([label, value]) => {
    const pct = Math.max(2, Math.round((Number(value) / total) * 100));
    return `<div class="bar-row">
      <span class="bar-label">${label}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      <span class="bar-count">${value}</span>
    </div>`;
  }).join("");
}

function renderAgents(items) {
  els.agentsCount.textContent = String(items.length);
  if (!items.length) {
    els.agentsBody.innerHTML = '<tr><td colspan="4" class="empty">No connected agents.</td></tr>';
    return;
  }
  els.agentsBody.innerHTML = items.map(a => `
    <tr>
      <td style="color:var(--text-1);font-weight:500">${a.name}</td>
      <td><span class="platform-tag">${a.platform}</span></td>
      <td style="font-family:var(--mono);font-size:12px">${a.instanceId}</td>
      <td>${fmtDate(a.lastSeenAt)}</td>
    </tr>`).join("");
}

function renderActivity(items) {
  els.activityCount.textContent = String(items.length);
  if (!items.length) {
    els.activityLog.innerHTML = '<li class="empty" style="padding:24px;text-align:center">No activity yet.</li>';
    return;
  }
  els.activityLog.innerHTML = items.slice(0, 50).map(item => `
    <li class="feed-item status-${item.status}">
      <div class="feed-dot"></div>
      <div class="feed-body">
        <div class="feed-title">${item.details}</div>
        <div class="feed-meta">${item.agentId} · <span style="text-transform:capitalize">${item.status}</span> · ${item.kind}</div>
      </div>
      <div class="feed-time">${fmtTime(item.timestamp)}</div>
    </li>`).join("");
}

function renderControl(items) {
  els.controlCount.textContent = String(items.length);
  if (!items.length) {
    els.controlLog.innerHTML = '<li class="empty" style="padding:24px;text-align:center">No control commands.</li>';
    return;
  }
  els.controlLog.innerHTML = items.slice(0, 25).map(item => `
    <li class="feed-item">
      <div class="feed-dot" style="background:var(--purple)"></div>
      <div class="feed-body">
        <div class="feed-title"><span class="feed-cmd">${item.command.command}</span></div>
        <div class="feed-meta">${item.agentId}${item.command.reason ? " · " + item.command.reason : ""}</div>
      </div>
      <div class="feed-time">${fmtTime(item.at)}</div>
    </li>`).join("");
}

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url} → ${r.status}`);
  return r.json();
}

function parsePrometheus(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const l = line.trim();
    if (!l || l.startsWith("#") || l.includes("{")) continue;
    const [name, val] = l.split(/\s+/, 2);
    const n = Number(val);
    if (name && !isNaN(n)) out[name] = n;
  }
  return out;
}

function drawTrend() {
  const canvas = els.trendCanvas;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
    canvas.width = W * dpr; canvas.height = H * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const pad = 12;

  // Grid lines
  ctx.strokeStyle = "rgba(255,255,255,.05)"; ctx.lineWidth = 1;
  for (let i = 1; i <= 4; i++) {
    const y = (H / 5) * i;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  function drawLine(points, color) {
    if (!points.length) return;
    const min = Math.min(...points), max = Math.max(...points);
    const range = Math.max(1e-9, max - min);
    ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1.5;
    points.forEach((v, i) => {
      const x = pad + (i / Math.max(1, points.length - 1)) * (W - pad * 2);
      const y = H - pad - ((v - min) / range) * (H - pad * 2);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Area fill
    ctx.beginPath();
    points.forEach((v, i) => {
      const x = pad + (i / Math.max(1, points.length - 1)) * (W - pad * 2);
      const y = H - pad - ((v - min) / range) * (H - pad * 2);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.lineTo(pad + (points.length - 1) / Math.max(1, points.length - 1) * (W - pad * 2), H - pad);
    ctx.lineTo(pad, H - pad);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, color.replace(")", ", 0.15)").replace("rgb", "rgba").replace("#", "rgba(").replace(")", ", 0.15)"));
    ctx.fillStyle = color + "18";
    ctx.fill();
  }

  drawLine(trend.cpu, "#4df0ff");
  drawLine(trend.memoryMb, "#a78bfa");
  drawLine(trend.lag, "#fbbf24");
  drawLine(trend.uptime, "#34d399");
}

async function refreshMetrics() {
  try {
    const text = await (await fetch("/metrics")).text();
    const p = parsePrometheus(text);
    const cpu = p.process_cpu_seconds_total || 0;
    const memBytes = p.process_resident_memory_bytes || 0;
    const lag = p.nodejs_eventloop_lag_mean_seconds || 0;
    const uptime = p.process_uptime_seconds || 0;
    const mem = getMemDisplay(memBytes);
    els.metricCpu.textContent = fmt(cpu);
    els.metricMemoryLabel.textContent = mem.label;
    els.metricMemory.textContent = fmt(mem.value);
    els.metricLag.textContent = `${fmt(lag * 1000)} ms`;
    els.metricUptime.textContent = `${fmt(uptime)} s`;
    els.metricsState.textContent = "Live";
    els.metricsState.style.color = "var(--green)";
    els.metricsState.style.borderColor = "rgba(52,211,153,.3)";
    pushTrend(trend.cpu, cpu);
    pushTrend(trend.memoryMb, memBytes / 1024 ** 2);
    pushTrend(trend.lag, lag * 1000);
    pushTrend(trend.uptime, uptime);
    drawTrend();
  } catch {
    els.metricsState.textContent = "Unavailable";
  }
}

async function refreshAll() {
  const [nexus, agents, activities, controls, sessions, wmStats] = await Promise.all([
    fetchJson("/nexus"),
    fetchJson("/nexus/agents"),
    fetchJson("/nexus/activities?limit=100"),
    fetchJson("/nexus/control-log?limit=100"),
    fetchJson("/nexus/sessions?limit=100"),
    fetchJson("/nexus/wm/stats").catch(() => ({ hitRatio: 0, hits: 0, misses: 0 }))
  ]);

  const ov = nexus.overview || {};
  const sc = ov.statusCounts || {};

  els.totalAgents.textContent = String(ov.totalAgents || 0);
  els.totalActivities.textContent = String(ov.totalActivities || 0);
  els.runningCount.textContent = String(sc.running || 0);
  els.failedCount.textContent = String(sc.failed || 0);
  els.tokensSavedKpi.textContent = fmtTokens(sessions.summary?.totalTokensSaved || 0);
  els.cacheHitRatio.textContent = (wmStats.hits + wmStats.misses) > 0
    ? `${(wmStats.hitRatio * 100).toFixed(1)}%`
    : "—";
  els.lastUpdated.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  renderBars(els.platformBars, ov.platformCounts || {});
  renderBars(els.statusBars, sc);
  renderAgents(agents.items || []);
  renderActivity(activities.items || []);
  renderControl(controls.items || []);
  await refreshMetrics();
}

function connectWs() {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/nexus/ws`);
  ws.addEventListener("open", () => setConn("online", "Live"));
  ws.addEventListener("message", () => refreshAll().catch(() => setConn("offline", "Update failed")));
  ws.addEventListener("close", () => { setConn("offline", "Reconnecting…"); setTimeout(connectWs, 2000); });
}

async function boot() {
  try { await refreshAll(); } catch { setConn("offline", "Unreachable"); }
  connectWs();
  setInterval(refreshAll, 8000);
  window.addEventListener("resize", drawTrend);
  els.memoryUnit.addEventListener("change", e => { memoryUnitMode = e.target.value; refreshMetrics(); });
}

boot();
