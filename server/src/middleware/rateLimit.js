import { ApiError } from '../lib/errors.js';

/**
 * Fixed-window in-memory limiter. Fine for a single instance; behind several
 * instances use a shared store (e.g. Redis) or enforce limits at the proxy.
 */
export function createRateLimiter({ windowMs, max, key, message = 'Too many requests. Please try again later.' }) {
  const hits = new Map();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, Math.max(windowMs, 60_000));
  sweep.unref?.();

  const middleware = (req, res, next) => {
    const k = key(req);
    if (k === null || k === undefined) return next();
    const now = Date.now();
    let entry = hits.get(k);
    if (!entry || entry.reset <= now) { entry = { count: 0, reset: now + windowMs }; hits.set(k, entry); }
    entry.count += 1;
    if (entry.count > max) {
      const retry = Math.max(1, Math.ceil((entry.reset - now) / 1000));
      res.set('Retry-After', String(retry));
      return next(new ApiError(429, 'rate_limited', message));
    }
    return next();
  };
  middleware.reset = (k) => (k === undefined ? hits.clear() : hits.delete(k));
  middleware.stop = () => clearInterval(sweep);
  return middleware;
}
