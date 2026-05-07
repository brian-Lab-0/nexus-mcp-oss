import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { estimateTokens } from "./pro";
import type {
  FileCacheEntry,
  SymbolInfo,
  ReadCachedResult,
  FileDigestResult,
  Episode,
  ContextBudgetResult,
  SessionHandoff
} from "./types";

// ─── File cache ──────────────────────────────────────────────────────────────

const fileCache = new Map<string, FileCacheEntry>();
let globalTurn = 0;
let cacheHits = 0;
let cacheMisses = 0;

export function nextTurn(): number { return ++globalTurn; }
export function currentTurn(): number { return globalTurn; }
export function getCacheStats() {
  const total = cacheHits + cacheMisses;
  return {
    entries: fileCache.size,
    hits: cacheHits,
    misses: cacheMisses,
    hitRatio: total > 0 ? Number((cacheHits / total).toFixed(3)) : 0
  };
}

export function getCacheEntries(): Array<{
  path: string; hash: string; size: number; tokens: number;
  readCount: number; lastReadTurn: number; summary: string; symbolCount: number;
}> {
  return Array.from(fileCache.values()).map(e => ({
    path: e.absPath,
    hash: e.contentHash,
    size: e.size,
    tokens: e.tokens,
    readCount: e.readCount,
    lastReadTurn: e.lastReadTurn,
    summary: e.summary ?? "",
    symbolCount: e.symbols?.length ?? 0
  }));
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function normalizePath(p: string): string {
  return path.resolve(p).replace(/\\/g, "/");
}

// ─── Read-through cache core ─────────────────────────────────────────────────

function generateSummary(content: string, filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const lines = content.split("\n");
  const lineCount = lines.length;

  if ([".ts", ".tsx", ".js", ".jsx"].includes(ext)) {
    const exports = lines.filter(l => /^export\s/.test(l.trim())).map(l => l.trim().slice(0, 80));
    const imports = lines.filter(l => /^import\s/.test(l.trim())).length;
    return `${path.basename(filePath)}: ${lineCount} lines, ${imports} imports, ${exports.length} exports. Top exports: ${exports.slice(0, 3).join("; ") || "none"}`;
  }

  if ([".json"].includes(ext)) {
    return `${path.basename(filePath)}: JSON, ${lineCount} lines, ${content.length} bytes`;
  }

  if ([".html", ".css"].includes(ext)) {
    return `${path.basename(filePath)}: ${ext.slice(1).toUpperCase()}, ${lineCount} lines`;
  }

  const firstMeaningful = lines.find(l => l.trim().length > 10)?.trim().slice(0, 100) ?? "";
  return `${path.basename(filePath)}: ${lineCount} lines. ${firstMeaningful}`;
}

export function readCached(absPath: string, forceFull?: boolean): ReadCachedResult {
  const t0 = performance.now();
  const normalized = normalizePath(absPath);
  const turn = nextTurn();

  if (!fs.existsSync(normalized)) {
    cacheMisses++;
    return {
      path: normalized, status: "full", tokens: 0, tokensSaved: 0,
      cacheHit: false, turnLastRead: turn, readCount: 1,
      content: `[ERROR] File not found: ${normalized}`,
      latencyMs: Number((performance.now() - t0).toFixed(2))
    };
  }

  const stat = fs.statSync(normalized);
  const mtime = stat.mtimeMs;
  const existing = fileCache.get(normalized);

  if (existing && existing.mtime === mtime && !forceFull) {
    cacheHits++;
    existing.lastReadTurn = turn;
    existing.readCount++;
    const savedTokens = existing.tokens;
    return {
      path: normalized, status: "unchanged",
      tokens: estimateTokens(existing.summary ?? ""),
      tokensSaved: savedTokens,
      cacheHit: true,
      summary: existing.summary,
      turnLastRead: turn,
      readCount: existing.readCount,
      latencyMs: Number((performance.now() - t0).toFixed(2))
    };
  }

  const content = fs.readFileSync(normalized, "utf-8");
  const hash = hashContent(content);

  if (existing && existing.contentHash === hash && !forceFull) {
    cacheHits++;
    existing.mtime = mtime;
    existing.lastReadTurn = turn;
    existing.readCount++;
    return {
      path: normalized, status: "unchanged",
      tokens: estimateTokens(existing.summary ?? ""),
      tokensSaved: existing.tokens,
      cacheHit: true,
      summary: existing.summary,
      turnLastRead: turn,
      readCount: existing.readCount,
      latencyMs: Number((performance.now() - t0).toFixed(2))
    };
  }

  cacheMisses++;
  const tokens = estimateTokens(content);
  const summary = generateSummary(content, normalized);
  const symbols = extractSymbols(normalized, content);

  const entry: FileCacheEntry = {
    absPath: normalized, contentHash: hash, mtime, size: stat.size,
    lastReadTurn: turn, readCount: (existing?.readCount ?? 0) + 1,
    tokens, summary, symbols
  };
  fileCache.set(normalized, entry);

  return {
    path: normalized, status: "full", content, tokens, tokensSaved: 0,
    cacheHit: false, summary, turnLastRead: turn, readCount: entry.readCount,
    latencyMs: Number((performance.now() - t0).toFixed(2))
  };
}

// ─── File digest (metadata only, no content) ────────────────────────────────

export function fileDigest(absPath: string): FileDigestResult {
  const t0 = performance.now();
  const normalized = normalizePath(absPath);

  if (!fs.existsSync(normalized)) {
    return { path: normalized, exists: false, latencyMs: Number((performance.now() - t0).toFixed(2)) };
  }

  const cached = fileCache.get(normalized);
  if (cached) {
    return {
      path: normalized, exists: true, hash: cached.contentHash,
      size: cached.size, tokens: cached.tokens, summary: cached.summary,
      symbolCount: cached.symbols?.length ?? 0, lastReadTurn: cached.lastReadTurn,
      latencyMs: Number((performance.now() - t0).toFixed(2))
    };
  }

  const stat = fs.statSync(normalized);
  return {
    path: normalized, exists: true, size: stat.size,
    latencyMs: Number((performance.now() - t0).toFixed(2))
  };
}

// ─── Symbol extraction (TypeScript compiler API) ─────────────────────────────

function extractSymbols(filePath: string, content: string): SymbolInfo[] {
  const ext = path.extname(filePath).toLowerCase();
  if (![".ts", ".tsx", ".js", ".jsx"].includes(ext)) return [];

  const symbols: SymbolInfo[] = [];
  try {
    const sourceFile = ts.createSourceFile(
      filePath, content, ts.ScriptTarget.Latest, true,
      ext === ".tsx" || ext === ".jsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );

    function visit(node: ts.Node) {
      const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;

      if (ts.isFunctionDeclaration(node) && node.name) {
        const params = node.parameters.map(p => p.getText(sourceFile)).join(", ");
        symbols.push({
          name: node.name.text, kind: "function",
          line: startLine, endLine,
          signature: `function ${node.name.text}(${params})`
        });
      } else if (ts.isClassDeclaration(node) && node.name) {
        symbols.push({
          name: node.name.text, kind: "class",
          line: startLine, endLine,
          signature: `class ${node.name.text}`
        });
      } else if (ts.isInterfaceDeclaration(node)) {
        symbols.push({
          name: node.name.text, kind: "interface",
          line: startLine, endLine,
          signature: `interface ${node.name.text}`
        });
      } else if (ts.isTypeAliasDeclaration(node)) {
        symbols.push({
          name: node.name.text, kind: "type",
          line: startLine, endLine,
          signature: `type ${node.name.text}`
        });
      } else if (ts.isEnumDeclaration(node)) {
        symbols.push({
          name: node.name.text, kind: "enum",
          line: startLine, endLine,
          signature: `enum ${node.name.text}`
        });
      } else if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            symbols.push({
              name: decl.name.text, kind: "variable",
              line: startLine, endLine,
              signature: decl.getText(sourceFile).slice(0, 120)
            });
          }
        }
      } else if (ts.isMethodDeclaration(node) && node.name) {
        const name = node.name.getText(sourceFile);
        const params = node.parameters.map(p => p.getText(sourceFile)).join(", ");
        symbols.push({
          name, kind: "method", line: startLine, endLine,
          signature: `${name}(${params})`
        });
      }
      ts.forEachChild(node, visit);
    }
    ts.forEachChild(sourceFile, visit);
  } catch { /* non-parseable file — return empty */ }

  return symbols;
}

