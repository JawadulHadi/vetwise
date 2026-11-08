import type { NextFunction, Request, Response } from 'express';
import { tokenFromHeader } from './auth.js';

interface Bucket {
  count: number;
  resetAt: number;
}

const MAX_BUCKETS = 1_000;

/**
 * Small fixed-window limiter, keyed on the bearer token's client id when one is
 * present and on the socket address otherwise.
 *
 * It exists for one reason: a single chat turn can trigger several model calls,
 * so an unthrottled token is an open-ended spend. No dependency, no shared
 * state, and the bucket map is bounded so the limiter cannot become the leak.
 */
export function rateLimit(options: { windowMs: number; max: number; scope: string }) {
  const buckets = new Map<string, Bucket>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const identity = tokenFromHeader(req.headers.authorization)?.clientId ?? req.ip ?? 'unknown';
    const key = `${options.scope}:${identity}`;
    const now = Date.now();
    const existing = buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      if (buckets.size >= MAX_BUCKETS) {
        // Drop the oldest window rather than growing without bound.
        const oldest = buckets.keys().next().value;
        if (oldest !== undefined) buckets.delete(oldest);
      }
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    existing.count += 1;
    if (existing.count <= options.max) {
      next();
      return;
    }

    const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1_000));
    res.status(429).set('Retry-After', String(retryAfter)).json({
      error: 'rate_limited',
      error_description: `Too many requests. Try again in ${retryAfter}s.`,
    });
  };
}
