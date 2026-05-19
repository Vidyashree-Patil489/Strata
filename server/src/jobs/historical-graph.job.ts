/**
 * BullMQ job: build dependency-graph snapshots for the last N commits
 * on a repo's default branch.
 *
 * Smart-incremental strategy:
 *  1. List the last N commits via /repos/:owner/:repo/commits (one call,
 *     paginated if N > 100).
 *  2. For each commit, fetch the recursive tree (~1 call/commit).
 *  3. Per-file content fetching uses a SHARED BlobCache across all
 *     commits — git blobs are content-addressed, so unchanged files
 *     across commits hit the cache. Typical hit rate on a real repo
 *     where each commit changes ~5 files: 99%+.
 *
 * Net GitHub API cost for "last 30 commits on a 500-file repo":
 *   30 commit-list + 30 tree-fetches + ~500 unique blobs ≈ 560 calls
 * vs. the naive 30 × 500 = 15,000 calls.
 *
 * Emits progress events via socket so the UI shows a real progress bar.
 */
import { Worker, type Job } from "bullmq";
import mongoose from "mongoose";
import { Repo } from "../models/Repo";
import { User } from "../models/User";
import { RepoGraphSnapshot } from "../models/RepoGraphSnapshot";
import { getRepoFetchToken } from "../utils/repoAuth";
import {
  BlobCache,
  extractGraphAtCommit,
} from "../agents/context/graph-snapshot";
import { getIO } from "../config/socket";
import { getRedisConnection } from "./queue";

function emitSafe(event: string, data: any, userId?: string) {
  try {
    const io = getIO();
    if (userId) io.to(`user:${userId}`).emit(event, data);
    else io.emit(event, data);
  } catch {
    // socket not initialized — skip
  }
}

export interface HistoricalGraphJobData {
  repoId: string;
  repoFullName: string;
  /** How many commits back from HEAD to snapshot. Hard cap: 200. */
  commitCount: number;
}

interface CommitListEntry {
  sha: string;
  commit: {
    author: { name: string; date: string };
    message: string;
  };
}

const HARD_CAP = 200;