// ─── Symbol-level slicing ────────────────────────────────────────────────────

export function listSymbols(absPath: string): { path: string; symbols: SymbolInfo[] } {
  const normalized = normalizePath(absPath);
  const cached = fileCache.get(normalized);

  if (cached?.symbols) {
    return { path: normalized, symbols: cached.symbols };
  }

  if (!fs.existsSync(normalized)) {
    return { path: normalized, symbols: [] };
  }

  const content = fs.readFileSync(normalized, "utf-8");
  const symbols = extractSymbols(normalized, content);

  const existing = fileCache.get(normalized);
  if (existing) {
    existing.symbols = symbols;
  }

  return { path: normalized, symbols };
}

export function getSymbol(absPath: string, symbolName: string, contextLines = 5): {
  path: string; found: boolean; name?: string; kind?: string;
  line?: number; endLine?: number; signature?: string;
  content?: string; tokens?: number;
} {
  const normalized = normalizePath(absPath);
  const { symbols } = listSymbols(normalized);
  const sym = symbols.find(s => s.name === symbolName);

  if (!sym) {
    return { path: normalized, found: false };
  }

  if (!fs.existsSync(normalized)) {
    return { path: normalized, found: false };
  }

  const lines = fs.readFileSync(normalized, "utf-8").split("\n");
  const start = Math.max(0, sym.line - 1 - contextLines);
  const end = Math.min(lines.length, sym.endLine + contextLines);
  const slice = lines.slice(start, end).map((l, i) => `${start + i + 1}\t${l}`).join("\n");

  return {
    path: normalized, found: true, name: sym.name, kind: sym.kind,
    line: sym.line, endLine: sym.endLine, signature: sym.signature,
    content: slice, tokens: estimateTokens(slice)
  };
}

