import type { D1Database } from '@cloudflare/workers-types';
import { sha256Hex } from './crypto';

// Application-level throttle for POST /auth/login (see
// migrations/0007_login_attempts.sql). Without it the public endpoint ran a
// 100k-iteration PBKDF2 check for every request with no per-account or
// per-IP limit, so passwords could be guessed without bound and Worker CPU
// burned with nonexistent-user attempts whenever no edge rate-limit rule was
// configured.
//
// Failed attempts are recorded under the normalised email and under a hash
// of the client IP; once either key has too many failures inside the window
// the request is refused BEFORE the PBKDF2 work. A successful login clears
// the email key. If the table is missing (worker deployed before the
// migration ran) the throttle fails open rather than locking everyone out.

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_EMAIL = 10;
const MAX_FAILURES_PER_IP = 50;

export interface ThrottleKeys {
  email: string;
  ip: string | null;
}

export async function throttleKeys(email: string, ip: string | undefined): Promise<ThrottleKeys> {
  return {
    email: `email:${email}`,
    ip: ip ? `ip:${await sha256Hex(ip)}` : null,
  };
}

/** Seconds until the caller may retry, or 0 when the attempt may proceed. */
export async function loginRetryAfterSeconds(db: D1Database, keys: ThrottleKeys): Promise<number> {
  try {
    const since = Date.now() - LOGIN_WINDOW_MS;
    const rows = (
      await db
        .prepare(
          `SELECT key, COUNT(*) AS failures, MIN(attempted_at) AS oldest
             FROM login_attempts
            WHERE key IN (?, ?) AND attempted_at > ?
            GROUP BY key`
        )
        .bind(keys.email, keys.ip ?? keys.email, since)
        .all()
    ).results as Array<{ key: string; failures: number; oldest: number }>;
    for (const row of rows) {
      const max = row.key === keys.email ? MAX_FAILURES_PER_EMAIL : MAX_FAILURES_PER_IP;
      if (row.failures >= max) {
        return Math.max(1, Math.ceil((row.oldest + LOGIN_WINDOW_MS - Date.now()) / 1000));
      }
    }
    return 0;
  } catch (err) {
    console.warn('login throttle unavailable (migration 0007 not applied?)', err);
    return 0;
  }
}

export async function recordLoginFailure(db: D1Database, keys: ThrottleKeys): Promise<void> {
  try {
    const now = Date.now();
    const stmts = [db.prepare('INSERT INTO login_attempts (key, attempted_at) VALUES (?, ?)').bind(keys.email, now)];
    if (keys.ip) {
      stmts.push(db.prepare('INSERT INTO login_attempts (key, attempted_at) VALUES (?, ?)').bind(keys.ip, now));
    }
    await db.batch(stmts);
  } catch (err) {
    console.warn('login throttle: failed to record attempt', err);
  }
}

export async function clearLoginFailures(db: D1Database, keys: ThrottleKeys): Promise<void> {
  try {
    await db.prepare('DELETE FROM login_attempts WHERE key = ?').bind(keys.email).run();
  } catch (err) {
    console.warn('login throttle: failed to clear attempts', err);
  }
}

export async function pruneLoginAttempts(db: D1Database): Promise<{ deleted: number }> {
  const r = await db
    .prepare('DELETE FROM login_attempts WHERE attempted_at < ?')
    .bind(Date.now() - LOGIN_WINDOW_MS)
    .run();
  return { deleted: r.meta?.changes ?? 0 };
}
