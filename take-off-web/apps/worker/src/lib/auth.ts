import type { Context, MiddlewareHandler } from 'hono';
import type { Env } from '../env';
import { sha256Hex } from './crypto';

// Auth model:
//   1. Cloudflare Access in front of takeoff.drivenwp.com handles browser auth.
//      When Access is configured, every request carries `Cf-Access-Authenticated-User-Email`
//      (header set by Access, not spoofable from the public internet because the
//      CF edge strips inbound headers with that name).
//   2. MCP / programmatic clients present `Authorization: Bearer <mcp-token>`
//      that maps to a SHA-256 hash in `mcp_clients`.
//   3. The bootstrap token (env.MCP_BOOTSTRAP_TOKEN) is accepted only by
//      /admin/mcp/tokens — see mcp/server.ts mintMcpClientToken.

export type AuthContext = {
  via: 'access' | 'mcp';
  identity: string; // email for Access, client-id for MCP
};

export async function authenticate(c: Context<{ Bindings: Env }>): Promise<AuthContext | null> {
  const accessEmail = c.req.header('Cf-Access-Authenticated-User-Email');
  if (accessEmail) {
    return { via: 'access', identity: accessEmail };
  }
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
