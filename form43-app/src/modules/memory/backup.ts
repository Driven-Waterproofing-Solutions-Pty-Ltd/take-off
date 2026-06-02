/**
 * Optional R2 snapshot of chat_memory. Mirrors aqua's memory/cron/backup
 * approach: single JSON blob keyed by timestamp, retain newest 90.
 */

import type { Env } from '../../env';

const MAX_SNAPSHOTS = 90;

export async function snapshotMemory(env: Env): Promise<{ key: string; bytes: number } | null> {
  if (!env.FORM43_BACKUPS || env.DISABLE_R2_BACKUP === '1') return null;

  const { results } = await env.FORM43_DB.prepare('SELECT * FROM chat_memory').all();
  const body = JSON.stringify({ snapshot_at: new Date().toISOString(), rows: results });
  const key = `chat_memory/${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

  await env.FORM43_BACKUPS.put(key, body, { httpMetadata: { contentType: 'application/json' } });

  await pruneSnapshots(env.FORM43_BACKUPS);

  return { key, bytes: body.length };
}

async function pruneSnapshots(bucket: R2Bucket): Promise<void> {
  const list = await bucket.list({ prefix: 'chat_memory/' });
  if (list.objects.length <= MAX_SNAPSHOTS) return;
  const sorted = [...list.objects].sort((a, b) => a.uploaded.getTime() - b.uploaded.getTime());
  const toDelete = sorted.slice(0, sorted.length - MAX_SNAPSHOTS).map((o) => o.key);
  if (toDelete.length > 0) await bucket.delete(toDelete);
}
