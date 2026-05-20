import { Hono } from 'hono';
import type { Env } from './env';
import projects from './routes/projects';
import measurements from './routes/measurements';
import memory from './routes/memory';
import xero from './routes/xero';
import { handleMcp, mintMcpClientToken } from './mcp/server';
import { syncXeroContacts } from './tools/xero';

const app = new Hono<{ Bindings: Env }>();

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

  // Nightly Xero contact sync
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    try {
      await syncXeroContacts(env);
    } catch (err) {
      console.error('xero sync failed', err);
    }
  },
};