// ─── Episode store ───────────────────────────────────────────────────────────

const episodes: Episode[] = [];
const EPISODE_GAP_MS = 5 * 60 * 1000;

export function getEpisodes(): Episode[] { return episodes; }

export function segmentEpisode(
  sessionId: string,
  activityIds: string[],
  details: string[],
  timestamps: string[],
  files: string[],
  phase: string
): Episode {
  const summary = buildEpisodeSummary(details, files, phase);
  const entities = extractEntities(details);

  const episode: Episode = {
    id: randomUUID().slice(0, 8),
    sessionId,
    summary,
    entities,
    activityIds,
    filesInvolved: [...new Set(files)],
    startTs: timestamps[0] ?? new Date().toISOString(),
    endTs: timestamps[timestamps.length - 1] ?? new Date().toISOString(),
    phase,
    tokensCost: estimateTokens(summary)
  };

  episodes.push(episode);
  return episode;
}

function buildEpisodeSummary(details: string[], files: string[], phase: string): string {
  const uniqueFiles = [...new Set(files)].map(f => path.basename(f));
  const verbs = extractVerbs(details);
  const fileStr = uniqueFiles.length > 0 ? `Files: ${uniqueFiles.slice(0, 5).join(", ")}` : "";
  const actionStr = verbs.length > 0 ? `Actions: ${verbs.slice(0, 4).join(", ")}` : "";
  return [`Phase: ${phase}`, actionStr, fileStr, `${details.length} activities`].filter(Boolean).join(". ");
}

function extractVerbs(details: string[]): string[] {
  const verbPatterns = /\b(created|updated|fixed|added|removed|refactored|tested|deployed|read|wrote|analyzed|compressed|distilled)\b/gi;
  const verbs = new Set<string>();
  for (const d of details) {
    for (const match of d.matchAll(verbPatterns)) {
      verbs.add(match[1].toLowerCase());
    }
  }
  return [...verbs];
}

