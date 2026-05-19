/**
 * LLM Concurrency Pool — Per-Key Rate Limiting
 *
 * Since LGTM is BYOK (bring your own key), each user has their own API key
 * with independent rate limits. This pool manages concurrency per API key,
 * not globally — User A's Gemini calls don't block User B's OpenAI calls.
 *
 * Usage:
 *   import { withLLMSlot } from "../lib/llm-pool";
 *   const result = await withLLMSlot(apiKey, () => callLLM(prompt));
 */

/** Max simultaneous LLM calls per API key */
const MAX_CONCURRENT_PER_KEY = 6;

/** Delay between releasing a slot and granting it to the next waiter (ms) */
const SLOT_COOLDOWN_MS = 100;

/** Auto-cleanup idle keys after this many ms */
const IDLE_CLEANUP_MS = 5 * 60 * 1000; // 5 minutes

interface KeyPool {
  active: number;
  waitQueue: Array<() => void>;
  lastUsed: number;
}

const pools = new Map<string, KeyPool>();

function getPool(key: string): KeyPool {
  let pool = pools.get(key);
  if (!pool) {
    pool = { active: 0, waitQueue: [], lastUsed: Date.now() };
    pools.set(key, pool);
  }
  pool.lastUsed = Date.now();
  return pool;
}

function acquireSlot(key: string): Promise<void> {
  const pool = getPool(key);
  if (pool.active < MAX_CONCURRENT_PER_KEY) {
    pool.active++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    pool.waitQueue.push(resolve);
  });
}

function releaseSlot(key: string): void {
  const pool = getPool(key);
  if (pool.waitQueue.length > 0) {
    const next = pool.waitQueue.shift()!;
    setTimeout(() => next(), SLOT_COOLDOWN_MS);
  } else {
    pool.active--;
    // Clean up empty pools to prevent memory leaks
    if (pool.active === 0 && pool.waitQueue.length === 0) {
      // Don't delete immediately — keep for a bit in case more calls come
      setTimeout(() => {
        const p = pools.get(key);
        if (
          p &&
          p.active === 0 &&
          p.waitQueue.length === 0 &&
          Date.now() - p.lastUsed > IDLE_CLEANUP_MS
        ) {
          pools.delete(key);
        }
      }, IDLE_CLEANUP_MS);
    }
  }
}

/**
 * Execute an async function within a rate-limited slot for the given API key.
 * If all slots for this key are busy, the call waits in a FIFO queue.
 * Different API keys run independently with no cross-blocking.
 */
export async function withLLMSlot<T>(
  apiKey: string,
  fn: () => Promise<T>,
): Promise<T> {
  await acquireSlot(apiKey);
  try {
    return await fn();
  } finally {
    releaseSlot(apiKey);
  }
}

/** Current pool stats (for health checks / debugging) */
export function getLLMPoolStats() {
  const keys: Record<string, { active: number; waiting: number }> = {};
  for (const [key, pool] of pools) {
    // Mask the API key for security — show first 6 + last 4 chars
    const masked =
      key.length > 12 ? `${key.slice(0, 6)}...${key.slice(-4)}` : "***";
    keys[masked] = { active: pool.active, waiting: pool.waitQueue.length };
  }
  return {
    maxConcurrentPerKey: MAX_CONCURRENT_PER_KEY,
    activeKeys: pools.size,
    keys,
  };
}
