import { Request, Response } from "express";
import RepoHealthSnapshot from "../models/RepoHealthSnapshot";
import FilePushHistory from "../models/FilePushHistory";
import { Repo } from "../models/Repo";
import { RepoContext } from "../models/RepoContext";
import { LLMUsage } from "../models/LLMUsage";
import { generateInsights } from "../services/insights.service";
import mongoose from "mongoose";

export async function getHealthSnapshot(req: Request, res: Response) {
  const repoId = String(req.params.repoId);

  if (!mongoose.Types.ObjectId.isValid(repoId))
    return res.status(400).json({ error: "Invalid repoId" });

  const repo = await Repo.findOne({
    _id: repoId,
    connectedBy: req.user!.userId,
    isActive: true,
  });
  if (!repo) return res.status(404).json({ error: "Repo not found" });

  const snapshot = await RepoHealthSnapshot.findOne({ repoId }).sort({
    computedAt: -1,
  });

  if (!snapshot) return res.status(404).json({ error: "No health data yet" });

  // Get recent push history for commit timeline
  const recentPushes = await FilePushHistory.find({ repoId })
    .sort({ pushedAt: -1 })
    .limit(10)
    .select("commitSha files pushedAt fileDiffs");

  // Calculate additional metrics
  const totalSnapshots = await RepoHealthSnapshot.countDocuments({ repoId });
  const firstSnapshot = await RepoHealthSnapshot.findOne({ repoId }).sort({
    computedAt: 1,
  });

  const scoreChange =
    firstSnapshot && totalSnapshots > 1
      ? snapshot.score - firstSnapshot.score
      : 0;

  return res.json({
    repoId,
    repoFullName: repo.fullName,
    score: snapshot.score,
    signals: snapshot.signals,
    hotFiles: snapshot.hotFiles,
    totalFiles: snapshot.totalFiles,
    totalDefs: snapshot.totalDefinitions,
    prCount: snapshot.prCount,
    computedAt: snapshot.computedAt,
    recentPushes: recentPushes.map((p) => ({
      commitSha: p.commitSha,
      files: p.files,
      pushedAt: p.pushedAt,
      fileDiffs: p.fileDiffs || [],
    })),
    metrics: {
      totalSnapshots,
      scoreChange,
      daysTracked: firstSnapshot
        ? Math.floor(
            (Date.now() - firstSnapshot.computedAt.getTime()) / 86400000,
          )
        : 0,
    },
  });
}

export async function getHealthHistory(req: Request, res: Response) {
  const repoId = String(req.params.repoId);
  const days = Math.min(parseInt(req.query.days as string) || 90, 365);

  if (!mongoose.Types.ObjectId.isValid(repoId))
    return res.status(400).json({ error: "Invalid repoId" });

  const repo = await Repo.findOne({
    _id: repoId,
    connectedBy: req.user!.userId,
    isActive: true,
  });
  if (!repo) return res.status(404).json({ error: "Repo not found" });

  const since = new Date(Date.now() - days * 86400000);
  const snapshots = await RepoHealthSnapshot.find({
    repoId,
    computedAt: { $gte: since },
  })
    .sort({ computedAt: 1 })
    .select("score computedAt signals totalFiles totalDefinitions");

  return res.json({
    repoId,
    repoFullName: repo.fullName,
    days,
    history: snapshots.map((s) => ({
      score: s.score,
      computedAt: s.computedAt,
      gini: s.signals.coupling.gini,
      hotFileCount: s.signals.churnRisk.hotFileCount,
      coupling: s.signals.coupling.normalized,
      churnRisk: s.signals.churnRisk.normalized,
      debt: s.signals.debt.normalized,
      confidence: s.signals.confidence.normalized,
      totalFiles: s.totalFiles,
      totalDefs: s.totalDefinitions,
    })),
  });
}

/**
 * GET /health/:repoId/evidence
 *
 * The "show me your work" endpoint. Returns:
 *   - The latest snapshot with hotFilesDetailed (each hot file's
 *     PageRank rank, churn frequency, and the math behind it)
 *   - The top 30 files by PageRank with their absolute scores
 *   - Conventions with their source files + LLMUsage links
 *   - History summaries with their source PRs + LLMUsage links
 *   - All LLMUsage rows for this repo (prompt previews, raw responses,
 *     tokens, cost) so users can audit every LLM-generated claim
 *   - Push history stats (total recorded pushes, oldest/newest)
 *
 * Everything cited on the Forensics page comes from this single
 * response, so it's a roundtrip per page-load (not per-section).
 */
