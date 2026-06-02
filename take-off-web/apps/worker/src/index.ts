import { Hono } from 'hono';
import { ZodError } from 'zod';
import type { Env } from './env';
import projects from './routes/projects';
import measurements from './routes/measurements';
import memory from './routes/memory';
import xero from './routes/xero';
import auth, { adminApp as adminUsers } from './routes/auth';
import { handleMcp, mintMcpClientToken } from './mcp/server';
import { syncXeroContacts } from './tools/xero';
import { pruneExpiredSessions } from './lib/sessions';

const app = new Hono<{ Bindings: Env }>();

app.onError((err, c) => {
  if (err instanceof ZodError) {
    return c.json(
      { error: 'invalid request', issues: err.flatten() },
      400
    );
  }
  const message = err instanceof Error ? err.message : String(err);
  // Domain validation messages thrown by tools (e.g. "scale not calibrated")
  // surface as 400. Unknown errors are 500.
  const isUserFacing = /not calibrated|not found|required|invalid|missing|already|unknown|forbidden|cannot/i.test(
    message
  );
  console.error('worker error:', err);
  return c.json({ error: message }, isUserFacing ? 400 : 500);
});

app.get('/', (c) =>
  c.json({
    name: 'takeoff-worker',
    version: '0.0.1',
    docs: 'https://takeoff.drivenwp.com/docs',
  })
);

app.get('/health', async (c) => {
  const row = await c.env.DB.prepare('SELECT 1 AS ok').first();
  return c.json({ ok: row?.ok === 1 });
});

app.route('/auth', auth);
app.route('/admin/users', adminUsers);
app.route('/api/projects', projects);
app.route('/api/measure', measurements);
app.route('/api/memory', memory);
app.route('/xero', xero);

// MCP endpoint — JSON-RPC over HTTP (matches MCP 2025-06-18 transport)
app.all('/mcp', (c) => handleMcp(c.req.raw, c.env));

// One-off: mint an MCP client token (used to provision Claude Desktop / Copilot)
app.post('/admin/mcp/tokens', async (c) => {
  try {
    const { name } = await c.req.json<{ name: string }>();
    const token = await mintMcpClientToken(
      c.env,
      c.req.header('authorization') ?? undefined,
      name
    );
    return c.json(token);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 403);
  }
});

export default {
  fetch: app.fetch,

  // Nightly: Xero contact sync + prune expired sessions
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    try {
      await syncXeroContacts(env);
    } catch (err) {
      console.error('xero sync failed', err);
    }
    try {
      const { deleted } = await pruneExpiredSessions(env.DB);
      if (deleted > 0) console.log(`pruned ${deleted} expired sessions`);
    } catch (err) {
      console.error('session prune failed', err);
    }
  },
};
