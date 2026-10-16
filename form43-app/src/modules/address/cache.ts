import { sha256Hex } from '../../shared/activity';

const TTL_SEC = {
  geoscape_predictive: 30 * 24 * 60 * 60,  // 30 days
  geoscape_verify: 90 * 24 * 60 * 60,      // 90 days
  osm: 7 * 24 * 60 * 60,                   // 7 days
};

export type Provider = keyof typeof TTL_SEC;

export interface CacheEntry<T = unknown> {
  provider: Provider;
  query_text: string;
  response: T;
  lat: number | null;
  lng: number | null;
}

function normalise(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function cacheKey(provider: Provider, query: string): Promise<string> {
  return sha256Hex(`${provider}|${normalise(query)}`);
}

export async function cacheGet<T>(db: D1Database, provider: Provider, query: string): Promise<T | null> {
  const key = await cacheKey(provider, query);
  const row = await db.prepare(
    "SELECT response_json, expires_at FROM address_cache WHERE cache_key = ? AND (expires_at IS NULL OR expires_at > datetime('now'))",
  ).bind(key).first<{ response_json: string; expires_at: string | null }>();
  if (!row) return null;
  await db.prepare('UPDATE address_cache SET hits = hits + 1 WHERE cache_key = ?').bind(key).run();
  return JSON.parse(row.response_json) as T;
}

export async function cacheSet<T>(db: D1Database, entry: CacheEntry<T>): Promise<void> {
  const key = await cacheKey(entry.provider, entry.query_text);
  const ttl = TTL_SEC[entry.provider];
  await db.prepare(
    `INSERT INTO address_cache (cache_key, provider, query_text, response_json, lat, lng, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+' || ? || ' seconds'))
     ON CONFLICT(cache_key) DO UPDATE SET
       response_json = excluded.response_json,
       lat = excluded.lat,
       lng = excluded.lng,
       expires_at = excluded.expires_at,
       hits = hits + 1`,
  ).bind(key, entry.provider, entry.query_text, JSON.stringify(entry.response), entry.lat, entry.lng, ttl).run();
}
