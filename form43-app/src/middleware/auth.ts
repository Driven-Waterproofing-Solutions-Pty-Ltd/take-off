import type { MiddlewareHandler } from 'hono';
import type { AppType } from '../shared/types';
import type { Env } from '../env';
import { sha256Hex } from '../shared/activity';

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify a presented bearer token. Constant-time compare against
 * FORM43_API_TOKEN. The function shape (token, env) -> Promise<boolean>
 * is the swap point for Cloudflare Access JWT verification later —
 * tools and routes never see the difference.
 */
export async function verify(token: string, env: Env): Promise<boolean> {
  if (!env.FORM43_API_TOKEN) return false;
  return timingSafeEqual(token, env.FORM43_API_TOKEN);
}

export const bearerAuth: MiddlewareHandler<AppType> = async (c, next) => {
  const header = c.req.header('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return c.json({ success: false, error: 'Missing Bearer token' }, 401);

  const token = match[1].trim();
  const okToken = await verify(token, c.env);
  if (!okToken) return c.json({ success: false, error: 'Invalid Bearer token' }, 401);

  c.set('tokenHash', (await sha256Hex(token)).slice(0, 16));
  await next();
};
