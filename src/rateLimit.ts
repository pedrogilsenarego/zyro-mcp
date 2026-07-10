import type { Request, Response, NextFunction } from "express";

interface Bucket {
  count: number;
  resetAt: number;
}

// Fixed-window in-memory rate limiter, keyed by client IP. Single-instance only
// (state is per-process) — use a shared store if zyro ever runs >1 node.
export function rateLimit(opts: {
  windowMs: number;
  max: number;
  message?: string;
}) {
  const buckets = new Map<string, Bucket>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();

    // Bound memory: sweep expired entries when the map grows large.
    if (buckets.size > 5000) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    }

    const key = req.ip ?? "unknown";
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, bucket);
    }

    bucket.count++;
    if (bucket.count > opts.max) {
      res.setHeader(
        "Retry-After",
        String(Math.ceil((bucket.resetAt - now) / 1000)),
      );
      res.status(429).json({ error: opts.message ?? "Too many requests" });
      return;
    }
    next();
  };
}