export async function getEvidence(req: Request, res: Response) {
  const repoId = String(req.params.repoId);

  if (!mongoose.Types.ObjectId.isValid(repoId))
    return res.status(400).json({ error: "Invalid repoId" });

  const repo = await Repo.findOne({
    _id: repoId,
    connectedBy: req.user!.userId,
    isActive: true,
  });
  if (!repo) return res.status(404).json({ error: "Repo not found" });

  const [snapshot, ctx, llmUsages, pushStats] = await Promise.all([
    RepoHealthSnapshot.findOne({ repoId }).sort({ computedAt: -1 }),
    RepoContext.findOne({ repoId }).select(
      "definitions conventionsDetailed conventions recentHistoryDetailed recentHistory lastIndexedAt indexStatus",
    ),
    LLMUsage.find({ repoId }).sort({ createdAt: -1 }).lean(),
    FilePushHistory.aggregate([
      { $match: { repoId: new mongoose.Types.ObjectId(repoId) } },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          oldest: { $min: "$pushedAt" },
          newest: { $max: "$pushedAt" },
        },
      },
    ]),
  ]);

  if (!snapshot) return res.status(404).json({ error: "No health data yet" });

  // Build a top-30 PageRank list, deduped to one row per file (max score
  // wins). Forensics page renders this as a sorted leaderboard so users
  // can see exactly which files dominate the dependency graph.
  const byFile = new Map<string, number>();
  for (const d of (ctx?.definitions ?? []) as any[]) {
    const cur = byFile.get(d.path) ?? 0;
    if ((d.pageRankScore ?? 0) > cur) byFile.set(d.path, d.pageRankScore ?? 0);
  }
  const topFiles = [...byFile.entries()]
    .map(([path, pageRankScore]) => ({ path, pageRankScore }))
    .sort((a, b) => b.pageRankScore - a.pageRankScore)
    .slice(0, 30);

  // Cost summary for this repo
  const totalCost = llmUsages.reduce((sum, r: any) => sum + (r.costUsd ?? 0), 0);
  const totalTokensIn = llmUsages.reduce(
    (sum, r: any) => sum + (r.inputTokens ?? 0),
    0,
  );
  const totalTokensOut = llmUsages.reduce(
    (sum, r: any) => sum + (r.outputTokens ?? 0),
    0,
  );

  const stats = pushStats[0] || { count: 0, oldest: null, newest: null };

  return res.json({
    repoId,
    repoFullName: repo.fullName,
    isPublic: repo.isPublic,
    indexStatus: ctx?.indexStatus ?? "idle",
    lastIndexedAt: ctx?.lastIndexedAt ?? null,
    score: snapshot.score,
    signals: snapshot.signals,
    coupling: {
      gini: snapshot.signals.coupling.gini,
      topFiles, // [{ path, pageRankScore }]
      totalFiles: byFile.size,
    },
    hotFiles: snapshot.hotFilesDetailed && snapshot.hotFilesDetailed.length > 0
      ? snapshot.hotFilesDetailed
      : snapshot.hotFiles.map((path) => ({
          path,
          pageRankScore: 0,
          pageRankPercentile: 0,
          churnPushes: 0,
          totalRecentPushes: 0,
        })),
    smells: snapshot.smells ?? { hitCount: 0, normalized: 0 },
    smellsDetailed: snapshot.smellsDetailed ?? [],
    branches: snapshot.branches ?? {
      total: 0,
      active: 0,
      idle: 0,
      stale: 0,
      abandoned: 0,
      fetchedAt: null,
    },
    branchesDetailed: snapshot.branchesDetailed ?? [],
    contributors: snapshot.contributors ?? {
      total: 0,
      activeCount: 0,
      botCount: 0,
      busFactor: 0,
      recentWindow: 0,
      totalCommits: 0,
      fetchedAt: null,
    },
    contributorsDetailed: snapshot.contributorsDetailed ?? [],
    conventions: ctx?.conventionsDetailed?.length
      ? ctx.conventionsDetailed
      : (ctx?.conventions ?? []).map((text) => ({
          text,
          sourceFiles: [],
          llmUsageId: null,
          category: null,
        })),
    history: ctx?.recentHistoryDetailed?.length
      ? ctx.recentHistoryDetailed
      : (ctx?.recentHistory ?? []).map((text) => ({
          text,
          sourcePRs: [],
          llmUsageId: null,
        })),
    pushStats: {
      count: stats.count,
      oldest: stats.oldest,
      newest: stats.newest,
    },
    llmUsages: llmUsages.map((u: any) => ({
      _id: u._id,
      runId: u.runId,
      taskType: u.taskType,
      provider: u.provider,
      model: u.model,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      costUsd: u.costUsd,
      pricingMatch: u.pricingMatch ?? "exact",
      durationMs: u.durationMs,
      promptPreview: u.promptPreview,
      inputs: u.inputs,
      rawResponse: u.rawResponse,
      createdAt: u.createdAt,
    })),
    costSummary: {
      totalUsd: totalCost,
      totalInputTokens: totalTokensIn,
      totalOutputTokens: totalTokensOut,
      callCount: llmUsages.length,
    },
  });
}

