import rateLimit, { ipKeyGenerator, type Options, type Store } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import type { Request } from "express";
import { redis } from "../config/redis";

function ipKey(req: Request): string {
  return ipKeyGenerator(req.ip ?? "unknown");
}

const handler: Options["handler"] = (_req, res) => {
  res.status(429).json({
    error: "Too many requests. Try again shortly.",
    code: "rate_limit_exceeded",
  });
};

function buildStore(prefix: string): Store | undefined {
  if (!redis || typeof (redis as any).call !== "function") {
    console.warn(
      `[RateLimit] No Redis call() — limiter "${prefix}" using in-memory store.`,
    );
    return undefined;
  }
  return new RedisStore({
    sendCommand: (...args: string[]) => (redis as any).call(...args),
    prefix: `repohealth:rl:${prefix}:`,
  });
}

/**
 * Manual context-index trigger is expensive (LLM-heavy pattern + history
 * agents + CPU-bound tree-sitter for minutes). Tight cap prevents the
 * obvious DoS shape (queue 1000 jobs, exhaust workers).
 */
export const contextIndexLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 3,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.user?.userId ?? ipKey(req),
  handler,
  store: buildStore("context-index"),
});
