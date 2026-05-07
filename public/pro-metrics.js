const els = {
  totalSessions: document.getElementById("total-sessions"),
  activeSessions: document.getElementById("active-sessions"),
  tokensSaved: document.getElementById("tokens-saved"),
  costSaved: document.getElementById("cost-saved"),
  leaderboardBody: document.getElementById("leaderboard-body"),
  sessionTimeline: document.getElementById("session-timeline"),
  sessionCards: document.getElementById("session-cards"),
  activeBadge: document.getElementById("active-badge"),
  sessionsTotalBadge: document.getElementById("sessions-total-badge")
};

function fmtN(v, d = 0) { return new Intl.NumberFormat("en-US", { maximumFractionDigits: d }).format(v); }
function fmtTokens(n) { return n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `${(n/1e3).toFixed(1)}K` : fmtN(n); }
function fmtTime(iso) { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
function truncId(id, len = 18) { return id.length > len ? id.slice(0, len) + "…" : id; }

function rateClass(pct) {
  if (pct >= 30) return "rate-high";
  if (pct >= 10) return "rate-mid";
  return "rate-low";
}

async function refresh() {
  const res = await fetch("/nexus/sessions?limit=500");
  if (!res.ok) throw new Error("Sessions unavailable");
  const { summary, items } = await res.json();

  // KPIs
  els.totalSessions.textContent = fmtN(summary.totalSessions);
  els.activeSessions.textContent = fmtN(summary.activeSessions);
  els.tokensSaved.textContent = fmtTokens(summary.totalTokensSaved);
  els.costSaved.textContent = `$${fmtN(summary.totalEstimatedCostSavedUsd, 4)}`;
  els.activeBadge.textContent = `${summary.activeSessions} live`;
  els.sessionsTotalBadge.textContent = `${summary.totalSessions} sessions`;

  // Leaderboard
  const top = [...items].sort((a, b) => b.compressionRatePct - a.compressionRatePct).slice(0, 20);
  els.leaderboardBody.innerHTML = top.length
    ? top.map(s => `
      <tr>
        <td style="font-family:var(--mono);font-size:12px">${truncId(s.sessionId)}</td>
        <td style="color:var(--text-1)">${s.agentId}</td>
        <td><span class="rate-pill ${rateClass(s.compressionRatePct)}">${fmtN(s.compressionRatePct, 1)}%</span></td>
        <td style="font-family:var(--mono)">${fmtTokens(s.tokensSaved)}</td>
        <td style="color:var(--yellow);font-family:var(--mono)">$${fmtN(s.estimatedCostSavedUsd, 4)}</td>
      </tr>`).join("")
    : '<tr><td colspan="5" class="empty">No compression data yet.</td></tr>';

  // Active sessions timeline
  const active = items.filter(s => s.isActive).slice(0, 30);
  els.sessionTimeline.innerHTML = active.length
    ? active.map(s => `
      <li class="feed-item">
        <div class="feed-dot"></div>
        <div class="feed-body">
          <div class="feed-title">${truncId(s.sessionId)}</div>
          <div class="feed-meta">${s.agentId} · ${fmtTokens(s.tokensSaved)} saved</div>
        </div>
        <div class="feed-time">${fmtTime(s.lastActivityAt)}</div>
      </li>`).join("")
    : '<li class="empty">No active sessions.</li>';

  // Session cards
  els.sessionCards.innerHTML = items.length
    ? items.slice(0, 60).map(s => `
      <article class="session-card ${s.isActive ? "is-active" : ""}">
        <div class="sc-head">
          <span class="sc-id">${truncId(s.sessionId, 22)}</span>
          <span class="sc-status ${s.isActive ? "active" : "idle"}">${s.isActive ? "Active" : "Idle"}</span>
        </div>
        <div class="sc-stats">
          <div class="sc-stat">
            <span class="sc-stat-label">Tokens Saved</span>
            <span class="sc-stat-value accent">${fmtTokens(s.tokensSaved)}</span>
          </div>
          <div class="sc-stat">
            <span class="sc-stat-label">Cost Saved</span>
            <span class="sc-stat-value gold">$${fmtN(s.estimatedCostSavedUsd, 4)}</span>
          </div>
          <div class="sc-stat">
            <span class="sc-stat-label">Input Tokens</span>
            <span class="sc-stat-value">${fmtTokens(s.tokensInput)}</span>
          </div>
          <div class="sc-stat">
            <span class="sc-stat-label">Events</span>
            <span class="sc-stat-value">${s.eventCount}</span>
          </div>
        </div>
        <div class="sc-bar-wrap">
          <div class="sc-bar-label">
            <span>Compression</span>
            <span style="color:${s.compressionRatePct >= 20 ? 'var(--green)' : 'var(--text-2)'};font-weight:600">${fmtN(s.compressionRatePct, 1)}%</span>
          </div>
          <div class="sc-bar-track">
            <div class="sc-bar-fill" style="width:${Math.min(s.compressionRatePct, 100)}%"></div>
          </div>
        </div>
      </article>`).join("")
    : '<p class="empty">No sessions yet. Send activity events with token metadata.</p>';
}

async function boot() {
  try { await refresh(); }
  catch { els.sessionCards.innerHTML = '<p class="empty">Failed to load sessions.</p>'; }
  setInterval(refresh, 8000);
}

boot();
