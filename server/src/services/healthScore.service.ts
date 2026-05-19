import { RepoContext }    from '../models/RepoContext';
import FilePushHistory   from '../models/FilePushHistory';
import RepoHealthSnapshot, { type IHotFileDetail } from '../models/RepoHealthSnapshot';
import mongoose          from 'mongoose';

/**
 * Compute four structural health signals from the indexed repo context and
 * push history, then save a snapshot. Also persists per-file "why this is
 * a hot file" details for the Forensics page.
 *
 * Without PR review data (Strata standalone has no review pipeline),
 * the composite score is driven by coupling + churn risk. Debt and
 * confidence are kept in the schema for forward compatibility but default
 * to neutral values.
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

export async function computeAndSaveHealthScore(
  repoId: mongoose.Types.ObjectId,
): Promise<void> {
  const [ctx, pushHistory] = await Promise.all([
    RepoContext.findOne({ repoId }),
    FilePushHistory.find({ repoId }).sort({ pushedAt: -1 }).limit(30),
  ]);

  if (!ctx) return;

  // Signal 1: Coupling (Gini of PageRank scores)
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

  // Signal 2: Churn × centrality
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
  // For each hot file we record the PageRank percentile + churn count.
  const sortedDescScores = [...pageRankScores].reverse(); // largest first
  const rankOf = new Map<number, number>();
  sortedDescScores.forEach((score, idx) => {
    if (!rankOf.has(score)) rankOf.set(score, idx + 1);
  });

  const hotFilesDetailed: IHotFileDetail[] = hotFilesList
    .map((path) => {
      const score = pageRankByFile.get(path) ?? 0;
      const rank = rankOf.get(score) ?? sortedDescScores.length;
      // percentile = (1 - rank/N) * 100, so top file ≈ 100
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

  // Signal 3 / 4 — reserved. Neutral defaults.
  const s3 = 0;
  const totalDebt = 0;
  const avgDebt = 0;
  const avgConf = 70;
  const s4 = avgConf / 100;

  // Composite — coupling + churn carry the score.
  const raw = 100 - s1 * 45 - s2 * 45 + s4 * 10;
  const score = Math.max(0, Math.min(100, Math.round(raw)));

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
    totalDefinitions: ctx.definitions.length,
    totalFiles: ctx.fileTree?.length ?? 0,
    prCount: 0,
    computedAt: new Date(),
  });
}
