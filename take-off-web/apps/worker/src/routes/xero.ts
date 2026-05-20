import { Hono } from 'hono';
import type { Env } from '../env';
import { tools } from '@takeoff/shared';
import { pushToXero, syncXeroContacts } from '../tools/xero';

const app = new Hono<{ Bindings: Env }>();

const XERO_SCOPES = 'accounting.transactions accounting.contacts offline_access';

app.get('/oauth/start', (c) => {
  if (!c.env.XERO_CLIENT_ID || !c.env.XERO_REDIRECT_URI) {
    return c.json({ error: 'Xero is not configured' }, 500);
  }
  const state = crypto.randomUUID();
  const url = new URL('https://login.xero.com/identity/connect/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', c.env.XERO_CLIENT_ID);
  url.searchParams.set('redirect_uri', c.env.XERO_REDIRECT_URI);
  url.searchParams.set('scope', XERO_SCOPES);
  url.searchParams.set('state', state);
  return c.redirect(url.toString());
});

app.get('/oauth/callback', async (c) => {
  if (!c.env.XERO_CLIENT_ID || !c.env.XERO_CLIENT_SECRET || !c.env.XERO_REDIRECT_URI) {
    return c.json({ error: 'Xero is not configured' }, 500);
  }
  const code = c.req.query('code');
  if (!code) return c.json({ error: 'missing code' }, 400);

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
    return c.json({ error: 'token exchange failed', detail: await tokenRes.text() }, 500);
  }
  const token = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  const connRes = await fetch('https://api.xero.com/connections', {
    headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' },
  });
  const conns = (await connRes.json()) as Array<{ tenantId: string; tenantName: string }>;
  const tenant = conns[0];
  if (!tenant) return c.json({ error: 'no Xero tenants connected' }, 400);

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
      token.access_token,
      token.refresh_token,
      expires_at,
      XERO_SCOPES,
      Date.now()
    )
    .run();

  return c.redirect(c.env.APP_BASE_URL ?? '/');
});

app.post('/push', async (c) => {
  const body = await c.req.json();
  const input = tools.push_to_xero.input.parse(body);
  return c.json(await pushToXero(c.env, input));
});

app.post('/sync', async (c) => {
  return c.json(await syncXeroContacts(c.env));
});

export default app;
