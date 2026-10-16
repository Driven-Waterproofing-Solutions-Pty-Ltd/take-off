import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../env';
import { sha256Hex } from './crypto';

// Sessions: random id stored server-side in `sessions`, plus a signed cookie
// of `id.expires.hmac` so we can reject forged ids before hitting D1.
//
// Cookie shape   :  takeoff_session=<id>.<expires_ms>.<hmac>; HttpOnly; Secure; SameSite=Strict; Path=/
// Server storage :  sessions row keyed by id, expires_at, user_id
// Rotation       :  on login a new session id is minted; the old one is deleted
// Logout         :  delete the row + clear the cookie
// TTL            :  30 days from issue, sliding renewal not implemented (v1)

export const COOKIE_NAME = 'takeoff_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface SessionRow {
  id: string;
  user_id: string;
  expires_at: number;
  created_at: number;
}

function getSessionSecret(env: Env): string {
  // We reuse the bootstrap token as the HMAC key — rotating it invalidates
  // both MCP-token-mint authority AND every active session, which is the
  // correct blast radius for that secret (it's the "log everyone out and
  // re-issue all MCP tokens" lever).
  if (!env.MCP_BOOTSTRAP_TOKEN) {
    throw new Error('MCP_BOOTSTRAP_TOKEN required to sign sessions');
  }
  return env.MCP_BOOTSTRAP_TOKEN;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface CreateSessionOpts {
  userId: string;
  userAgent?: string;
  ip?: string;
}

export async function createSession(
  env: Env,
  opts: CreateSessionOpts
): Promise<{ cookie: string; expiresAt: number; id: string }> {
  const id = crypto.randomUUID();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const ip_hash = opts.ip ? await sha256Hex(opts.ip) : null;

  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, expires_at, created_at, user_agent, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(id, opts.userId, expiresAt, Date.now(), opts.userAgent ?? null, ip_hash)
    .run();

  const sig = await hmacHex(getSessionSecret(env), `${id}.${expiresAt}`);
  const value = `${id}.${expiresAt}.${sig}`;
  // Max-Age is in seconds.
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  const cookie = `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
  return { cookie, expiresAt, id };
}

export async function deleteSession(env: Env, sessionId: string): Promise<void> {
  await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

export interface SessionContext {
  sessionId: string;
  userId: string;
  expiresAt: number;
}

export async function readSession(
  env: Env,
  cookieHeader: string | undefined
): Promise<SessionContext | null> {
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(/;\s*/);
  const sessionCookie = cookies.find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (!sessionCookie) return null;

  const value = sessionCookie.slice(COOKIE_NAME.length + 1);
  const parts = value.split('.');
  if (parts.length !== 3) return null;

  const [id, expiresStr, sig] = parts;
  const expiresAt = Number(expiresStr);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;

  const expectedSig = await hmacHex(getSessionSecret(env), `${id}.${expiresAt}`);
  if (!timingSafeEqualHex(expectedSig, sig)) return null;

  const row = (await env.DB.prepare(
    'SELECT id, user_id, expires_at FROM sessions WHERE id = ?'
  )
    .bind(id)
    .first()) as SessionRow | null;
  if (!row || row.expires_at < Date.now()) return null;

  return { sessionId: row.id, userId: row.user_id, expiresAt: row.expires_at };
}

export async function pruneExpiredSessions(db: D1Database): Promise<{ deleted: number }> {
  const r = await db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()).run();
  return { deleted: r.meta?.changes ?? 0 };
}
