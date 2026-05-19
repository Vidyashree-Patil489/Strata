/**
 * BullMQ Worker: context-index for Repo Health.
 *
 * Orchestrates the 3 context agents sequentially:
 * 1. Repo Indexer (tree-sitter parsing + dependency graph + PageRank)
 * 2. Pattern Extractor (conventions)
 * 3. History Summarizer (recent changes)
 *
 * After indexing completes, runs computeAndSaveHealthScore() to produce a
 * fresh RepoHealthSnapshot.
 */
import { Worker, Job } from "bullmq";
import { Repo } from "../models/Repo";
import { RepoContext } from "../models/RepoContext";
import { User } from "../models/User";
import { getRepoFetchToken } from "../utils/repoAuth";
import { decrypt } from "../utils/encryption";
import { resolveProvider, type CallLLMOptions } from "../services/ai.service";
import { getIO } from "../config/socket";
import { runIndexer } from "../agents/context/indexer";
import { runPatternExtractor } from "../agents/context/patterns";
import { runHistorySummarizer } from "../agents/context/history";
import FilePushHistory from "../models/FilePushHistory";
import { computeAndSaveHealthScore } from "../services/healthScore.service";
import { extractGraphAtCommit } from "../agents/context/graph-snapshot";
import { RepoGraphSnapshot } from "../models/RepoGraphSnapshot";
import mongoose from "mongoose";

function emitSafe(event: string, data: any, userId?: string) {
  try {
    const io = getIO();
    if (userId) {
      io.to(`user:${userId}`).emit(event, data);
    } else {
      io.emit(event, data);
    }
  } catch {
    // Socket not initialized
  }
}

export interface ContextJobData {
  repoId: string;
  repoFullName: string;
  branch: string;
  headSha: string;
  pusher?: string;
  commits?: number;
  changedFiles?: string[];
  isBackfill?: boolean;
}

const INCREMENTAL_FILE_CAP = Number(
  process.env.CONTEXT_INCREMENTAL_FILE_CAP ?? 300,
);
const BACKFILL_FILE_CAP = Number(process.env.CONTEXT_BACKFILL_FILE_CAP ?? 5000);

const INCREMENTAL_JOB_TIMEOUT_MS = Number(
  process.env.CONTEXT_INCREMENTAL_TIMEOUT_MS ?? 5 * 60 * 1000,
);
const BACKFILL_JOB_TIMEOUT_MS = Number(
  process.env.CONTEXT_BACKFILL_TIMEOUT_MS ?? 30 * 60 * 1000,
);

function withWatchdog<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(`[ContextJob] ${label} exceeded ${ms}ms wall-clock limit`),
        ),
      ms,
    );
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function processContextJob(job: Job<ContextJobData>) {
  const { repoFullName, headSha, changedFiles, isBackfill } = job.data;
  const mode = isBackfill ? "backfill" : "incremental";
  const cap = isBackfill ? BACKFILL_FILE_CAP : INCREMENTAL_FILE_CAP;
  const timeoutMs = isBackfill ? BACKFILL_JOB_TIMEOUT_MS : INCREMENTAL_JOB_TIMEOUT_MS;

  console.log(
    `[ContextJob] Starting (${mode}) for ${repoFullName} @ ${headSha.slice(0, 7)}`,
  );

  const overFileCap =
    !isBackfill && (changedFiles?.length ?? 0) > INCREMENTAL_FILE_CAP;
  if (overFileCap) {
    console.warn(
      `[ContextJob] Incremental file-count cap exceeded (${changedFiles?.length} > ${INCREMENTAL_FILE_CAP}) — downgrading to metadata-only`,
    );
  }
  void cap;
  return withWatchdog(
    processContextJobInner(job, { overFileCap }),
    timeoutMs,
    `${mode} job for ${repoFullName}`,
  );
}

