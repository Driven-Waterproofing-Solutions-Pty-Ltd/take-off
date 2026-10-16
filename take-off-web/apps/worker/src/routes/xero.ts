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
import { requireAuth, requireAdmin, requireSession } from '../lib/auth';
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

interface XeroConnection {
  tenantId: string;
  tenantName: string;
  tenantType?: string;
  authEventId?: string;
}

// Read the authentication_event_id claim from the access token Xero's token
// endpoint just returned to us over TLS. Only used to narrow /connections to
// the organisations picked on this consent screen, never as an auth decision,
// so the JWT signature isn't verified here.
function readAuthEventId(accessToken: string): string | null {
  const parts = accessToken.split('.');
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { authentication_event_id?: unknown };
    return typeof payload.authentication_event_id === 'string' ? payload.authentication_event_id : null;
  } catch {
    return null;
  }
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

  // /connections lists EVERY organisation this app has ever been connected to
  // for the user, not just the one chosen on this consent screen, so taking
  // conns[0] could bind the shared connection to the wrong org and send
  // later quote/invoice pushes there. Narrow to the organisations authorised
  // in THIS consent (authEventId, from the access token's
  // authentication_event_id claim) and refuse if that isn't exactly one.
  // If the event filter yields nothing (e.g. Xero didn't tag a re-consented
  // existing connection), fall back to the full list — still refusing when
  // that is ambiguous.
  const fetchConnections = async (
    eventId: string | null
  ): Promise<{ ok: true; conns: XeroConnection[] } | { ok: false; status: number; detail: string }> => {
    const url = new URL('https://api.xero.com/connections');
    if (eventId) url.searchParams.set('authEventId', eventId);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' },
    });
    if (!res.ok) return { ok: false, status: res.status, detail: await res.text() };
    const list = (await res.json()) as XeroConnection[];
    return {
      ok: true,
      conns: list.filter(
        (conn) =>
          (!eventId || !conn.authEventId || conn.authEventId === eventId) &&
          (!conn.tenantType || conn.tenantType === 'ORGANISATION')
      ),
    };
  };
  const authEventId = readAuthEventId(token.access_token);
  let connResult = await fetchConnections(authEventId);
  if (authEventId && connResult.ok && connResult.conns.length === 0) {
    connResult = await fetchConnections(null);
  }
  if (!connResult.ok) {
    return c.json(
      { error: 'failed to fetch Xero tenant list', status: connResult.status, detail: connResult.detail },
      502
    );
  }
  const conns = connResult.conns;
  if (conns.length === 0) return c.json({ error: 'no Xero tenants connected to this user' }, 400);
  if (conns.length > 1) {
    return c.json(
      {
        error:
          'More than one Xero organisation was authorised. Reconnect and select exactly one organisation on the Xero consent screen.',
        tenants: conns.map((conn) => conn.tenantName),
      },
      409
    );
  }
  const tenant = conns[0];

  const secret = getTokenSecret(c.env);
  const encAccess = await encryptString(secret, token.access_token);
  const encRefresh = await encryptString(secret, token.refresh_token);
  const expires_at = Date.now() + token.expires_in * 1000;
  // The integration holds ONE active connection (getActiveXeroToken uses the
  // newest row). Replace any other tenant's row in the same transaction:
  // otherwise a refresh for the previous tenant that was already in flight
  // could bump that row's updated_at past the new one and silently switch
  // pushes back to the old organisation.
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM xero_tokens WHERE tenant_id != ?').bind(tenant.tenantId),
    c.env.DB.prepare(
      `INSERT INTO xero_tokens (tenant_id, tenant_name, access_token, refresh_token, expires_at, scopes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id) DO UPDATE SET
         tenant_name = excluded.tenant_name,
         access_token = excluded.access_token,
         refresh_token = excluded.refresh_token,
         expires_at = excluded.expires_at,
         updated_at = excluded.updated_at`
    ).bind(tenant.tenantId, tenant.tenantName, encAccess, encRefresh, expires_at, XERO_SCOPES, now),
  ]);

  c.header(
    'Set-Cookie',
    `${OAUTH_STATE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/xero; Max-Age=0`
  );
  return c.redirect(c.env.APP_BASE_URL ?? '/');
});

// Pushes/contact-create/project-docs use requireSession (browser-only) — they
// mutate Driven's Xero books or expose invoice totals, and the agent paths
// go through the MCP `push_to_xero` tool (which calls pushToXero directly),
// not this REST route. /sync and /invoices/pull stay on requireAuth because
// the MCP agent legitimately uses them to refresh contacts and reverse-
// engineer prior quotes.
app.post('/push', requireSession, async (c) => {
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
// Browser-session only: the agent uses the existing customer-sync path.
const findOrCreateContactZ = z.object({
  name: z.string().min(1),
  email: z.string().optional(),
  phone: z.string().optional(),
});
app.post('/contacts/find-or-create', requireSession, async (c) => {
  const input = findOrCreateContactZ.parse(await c.req.json());
  return c.json(await findOrCreateXeroContact(c.env, input));
});

// List the Xero docs already pushed for a project, with live status.
const projectDocsZ = z.object({ project_id: z.string().min(1) });
app.post('/project-docs', requireSession, async (c) => {
  const input = projectDocsZ.parse(await c.req.json());
  return c.json(await listProjectXeroDocs(c.env, input));
});

export default app;