function extractEntities(details: string[]): string[] {
  const entities = new Set<string>();
  for (const d of details) {
    for (const match of d.matchAll(/`([^`]+)`/g)) entities.add(match[1]);
    for (const match of d.matchAll(/\b[\w-]+\.(ts|js|tsx|jsx|json|html|css|py|go|rs)\b/g)) entities.add(match[0]);
  }
  return [...entities].slice(0, 20);
}

// ─── Episode retrieval (keyword-based, upgradeable to embedding) ─────────────

export function recallEpisodes(query: string, k = 3): Episode[] {
  if (episodes.length === 0) return [];

  const queryWords = new Set(query.toLowerCase().split(/\s+/).filter(w => w.length > 2));

  const scored = episodes.map(ep => {
    const text = `${ep.summary} ${ep.entities.join(" ")} ${ep.filesInvolved.join(" ")}`.toLowerCase();
    const hits = [...queryWords].filter(w => text.includes(w)).length;
    const recency = (Date.now() - new Date(ep.endTs).getTime()) / (1000 * 60 * 60);
    const recencyBoost = Math.max(0, 1 - recency / 24);
    return { episode: ep, score: hits + recencyBoost * 0.5 };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .filter(s => s.score > 0)
    .map(s => s.episode);
}

// ─── Auto-segmentation from activity stream ──────────────────────────────────

interface ActivityForSegment {
  id: string;
  timestamp: string;
  details: string;
  status: string;
  metadata?: Record<string, unknown>;
}

export function autoSegmentActivities(
  sessionId: string,
  activities: ActivityForSegment[]
): Episode[] {
  if (activities.length === 0) return [];

  const sorted = [...activities].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const segments: ActivityForSegment[][] = [];
  let current: ActivityForSegment[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const gap = new Date(sorted[i].timestamp).getTime() - new Date(sorted[i - 1].timestamp).getTime();
    if (gap > EPISODE_GAP_MS) {
      segments.push(current);
      current = [];
    }
    current.push(sorted[i]);
  }
  if (current.length > 0) segments.push(current);

  const newEpisodes: Episode[] = [];
  for (const seg of segments) {
    const ids = seg.map(a => a.id);
    const details = seg.map(a => a.details);
    const timestamps = seg.map(a => a.timestamp);
    const files: string[] = [];
    for (const a of seg) {
      const meta = a.metadata ?? {};
      if (typeof meta.file === "string") files.push(meta.file);
      if (Array.isArray(meta.files)) files.push(...meta.files.filter((f): f is string => typeof f === "string"));
    }
    const phase = inferPhase(seg);
    newEpisodes.push(segmentEpisode(sessionId, ids, details, timestamps, files, phase));
  }

  return newEpisodes;
}

function inferPhase(activities: ActivityForSegment[]): string {
  const text = activities.map(a => a.details).join(" ").toLowerCase();
  if (text.includes("plan") || text.includes("design") || text.includes("architect")) return "PLAN";
  if (text.includes("test") || text.includes("verify") || text.includes("check")) return "VERIFY";
  if (text.includes("done") || text.includes("complete") || text.includes("finish")) return "CONCLUDE";
  return "EXECUTE";
}

// ─── Context budget governor ─────────────────────────────────────────────────

const sessionBudgets = new Map<string, { budget: number; used: number }>();

export function setSessionBudget(sessionId: string, budget: number): void {
  sessionBudgets.set(sessionId, { budget, used: 0 });
}

export function trackTokenUsage(sessionId: string, tokens: number): void {
  const entry = sessionBudgets.get(sessionId);
  if (entry) entry.used += tokens;
}

export function getContextBudget(sessionId: string): ContextBudgetResult {
  const t0 = performance.now();
  const entry = sessionBudgets.get(sessionId) ?? { budget: 200000, used: 0 };
  const remaining = Math.max(0, entry.budget - entry.used);
  const utilizationPct = entry.budget > 0 ? Number(((entry.used / entry.budget) * 100).toFixed(1)) : 0;

  const sessionEpisodes = episodes.filter(e => e.sessionId === sessionId);
  const stats = getCacheStats();

  const evictionCandidates: string[] = [];
  if (utilizationPct > 80) {
    const oldEpisodes = sessionEpisodes
      .sort((a, b) => new Date(a.startTs).getTime() - new Date(b.startTs).getTime())
      .slice(0, Math.ceil(sessionEpisodes.length * 0.3));
    evictionCandidates.push(...oldEpisodes.map(e => e.id));
  }

  let recommendation = "Budget healthy — full context available.";
  if (utilizationPct > 90) recommendation = "Critical — evict old episodes and use summaries only.";
  else if (utilizationPct > 80) recommendation = "High usage — consider evicting oldest episodes to summaries.";
  else if (utilizationPct > 60) recommendation = "Moderate — monitor usage, prefer cached reads.";

  return {
    sessionId, totalBudget: entry.budget, used: entry.used, remaining,
    utilizationPct, episodesInWindow: sessionEpisodes.length,
    cachedFiles: stats.entries, cacheHitRatio: stats.hitRatio,
    evictionCandidates, recommendation,
    latencyMs: Number((performance.now() - t0).toFixed(2))
  };
}

// ─── Session handoff ─────────────────────────────────────────────────────────

export function generateHandoff(sessionId: string): SessionHandoff {
  const sessionEpisodes = episodes.filter(e => e.sessionId === sessionId);
  const summaries = sessionEpisodes.map(e => e.summary);
  const allFiles = [...new Set(sessionEpisodes.flatMap(e => e.filesInvolved))];

  const lastEpisode = sessionEpisodes[sessionEpisodes.length - 1];
  const outstandingGoals: string[] = [];
  if (lastEpisode && lastEpisode.phase !== "CONCLUDE") {
    outstandingGoals.push(`Incomplete phase: ${lastEpisode.phase}. Last: ${lastEpisode.summary.slice(0, 100)}`);
  }

  const totalSaved = sessionEpisodes.reduce((sum, e) => sum + e.tokensCost, 0);
  const handoffText = summaries.join("\n");

  return {
    sessionId,
    episodeSummaries: summaries,
    outstandingGoals,
    filesModified: allFiles,
    tokensSavedTotal: totalSaved,
    handoffTokens: estimateTokens(handoffText),
    generatedAt: new Date().toISOString()
  };
}