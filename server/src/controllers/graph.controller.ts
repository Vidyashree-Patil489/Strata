/**
 * Knowledge Graph endpoints.
 *
 *   GET    /repos/:id/graph/snapshots          — list available snapshots
 *   GET    /repos/:id/graph/:commitSha         — full nodes+edges for one snapshot
 *   GET    /repos/:id/graph/diff?from=&to=     — diff between two snapshots
 *   POST   /repos/:id/graph/build              — queue historical-graph job
 *   GET    /repos/:id/graph/build/status       — current build progress
 */
import { Request, Response } from "express";
import mongoose from "mongoose";
import { Repo } from "../models/Repo";
import { User } from "../models/User";
import { RepoGraphSnapshot } from "../models/RepoGraphSnapshot";
import { historicalGraphQueue } from "../jobs/queue";
import { getRepoFetchToken } from "../utils/repoAuth";
import { extractSymbolsFromPatch } from "../utils/patch-symbols";

const SHA_REGEX = /^[a-f0-9]{7,40}$/i;

async function ownsRepo(req: Request) {
  const repoId = req.params.id;
  if (!mongoose.Types.ObjectId.isValid(repoId)) return null;
  return Repo.findOne({
    _id: repoId,
    connectedBy: req.user!.userId,
    isActive: true,
  });
}

/**
 * GET /repos/:id/graph/snapshots
 *
 * Lightweight list of snapshots for this repo, newest first. Used by
 * the commit picker / scrubber UI. Excludes the heavy `nodes`/`edges`
 * arrays — only the metadata that drives the list.
 */
export async function listGraphSnapshots(req: Request, res: Response) {
  const repo = await ownsRepo(req);
  if (!repo) return res.status(404).json({ error: "Repo not found" });

  const snapshots = await RepoGraphSnapshot.find({ repoId: repo._id })
    .sort({ commitDate: -1 })
    .select(
      "commitSha commitShortSha commitDate commitAuthor commitMessage " +
        "filesAdded filesRemoved nodeCount edgeCount source createdAt",
    )
    .lean();

  return res.json({
    repoId: repo._id.toString(),
    repoFullName: repo.fullName,
    isPublic: repo.isPublic,
    count: snapshots.length,
    snapshots,
  });
}

/**
 * GET /repos/:id/graph/:commitSha
 *
 * Returns the full nodes+edges for a single snapshot, cytoscape-ready.
 * No transformation — the model stores it in the cytoscape shape.
 */
export async function getGraphSnapshot(req: Request, res: Response) {
  const repo = await ownsRepo(req);
  if (!repo) return res.status(404).json({ error: "Repo not found" });

  const sha = req.params.commitSha;
  if (!SHA_REGEX.test(sha))
    return res.status(400).json({ error: "Invalid commitSha" });

  // Accept short or full SHA — match by prefix
  const snap = await RepoGraphSnapshot.findOne({
    repoId: repo._id,
    commitSha: { $regex: `^${sha}` },
  }).lean();

  if (!snap)
    return res.status(404).json({ error: "Snapshot not found for that commit" });

  return res.json(snap);
}

/**
 * GET /repos/:id/graph/diff?from=<sha>&to=<sha>
 *
 * Computes a node + edge diff between two snapshots. Returns:
 *   - added/removed/unchanged node sets
 *   - added/removed edge sets
 *   - per-directory stats (added/removed file counts per dir)
 *   - metric deltas (node count, edge count, average PageRank shift)
 *
 * The frontend renders this two ways: as a metrics panel and as a
 * coloured overlay on the "to" graph (added = green, removed shown
 * with phantom styling, unchanged = subdued).
 */
