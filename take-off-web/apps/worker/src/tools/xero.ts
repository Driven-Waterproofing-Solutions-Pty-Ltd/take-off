import type { Env } from '../env';
import { buildQuote } from './memory';

interface XeroTokenRow {
  tenant_id: string;
  tenant_name: string | null;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scopes: string;
  updated_at: number;
}

async function getActiveXeroToken(env: Env): Promise<XeroTokenRow> {
  const row = (await env.DB.prepare(
    'SELECT * FROM xero_tokens ORDER BY updated_at DESC LIMIT 1'
  ).first()) as XeroTokenRow | null;
  if (!row) throw new Error('Xero is not connected. Visit /xero/oauth/start to connect.');

  if (row.expires_at <= Date.now() + 60_000) {
    return await refreshXeroToken(env, row);
  }
  return row;
}

async function refreshXeroToken(env: Env, row: XeroTokenRow): Promise<XeroTokenRow> {
  if (!env.XERO_CLIENT_ID || !env.XERO_CLIENT_SECRET) {
    throw new Error('XERO_CLIENT_ID / XERO_CLIENT_SECRET secrets not set');
  }
  const basic = btoa(`${env.XERO_CLIENT_ID}:${env.XERO_CLIENT_SECRET}`);
  const res = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: row.refresh_token,
    }),
  });
  if (!res.ok) throw new Error(`Xero refresh failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  const expires_at = Date.now() + body.expires_in * 1000;
  await env.DB.prepare(
    `UPDATE xero_tokens SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = ?
     WHERE tenant_id = ?`
  )
    .bind(body.access_token, body.refresh_token, expires_at, Date.now(), row.tenant_id)
    .run();
  return { ...row, access_token: body.access_token, refresh_token: body.refresh_token, expires_at };
}

export async function pushToXero(
  env: Env,
  args: {
    project_id: string;
    kind: 'QUOTE' | 'INVOICE';
    customer_xero_id: string;
    reference?: string;
  }
): Promise<{ xero_id: string; deep_link: string }> {
  const token = await getActiveXeroToken(env);
  const quote = await buildQuote(env, args.project_id);

  const lineItems = quote.lines.map((l) => ({
    Description: l.description,
    Quantity: l.qty,
    UnitAmount: l.unitPrice,
    AccountCode: '200', // sales account; should be configurable per assembly
    TaxType: 'OUTPUT',
  }));

  if (args.kind === 'QUOTE') {
    const body = {
      Quotes: [
        {
          Contact: { ContactID: args.customer_xero_id },
          Date: new Date().toISOString().split('T')[0],
          LineItems: lineItems,
          Status: 'DRAFT' as const,
          Reference: args.reference,
        },
      ],
    };
    const res = await fetch('https://api.xero.com/api.xro/2.0/Quotes', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'xero-tenant-id': token.tenant_id,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Xero Quote create failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { Quotes: Array<{ QuoteID: string }> };
    const xeroId = json.Quotes[0].QuoteID;
    await env.DB.prepare(
      `INSERT INTO past_quotes (id, project_id, customer_id, kind, total, xero_id, snapshot_json, created_at)
       VALUES (?, ?, ?, 'QUOTE', ?, ?, ?, ?)`
    )
      .bind(
        crypto.randomUUID(),
        args.project_id,
        quote.customerId ?? null,
        quote.total,
        xeroId,
        JSON.stringify(quote),
        Date.now()
      )
      .run();
    return {
      xero_id: xeroId,
      deep_link: `https://go.xero.com/app/quotes/edit/${xeroId}`,
    };
  } else {
    const body = {
      Invoices: [
        {
          Type: 'ACCREC',
          Contact: { ContactID: args.customer_xero_id },
          Date: new Date().toISOString().split('T')[0],
          DueDate: new Date(Date.now() + 14 * 86400_000).toISOString().split('T')[0],
          LineItems: lineItems,
          Status: 'DRAFT' as const,
          Reference: args.reference,
        },
      ],
    };
    const res = await fetch('https://api.xero.com/api.xro/2.0/Invoices', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'xero-tenant-id': token.tenant_id,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Xero Invoice create failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { Invoices: Array<{ InvoiceID: string }> };
    const xeroId = json.Invoices[0].InvoiceID;
    await env.DB.prepare(
      `INSERT INTO past_quotes (id, project_id, customer_id, kind, total, xero_id, snapshot_json, created_at)
       VALUES (?, ?, ?, 'INVOICE', ?, ?, ?, ?)`
    )
      .bind(
        crypto.randomUUID(),
        args.project_id,
        quote.customerId ?? null,
        quote.total,
        xeroId,
        JSON.stringify(quote),
        Date.now()
      )
      .run();
    return {
      xero_id: xeroId,
      deep_link: `https://go.xero.com/AccountsReceivable/Edit.aspx?InvoiceID=${xeroId}`,
    };
  }
}

export async function syncXeroContacts(env: Env): Promise<{ synced: number }> {
  const token = await getActiveXeroToken(env);
  const res = await fetch('https://api.xero.com/api.xro/2.0/Contacts?summaryOnly=true', {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      'xero-tenant-id': token.tenant_id,
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Xero Contacts fetch failed: ${res.status}`);
  const json = (await res.json()) as {
    Contacts: Array<{
      ContactID: string;
      Name: string;
      EmailAddress?: string;
      Phones?: Array<{ PhoneNumber?: string }>;
    }>;
  };
  const now = Date.now();
  let synced = 0;
  for (const c of json.Contacts) {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO customers (id, xero_contact_id, name, email, phone, last_synced_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(xero_contact_id) DO UPDATE SET
         name = excluded.name,
         email = excluded.email,
         phone = excluded.phone,
         last_synced_at = excluded.last_synced_at`
    )
      .bind(
        id,
        c.ContactID,
        c.Name,
        c.EmailAddress ?? null,
        c.Phones?.find((p) => p.PhoneNumber)?.PhoneNumber ?? null,
        now
      )
      .run();
    synced++;
  }
  return { synced };
}
