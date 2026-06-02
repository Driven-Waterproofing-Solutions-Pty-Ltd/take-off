/**
 * form43-app — Standalone Cloudflare Worker for QLD Form 43.
 *
 * Surfaces:
 *   /form43                      — Standalone HTML page (PDF generator)
 *   /api/v1/form43/*             — Form 43 REST API
 *   /api/v1/address/*            — Geoscape G-NAF / OSM Nominatim address API
 *   /api/v1/memory/*             — Self-contained memory (D1 + Vectorize)
 *   /mcp                         — Remote MCP (Streamable HTTP, JSON-RPC 2.0)
 *   /health                      — Liveness probe (unauthenticated)
 *
 * All /api/* and /mcp routes require Bearer auth (FORM43_API_TOKEN).
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppType } from './shared/types';
import type { Env } from './env';
import { snapshotMemory } from './modules/memory/backup';
import { correlation } from './middleware/correlation';
import { bearerAuth } from './middleware/auth';
import { err } from './shared/response';
import form43Routes from './modules/form43/routes';
import addressRoutes from './modules/address/routes';
import memoryRoutes from './modules/memory/routes';
import mcpRouter from './mcp/server';
import { getForm43HTML } from './modules/form43/standalone';

const app = new Hono<AppType>();

app.use('*', correlation);
app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'], allowHeaders: ['Authorization', 'Content-Type', 'X-Correlation-Id'] }));

app.get('/health', (c) => c.json({ success: true, data: { ok: true, env: c.env.ENV } }));

app.get('/form43', (c) => c.html(getForm43HTML()));

// Compatibility stub for the aqua-era /job-data/:jobId endpoint that the
// standalone HTML's job-picker calls. The new app has no jobs table; use
// POST /api/v1/form43/prefill (or the form43_prefill MCP tool) instead.
app.get('/api/v1/form43/job-data/:jobId', (c) =>
  c.json(err('Job lookup not supported in standalone form43-app. Use POST /api/v1/form43/prefill with the job payload, or the form43_prefill MCP tool.'), 410),
);

// Authenticated surfaces below.
app.use('/api/v1/*', bearerAuth);
app.use('/mcp/*', bearerAuth);
app.use('/mcp', bearerAuth);

app.route('/api/v1/form43', form43Routes);
app.route('/api/v1/address', addressRoutes);
app.route('/api/v1/memory', memoryRoutes);
app.route('/mcp', mcpRouter);

app.onError((e, c) => {
  console.error('Unhandled error', e);
  return c.json(err(e.message, c.get('correlationId')), 500);
});

app.notFound((c) => c.json(err('Not found', c.get('correlationId')), 404));

/**
 * Worker handlers. `fetch` serves HTTP; `scheduled` runs the memory R2
 * snapshot on the cron defined in wrangler.jsonc (triggers.crons).
 */
export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      snapshotMemory(env)
        .then((r) => { if (r) console.log(`memory snapshot ${r.key} (${r.bytes} bytes)`); })
        .catch((e) => console.error('memory snapshot failed', e)),
    );
  },
};