async function processHistoricalGraphJob(job: Job<HistoricalGraphJobData>) {
  const { repoId, repoFullName } = job.data;
  const commitCount = Math.min(job.data.commitCount, HARD_CAP);

  const repo = await Repo.findById(repoId);
  if (!repo || !repo.isActive) {
    console.log(`[HistGraph] Repo ${repoId} inactive, skipping`);
    return;
  }
  const user = await User.findById(repo.connectedBy);
  if (!user) {
    console.log(`[HistGraph] User not found for ${repoFullName}`);
    return;
  }

  let token: string;
  try {
    token = await getRepoFetchToken(repo, user);
  } catch (err: any) {
    console.log(`[HistGraph] Cannot fetch token: ${err.message}`);
    return;
  }

  const socketUserId = user._id.toString();
  emitSafe(
    "graph:build:started",
    { repoId, repoFullName, commitCount },
    socketUserId,
  );

  // 1. Resolve default branch, then fetch the last N commits.
  console.log(`[HistGraph] Fetching last ${commitCount} commits for ${repoFullName}`);
  const repoInfoRes = await fetch(`https://api.github.com/repos/${repoFullName}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!repoInfoRes.ok) {
    emitSafe(
      "graph:build:failed",
      { repoId, error: `Failed to fetch repo info: HTTP ${repoInfoRes.status}` },
      socketUserId,
    );
    throw new Error(`Repo info fetch failed: ${repoInfoRes.status}`);
  }
  const repoInfo = (await repoInfoRes.json()) as { default_branch: string };

  const commits: CommitListEntry[] = [];
  const PER_PAGE = 100;
  let page = 1;
  while (commits.length < commitCount) {
    const want = Math.min(PER_PAGE, commitCount - commits.length);
    const res = await fetch(
      `https://api.github.com/repos/${repoFullName}/commits?sha=${repoInfo.default_branch}&per_page=${want}&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      },
    );
    if (!res.ok) {
      emitSafe(
        "graph:build:failed",
        { repoId, error: `Failed to list commits: HTTP ${res.status}` },
        socketUserId,
      );
      throw new Error(`Commit list fetch failed: ${res.status}`);
    }
    const batch = (await res.json()) as CommitListEntry[];
    if (batch.length === 0) break;
    commits.push(...batch);
    if (batch.length < want) break;
    page++;
  }

  console.log(`[HistGraph] Got ${commits.length} commits; building snapshots`);

  // 2. Walk newest → oldest so the cache primes with current files first
  // (highest hit-rate ordering).
  const cache = new BlobCache();
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i];
    const sha = commit.sha;

    // Skip if a snapshot already exists for this commit (idempotent reruns)
    const existing = await RepoGraphSnapshot.findOne({
      repoId,
      commitSha: sha,
    }).select("_id");
    if (existing) {
      skipped++;
      emitSafe(
        "graph:build:progress",
        {
          repoId,
          completed: i + 1,
          total: commits.length,
          currentSha: sha.slice(0, 7),
          succeeded,
          failed,
          skipped,
          cacheHits: cache.hits,
          fetches: cache.misses,
        },
        socketUserId,
      );
      continue;
    }

    try {
      const result = await extractGraphAtCommit({
        repoFullName,
        commitSha: sha,
        token,
        cache,
      });

      // Compute file-add/remove diff vs prior snapshot (the one chronologically
      // PRIOR to this commit — which is the next one in our reverse walk if any
      // future commit shares our repoId). We compare against whichever neighbor
      // we already have in the DB.
      const neighbor = await RepoGraphSnapshot.findOne({ repoId })
        .where({ commitDate: { $lt: new Date(commit.commit.author.date) } })
        .sort({ commitDate: -1 })
        .select("nodes");

      let filesAdded = 0;
      let filesRemoved = 0;
      if (neighbor) {
        const neighborIds = new Set(neighbor.nodes.map((n: any) => n.id));
        const currentIds = new Set(result.nodes.map((n) => n.id));
        for (const id of currentIds) if (!neighborIds.has(id)) filesAdded++;
        for (const id of neighborIds) if (!currentIds.has(id)) filesRemoved++;
      } else {
        filesAdded = result.nodes.length;
      }

      await RepoGraphSnapshot.findOneAndUpdate(
        { repoId, commitSha: sha },
        {
          $set: {
            commitShortSha: sha.slice(0, 7),
            commitDate: new Date(commit.commit.author.date),
            commitAuthor: commit.commit.author.name,
            commitMessage: commit.commit.message.split("\n")[0].slice(0, 200),
            filesAdded,
            filesRemoved,
            filesChanged: 0,
            nodeCount: result.nodes.length,
            edgeCount: result.edges.length,
            nodes: result.nodes,
            edges: result.edges,
            source: "historical",
            createdAt: new Date(),
          },
        },
        { upsert: true },
      );

      succeeded++;
      console.log(
        `[HistGraph] [${i + 1}/${commits.length}] ${sha.slice(0, 7)}: ` +
          `${result.nodes.length}n/${result.edges.length}e ` +
          `(${result.fetchesMade}f/${result.cacheHits}h, ${result.durationMs}ms)`,
      );
    } catch (err: any) {
      failed++;
      console.error(
        `[HistGraph] [${i + 1}/${commits.length}] ${sha.slice(0, 7)} FAILED: ${err.message}`,
      );
    }

    emitSafe(
      "graph:build:progress",
      {
        repoId,
        completed: i + 1,
        total: commits.length,
        currentSha: sha.slice(0, 7),
        succeeded,
        failed,
        skipped,
        cacheHits: cache.hits,
        fetches: cache.misses,
      },
      socketUserId,
    );

    await job.updateProgress(Math.round(((i + 1) / commits.length) * 100));
  }

  console.log(
    `[HistGraph] Done: ${succeeded} succeeded, ${failed} failed, ${skipped} skipped (${cache.size()} blobs cached)`,
  );

  emitSafe(
    "graph:build:completed",
    { repoId, succeeded, failed, skipped, total: commits.length },
    socketUserId,
  );

  cache.clear();
}

let workerInstance: Worker<HistoricalGraphJobData> | null = null;

export function startHistoricalGraphWorker(): Worker<HistoricalGraphJobData> | null {
  const connection = getRedisConnection();
  if (!connection) {
    console.warn("[HistGraph] No REDIS_URL — worker not started");
    return null;
  }

  console.log(`[HistGraph] Initializing on queue "historical-graph"`);

  workerInstance = new Worker<HistoricalGraphJobData>(
    "historical-graph",
    processHistoricalGraphJob,
    {
      connection,
      concurrency: 1, // CPU + GitHub-API heavy; one at a time
      limiter: { max: 2, duration: 60_000 },
      stalledInterval: 60_000,
      maxStalledCount: 2,
      lockDuration: 90 * 60_000, // 90 minutes — historical builds can be long
    },
  );

  workerInstance.on("completed", (job) =>
    console.log(`[HistGraph] Job ${job.id} completed`),
  );
  workerInstance.on("failed", (job, err) => {
    console.error(`[HistGraph] Job ${job?.id} failed:`, err.message);
  });
  workerInstance.on("error", (err) =>
    console.error("[HistGraph] Worker error:", err.message),
  );
  workerInstance.on("ready", () => console.log("[HistGraph] Worker ready"));

  return workerInstance;
}
