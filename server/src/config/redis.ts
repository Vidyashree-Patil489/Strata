/**
 * Centralized Redis client factory.
 *
 * Three distinct concerns share the same Redis URL but need separate
 * connections because they use incompatible client modes:
 *
 *   1. `redis` — general commands (GET/SET/EX/...). Used by the halt-decision
 *      cache, rate limiter, application state. maxRetriesPerRequest: null so
 *      it's safe for long-running commands.
 *
 *   2. `pub` / `sub` — Socket.IO Redis adapter. Pub/sub clients in ioredis
 *      cannot run normal commands; they must be dedicated. Two separate
 *      connections, both with maxRetriesPerRequest set to null (the adapter
 *      installs blocking subscribe loops on `sub`).
 *
 *   3. BullMQ creates its own connections from getRedisConnection() in
 *      jobs/queue.ts — BullMQ explicitly requires its own clients with
 *      maxRetriesPerRequest: null and enableReadyCheck: false to play nice
 *      with blocking BRPOPLPUSH commands.
 *
 * All connections share the same REDIS_URL. In ElastiCache / Upstash this
 * means one Redis instance handles all three concerns. The connection
 * overhead is negligible (we're talking ~6 sockets total per process).
 */
import IORedis from "ioredis";

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  console.warn("[Redis] REDIS_URL is not set — queues, sockets across instances, and rate limiting will not work");
}

/** General-purpose Redis client. Safe for any non-blocking command. */
export const redis = redisUrl
  ? new IORedis(redisUrl, { maxRetriesPerRequest: null })
  : (null as unknown as IORedis);

/**
 * Socket.IO Redis adapter pub/sub pair. Lazy because most processes don't
 * need them (e.g. CLI scripts, one-off tasks). The API server and worker
 * processes that emit socket events call `getSocketPubSub()` during init.
 *
 * Returns null when REDIS_URL is missing — the socket layer falls back to
 * single-instance in-memory routing in that case.
 */
let pubClient: IORedis | null = null;
let subClient: IORedis | null = null;

export function getSocketPubSub(): { pub: IORedis; sub: IORedis } | null {
  if (!redisUrl) return null;
  if (!pubClient) {
    pubClient = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    pubClient.on("error", (err) =>
      console.error("[Redis:pub] error:", err.message),
    );
  }
  if (!subClient) {
    subClient = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    subClient.on("error", (err) =>
      console.error("[Redis:sub] error:", err.message),
    );
  }
  return { pub: pubClient, sub: subClient };
}
