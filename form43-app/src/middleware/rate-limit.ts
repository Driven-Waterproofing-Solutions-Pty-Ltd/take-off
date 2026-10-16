import type { MiddlewareHandler } from 'hono';
import type { AppType } from '../shared/types';

interface Bucket {
  limit: number;
  windowSec: number;
}

const BUCKETS: Record<string, Bucket> = {
  address_autocomplete: { limit: 60, windowSec: 60 },
  address_verify: { limit: 30, windowSec: 60 },
  memory_save: { limit: 30, windowSec: 60 },
  default: { limit: 120, windowSec: 60 },
};

/**
 * Sliding-window rate limit. Uses KV when RATE_LIMIT_KV is bound, falls
 * back to D1 rate_limit_counters table otherwise. Skipped entirely when
 * DISABLE_RATE_LIMIT=1 (tests + local dev).
 */
export function rateLimit(bucketName: keyof typeof BUCKETS = 'default'): MiddlewareHandler<AppType> {
  return async (c, next) => {
    if (c.env.DISABLE_RATE_LIMIT === '1') return next();

    const bucket = BUCKETS[bucketName] || BUCKETS.default;
    const tokenHash = c.get('tokenHash') || 'anon';
    const windowStart = Math.floor(Date.now() / 1000 / bucket.windowSec) * bucket.windowSec;
    const key = `rl:${tokenHash}:${bucketName}:${windowStart}`;

    let count: number;
    if (c.env.RATE_LIMIT_KV) {
      const raw = await c.env.RATE_LIMIT_KV.get(key);
      count = raw ? parseInt(raw, 10) + 1 : 1;
      await c.env.RATE_LIMIT_KV.put(key, String(count), { expirationTtl: bucket.windowSec * 2 });
    } else {
      const row = await c.env.FORM43_DB.prepare(
        'INSERT INTO rate_limit_counters (token_hash, bucket, window_start, count) VALUES (?, ?, ?, 1) ON CONFLICT(token_hash, bucket, window_start) DO UPDATE SET count = count + 1 RETURNING count',
      ).bind(tokenHash, bucketName, windowStart).first<{ count: number }>();
      count = row?.count ?? 1;
    }

    if (count > bucket.limit) {
      return c.json(
        { success: false, error: `Rate limit exceeded for ${bucketName} (${bucket.limit}/${bucket.windowSec}s)` },
        429,
      );
    }
    await next();
  };
}
