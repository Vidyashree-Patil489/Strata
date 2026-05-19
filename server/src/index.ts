import dotenv from "dotenv";
dotenv.config();

import http from "http";
import app from "./app";
import { connectDB } from "./config/db";
import { initSocket } from "./config/socket";
import {
  startContextIncrementalWorker,
  startContextBackfillWorker,
} from "./jobs/context.job";
import { startHistoricalGraphWorker } from "./jobs/historical-graph.job";
import { RepoContext } from "./models/RepoContext";
import type { Worker } from "bullmq";

// Ensure indexes are created
import "./models/FilePushHistory";
import "./models/RepoHealthSnapshot";
import "./models/RepoGraphSnapshot";

const server = http.createServer(app);
initSocket(server);

const PORT = process.env.PORT || 3000;

/**
 * Reset repos stuck at "indexing" from a previous crash/deploy.
 */
async function cleanupOrphanedStatuses() {
  try {
    const result = await RepoContext.updateMany(
      { indexStatus: "indexing" },
      { $set: { indexStatus: "failed" } },
    );
    if (result.modifiedCount > 0) {
      console.log(
        `[RepoHealth] Startup cleanup: reset ${result.modifiedCount} stuck repos`,
      );
    }
  } catch (err: any) {
    console.error("[RepoHealth] Startup cleanup error:", err.message);
  }
}

async function start() {
  await connectDB();
  await cleanupOrphanedStatuses();

  const inlineWorkers: Record<string, Worker | null> = {};
  const runInline =
    process.env.WORKER_MODE !== "separate" &&
    process.env.WORKER_TYPE !== "none";

  if (!runInline) {
    console.log("[RepoHealth] Skipping inline workers (WORKER_MODE=separate)");
  } else {
    inlineWorkers["context-incremental"] = startContextIncrementalWorker();
    inlineWorkers["context-backfill"] = startContextBackfillWorker();
    inlineWorkers["historical-graph"] = startHistoricalGraphWorker();

    for (const [name, w] of Object.entries(inlineWorkers)) {
      if (w) {
        console.log(`[RepoHealth] ${name} worker initialized`);
      } else {
        console.warn(`[RepoHealth] ${name} worker NOT initialized — check REDIS_URL`);
      }
    }
  }

  server.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`[RepoHealth] Server running on 0.0.0.0:${PORT}`);
  });

  let shuttingDown = false;
  async function gracefulShutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[RepoHealth] ${signal} received — graceful shutdown...`);

    server.close(() => console.log("[RepoHealth] HTTP server closed"));

    const closePromises: Promise<void>[] = [];
    for (const [name, w] of Object.entries(inlineWorkers)) {
      if (!w) continue;
      console.log(`[RepoHealth] Closing ${name} worker...`);
      closePromises.push(
        w.close().then(() => console.log(`[RepoHealth] ${name} closed`)),
      );
    }

    const hardKill = setTimeout(() => {
      console.error("[RepoHealth] Shutdown timed out — forcing exit");
      process.exit(1);
    }, 30000);

    try {
      await Promise.all(closePromises);
    } catch (err: any) {
      console.error("[RepoHealth] Shutdown error:", err.message);
    }

    clearTimeout(hardKill);
    process.exit(0);
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

start();

export { app, server };