async function processContextJobInner(
  job: Job<ContextJobData>,
  opts: { overFileCap: boolean },
) {
  const { repoId, repoFullName, headSha, changedFiles } = job.data;

  const repo = await Repo.findById(repoId);
  if (!repo || !repo.isActive) {
    console.log(`[ContextJob] Repo ${repoId} inactive, skipping`);
    return;
  }

  const user = await User.findById(repo.connectedBy);
  if (!user) {
    console.log(`[ContextJob] User not found for repo ${repoFullName}`);
    return;
  }

  // For private repos we need the GitHub App installation; for public repos
  // we use the user's OAuth token instead. getRepoFetchToken picks correctly
  // and throws if neither is available — handle that as a recoverable skip
  // so a misconfigured single repo doesn't fail the worker.
  let installationToken: string;
  try {
    installationToken = await getRepoFetchToken(repo, user);
  } catch (err: any) {
    console.log(`[ContextJob] Cannot fetch token for ${repoFullName}: ${err.message}`);
    await setIndexStatus(repoId, "failed");
    return;
  }

  // Fetch commit details (diffs) for the push history record
  let finalChangedFiles = changedFiles || [];
  let fileDiffs: Array<{
    filename: string;
    additions: number;
    deletions: number;
    patch?: string;
  }> = [];

  if (headSha) {
    try {
      const commitRes = await fetch(
        `https://api.github.com/repos/${repoFullName}/commits/${headSha}`,
        {
          headers: {
            Authorization: `Bearer ${installationToken}`,
            Accept: "application/vnd.github.v3+json",
          },
        },
      );
      if (commitRes.ok) {
        const commitData = (await commitRes.json()) as {
          files?: Array<{
            filename: string;
            additions: number;
            deletions: number;
            patch?: string;
          }>;
        };
        const files = commitData.files || [];
        if (!changedFiles || changedFiles.length === 0) {
          finalChangedFiles = files.map((f: any) => f.filename);
        }
        fileDiffs = files.map((f: any) => ({
          filename: f.filename,
          additions: f.additions || 0,
          deletions: f.deletions || 0,
          patch: f.patch,
        }));
      }
    } catch (err) {
      console.warn(`[ContextJob] Failed to fetch commit details:`, err);
    }
  }

  // ── Resolve LLM provider (optional) ──────────────────────────────────
  //
  // In Strata, the LLM is only used by the pattern + history agents
  // (extracting coding conventions and summarizing recent PRs). The
  // indexer is pure tree-sitter; the health score is computed from
  // structural data alone. So a repo with NO provider configured is a
  // fully-supported workflow: indexer runs, score gets computed, the
  // two LLM agents are skipped.
  //
  // Belt-and-braces handling:
  //   1. Fast-path skip if user has zero providers OR no default.
  //      (Avoids even trying decrypt() — JWT_SECRET drift would throw.)
  //   2. Per-key decrypt with try/catch so one corrupted key doesn't
  //      poison the whole list.
  //   3. Outer try/catch around resolveProvider in case the default
  //      provider points at a provider the user later removed.
  //
  // Every path here leads to `llmOptions = null` on failure; the agent
  // gating below (`if (llmOptions && ...)`) handles the rest.
  let llmOptions: CallLLMOptions | null = null;

  const hasAnyProvider =
    Array.isArray(user.aiConfig?.providers) &&
    user.aiConfig.providers.length > 0;
  const hasDefault =
    !!user.aiConfig?.defaultProvider && !!user.aiConfig?.defaultModel;
  const hasRepoOverride =
    !!repo.settings?.aiProvider && !!repo.settings?.aiModel;

  if (!hasAnyProvider || (!hasDefault && !hasRepoOverride)) {
    console.log(
      `[ContextJob] No AI provider configured for ${repoFullName} — indexer + health score will run, pattern/history agents skipped.`,
    );
  } else {
    try {
      const decryptedProviders = user.aiConfig.providers
        .map((p) => {
          try {
            return { provider: p.provider, apiKey: decrypt(p.apiKey) };
          } catch (decryptErr: any) {
            console.warn(
              `[ContextJob] Skipping corrupted key for provider=${p.provider}: ${decryptErr.message}`,
            );
            return null;
          }
        })
        .filter((p): p is { provider: string; apiKey: string } => p !== null);

      const resolved = resolveProvider({
        repoAiProvider: repo.settings.aiProvider,
        repoAiModel: repo.settings.aiModel,
        userDefaultProvider: user.aiConfig.defaultProvider,
        userDefaultModel: user.aiConfig.defaultModel,
        userProviders: decryptedProviders,
      });
      llmOptions = {
        provider: resolved.provider,
        model: resolved.model,
        apiKey: resolved.apiKey,
      };
    } catch (err: any) {
      console.warn(
        `[ContextJob] AI provider resolution failed — pattern/history agents will be skipped: ${err.message}`,
      );
    }
  }

  // One runId per index job — groups LLM cost rows so the Forensics page
  // can show "this index run cost $X total, broken down by agent".
  const runId =
    (job.id ? String(job.id) : "") +
    "-" + Math.random().toString(36).slice(2, 10);

  await setIndexStatus(repoId, "indexing");
  const socketUserId = user._id.toString();

  emitSafe("context:started", { repoId, repoFullName, step: "indexer" }, socketUserId);

  try {
    await job.updateProgress(10);

    // Agent 1: Indexer
    const indexResult = await runIndexer({
      repoFullName,
      headSha,
      installationToken,
      repoId: repo._id,
      changedFiles,
    });
    console.log(
      `[ContextJob] Indexer done: ${indexResult.indexedFiles}/${indexResult.totalFiles} files (${indexResult.durationMs}ms)`,
    );
    await job.updateProgress(50);
    emitSafe(
      "context:progress",
      { repoId, repoFullName, step: "patterns", progress: 50 },
      socketUserId,
    );

    // Agent 2: Pattern Extractor
    if (llmOptions && !opts.overFileCap) {
      const patternResult = await runPatternExtractor({
        repoFullName,
        headSha,
        installationToken,
        repoId: repo._id,
        userId: user._id as any,
        runId,
        llmOptions,
      });
      console.log(
        `[ContextJob] Patterns: ${patternResult.conventions.length} conventions, $${patternResult.costUsd.toFixed(4)} (${patternResult.durationMs}ms)`,
      );
    } else {
      console.log(`[ContextJob] Skipping pattern extractor`);
    }
    await job.updateProgress(80);
    emitSafe(
      "context:progress",
      { repoId, repoFullName, step: "history", progress: 80 },
      socketUserId,
    );

    // Agent 3: History Summarizer
    if (llmOptions && !opts.overFileCap) {
      const historyResult = await runHistorySummarizer({
        repoFullName,
        installationToken,
        repoId: repo._id,
        userId: user._id as any,
        runId,
        llmOptions,
      });
      console.log(
        `[ContextJob] History: ${historyResult.summaries.length} summaries, $${historyResult.costUsd.toFixed(4)} (${historyResult.durationMs}ms)`,
      );
    } else {
      console.log(`[ContextJob] Skipping history summarizer`);
    }
    await job.updateProgress(100);

    // Mark ready, save push history, compute health score
    const ctx = await RepoContext.findOne({ repoId: repo._id });
    if (ctx) {
      ctx.indexStatus = "ready";
      ctx.lastIndexedAt = new Date();
      await ctx.save();

      await FilePushHistory.create({
        repoId: new mongoose.Types.ObjectId(repoId),
        pushedAt: new Date(),
        files: finalChangedFiles || [],
        commitSha: headSha ?? "",
        fileDiffs: fileDiffs.length > 0 ? fileDiffs : undefined,
      });

      try {
        await computeAndSaveHealthScore(new mongoose.Types.ObjectId(repoId));
        console.log(`[ContextJob] Health score computed`);
      } catch (healthErr: any) {
        console.error(`[ContextJob] Health score failed (non-fatal):`, healthErr.message);
      }

      // Save the "current" graph snapshot so the Knowledge Graph page
      // has data to render the moment indexing finishes. Non-fatal —
      // any failure here just leaves the user with health data but no
      // snapshot; they can trigger Build History to recover.
      try {
        await saveCurrentGraphSnapshot({
          repoId: repo._id,
          repoFullName,
          commitSha: headSha,
          token: installationToken,
        });
      } catch (graphErr: any) {
        console.error(
          `[ContextJob] Current graph snapshot failed (non-fatal):`,
          graphErr.message,
        );
      }
    }

    emitSafe(
      "context:completed",
      {
        repoId,
        repoFullName,
        fileCount: ctx?.fileTree?.length || 0,
        conventionCount: ctx?.conventions?.length || 0,
        historyCount: ctx?.recentHistory?.length || 0,
      },
      socketUserId,
    );

    console.log(`[ContextJob] Completed for ${repoFullName}`);
  } catch (err: any) {
    console.error(`[ContextJob] Failed for ${repoFullName}:`, err.message);
    try {
      await setIndexStatus(repoId, "failed");
      emitSafe("context:failed", { repoId, repoFullName, error: err.message }, socketUserId);
    } catch (failErr: any) {
      console.error(`[ContextJob] Error during failure handling:`, failErr.message);
    }
    throw err;
  }
}

