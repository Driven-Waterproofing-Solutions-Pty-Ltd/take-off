import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../env';
import { tools } from '@takeoff/shared';
import {
  pushToXero,
  syncXeroContacts,
  pullXeroInvoice,
  findOrCreateXeroContact,
  listProjectXeroDocs,
} from '../tools/xero';
import { requireAuth, requireAdmin } from '../lib/auth';
import { encryptString, signOauthState, verifyOauthState } from '../lib/crypto';

const app = new Hono<{ Bindings: Env }>();

// Granular scopes: Xero apps created after 2 Mar 2026 cannot request the old
// broad scopes (accounting.transactions → invalid_scope). Quotes + invoices
// are covered by accounting.invoices in the granular model; settings.read is
// needed to resolve org defaults (tax rates / account codes) when pushing.
const XERO_SCOPES = 'accounting.invoices accounting.contacts accounting.settings.read offline_access';
const OAUTH_STATE_COOKIE = 'xero_oauth_state';

function getOauthSecret(env: Env): string {
  // Reuse MCP_BOOTSTRAP_TOKEN as HMAC key for the short-lived OAuth state cookie.
  // It is server-side-only, rotated like any other secret.
  if (!env.MCP_BOOTSTRAP_TOKEN) {
    throw new Error('MCP_BOOTSTRAP_TOKEN required to sign OAuth state');
  }
  return env.MCP_BOOTSTRAP_TOKEN;
}

function getTokenSecret(env: Env): string {
  if (!env.XERO_TOKEN_KEY) {
    throw new Error('XERO_TOKEN_KEY secret not set — required to encrypt Xero tokens');
  }
  return env.XERO_TOKEN_KEY;
}

// /oauth/start REQUIRES an ADMIN session: the org's xero_tokens row is a
// single, shared connection. If any authenticated member could re-run the
// flow, they could repoint the integration at their own Xero tenant, and
// every later quote/invoice push would silently land there. We also reject
// MCP tokens — Xero's consent screen needs a real browser, so server-to-
// server "admin" doesn't apply to this endpoint.
//
// /oauth/callback is hit by Xero's redirect (no app session header), so it
// stays public — CSRF is handled by the HMAC-signed state cookie set in
// /oauth/start. Combined: only an admin user can initiate the flow, and
// only their browser can complete it.

app.get('/oauth/start', requireAdmin, async (c) => {
  if (!c.env.XERO_CLIENT_ID || !c.env.XERO_REDIRECT_URI) {
    return c.json({ error: 'Xero is not configured' }, 500);
  }
  const rawState = crypto.randomUUID();
  const signed = await signOauthState(getOauthSecret(c.env), rawState);
  const url = new URL('https://login.xero.com/identity/connect/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', c.env.XERO_CLIENT_ID);
  url.searchParams.set('redirect_uri', c.env.XERO_REDIRECT_URI);
  url.searchParams.set('scope', XERO_SCOPES);
  url.searchParams.set('state', rawState);
  c.header(
    'Set-Cookie',
    `${OAUTH_STATE_COOKIE}=${signed}; HttpOnly; Secure; SameSite=Lax; Path=/xero; Max-Age=600`
  );
  return c.redirect(url.toString());
});

app.get('/oauth/callback', async (c) => {
  if (!c.env.XERO_CLIENT_ID || !c.env.XERO_CLIENT_SECRET || !c.env.XERO_REDIRECT_URI) {
    return c.json({ error: 'Xero is not configured' }, 500);
  }
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) return c.json({ error: 'missing code or state' }, 400);

  const cookieHeader = c.req.header('Cookie') ?? '';
  const cookie = cookieHeader
    .split(/;\s*/)
    .find((p) => p.startsWith(`${OAUTH_STATE_COOKIE}=`))
    ?.split('=', 2)[1];
  if (!cookie) return c.json({ error: 'missing state cookie' }, 400);
  const ok = await verifyOauthState(getOauthSecret(c.env), cookie, state);
  if (!ok) return c.json({ error: 'state mismatch (possible CSRF)' }, 400);

  const basic = btoa(`${c.env.XERO_CLIENT_ID}:${c.env.XERO_CLIENT_SECRET}`);
  const tokenRes = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: c.env.XERO_REDIRECT_URI,
    }),
  });
  if (!tokenRes.ok) {
    return c.json({ error: 'token exchange failed', detail: await tokenRes.text() }, 502);
  }
  const token = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  const connRes = await fetch('https://api.xero.com/connections', {
    headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' },
  });
  if (!connRes.ok) {
    return c.json(
      { error: 'failed to fetch Xero tenant list', status: connRes.status, detail: await connRes.text() },
      502
    );
  }
  const conns = (await connRes.json()) as Array<{ tenantId: string; tenantName: string }>;
  const tenant = conns[0];
  if (!tenant) return c.json({ error: 'no Xero tenants connected to this user' }, 400);

  const secret = getTokenSecret(c.env);
  const encAccess = await encryptString(secret, token.access_token);
  const encRefresh = await encryptString(secret, token.refresh_token);
  const expires_at = Date.now() + token.expires_in * 1000;
  await c.env.DB.prepare(
    `INSERT INTO xero_tokens (tenant_id, tenant_name, access_token, refresh_token, expires_at, scopes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id) DO UPDATE SET
       tenant_name = excluded.tenant_name,
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at,
       updated_at = excluded.updated_at`
  )
    .bind(
      tenant.tenantId,
      tenant.tenantName,
      encAccess,
      encRefresh,
      expires_at,
      XERO_SCOPES,
      Date.now()
    )
    .run();

  c.header(
    'Set-Cookie',
    `${OAUTH_STATE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/xero; Max-Age=0`
  );
  return c.redirect(c.env.APP_BASE_URL ?? '/');
});

app.post('/push', requireAuth, async (c) => {
  const body = await c.req.json();
  const input = tools.push_to_xero.input.parse(body);
  return c.json(await pushToXero(c.env, input));
});

app.post('/sync', requireAuth, async (c) => {
  return c.json(await syncXeroContacts(c.env));
});

// Read-only invoice fetch — used to reverse-engineer assemblies/pricing
// from past quoted work, or to look up a similar prior job at quote time.
app.post('/invoices/pull', requireAuth, async (c) => {
  const body = await c.req.json();
  const input = tools.pull_xero_invoice.input.parse(body);
  return c.json(await pullXeroInvoice(c.env, input));
});

// Find an existing Xero contact (by name, then email) or create one, so a
// brand-new customer can be invoiced without a manual Xero round-trip first.
// REST-only — deliberately NOT in the agent tool registry; the human picks or
// confirms the contact in the Send-to-Xero modal.
const findOrCreateContactZ = z.object({
  name: z.string().min(1),
  email: z.string().optional(),
  phone: z.string().optional(),
});
app.post('/contacts/find-or-create', requireAuth, async (c) => {
  const input = findOrCreateContactZ.parse(await c.req.json());
  return c.json(await findOrCreateXeroContact(c.env, input));
});

// List the Xero docs already pushed for a project, with live invoice status.
const projectDocsZ = z.object({ project_id: z.string().min(1) });
app.post('/project-docs', requireAuth, async (c) => {
  const input = projectDocsZ.parse(await c.req.json());
  return c.json(await listProjectXeroDocs(c.env, input));
});

export default app;
