const els = {
  kpiEntries: document.getElementById("kpi-entries"),
  kpiHitRatio: document.getElementById("kpi-hit-ratio"),
  kpiHitsMisses: document.getElementById("kpi-hits-misses"),
  kpiEpisodes: document.getElementById("kpi-episodes"),
  kpiBudget: document.getElementById("kpi-budget"),
  cacheBody: document.getElementById("cache-body"),
  cacheCount: document.getElementById("cache-count"),
  cacheCanvas: document.getElementById("cache-canvas"),
  episodeFeed: document.getElementById("episode-feed"),
  episodeCount: document.getElementById("episode-count"),
  gaugeCanvas: document.getElementById("gauge-canvas"),
  gaugeLabel: document.getElementById("gauge-label"),
  budgetStats: document.getElementById("budget-stats"),
  budgetRec: document.getElementById("budget-rec"),
  budgetStatus: document.getElementById("budget-status"),
  symbolBody: document.getElementById("symbol-body"),
  symbolCount: document.getElementById("symbol-count"),
  lastUpdated: document.getElementById("last-updated")
};

const cacheTrend = { hits: [], misses: [] };
const MAX_TREND = 48;

function fmtN(v, d = 0) { return new Intl.NumberFormat("en-US", { maximumFractionDigits: d }).format(v); }
function fmtTokens(n) { return n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `${(n/1e3).toFixed(1)}K` : String(n); }
function fmtTime(iso) { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
function fmtDate(iso) { return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
function basename(p) { return p.split(/[/\\]/).pop() || p; }
function pushTrend(arr, v) { arr.push(v); if (arr.length > MAX_TREND) arr.shift(); }

// ─── Cache performance chart ──────────────────────────────────────────────────

function drawCacheTrend() {
  const canvas = els.cacheCanvas;
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

  ctx.strokeStyle = "rgba(255,255,255,.05)"; ctx.lineWidth = 1;
  for (let i = 1; i <= 4; i++) {
    const y = (H / 5) * i;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  function drawLine(points, color) {
    if (!points.length) return;
    const min = Math.min(...points), max = Math.max(...points);
    const range = Math.max(1, max - min);
    ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 2;
    points.forEach((v, i) => {
      const x = pad + (i / Math.max(1, points.length - 1)) * (W - pad * 2);
      const y = H - pad - ((v - min) / range) * (H - pad * 2);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.beginPath();
    points.forEach((v, i) => {
      const x = pad + (i / Math.max(1, points.length - 1)) * (W - pad * 2);
      const y = H - pad - ((v - min) / range) * (H - pad * 2);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    const lastX = pad + ((points.length - 1) / Math.max(1, points.length - 1)) * (W - pad * 2);
    ctx.lineTo(lastX, H - pad);
    ctx.lineTo(pad, H - pad);
    ctx.closePath();
    ctx.fillStyle = color + "18";
    ctx.fill();
  }

  drawLine(cacheTrend.hits, "#34d399");
  drawLine(cacheTrend.misses, "#f87171");
}

// ─── Budget gauge ─────────────────────────────────────────────────────────────

function drawGauge(pct) {
  const canvas = els.gaugeCanvas;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = 200, H = 120;
  const cx = W / 2, cy = H - 10, r = 80;
  const startAngle = Math.PI;
  const endAngle = 2 * Math.PI;

  ctx.clearRect(0, 0, W, H);

  ctx.beginPath();
  ctx.arc(cx, cy, r, startAngle, endAngle);
  ctx.lineWidth = 12;
  ctx.strokeStyle = "rgba(255,255,255,.07)";
  ctx.lineCap = "round";
  ctx.stroke();

  const fillAngle = startAngle + (pct / 100) * Math.PI;
  let color = "#34d399";
  if (pct > 80) color = "#f87171";
  else if (pct > 60) color = "#fbbf24";

  ctx.beginPath();
  ctx.arc(cx, cy, r, startAngle, fillAngle);
  ctx.lineWidth = 12;
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.stroke();

  const glow = ctx.createRadialGradient(cx, cy, r - 20, cx, cy, r + 20);
  glow.addColorStop(0, color + "00");
  glow.addColorStop(0.5, color + "15");
  glow.addColorStop(1, color + "00");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  els.gaugeLabel.textContent = `${fmtN(pct, 1)}%`;
  els.gaugeLabel.style.color = color;
}

// ─── Render functions ─────────────────────────────────────────────────────────

function renderCacheTable(items) {
  els.cacheCount.textContent = `${items.length} files`;
  if (!items.length) {
    els.cacheBody.innerHTML = '<tr><td colspan="5" class="empty">No cached files yet. Use nexus_read_cached to populate.</td></tr>';
    return;
  }
  els.cacheBody.innerHTML = items.map(e => `
    <tr>
      <td><span class="file-path" title="${e.path}">${basename(e.path)}</span></td>
      <td style="font-family:var(--mono);font-size:12px">${fmtTokens(e.tokens)}</td>
      <td style="font-family:var(--mono);font-size:12px;color:var(--cyan)">${e.readCount}</td>
      <td style="font-family:var(--mono);font-size:12px">${e.symbolCount}</td>
      <td style="font-size:12px;color:var(--text-3)">T${e.lastReadTurn}</td>
    </tr>`).join("");
}

function renderEpisodes(items) {
  els.episodeCount.textContent = String(items.length);
  if (!items.length) {
    els.episodeFeed.innerHTML = '<li class="empty">No episodes yet. Use nexus_segment_episodes to create.</li>';
    return;
  }
  els.episodeFeed.innerHTML = items.map(ep => {
    const entities = ep.entities.slice(0, 5).map(e => `<span class="entity-chip">${e}</span>`).join("");
    const phaseClass = `phase-${ep.phase}`;
    return `
    <li class="feed-item" style="border-left-color:${phaseColor(ep.phase)}">
      <div class="feed-dot" style="background:${phaseColor(ep.phase)}"></div>
      <div class="feed-body">
        <div class="feed-title"><span class="phase-pill ${phaseClass}">${ep.phase}</span> ${ep.summary}</div>
        <div class="feed-meta">${ep.activityIds.length} activities · ${fmtTokens(ep.tokensCost)} tokens${entities ? " · " + entities : ""}</div>
      </div>
      <div class="feed-time">${fmtTime(ep.startTs)}</div>
    </li>`;
  }).join("");
}

function phaseColor(phase) {
  const map = { PLAN: "#a78bfa", EXECUTE: "#4df0ff", VERIFY: "#34d399", CONCLUDE: "#fbbf24" };
  return map[phase] || "#3d5080";
}

function renderBudget(data) {
  if (!data || !data.sessionId) {
    els.budgetStatus.textContent = "No session";
    drawGauge(0);
    els.budgetStats.innerHTML = "";
    els.budgetRec.textContent = "Set a session budget with nexus_context_budget to track usage.";
    return;
  }
  els.budgetStatus.textContent = `${fmtN(data.utilizationPct, 1)}% used`;
  drawGauge(data.utilizationPct);
  els.budgetStats.innerHTML = `
    <div class="budget-stat">
      <span class="budget-stat-label">Used</span>
      <span class="budget-stat-value">${fmtTokens(data.used)}</span>
    </div>
    <div class="budget-stat">
      <span class="budget-stat-label">Remaining</span>
      <span class="budget-stat-value" style="color:var(--green)">${fmtTokens(data.remaining)}</span>
    </div>
    <div class="budget-stat">
      <span class="budget-stat-label">Cache Files</span>
      <span class="budget-stat-value">${data.cachedFiles}</span>
    </div>
    <div class="budget-stat">
      <span class="budget-stat-label">Hit Ratio</span>
      <span class="budget-stat-value" style="color:var(--cyan)">${fmtN(data.cacheHitRatio * 100, 1)}%</span>
    </div>`;
  els.budgetRec.textContent = data.recommendation;
}

function renderSymbols(entries) {
  let allSymbols = [];
  for (const entry of entries) {
    if (entry.symbolCount > 0) {
      allSymbols.push({ path: entry.path, _pending: true });
    }
  }
  if (!allSymbols.length) {
    els.symbolCount.textContent = "0 symbols";
    els.symbolBody.innerHTML = '<tr><td colspan="5" class="empty">No symbols indexed yet.</td></tr>';
    return;
  }
  const fetches = entries.filter(e => e.symbolCount > 0).map(e =>
    fetch("/nexus/wm/symbols", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: e.path })
    }).then(r => r.json()).catch(() => ({ symbols: [] }))
  );
  Promise.all(fetches).then(results => {
    const rows = [];
    for (const res of results) {
      const file = basename(res.path || "");
      for (const sym of (res.symbols || []).filter(s => ["function","class","interface","type","enum","method"].includes(s.kind))) {
        rows.push({ file, ...sym });
      }
    }
    els.symbolCount.textContent = `${rows.length} symbols`;
    if (!rows.length) {
      els.symbolBody.innerHTML = '<tr><td colspan="5" class="empty">No exportable symbols found.</td></tr>';
      return;
    }
    els.symbolBody.innerHTML = rows.slice(0, 100).map(s => `
      <tr>
        <td><span class="file-path">${s.file}</span></td>
        <td style="color:var(--text-1);font-weight:500">${s.name}</td>
        <td><span class="kind-badge kind-${s.kind}">${s.kind}</span></td>
        <td style="font-family:var(--mono);font-size:12px">${s.line}–${s.endLine}</td>
        <td><span class="sig-text" title="${s.signature}">${s.signature}</span></td>
      </tr>`).join("");
  });
}

// ─── Data fetching ────────────────────────────────────────────────────────────

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url} → ${r.status}`);
  return r.json();
}

async function refreshAll() {
  const [stats, cacheEntries, episodes] = await Promise.all([
    fetchJson("/nexus/wm/stats"),
    fetchJson("/nexus/wm/cache-entries"),
    fetchJson("/nexus/wm/episodes")
  ]);

  // KPIs
  els.kpiEntries.textContent = fmtN(stats.entries);
  els.kpiHitRatio.textContent = `${fmtN(stats.hitRatio * 100, 1)}%`;
  els.kpiHitsMisses.innerHTML = `<span style="color:var(--green)">${fmtN(stats.hits)}</span> / <span style="color:var(--red)">${fmtN(stats.misses)}</span>`;
  els.kpiEpisodes.textContent = fmtN(episodes.total);

  // Trend
  pushTrend(cacheTrend.hits, stats.hits);
  pushTrend(cacheTrend.misses, stats.misses);
  drawCacheTrend();

  // Tables
  renderCacheTable(cacheEntries.items || []);
  renderEpisodes(episodes.items || []);
  renderSymbols(cacheEntries.items || []);

  // Budget — try to find an active session
  try {
    const sessions = await fetchJson("/nexus/sessions?limit=5");
    const active = (sessions.items || []).find(s => s.isActive);
    if (active) {
      const budget = await fetch("/nexus/wm/budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: active.sessionId, action: "get" })
      }).then(r => r.json());
      els.kpiBudget.textContent = `${fmtN(budget.utilizationPct, 1)}%`;
      renderBudget(budget);
    } else {
      els.kpiBudget.textContent = "—";
      renderBudget(null);
    }
  } catch {
    els.kpiBudget.textContent = "—";
    renderBudget(null);
  }

  els.lastUpdated.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

async function boot() {
  try { await refreshAll(); } catch(e) { console.error("Initial load failed:", e); }
  setInterval(refreshAll, 6000);
  window.addEventListener("resize", drawCacheTrend);
}

boot();