/**
 * GET /health/:repoId/costs?days=30
 * Or: GET /health/costs?days=30 (user-wide, across all their repos)
 *
 * Returns per-day cost totals + per-task-type rollup. Drives the
 * "This month: $X · N calls" card on the Health page.
 */
export async function getCosts(req: Request, res: Response) {
  const days = Math.min(parseInt(req.query.days as string) || 30, 90);
  const since = new Date(Date.now() - days * 86400000);
  const repoIdParam = req.params.repoId;

  const match: any = {
    userId: new mongoose.Types.ObjectId(req.user!.userId),
    createdAt: { $gte: since },
  };

  if (repoIdParam) {
    if (!mongoose.Types.ObjectId.isValid(repoIdParam))
      return res.status(400).json({ error: "Invalid repoId" });
    const repo = await Repo.findOne({
      _id: repoIdParam,
      connectedBy: req.user!.userId,
      isActive: true,
    });
    if (!repo) return res.status(404).json({ error: "Repo not found" });
    match.repoId = repo._id;
  }

  const [totals, byTask, byDay] = await Promise.all([
    LLMUsage.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalUsd: { $sum: "$costUsd" },
          totalInputTokens: { $sum: "$inputTokens" },
          totalOutputTokens: { $sum: "$outputTokens" },
          callCount: { $sum: 1 },
        },
      },
    ]),
    LLMUsage.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$taskType",
          totalUsd: { $sum: "$costUsd" },
          callCount: { $sum: 1 },
        },
      },
    ]),
    LLMUsage.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          totalUsd: { $sum: "$costUsd" },
          callCount: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);

  return res.json({
    days,
    totals: totals[0] || {
      totalUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      callCount: 0,
    },
    byTaskType: byTask.map((t: any) => ({
      taskType: t._id,
      totalUsd: t.totalUsd,
      callCount: t.callCount,
    })),
    byDay: byDay.map((d: any) => ({
      date: d._id,
      totalUsd: d.totalUsd,
      callCount: d.callCount,
    })),
  });
}

export async function getCommitData(req: Request, res: Response) {
  const repoId = String(req.params.repoId);
  const commitSha = String(req.params.commitSha);

  if (!mongoose.Types.ObjectId.isValid(repoId))
    return res.status(400).json({ error: "Invalid repoId" });

  if (!commitSha || !/^[a-f0-9]{7,40}$/i.test(commitSha))
    return res.status(400).json({ error: "Invalid commitSha" });

  const repo = await Repo.findOne({
    _id: repoId,
    connectedBy: req.user!.userId,
    isActive: true,
  });
  if (!repo) return res.status(404).json({ error: "Repo not found" });

  const push = await FilePushHistory.findOne({ repoId, commitSha });
  if (!push) return res.status(404).json({ error: "Commit not found" });

  return res.json({
    commit: {
      commitSha: push.commitSha,
      files: push.files,
      pushedAt: push.pushedAt,
      fileDiffs: push.fileDiffs || [],
    },
  });
}

/**
 * GET /health/:repoId/insights
 *
 * Synthesises everything the 4 indexing agents produced (definitions, edges,
 * conventions, history, snapshots, smells, pushes) and returns cards from
 * 6 analyzer lenses. No extra LLM calls, no extra GitHub roundtrips.
 */
export async function getInsights(req: Request, res: Response) {
  const repoId = String(req.params.repoId);

  if (!mongoose.Types.ObjectId.isValid(repoId))
    return res.status(400).json({ error: "Invalid repoId" });

  const repo = await Repo.findOne({
    _id: repoId,
    connectedBy: req.user!.userId,
    isActive: true,
  });
  if (!repo) return res.status(404).json({ error: "Repo not found" });

  try {
    const data = await generateInsights(repo._id as mongoose.Types.ObjectId);
    return res.json(data);
  } catch (err: any) {
    return res
      .status(500)
      .json({ error: err.message || "Failed to generate insights" });
  }
}