async function setIndexStatus(
  repoId: string,
  status: "idle" | "indexing" | "ready" | "failed",
) {
  await RepoContext.findOneAndUpdate(
    { repoId },
    { indexStatus: status },
    { upsert: true },
  );
}

/**
 * Build and persist (upsert) the dependency-graph snapshot for the
 * given commit. Called after a successful index so the Knowledge
 * Graph page has data to render immediately. Also reused by the
 * historical-graph job for older commits.
 */
async function saveCurrentGraphSnapshot(opts: {
  repoId: mongoose.Types.ObjectId;
  repoFullName: string;
  commitSha: string;
  token: string;
}): Promise<void> {
  const { repoId, repoFullName, commitSha, token } = opts;

  // Fetch commit metadata so we have author/date/message for the snapshot
  // header. Cheap (one request) and the snapshot is useless without it.
  const commitRes = await fetch(
    `https://api.github.com/repos/${repoFullName}/commits/${commitSha}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    },
  );
  if (!commitRes.ok) {
    throw new Error(`Failed to fetch commit metadata: HTTP ${commitRes.status}`);
  }
  const commit = (await commitRes.json()) as {
    commit: { author: { name: string; date: string }; message: string };
  };

  const result = await extractGraphAtCommit({
    repoFullName,
    commitSha,
    token,
  });

  console.log(
    `[GraphSnapshot] ${repoFullName} @ ${commitSha.slice(0, 7)}: ` +
      `${result.nodes.length} nodes, ${result.edges.length} edges ` +
      `(${result.filesIndexed}/${result.filesTotal} files, ${result.fetchesMade} fetches, ${result.durationMs}ms)`,
  );

  // Compare against the immediately-prior snapshot (if any) to compute
  // file-level diff counts. Cheap denormalization for the snapshot list UI.
  const prior = await RepoGraphSnapshot.findOne({ repoId })
    .sort({ commitDate: -1 })
    .select("nodes");

  let filesAdded = 0;
  let filesRemoved = 0;
  if (prior) {
    const priorIds = new Set(prior.nodes.map((n) => n.id));
    const currentIds = new Set(result.nodes.map((n) => n.id));
    for (const id of currentIds) if (!priorIds.has(id)) filesAdded++;
    for (const id of priorIds) if (!currentIds.has(id)) filesRemoved++;
  } else {
    filesAdded = result.nodes.length;
  }

  await RepoGraphSnapshot.findOneAndUpdate(
    { repoId, commitSha },
    {
      $set: {
        commitShortSha: commitSha.slice(0, 7),
        commitDate: new Date(commit.commit.author.date),
        commitAuthor: commit.commit.author.name,
        commitMessage: commit.commit.message.split("\n")[0].slice(0, 200),
        filesAdded,
        filesRemoved,
        filesChanged: 0, // computed later by historical job if needed
        nodeCount: result.nodes.length,
        edgeCount: result.edges.length,
        nodes: result.nodes,
        edges: result.edges,
        source: "current",
        createdAt: new Date(),
      },
    },
    { upsert: true },
  );
}

// ── Worker init ──

import { getRedisConnection } from "./queue";

interface ContextWorkerOptions {
  queueName: string;
  label: string;
  concurrency: number;
  limiter: { max: number; duration: number };
  lockDuration: number;
}

function startContextWorkerImpl(opts: ContextWorkerOptions): Worker | null {
  const connection = getRedisConnection();
  if (!connection) {
    console.warn(`[ContextJob:${opts.label}] No REDIS_URL — worker not started`);
    return null;
  }

  console.log(
    `[ContextJob:${opts.label}] Initializing on queue "${opts.queueName}" (concurrency=${opts.concurrency})`,
  );

  const worker = new Worker<ContextJobData>(opts.queueName, processContextJob, {
    connection,
    concurrency: opts.concurrency,
    limiter: opts.limiter,
    stalledInterval: 60000,
    maxStalledCount: 2,
    lockDuration: opts.lockDuration,
  });

  worker.on("completed", (job) => {
    console.log(`[ContextJob:${opts.label}] Job ${job.id} completed`);
  });
  worker.on("failed", async (job, err) => {
    console.error(`[ContextJob:${opts.label}] Job ${job?.id} failed:`, err.message);
    if (job?.data?.repoId) {
      try {
        await setIndexStatus(job.data.repoId, "failed");
      } catch (resetErr: any) {
        console.error(`[ContextJob:${opts.label}] Failed to reset indexStatus:`, resetErr.message);
      }
    }
  });
  worker.on("error", (err) => {
    console.error(`[ContextJob:${opts.label}] Worker error:`, err.message);
  });
  worker.on("ready", () => {
    console.log(`[ContextJob:${opts.label}] Worker ready`);
  });

  return worker;
}

export function startContextIncrementalWorker(): Worker | null {
  return startContextWorkerImpl({
    queueName: "context-incremental",
    label: "incremental",
    concurrency: Number(process.env.CONTEXT_INCREMENTAL_CONCURRENCY ?? 4),
    limiter: { max: 30, duration: 60000 },
    lockDuration: INCREMENTAL_JOB_TIMEOUT_MS + 30 * 1000,
  });
}

export function startContextBackfillWorker(): Worker | null {
  return startContextWorkerImpl({
    queueName: "context-backfill",
    label: "backfill",
    concurrency: Number(process.env.CONTEXT_BACKFILL_CONCURRENCY ?? 1),
    limiter: { max: 5, duration: 60000 },
    lockDuration: BACKFILL_JOB_TIMEOUT_MS + 60 * 1000,
  });
}
