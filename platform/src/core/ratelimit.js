/**
 * Rate limiting — replaces @fastify/rate-limit.
 *
 * Fixed-window counter per key, held in memory with a periodic sweep of expired buckets.
 *
 * This is per-process: behind a multi-worker Passenger setup each worker keeps its own counters,
 * so the effective limit is (configured limit x worker count). That is the right trade for a
 * single-dependency monolith; a Redis-backed limiter can be added without touching call sites
 * because everything goes through rateLimit().
 *
 * Keys are the client IP by default, with an optional authenticated-user key so a logged-in user
 * behind shared NAT is not throttled by strangers.
 */
'use strict';

const { TooManyRequestsError } = require('./errors');

class RateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs ?? 60_000;
    this.max = options.max ?? 300;
    this.buckets = new Map(); // key -> { count, resetAt }
    this.sweepInterval = null;
    if (options.sweep !== false) this.startSweep();
  }

  startSweep() {
    // Evict stale buckets so a burst of unique IPs cannot grow the map without bound.
    this.sweepInterval = setInterval(() => this.sweep(), this.windowMs * 2);
    this.sweepInterval.unref?.();
  }

  stop() {
    if (this.sweepInterval) clearInterval(this.sweepInterval);
    this.buckets.clear();
  }

  sweep() {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }

  /**
   * Consume one unit for `key`.
   * @returns {{ allowed: boolean, limit: number, remaining: number, resetAt: number }}
   */
  hit(key, limit = this.max) {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(0, limit - bucket.count);

    return {
      allowed: bucket.count <= limit,
      limit,
      remaining,
      resetAt: bucket.resetAt,
      retryAfterMs: Math.max(0, bucket.resetAt - now),
    };
  }

  /** Drop a key's counters — used after a successful login so a user is not punished for typos. */
  reset(key) {
    this.buckets.delete(key);
  }
}

/**
 * Middleware factory.
 * @param {object} options
 * @param {RateLimiter} options.limiter
 * @param {number} [options.max]            override the limiter default for this route group
 * @param {function} [options.keyGenerator] (ctx) => string
 * @param {string} [options.name]           label used in the response headers
 */
function rateLimit(options) {
  const { limiter, max, keyGenerator, name } = options;

  return function applyRateLimit(ctx) {
    const key = `${name ?? 'global'}:${keyGenerator ? keyGenerator(ctx) : ctx.ip}`;
    const result = limiter.hit(key, max);

    ctx.header('X-RateLimit-Limit', String(result.limit));
    ctx.header('X-RateLimit-Remaining', String(result.remaining));
    ctx.header('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));

    if (!result.allowed) {
      ctx.header('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
      throw new TooManyRequestsError('Too many requests, please slow down', {
        limit: result.limit,
        retryAfterMs: result.retryAfterMs,
      });
    }
  };
}

/** Key by authenticated user when present, otherwise by IP. */
const userOrIp = (ctx) => (ctx.user?.id ? `user:${ctx.user.id}` : `ip:${ctx.ip}`);

module.exports = { RateLimiter, rateLimit, userOrIp };
