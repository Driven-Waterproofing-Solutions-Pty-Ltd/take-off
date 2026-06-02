import type { MiddlewareHandler } from 'hono';
import type { Env } from '../env';
import { sha256Hex } from './crypto';
import { readSession } from './sessions';

// Two accept paths, checked in order:
//   1. Signed session cookie (browser users after /auth/login)
//   2. Bearer MCP token (Claude Desktop, Copilot, server-to-server)
//
// NOTE: an earlier draft also accepted `Cf-Access-Authenticated-User-Email`
// as a third path "for the transitional period while Access is in front",
// but that header is trivially spoofable any time the worker is reachable
// without Access actually enforcing in front of it. The Workers Builds /
// custom-domain rollout makes this very easy to misconfigure (deploy first,
// add Access later, or remove Access for testing and forget to put it back).
// Removed. If you want SSO on top of in-app auth, configure Cloudflare Access
// AND keep using the in-app login — session cookie still flows through Access.

interface MinimalContext {
  req: { header: (name: string) => string | undefined };
  env: Env;
}

export type AuthContext = {
  via: 'session' | 'mcp';
  identity: string; // user_id (session) or client_id (mcp)
};

export async function authenticate(c: MinimalContext): Promise<AuthContext | null> {
  // 1. Session cookie
  const session = await readSession(c.env, c.req.header('Cookie'));
  if (session) {
    return { via: 'session', identity: session.userId };
  }

  // 2. MCP bearer token
  const auth = c.req.header('Authorization');
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice('Bearer '.length);
    const hash = await sha256Hex(token);
    const row = (await c.env.DB.prepare(
      'SELECT id FROM mcp_clients WHERE token_hash = ?'
    )
      .bind(hash)
      .first()) as { id: string } | null;
    if (row) {
      await c.env.DB.prepare('UPDATE mcp_clients SET last_seen_at = ? WHERE id = ?')
        .bind(Date.now(), row.id)
        .run();
      return { via: 'mcp', identity: row.id };
    }
  }

  return null;
}

export const requireAuth: MiddlewareHandler<{ Bindings: Env; Variables: { auth: AuthContext } }> =
  async (c, next) => {
    const auth = await authenticate(c);
    if (!auth) return c.json({ error: 'unauthorized' }, 401);
    c.set('auth', auth);
    await next();
  };
