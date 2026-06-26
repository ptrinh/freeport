/**
 * Lightweight, dependency-free rate limiting for the hosted HTTP endpoint.
 *
 * Two token buckets per request:
 *  - PER-IP: stops a single client spamming us.
 *  - GLOBAL: caps aggregate load so a botnet of many IPs still can't hammer
 *    the upstream relays through us.
 *
 * Tokens refill continuously (smooth, not a fixed-window cliff). Behind the
 * Cloudflare tunnel the real client IP is in `CF-Connecting-IP`.
 *
 * Tunables (env): RATE_LIMIT_PER_MIN (default 60), RATE_LIMIT_GLOBAL_PER_MIN
 * (default 1200), RATE_LIMIT_BURST (per-IP bucket capacity, default 20).
 */
import type { Request, Response, NextFunction } from 'express';

interface Bucket { tokens: number; last: number; }

function makeBucket(capacity: number, refillPerSec: number) {
  const buckets = new Map<string, Bucket>();
  return {
    take(key: string, now: number): { ok: boolean; retryAfter: number } {
      let b = buckets.get(key);
      if (!b) { b = { tokens: capacity, last: now }; buckets.set(key, b); }
      b.tokens = Math.min(capacity, b.tokens + ((now - b.last) / 1000) * refillPerSec);
      b.last = now;
      if (b.tokens >= 1) { b.tokens -= 1; return { ok: true, retryAfter: 0 }; }
      return { ok: false, retryAfter: Math.ceil((1 - b.tokens) / refillPerSec) };
    },
    sweep(now: number) {
      // Drop fully-refilled idle buckets so the map can't grow unbounded.
      for (const [k, b] of buckets) {
        if (b.tokens >= capacity && now - b.last > 60_000) buckets.delete(k);
      }
    },
    size: () => buckets.size,
  };
}

export function rateLimit() {
  const perMin = Number(process.env.RATE_LIMIT_PER_MIN ?? 60);
  const globalPerMin = Number(process.env.RATE_LIMIT_GLOBAL_PER_MIN ?? 1200);
  const burst = Number(process.env.RATE_LIMIT_BURST ?? 20);

  const perIp = makeBucket(Math.max(burst, perMin), perMin / 60);
  const global = makeBucket(globalPerMin, globalPerMin / 60);
  let lastSweep = 0;

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    if (now - lastSweep > 60_000) { perIp.sweep(now); lastSweep = now; }

    const ip =
      (req.headers['cf-connecting-ip'] as string) ||
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.ip ||
      'unknown';

    const g = global.take('@global', now);
    const i = perIp.take(ip, now);
    if (g.ok && i.ok) { next(); return; }

    const retryAfter = Math.max(g.retryAfter, i.retryAfter, 1);
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({
      jsonrpc: '2.0', id: null,
      error: { code: -32029, message: `Rate limit exceeded. Retry after ${retryAfter}s.` },
    });
  };
}
