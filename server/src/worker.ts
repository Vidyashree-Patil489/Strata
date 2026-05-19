/**
 * Standalone worker process for Repo Health.
 *
 * Run separately from the API to isolate CPU-heavy job processing
 * (tree-sitter parsing, LLM calls) from the HTTP/Socket layer.
 *
 *   WORKER_TYPE=index             (default) both incremental + backfill
 *   WORKER_TYPE=index-incremental ONLY the incremental worker
 *   WORKER_TYPE=index-backfill    ONLY the backfill worker
 */
import dotenv from "dotenv";
dotenv.config();

import http from "http";
import { connectDB } from "./config/db";
import { initSocket } from "./config/socket";
import {
  startContextIncrementalWorker,
  startContextBackfillWorker,
} from "./jobs/context.job";
import { startHistoricalGraphWorker } from "./jobs/historical-graph.job";
import { RepoContext } from "./models/RepoContext";
import type { Worker } from "bullmq";

import "./models/FilePushHistory";
import "./models/RepoHealthSnapshot";
import "./models/RepoGraphSnapshot";

type WorkerType = "index" | "index-backfill" | "index-incremental" | "all";

function resolveWorkerType(): WorkerType {
  const raw = (process.env.WORKER_TYPE ?? "all").toLowerCase();
  const allowed: WorkerType[] = ["index", "index-backfill", "index-incremental", "all"];
  if ((allowed as string[]).includes(raw)) return raw as WorkerType;
  console.warn(`[Worker] Unknown WORKER_TYPE="${raw}", using "all"`);
  return "all";
}

async function cleanupOrphanedStatuses() {
  try {
    const result = await RepoContext.updateMany(
      { indexStatus: "indexing" },
      { $set: { indexStatus: "failed" } },
    );
    if (result.modifiedCount > 0) {
      console.log(`[Worker] Cleanup: reset ${result.modifiedCount} stuck repos`);
    }
  } catch (err: any) {
    console.error("[Worker] Cleanup error:", err.message);
  }
}

async function start() {
  const type = resolveWorkerType();
  console.log(`[Worker] Starting (type=${type})`);

  await connectDB();

  // Socket.io for cross-instance event fan-out via Redis adapter.
  const minimalServer = http.createServer();
  initSocket(minimalServer);

  await cleanupOrphanedStatuses();

  const workers: Array<{ name: string; worker: Worker | null }> = [];

  if (type === "all" || type === "index" || type === "index-incremental") {
    workers.push({ name: "context-incremental", worker: startContextIncrementalWorker() });
  }
  if (type === "all" || type === "index" || type === "index-backfill") {
    workers.push({ name: "context-backfill", worker: startContextBackfillWorker() });
  }
  if (type === "all") {
    workers.push({ name: "historical-graph", worker: startHistoricalGraphWorker() });
  }

  for (const w of workers) {
    console.log(`[Worker] ${w.name}:`, w.worker ? "started" : "SKIPPED (no REDIS_URL)");
  }
  console.log("[Worker] Ready");

  let shuttingDown = false;
  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Worker] ${signal} — shutting down...`);

    const closes: Promise<void>[] = [];
    for (const w of workers) {
      if (w.worker) closes.push(w.worker.close());
    }

    const hardKill = setTimeout(() => {
      console.error("[Worker] Shutdown timed out");
      process.exit(1);
    }, 30000);

    await Promise.all(closes).catch(() => {});
    clearTimeout(hardKill);
    process.exit(0);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start();
