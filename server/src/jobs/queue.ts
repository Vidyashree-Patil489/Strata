/**
 * BullMQ Queue setup for Repo Health.
 *
 * Two queues:
 *   - `context-incremental`  small webhook-driven re-indexes (fast, high concurrency)
 *   - `context-backfill`     repo-connect / manual full re-index (slow, low concurrency)
 *
 * The split exists so heavy backfill jobs can never starve the
 * latency-sensitive incremental stream.
 */
import { Queue, type ConnectionOptions } from "bullmq";

const redisUrl = process.env.REDIS_URL;

export function getRedisConnection(): ConnectionOptions | null {
  if (!redisUrl) return null;
  return {
    url: redisUrl,
    maxRetriesPerRequest: null,
  };
}

const connection = getRedisConnection();

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 2000 },
  removeOnComplete: 100,
  removeOnFail: 200,
};

function createQueue(name: string): Queue | null {
  if (!connection) return null;
  const queue = new Queue(name, { connection, defaultJobOptions });
  queue.on("error", (err) => {
    console.error(`[Queue:${name}] Redis error:`, err.message);
  });
  return queue;
}

export const contextIncrementalQueue: Queue | null = createQueue(
  "context-incremental",
);
export const contextBackfillQueue: Queue | null = createQueue(
  "context-backfill",
);
export const historicalGraphQueue: Queue | null = createQueue(
  "historical-graph",
);

/** Back-compat alias. Defaults to the incremental queue. */
export const contextQueue: Queue | null = contextIncrementalQueue;

export function getQueueOrThrow(
  name: "context" | "context-incremental" | "context-backfill",
): Queue {
  const queue =
    name === "context" || name === "context-incremental"
      ? contextIncrementalQueue
      : contextBackfillQueue;
  if (!queue) {
    const err = new Error(
      `${name} queue not available (Redis not connected)`,
    ) as any;
    err.statusCode = 503;
    throw err;
  }
  return queue;
}
