import { RepoContext }    from '../models/RepoContext';
import FilePushHistory   from '../models/FilePushHistory';
import RepoHealthSnapshot, {
  type IHotFileDetail,
  type ISmellDetail,
} from '../models/RepoHealthSnapshot';
import { analyzeBranches } from './branch.service';
import { analyzeContributors, computeBusFactor } from './contributor.service';
import mongoose          from 'mongoose';

/**
 * Compute structural health signals from the indexed repo context and
 * push history, then save a snapshot. Also persists per-file "why" detail
 * for both hot files and semantic-analysis findings, surfaced on the
 * Forensics page.
 *
 * Active signals (drive the composite score):
 *   - Coupling      (Gini of PageRank)
 *   - Churn risk    (hot files × pushes)
 *   - Smells        (god-file / dead-file / deep-coupling / circular-dep,
 *                    derived purely from ctx.definitions + ctx.graphEdges)
 * Reserved slots (default neutral, populated when PR review pipeline lands):
 *   - Debt
 *   - Confidence
 */

export function computeGini(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const sum = sorted.reduce((a, b) => a + b, 0);
  if (sum === 0) return 0;
  const weighted = sorted.reduce((acc, v, i) => acc + v * (i + 1), 0);
  return (2 * weighted) / (n * sum) - (n + 1) / n;
}

