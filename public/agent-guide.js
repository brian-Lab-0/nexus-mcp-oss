function fmtTokens(n) { return n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `${(n/1e3).toFixed(1)}K` : String(n); }
function fmtN(v, d = 2) { return new Intl.NumberFormat("en-US", { maximumFractionDigits: d }).format(v); }
function esc(str) { return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

function phasePills(phases) {
  return phases.map(p => `<span class="phase-pill">${p}</span>`).join("");
}

function catBadge(cat) {
  return `<span class="cat-badge cat-${cat}">${cat.toUpperCase()}</span>`;
}

function renderTool(tool) {
  const impact = tool.tokenImpact
    ? `<div class="tool-impact"><strong>Token impact:</strong> ${esc(tool.tokenImpact)}</div>`
    : "";

  return `
    <div class="tool-card">
      <div class="tool-card-head">
        <div style="flex:1;min-width:0">
          <div class="tool-name">${esc(tool.name)}</div>
          <div class="tool-trigger"><strong>When:</strong> ${esc(tool.trigger)}</div>
          <div class="phase-pills" style="margin-top:8px">${phasePills(tool.phase)}</div>
        </div>
        ${catBadge(tool.category)}
      </div>
      <div class="tool-card-body">
        <p class="tool-desc">${esc(tool.description)}</p>
        <div class="tool-why"><strong>Why it matters:</strong> ${esc(tool.why)}</div>
        ${impact}
        <div>
          <div class="tool-example-label">Example</div>
          <div class="tool-example-desc">${esc(tool.example.description)}</div>
          <pre class="tool-code">${esc(JSON.stringify(tool.example.input, null, 2))}</pre>
          ${tool.example.expectedOutput ? `<div class="tool-expected">→ ${esc(tool.example.expectedOutput)}</div>` : ""}
        </div>
      </div>
    </div>`;
}

function renderWorkflowSteps(steps) {
  return steps.map((step, i) => `
    <div class="wf-step">
      <div class="wf-step-num">${i + 1}</div>
      <div>
        <div class="wf-step-tool">${step.tool}</div>
        <div class="wf-step-note">${esc(step.note)}</div>
      </div>
    </div>`).join("");
}

function renderQuickSteps(steps) {
  return steps.map((step, i) => {
    // Extract tool name from step if present
    const toolMatch = step.match(/`([^`]+)`/);
    const display = toolMatch
      ? step.replace(/`([^`]+)`/g, `<code>$1</code>`)
      : esc(step);
    return `
      <div class="step">
        <div class="step-num">${i + 1}</div>
        <div class="step-body">${display.replace(/^[\d]+\.\s*/, '')}</div>
      </div>`;
  }).join("");
}

async function load() {
  const res = await fetch("/nexus/guide");
  if (!res.ok) throw new Error("Guide unavailable");
  const guide = await res.json();

  // Generated time
  const genTime = new Date(guide._meta.generatedAt).toLocaleString();
  document.getElementById("gen-time").textContent = `Generated ${genTime}`;
  document.getElementById("footer-gen").textContent = `Auto-generated · Nexus Pro · ${genTime}`;

  // Sidebar stats
  const { serverStats } = guide._meta;
  document.getElementById("stat-sessions").textContent = fmtN(serverStats.totalSessions, 0);
  document.getElementById("stat-tokens").textContent = fmtTokens(serverStats.totalTokensSaved);
  document.getElementById("stat-cost").textContent = `$${fmtN(serverStats.estimatedCostSavedUsd, 4)}`;

  // Quick steps
  document.getElementById("quick-steps").innerHTML = renderQuickSteps(guide.quickStart.steps);

  // Token strategy
  document.getElementById("strategy-headline").textContent = guide.tokenStrategy.headline;
  document.getElementById("savings-table").innerHTML = guide.tokenStrategy.savings.map(s => `
    <div class="savings-row">
      <span class="savings-source">${esc(s.source)}</span>
      <span class="savings-est">${esc(s.estimate)}</span>
      <span class="savings-type">${esc(s.type)} tokens</span>
    </div>`).join("");
  document.getElementById("strategy-total").textContent = guide.tokenStrategy.totalEstimate;

  // Workflows
  const wfs = guide.workflows;
  document.getElementById("wf-start-desc").textContent = wfs.sessionStart.description;
  document.getElementById("wf-start-steps").innerHTML = renderWorkflowSteps(wfs.sessionStart.steps);
  document.getElementById("wf-during-desc").textContent = wfs.duringExecution.description;
  document.getElementById("wf-during-steps").innerHTML = renderWorkflowSteps(wfs.duringExecution.steps);
  document.getElementById("wf-end-desc").textContent = wfs.sessionEnd.description;
  document.getElementById("wf-end-steps").innerHTML = renderWorkflowSteps(wfs.sessionEnd.steps);

  // Tools
  document.getElementById("tools-pro").innerHTML = guide.tools.pro.map(renderTool).join("");
  document.getElementById("tools-core").innerHTML = guide.tools.core.map(renderTool).join("");

  // Sidebar active link on scroll
  const sections = document.querySelectorAll(".doc-section");
  const links = document.querySelectorAll(".sidebar-link[href^='#']");
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        links.forEach(l => l.classList.toggle("active", l.getAttribute("href") === `#${entry.target.id}`));
      }
    }
  }, { rootMargin: "-30% 0px -60% 0px" });
  sections.forEach(s => observer.observe(s));
}

load().catch(() => {
  document.getElementById("content").innerHTML += '<p style="padding:40px;color:var(--red)">Failed to load guide. Is the Nexus server running on port 8787?</p>';
});
