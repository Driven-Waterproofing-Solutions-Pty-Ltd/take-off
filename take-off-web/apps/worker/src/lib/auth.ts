import type { MiddlewareHandler } from 'hono';
import type { Env } from '../env';
import { sha256Hex } from './crypto';
import { readSession } from './sessions';

// Three accept paths, checked in order:
//   1. Signed session cookie (browser users after /auth/login)
//   2. Bearer MCP token (Claude Desktop, Copilot, server-to-server)
//   3. Cf-Access-Authenticated-User-Email header (transitional fallback
//      while in-app auth is being rolled out; remove the Access policy
//      from the dashboard once everyone has a user account)

interface MinimalContext {
  req: { header: (name: string) => string | undefined };
  env: Env;
}

export type AuthContext = {
  via: 'session' | 'mcp' | 'access';
  identity: string; // user_id (session), client_id (mcp), or email (access)
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

  // 3. Cloudflare Access (transitional)
  const accessEmail = c.req.header('Cf-Access-Authenticated-User-Email');
  if (accessEmail) {
    return { via: 'access', identity: accessEmail };
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