export function percentile(sorted: number[], pct: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((pct / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// Files legitimately allowed to have zero incoming references — entrypoints,
// declaration shims, config, tests. Used by the dead-file heuristic.
const DEAD_FILE_ALLOWLIST: RegExp[] = [
  /(^|\/)index\.[jt]sx?$/,
  /(^|\/)main\.[jt]sx?$/,
  /(^|\/)app\.[jt]sx?$/,
  /(^|\/)server\.[jt]sx?$/,
  /(^|\/)worker\.[jt]sx?$/,
  /(^|\/)cli\.[jt]sx?$/,
  /\.config\.[jt]sx?$/,
  /\.d\.ts$/,
  /\/__tests__\//,
  /\/test\//,
  /\/spec\//,
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
];

function isAllowedZeroImport(path: string): boolean {
  return DEAD_FILE_ALLOWLIST.some((re) => re.test(path));
}

export async function computeAndSaveHealthScore(
  repoId: mongoose.Types.ObjectId,
): Promise<void> {
  const [ctx, pushHistory] = await Promise.all([
    RepoContext.findOne({ repoId }),
    FilePushHistory.find({ repoId }).sort({ pushedAt: -1 }).limit(30),
  ]);

  if (!ctx) return;

  // ── Signal 1: Coupling (Gini of PageRank scores) ─────────────────────
  // Collapse to one score per file (definitions can share a path).
  const pageRankByFile = new Map<string, number>();
  for (const d of ctx.definitions as any[]) {
    const cur = pageRankByFile.get(d.path) ?? 0;
    if ((d.pageRankScore ?? 0) > cur) pageRankByFile.set(d.path, d.pageRankScore ?? 0);
  }

  const pageRankScores = [...pageRankByFile.values()]
    .filter((s) => s > 0)
    .sort((a, b) => a - b);

  const gini = computeGini(pageRankScores);
  const s1   = gini;

  // ── Signal 2: Churn × centrality ─────────────────────────────────────
  const topThreshold = percentile(pageRankScores, 90);
  const highCentralFiles = [...pageRankByFile.entries()]
    .filter(([, score]) => score >= topThreshold);
  const highCentralSet = new Set(highCentralFiles.map(([p]) => p));

  const totalPushes = pushHistory.length || 1;
  const churnCount  = new Map<string, number>();
  for (const push of pushHistory)
    for (const f of push.files)
      churnCount.set(f, (churnCount.get(f) ?? 0) + 1);

  // A "hot file" is in the top 10% PageRank AND changed in >30% of recent pushes.
  const hotFilesList = [...highCentralSet].filter(
    f => (churnCount.get(f) ?? 0) / totalPushes > 0.30,
  );

  // Build per-file detail so Forensics page can show the math.
  const sortedDescScores = [...pageRankScores].reverse(); // largest first
  const rankOf = new Map<number, number>();
  sortedDescScores.forEach((score, idx) => {
    if (!rankOf.has(score)) rankOf.set(score, idx + 1);
  });

  const hotFilesDetailed: IHotFileDetail[] = hotFilesList
    .map((path) => {
      const score = pageRankByFile.get(path) ?? 0;
      const rank = rankOf.get(score) ?? sortedDescScores.length;
      const pct = sortedDescScores.length
        ? Math.round((1 - (rank - 1) / sortedDescScores.length) * 100)
        : 0;
      return {
        path,
        pageRankScore: score,
        pageRankPercentile: pct,
        churnPushes: churnCount.get(path) ?? 0,
        totalRecentPushes: totalPushes,
      };
    })
    .sort((a, b) => b.churnPushes - a.churnPushes)
    .slice(0, 20);

  const s2 = Math.min(hotFilesList.length / 10, 1);

  // ── Smell detection (god-file / dead-file / deep-coupling / circular-dep) ──

  // File-level def counts (one row per file).
  const defCountByFile = new Map<string, number>();
  for (const d of ctx.definitions as any[]) {
    defCountByFile.set(d.path, (defCountByFile.get(d.path) ?? 0) + 1);
  }

  // Build incoming + outgoing edge sets from ctx.graphEdges. Field is named
  // `source`/`target` in the schema, but accept `from`/`to` as a safety net.
  const incomingEdges = new Map<string, Set<string>>(); // path → set of importers
  const outgoingEdges = new Map<string, Set<string>>(); // path → set of imports
  for (const edge of (ctx.graphEdges ?? []) as any[]) {
    const src: string | undefined = edge.source ?? edge.from;
    const dst: string | undefined = edge.target ?? edge.to;
    if (!src || !dst || src === dst) continue;
    if (!incomingEdges.has(dst)) incomingEdges.set(dst, new Set());
    if (!outgoingEdges.has(src)) outgoingEdges.set(src, new Set());
    incomingEdges.get(dst)!.add(src);
    outgoingEdges.get(src)!.add(dst);
  }

  const smellHits: ISmellDetail[] = [];

  // 2b. God files — files in top 2% of def count, capped at 50 defs.
  const defCountsSorted = [...defCountByFile.values()].sort((a, b) => a - b);
  const godFileThreshold = defCountsSorted.length
    ? Math.min(percentile(defCountsSorted, 98), 50)
    : 50;

  for (const [path, count] of defCountByFile) {
    if (count < godFileThreshold) continue;
    // file's percentile rank: fraction of files with defCount <= this one.
    const ltOrEq = defCountsSorted.filter((c) => c <= count).length;
    const rankPct = defCountsSorted.length
      ? Math.round((ltOrEq / defCountsSorted.length) * 100)
      : 100;
    const topPct = Math.max(1, 100 - rankPct);
    smellHits.push({
      path,
      kind: 'god-file',
      severity: count > 100 ? 'critical' : 'warning',
      metric: count,
      evidence: `${count} definitions — top ${topPct}% of repo`,
    });
  }

  // 2c. Dead files — zero incoming, ≥1 outgoing, path not allowlisted.
  for (const [path, outs] of outgoingEdges) {
    const inCount = incomingEdges.get(path)?.size ?? 0;
    if (inCount !== 0) continue;
    if (outs.size === 0) continue;
    if (isAllowedZeroImport(path)) continue;
    smellHits.push({
      path,
      kind: 'dead-file',
      severity: 'warning',
      metric: 0,
      evidence: `0 incoming references, ${outs.size} outgoing — nothing in the repo imports this file`,
    });
  }

  // 2d. Deep coupling — incoming count in top 5%, capped at 15. Exclude
  // files already flagged as god-files to avoid double-counting.
  const godFilePaths = new Set(
    smellHits.filter((s) => s.kind === 'god-file').map((s) => s.path),
  );
  const incomingCountsSorted = [...incomingEdges.values()]
    .map((s) => s.size)
    .sort((a, b) => a - b);
  const deepCouplingThreshold = incomingCountsSorted.length
    ? Math.min(percentile(incomingCountsSorted, 95), 15)
    : 15;

  for (const [path, ins] of incomingEdges) {
    if (godFilePaths.has(path)) continue;
    const inCount = ins.size;
    if (inCount < deepCouplingThreshold) continue;
    smellHits.push({
      path,
      kind: 'deep-coupling',
      severity: inCount > 30 ? 'critical' : 'warning',
      metric: inCount,
      evidence: `${inCount} files depend on this — changes here have wide blast radius`,
    });
  }

  // 2e. Direct circular dependencies (A→B and B→A). Aggregate per file.
  const cyclePartners = new Map<string, Set<string>>(); // path → set of partners
  const MAX_CYCLE_PAIRS = 20;
  const seenPair = new Set<string>();
  let pairCount = 0;

  outer: for (const [a, outsA] of outgoingEdges) {
    for (const b of outsA) {
      const outsB = outgoingEdges.get(b);
      if (!outsB || !outsB.has(a)) continue;
      const key = a < b ? `${a}::${b}` : `${b}::${a}`;
      if (seenPair.has(key)) continue;
      seenPair.add(key);
      if (!cyclePartners.has(a)) cyclePartners.set(a, new Set());
      if (!cyclePartners.has(b)) cyclePartners.set(b, new Set());
      cyclePartners.get(a)!.add(b);
      cyclePartners.get(b)!.add(a);
      pairCount++;
      if (pairCount >= MAX_CYCLE_PAIRS) break outer;
    }
  }

  for (const [path, partners] of cyclePartners) {
    const samplePartner = [...partners][0];
    smellHits.push({
      path,
      kind: 'circular-dep',
      severity: 'critical',
      metric: partners.size,
      evidence: `Directly imports ${samplePartner} which imports back — circular dependency`,
    });
  }

  // 2f. Normalize smell signal. Critical hits count double; cap at 30.
  const weightedSmells = smellHits.reduce(
    (acc, s) => acc + (s.severity === 'critical' ? 2 : 1),
    0,
  );
  const s5weighted = Math.min(weightedSmells / 30, 1);

  // ── Signals 3 / 4 — reserved (neutral defaults) ──────────────────────
  const s3 = 0;
  const totalDebt = 0;
  const avgDebt = 0;
  const avgConf = 70;
  const s4 = avgConf / 100;

  // ── Branch analysis ─────────────────────────────────────────────────
  // Pure derivation from ctx.branchSnapshot (fetched at index time). No
  // network calls here, mirrors how smells are derived from graphEdges.
  const branchesDetailed = analyzeBranches(ctx.branchSnapshot ?? null);
  const branchesSummary = branchesDetailed.reduce(
    (acc, b) => {
      acc.total++;
      if (b.status === "active") acc.active++;
      else if (b.status === "idle") acc.idle++;
      else if (b.status === "stale") acc.stale++;
      else if (b.status === "abandoned") acc.abandoned++;
      return acc;
    },
    { total: 0, active: 0, idle: 0, stale: 0, abandoned: 0 },
  );

  // ── Contributor analysis ────────────────────────────────────────────
  // Same pattern as branches — derived from a stored snapshot. Bus factor
  // = how many human authors are needed to cover 50% of all commits.
  const contributorsDetailed = analyzeContributors(
    ctx.contributorSnapshot ?? null,
  );
  const contributorsSummary = contributorsDetailed.reduce(
    (acc, c) => {
      acc.total++;
      if (c.isBot) acc.botCount++;
      if (c.status === "active") acc.activeCount++;
      acc.totalCommits += c.contributions;
      return acc;
    },
    { total: 0, activeCount: 0, botCount: 0, totalCommits: 0 },
  );
  const busFactor = computeBusFactor(contributorsDetailed);

  // ── Composite — coupling + churn + smells, baselined by confidence ────
  // Weights: coupling 35 + churn 35 + smells 20 + confidence 10 → 100 max.
  // Branch hygiene is informational only — it doesn't directly affect score.
  const raw = 100 - s1 * 35 - s2 * 35 - s5weighted * 20 + s4 * 10;
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  // Sort smells: critical first, then by metric descending. Cap at 50.
  const smellsDetailed = smellHits
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
      return b.metric - a.metric;
    })
    .slice(0, 50);

  await RepoHealthSnapshot.create({
    repoId,
    score,
    signals: {
      coupling:   { gini: s1, normalized: s1 },
      churnRisk:  { hotFileCount: hotFilesList.length, normalized: s2 },
      debt:       { weightedTotal: totalDebt, avgPerPR: avgDebt, normalized: s3 },
      confidence: { rollingAvg: avgConf, normalized: s4 },
    },
    hotFiles: hotFilesList.slice(0, 10),
    hotFilesDetailed,
    smells: {
      hitCount:   smellHits.length,
      normalized: s5weighted,
    },
    smellsDetailed,
    branches: {
      ...branchesSummary,
      fetchedAt: ctx.branchSnapshot?.fetchedAt ?? null,
    },
    branchesDetailed,
    contributors: {
      ...contributorsSummary,
      busFactor,
      recentWindow: ctx.contributorSnapshot?.recentWindow ?? 0,
      fetchedAt: ctx.contributorSnapshot?.fetchedAt ?? null,
    },
    contributorsDetailed,
    totalDefinitions: ctx.definitions.length,
    totalFiles: ctx.fileTree?.length ?? 0,
    prCount: 0,
    computedAt: new Date(),
  });
}