export async function getGraphDiff(req: Request, res: Response) {
  const repo = await ownsRepo(req);
  if (!repo) return res.status(404).json({ error: "Repo not found" });

  const from = String(req.query.from || "");
  const to = String(req.query.to || "");
  if (!SHA_REGEX.test(from) || !SHA_REGEX.test(to))
    return res.status(400).json({ error: "Both 'from' and 'to' are required SHAs" });

  const [fromSnap, toSnap] = await Promise.all([
    RepoGraphSnapshot.findOne({
      repoId: repo._id,
      commitSha: { $regex: `^${from}` },
    }).lean(),
    RepoGraphSnapshot.findOne({
      repoId: repo._id,
      commitSha: { $regex: `^${to}` },
    }).lean(),
  ]);
  if (!fromSnap || !toSnap)
    return res.status(404).json({
      error: "One or both snapshots not found. Build them first.",
    });

  const fromNodes = new Set(fromSnap.nodes.map((n: any) => n.id));
  const toNodes = new Set(toSnap.nodes.map((n: any) => n.id));

  const addedNodes = [...toNodes].filter((id) => !fromNodes.has(id));
  const removedNodes = [...fromNodes].filter((id) => !toNodes.has(id));
  const unchangedNodes = [...toNodes].filter((id) => fromNodes.has(id));

  const edgeKey = (e: any) => `${e.source}${e.target}`;
  const fromEdges = new Set(fromSnap.edges.map(edgeKey));
  const toEdges = new Set(toSnap.edges.map(edgeKey));

  const addedEdges = toSnap.edges
    .filter((e: any) => !fromEdges.has(edgeKey(e)))
    .map((e: any) => ({ source: e.source, target: e.target }));
  const removedEdges = fromSnap.edges
    .filter((e: any) => !toEdges.has(edgeKey(e)))
    .map((e: any) => ({ source: e.source, target: e.target }));

  // Per-directory churn: how many files were added/removed in each top-level dir
  const dirStats = new Map<string, { added: number; removed: number }>();
  const bump = (dir: string, key: "added" | "removed") => {
    if (!dirStats.has(dir)) dirStats.set(dir, { added: 0, removed: 0 });
    dirStats.get(dir)![key]++;
  };
  for (const n of toSnap.nodes as any[]) {
    if (addedNodes.includes(n.id)) bump(n.dir || ".", "added");
  }
  for (const n of fromSnap.nodes as any[]) {
    if (removedNodes.includes(n.id)) bump(n.dir || ".", "removed");
  }

  // ── Rich diff data from GitHub compare API ────────────────────────────
  // GitHub's /compare/from...to returns BOTH the commit log AND a full
  // per-file diff (with patches inline) in a single response. We pull
  // tokens via getRepoFetchToken so it works for public + private repos.
  // Best-effort: any failure here leaves the response without rich data
  // but still includes the structural diff above. The frontend tolerates
  // missing fields.
  let commits: Array<{
    sha: string;
    shortSha: string;
    message: string;
    author: string;
    date: string;
    url: string;
  }> = [];
  let filePatches: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
    patch?: string;
    addedSymbols: string[];
    removedSymbols: string[];
    url: string;
  }> = [];
  let symbolChanges = { added: 0, removed: 0 };
  let compareError: string | null = null;

  try {
    const user = await User.findById(req.user!.userId);
    if (!user) throw new Error("User not found");
    const token = await getRepoFetchToken(repo, user);

    // GitHub compare can return up to 300 files in a single response.
    // For most diffs that's plenty; for huge multi-month diffs we'd need
    // pagination via the per_page commit list — defer that for later.
    const compareRes = await fetch(
      `https://api.github.com/repos/${repo.fullName}/compare/${fromSnap.commitSha}...${toSnap.commitSha}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    if (!compareRes.ok) {
      throw new Error(`GitHub compare returned ${compareRes.status}`);
    }
    const compareData = (await compareRes.json()) as {
      commits?: Array<{
        sha: string;
        commit: {
          message: string;
          author: { name: string; date: string };
        };
        html_url: string;
      }>;
      files?: Array<{
        filename: string;
        status: string;
        additions: number;
        deletions: number;
        changes: number;
        patch?: string;
        blob_url: string;
      }>;
    };

    commits = (compareData.commits ?? []).map((c) => ({
      sha: c.sha,
      shortSha: c.sha.slice(0, 7),
      message: c.commit.message.split("\n")[0].slice(0, 200),
      author: c.commit.author.name,
      date: c.commit.author.date,
      url: c.html_url,
    }));

    filePatches = (compareData.files ?? []).map((f) => {
      const sym = extractSymbolsFromPatch(f.filename, f.patch || "");
      symbolChanges.added += sym.added.length;
      symbolChanges.removed += sym.removed.length;
      return {
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        changes: f.changes,
        patch: f.patch,
        addedSymbols: sym.added,
        removedSymbols: sym.removed,
        url: f.blob_url,
      };
    });
  } catch (err: any) {
    console.warn(`[GraphDiff] Rich diff unavailable: ${err.message}`);
    compareError = err.message;
  }

  return res.json({
    from: pickSummary(fromSnap),
    to: pickSummary(toSnap),
    nodes: {
      added: addedNodes,
      removed: removedNodes,
      unchanged: unchangedNodes,
    },
    edges: {
      added: addedEdges,
      removed: removedEdges,
    },
    dirStats: [...dirStats.entries()].map(([dir, s]) => ({
      dir,
      added: s.added,
      removed: s.removed,
    })),
    metrics: {
      nodeDelta: toSnap.nodeCount - fromSnap.nodeCount,
      edgeDelta: toSnap.edgeCount - fromSnap.edgeCount,
      commitsInRange: commits.length,
      filesChanged: filePatches.length,
      totalAdditions: filePatches.reduce((s, f) => s + f.additions, 0),
      totalDeletions: filePatches.reduce((s, f) => s + f.deletions, 0),
      symbolsAdded: symbolChanges.added,
      symbolsRemoved: symbolChanges.removed,
    },
    commits,
    filePatches,
    compareError,
  });
}

function pickSummary(s: any) {
  return {
    commitSha: s.commitSha,
    commitShortSha: s.commitShortSha,
    commitDate: s.commitDate,
    commitAuthor: s.commitAuthor,
    commitMessage: s.commitMessage,
    nodeCount: s.nodeCount,
    edgeCount: s.edgeCount,
  };
}

/**
 * POST /repos/:id/graph/build  { commitCount?: number }
 *
 * Queues a historical-graph job. Per-user rate-limited at the route
 * level. Returns immediately with the job id.
 */
export async function buildHistoricalGraph(req: Request, res: Response) {
  const repo = await ownsRepo(req);
  if (!repo) return res.status(404).json({ error: "Repo not found" });

  if (!historicalGraphQueue) {
    return res.status(503).json({
      error: "Graph build queue not available (Redis not connected)",
    });
  }

  const commitCount = Math.min(
    Math.max(1, parseInt(String(req.body?.commitCount || 30)) || 30),
    200,
  );

  // Use a stable job id so spamming the button doesn't queue duplicates.
  // BullMQ dedupes by jobId across the queue.
  const jobId = `histgraph-${repo._id.toString()}`;

  const existing = await historicalGraphQueue.getJob(jobId);
  if (existing && !(await existing.isCompleted()) && !(await existing.isFailed())) {
    const progress = await existing.progress;
    return res.json({
      message: "Build already in progress",
      jobId,
      progress,
    });
  }
  if (existing) {
    // Stale completed/failed — remove so we can re-queue under same id
    await existing.remove();
  }

  await historicalGraphQueue.add(
    "historical-graph",
    {
      repoId: repo._id.toString(),
      repoFullName: repo.fullName,
      commitCount,
    },
    { jobId, removeOnComplete: { age: 3600 }, removeOnFail: { age: 86400 } },
  );

  return res.json({
    message: `Building snapshots for the last ${commitCount} commits`,
    jobId,
    commitCount,
  });
}

/**
 * GET /repos/:id/graph/build/status
 *
 * Returns current progress of the historical-graph job for this repo.
 * Used by the UI to show a progress bar even after refreshing the page
 * (socket events are ephemeral; this is the source of truth).
 */
export async function getBuildStatus(req: Request, res: Response) {
  const repo = await ownsRepo(req);
  if (!repo) return res.status(404).json({ error: "Repo not found" });

  if (!historicalGraphQueue) {
    return res.json({ state: "unavailable" });
  }

  const jobId = `histgraph-${repo._id.toString()}`;
  const job = await historicalGraphQueue.getJob(jobId);
  if (!job) {
    return res.json({ state: "idle" });
  }

  const state = await job.getState();
  const progress = await job.progress;
  return res.json({
    state, // waiting | active | completed | failed | delayed
    progress,
    commitCount: job.data?.commitCount,
    failedReason: (job as any).failedReason,
  });
}

