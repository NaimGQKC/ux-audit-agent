/**
 * In-memory token-bucket rate limiter.
 *
 * Not cluster-safe: if we scale the Next.js or MCP server to multiple
 * instances, this becomes per-instance. That's acceptable for now — we ship
 * single-instance in Fly and dev. If we later need shared limits, swap the
 * underlying store for Redis / upstash without changing the API shape.
 *
 * The limiter deliberately keys by caller identity (IP for HTTP, sessionId
 * for Slack, bearer-token hash for MCP). Missing identities fall back to
 * "unknown" which gets its own very tight bucket — better to be strict on
 * unidentified traffic than to share a bucket with real users.
 */

import crypto from "node:crypto";

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export interface RateLimitConfig {
  /** Max requests allowed within `windowMs`. */
  limit: number;
  /** Sliding window in milliseconds. */
  windowMs: number;
  /** Identifier used to key this limiter — separate keyspaces per route. */
  namespace: string;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Requests remaining in the current window. */
  remaining: number;
  /** Milliseconds until another request would be allowed. */
  retryAfterMs: number;
}

const buckets = new Map<string, Bucket>();

// GC old buckets periodically so the map doesn't grow unbounded.
const GC_INTERVAL_MS = 5 * 60 * 1000;
let gcTimer: NodeJS.Timeout | null = null;
function startGc(): void {
  if (gcTimer) return;
  gcTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of Array.from(buckets.entries())) {
      if (now - bucket.updatedAt > 60 * 60 * 1000) buckets.delete(key);
    }
  }, GC_INTERVAL_MS);
  // Never block process exit on the GC timer.
  gcTimer.unref?.();
}

export function hashIdentifier(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

/**
 * Check + consume one token. Returns allowed=false if the bucket is empty.
 */
export function rateLimitCheck(identifier: string, config: RateLimitConfig): RateLimitResult {
  startGc();

  const now = Date.now();
  const key = `${config.namespace}:${identifier || "unknown"}`;
  const existing = buckets.get(key);

  // Token-bucket refill: tokens regenerate proportional to elapsed time.
  const refillRatePerMs = config.limit / config.windowMs;
  let tokens = config.limit;
  let updatedAt = now;
  if (existing) {
    const elapsed = Math.max(0, now - existing.updatedAt);
    tokens = Math.min(config.limit, existing.tokens + elapsed * refillRatePerMs);
    updatedAt = now;
  }

  if (tokens < 1) {
    const deficit = 1 - tokens;
    const retryAfterMs = Math.ceil(deficit / refillRatePerMs);
    buckets.set(key, { tokens, updatedAt });
    return { allowed: false, remaining: 0, retryAfterMs };
  }

  tokens -= 1;
  buckets.set(key, { tokens, updatedAt });
  return { allowed: true, remaining: Math.floor(tokens), retryAfterMs: 0 };
}

/**
 * Extract the best-effort client IP from Next-style request headers.
 * Falls back to "unknown" — callers should set a tight limit for that bucket.
 */
export function clientIp(headers: Headers | Record<string, string | undefined>): string {
  const get = (name: string): string | undefined => {
    if (typeof (headers as Headers).get === "function") {
      return (headers as Headers).get(name) ?? undefined;
    }
    return (headers as Record<string, string | undefined>)[name];
  };

  const forwarded = get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = get("x-real-ip");
  if (real) return real;
  const fly = get("fly-client-ip");
  if (fly) return fly;
  return "unknown";
}

/**
 * Only for tests — clears all buckets so we don't leak state between runs.
 */
export function __resetRateLimits(): void {
  buckets.clear();
}
