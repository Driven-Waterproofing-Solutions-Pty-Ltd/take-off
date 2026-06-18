import type { Env } from '../env';
import { buildQuote } from './memory';
import { encryptString, decryptString } from '../lib/crypto';

interface XeroTokenRow {
  tenant_id: string;
  tenant_name: string | null;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scopes: string;
  updated_at: number;
}

interface DecryptedXeroToken extends Omit<XeroTokenRow, 'access_token' | 'refresh_token'> {
  access_token: string; // plaintext (in-memory only)
  refresh_token: string; // plaintext (in-memory only)
}

function requireTokenKey(env: Env): string {
  if (!env.XERO_TOKEN_KEY) throw new Error('XERO_TOKEN_KEY secret not set');
  return env.XERO_TOKEN_KEY;
}

async function getActiveXeroToken(env: Env): Promise<DecryptedXeroToken> {
  const row = (await env.DB.prepare(
    'SELECT * FROM xero_tokens ORDER BY updated_at DESC LIMIT 1'
  ).first()) as XeroTokenRow | null;
  if (!row) throw new Error('Xero is not connected. Visit /xero/oauth/start to connect.');

  const key = requireTokenKey(env);
  const decrypted: DecryptedXeroToken = {
    ...row,
    access_token: await decryptString(key, row.access_token),
    refresh_token: await decryptString(key, row.refresh_token),
  };

  if (row.expires_at <= Date.now() + 60_000) {
    return await refreshXeroToken(env, decrypted);
  }
  return decrypted;
}

async function refreshXeroToken(
  env: Env,
  current: DecryptedXeroToken
): Promise<DecryptedXeroToken> {
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
      refresh_token: current.refresh_token,
    }),
  });
  if (!res.ok) throw new Error(`Xero refresh failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  const expires_at = Date.now() + body.expires_in * 1000;
  const key = requireTokenKey(env);
  const encAccess = await encryptString(key, body.access_token);
  const encRefresh = await encryptString(key, body.refresh_token);
  await env.DB.prepare(
    `UPDATE xero_tokens SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = ?
     WHERE tenant_id = ?`
  )
    .bind(encAccess, encRefresh, expires_at, Date.now(), current.tenant_id)
    .run();
  return {
    ...current,
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_at,
  };
}

const XERO_API = 'https://api.xero.com/api.xro/2.0';
const ORG_CONFIG_TTL_MS = 7 * 86_400_000;
const DEFAULT_TAX_TYPE = 'OUTPUT';
const DEFAULT_ACCOUNT_CODE = '200';

function xeroHeaders(
  token: DecryptedXeroToken,
  extra?: Record<string, string>
): Record<string, string> {
  return {
    Authorization: `Bearer ${token.access_token}`,
    'xero-tenant-id': token.tenant_id,
    Accept: 'application/json',
    ...extra,
  };
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Xero's filter strings are wrapped in double quotes; a literal quote or
// backslash in a customer name would otherwise break the where clause.
function escapeXeroString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

interface XeroTaxRate {
  Name?: string;
  TaxType?: string;
  Status?: string;
  CanApplyToRevenue?: boolean;
}

// Pick the tax code to stamp on ACCREC lines for 10% GST on income. Priority:
// an explicit "GST on Income" name, then OUTPUT2 (current AU code), then the
// legacy OUTPUT — all restricted to ACTIVE, revenue-applicable rates. Returns
// null if nothing qualifies so the caller can fall back without caching it.
function pickGstOnIncome(rates: XeroTaxRate[]): XeroTaxRate | null {
  const candidates = rates.filter(
    (r) => (r.Status ?? 'ACTIVE') === 'ACTIVE' && r.CanApplyToRevenue !== false && !!r.TaxType
  );
  return (
    candidates.find((r) => /gst on income/i.test(r.Name ?? '')) ??
    candidates.find((r) => r.TaxType === 'OUTPUT2') ??
    candidates.find((r) => r.TaxType === 'OUTPUT') ??
    null
  );
}

interface OrgConfig {
  taxType: string;
  accountCode: string;
}

// Resolve the GST tax code + sales account for the active tenant, caching the
// tax code in xero_org_config. Replaces the old hardcoded TaxType:'OUTPUT' /
// AccountCode:'200' — see migration 0006. On any lookup failure we fall back
// to the legacy defaults (and do NOT cache) so pushing never hard-breaks on a
// transient TaxRates error, but a healthy org self-corrects to OUTPUT2.
async function resolveOrgConfig(env: Env, token: DecryptedXeroToken): Promise<OrgConfig> {
  // Read the cache defensively: if migration 0006 hasn't been applied yet
  // (Workers Builds deploys but doesn't auto-run migrations), a missing table
  // must not break pushing — we just fall through to the live lookup.
  type OrgConfigRow = {
    gst_output_tax_type: string | null;
    sales_account_code: string | null;
    resolved_at: number | null;
  };
  let row: OrgConfigRow | null = null;
  try {
    row = (await env.DB.prepare(
      'SELECT gst_output_tax_type, sales_account_code, resolved_at FROM xero_org_config WHERE tenant_id = ?'
    )
      .bind(token.tenant_id)
      .first()) as OrgConfigRow | null;
  } catch (err) {
    console.warn('xero_org_config read failed (migration not applied?)', err);
  }

  const accountCode = row?.sales_account_code ?? DEFAULT_ACCOUNT_CODE;

  if (row?.gst_output_tax_type && row.resolved_at && Date.now() - row.resolved_at < ORG_CONFIG_TTL_MS) {
    return { taxType: row.gst_output_tax_type, accountCode };
  }

  try {
    const res = await fetch(`${XERO_API}/TaxRates`, { headers: xeroHeaders(token) });
    if (res.ok) {
      const json = (await res.json()) as { TaxRates?: XeroTaxRate[] };
      const rate = pickGstOnIncome(json.TaxRates ?? []);
      if (rate?.TaxType) {
        // Best-effort cache write — never let a cache failure break the push.
        try {
          await env.DB.prepare(
            `INSERT INTO xero_org_config (tenant_id, gst_output_tax_type, sales_account_code, resolved_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(tenant_id) DO UPDATE SET
               gst_output_tax_type = excluded.gst_output_tax_type,
               resolved_at = excluded.resolved_at`
          )
            .bind(token.tenant_id, rate.TaxType, row?.sales_account_code ?? null, Date.now())
            .run();
        } catch (err) {
          console.warn('xero_org_config write failed (migration not applied?)', err);
        }
        return { taxType: rate.TaxType, accountCode };
      }
      console.warn('Xero TaxRates returned no usable GST-on-income rate; using', DEFAULT_TAX_TYPE);
    } else {
      console.warn('Xero TaxRates fetch failed', res.status, '- using', DEFAULT_TAX_TYPE);
    }
  } catch (err) {
    console.warn('Xero TaxRates lookup error', err, '- using', DEFAULT_TAX_TYPE);
  }

  return { taxType: row?.gst_output_tax_type ?? DEFAULT_TAX_TYPE, accountCode };
}

async function defaultReference(env: Env, projectId: string): Promise<string | undefined> {
  const row = (await env.DB.prepare('SELECT name FROM projects WHERE id = ?')
    .bind(projectId)
    .first()) as { name: string } | null;
  return row?.name ? `Take-off: ${row.name}` : undefined;
}

// Find an existing Xero contact by name (then email), creating one if neither
// matches. Persists the resolved ContactID into `customers` so future pushes
// and the customer picker use it directly instead of waiting for the nightly
// sync. Lets a brand-new customer be invoiced without a manual Xero round-trip.
export async function findOrCreateXeroContact(
  env: Env,
  args: { name: string; email?: string; phone?: string }
): Promise<{ contact_id: string; name: string; created: boolean }> {
  const name = args.name?.trim();
  if (!name) throw new Error('Customer name is required');
  const token = await getActiveXeroToken(env);

  const tryMatch = async (where: string): Promise<{ ContactID: string; Name: string } | null> => {
    const res = await fetch(`${XERO_API}/Contacts?where=${encodeURIComponent(where)}`, {
      headers: xeroHeaders(token),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { Contacts?: Array<{ ContactID: string; Name: string }> };
    return json.Contacts?.[0] ?? null;
  };

  let match = await tryMatch(`Name=="${escapeXeroString(name)}"`);
  if (!match && args.email?.trim()) {
    match = await tryMatch(
      `EmailAddress!=null&&EmailAddress=="${escapeXeroString(args.email.trim())}"`
    );
  }

  let contactId: string;
  let created = false;
  if (match) {
    contactId = match.ContactID;
  } else {
    const body = {
      Contacts: [
        {
          Name: name,
          ...(args.email?.trim() ? { EmailAddress: args.email.trim() } : {}),
          ...(args.phone?.trim()
            ? { Phones: [{ PhoneType: 'DEFAULT', PhoneNumber: args.phone.trim() }] }
            : {}),
        },
      ],
    };
    const res = await fetch(`${XERO_API}/Contacts`, {
      method: 'POST',
      headers: xeroHeaders(token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Xero Contact create failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { Contacts: Array<{ ContactID: string; Name: string }> };
    contactId = json.Contacts[0].ContactID;
    created = true;
  }

  await env.DB.prepare(
    `INSERT INTO customers (id, xero_contact_id, xero_tenant_id, name, email, phone, last_synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(xero_contact_id) DO UPDATE SET
       xero_tenant_id = excluded.xero_tenant_id,
       name = excluded.name,
       email = COALESCE(excluded.email, customers.email),
       phone = COALESCE(excluded.phone, customers.phone),
       last_synced_at = excluded.last_synced_at`
  )
    .bind(
      crypto.randomUUID(),
      contactId,
      token.tenant_id,
      match?.Name ?? name,
      args.email?.trim() ?? null,
      args.phone?.trim() ?? null,
      Date.now()
    )
    .run();

  return { contact_id: contactId, name: match?.Name ?? name, created };
}

// List the Xero documents already pushed for a project, with live invoice
// status pulled from Xero. Also repairs the previously-dead past_quotes.accepted
// flag so the UI can show which drafts the user has since approved in Xero.
export async function listProjectXeroDocs(
  env: Env,
  args: { project_id: string }
): Promise<{
  docs: Array<{
    id: string;
    kind: string;
    xero_id: string;
    total: number;
    created_at: number;
    status: string | null;
    deep_link: string;
  }>;
}> {
  const rows = ((
    await env.DB.prepare(
      `SELECT id, kind, xero_id, total, created_at FROM past_quotes
       WHERE project_id = ? AND xero_id IS NOT NULL
       ORDER BY created_at DESC LIMIT 20`
    )
      .bind(args.project_id)
      .all()
  ).results ?? []) as Array<{
    id: string;
    kind: string;
    xero_id: string;
    total: number;
    created_at: number;
  }>;

  const docs = [] as Array<{
    id: string;
    kind: string;
    xero_id: string;
    total: number;
    created_at: number;
    status: string | null;
    deep_link: string;
  }>;
  for (const r of rows) {
    let status: string | null = null;
    let deepLink =
      r.kind === 'QUOTE'
        ? `https://go.xero.com/app/quotes/edit/${r.xero_id}`
        : `https://go.xero.com/AccountsReceivable/Edit.aspx?InvoiceID=${r.xero_id}`;
    if (r.kind === 'INVOICE') {
      try {
        const inv = await pullXeroInvoice(env, { invoice_id: r.xero_id });
        status = inv.status;
        deepLink = inv.deep_link;
        const accepted = ['AUTHORISED', 'PAID', 'SUBMITTED'].includes(inv.status.toUpperCase())
          ? 1
          : 0;
        await env.DB.prepare('UPDATE past_quotes SET accepted = ? WHERE id = ?')
          .bind(accepted, r.id)
          .run();
      } catch {
        // Invoice deleted/voided in Xero, or a transient fetch error.
        status = 'UNKNOWN';
      }
    }
    docs.push({
      id: r.id,
      kind: r.kind,
      xero_id: r.xero_id,
      total: r.total,
      created_at: r.created_at,
      status,
      deep_link: deepLink,
    });
  }
  return { docs };
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
  const orgConfig = await resolveOrgConfig(env, token);
  const reference = args.reference ?? (await defaultReference(env, args.project_id));

  const lineItems = quote.lines.map((l) => ({
    Description: l.description,
    Quantity: l.qty,
    UnitAmount: l.unitPrice,
    AccountCode: orgConfig.accountCode,
    TaxType: orgConfig.taxType,
  }));

  // Deterministic per project + payload: a retry of the same logical push
  // (e.g. after a dropped response) replays Xero's stored result instead of
  // creating a duplicate draft; a genuinely changed quote gets a fresh key.
  const idempotencyKey = `takeoff-${args.kind.toLowerCase()}-${args.project_id}-${(
    await sha256Hex(
      JSON.stringify({
        kind: args.kind,
        contact: args.customer_xero_id,
        lines: lineItems,
        total: quote.total,
      })
    )
  ).slice(0, 24)}`;

  // Refuse to push to a ContactID that belongs to a different Xero tenant
  // than the one the OAuth token is currently bound to — otherwise a stale
  // recall (after an admin reconnected to a new tenant) would silently
  // bounce off the Xero API or, worse, hit a coincidentally-shaped ID.
  const contactRow = (await env.DB.prepare(
    'SELECT xero_tenant_id FROM customers WHERE xero_contact_id = ?'
  )
    .bind(args.customer_xero_id)
    .first()) as { xero_tenant_id: string | null } | null;
  if (contactRow?.xero_tenant_id && contactRow.xero_tenant_id !== token.tenant_id) {
    throw new Error(
      'Xero contact belongs to a different tenant than the active connection — re-sync contacts before pushing.'
    );
  }

  if (args.kind === 'QUOTE') {
    const body = {
      Quotes: [
        {
          Contact: { ContactID: args.customer_xero_id },
          Date: new Date().toISOString().split('T')[0],
          LineItems: lineItems,
          Status: 'DRAFT' as const,
          Reference: reference,
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
        'Idempotency-Key': idempotencyKey,
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
          Reference: reference,
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
        'Idempotency-Key': idempotencyKey,
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

export async function syncXeroContacts(env: Env): Promise<{ synced: number; tenant_id: string }> {
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
    // Stamp xero_tenant_id on every synced row so a future tenant switch
    // doesn't leave stale ContactIDs in `customers` that would push to the
    // wrong tenant via /xero/push. recallCustomer / pushToXero filter by
    // the currently-active token's tenant.
    await env.DB.prepare(
      `INSERT INTO customers (id, xero_contact_id, xero_tenant_id, name, email, phone, last_synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(xero_contact_id) DO UPDATE SET
         xero_tenant_id = excluded.xero_tenant_id,
         name = excluded.name,
         email = excluded.email,
         phone = excluded.phone,
         last_synced_at = excluded.last_synced_at`
    )
      .bind(
        id,
        c.ContactID,
        token.tenant_id,
        c.Name,
        c.EmailAddress ?? null,
        c.Phones?.find((p) => p.PhoneNumber)?.PhoneNumber ?? null,
        now
      )
      .run();
    synced++;
  }
  return { synced, tenant_id: token.tenant_id };
}

// Pull a single Xero invoice (or quote) with its full line items so the agent
// (and the memory layer) can reverse-engineer real assemblies / unit pricing
// from past work. Read-only — uses accounting.invoices.read /
// accounting.transactions.read scopes already on the existing OAuth token.
//
// Accepts EITHER a Xero invoice UUID (InvoiceID) OR a human invoice number
// (e.g. "INV-1814"). One must be set.
export async function pullXeroInvoice(
  env: Env,
  args: { invoice_id?: string; invoice_number?: string }
): Promise<{
  invoice_id: string;
  invoice_number: string;
  status: string;
  contact_name: string | null;
  contact_xero_id: string | null;
  date: string | null;
  due_date: string | null;
  total: number;
  subtotal: number;
  total_tax: number;
  currency: string;
  reference: string | null;
  line_items: Array<{
    description: string | null;
    quantity: number | null;
    unit_amount: number | null;
    line_amount: number | null;
    account_code: string | null;
    tax_type: string | null;
    item_code: string | null;
    tracking: Array<{ name: string; option: string }>;
  }>;
  deep_link: string;
}> {
  if (!args.invoice_id && !args.invoice_number) {
    throw new Error('invoice_id or invoice_number required');
  }
  const token = await getActiveXeroToken(env);
  const url = args.invoice_id
    ? `https://api.xero.com/api.xro/2.0/Invoices/${encodeURIComponent(args.invoice_id)}`
    : `https://api.xero.com/api.xro/2.0/Invoices?InvoiceNumbers=${encodeURIComponent(args.invoice_number!)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      'xero-tenant-id': token.tenant_id,
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Xero Invoice fetch failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as {
    Invoices: Array<{
      InvoiceID: string;
      InvoiceNumber: string;
      Status: string;
      Type: string;
      Contact?: { ContactID?: string; Name?: string };
      DateString?: string;
      DueDateString?: string;
      Total?: number;
      SubTotal?: number;
      TotalTax?: number;
      CurrencyCode?: string;
      Reference?: string;
      LineItems?: Array<{
        Description?: string;
        Quantity?: number;
        UnitAmount?: number;
        LineAmount?: number;
        AccountCode?: string;
        TaxType?: string;
        ItemCode?: string;
        Tracking?: Array<{ Name?: string; Option?: string }>;
      }>;
    }>;
  };
  const inv = json.Invoices?.[0];
  if (!inv) throw new Error('Invoice not found');
  return {
    invoice_id: inv.InvoiceID,
    invoice_number: inv.InvoiceNumber,
    status: inv.Status,
    contact_name: inv.Contact?.Name ?? null,
    contact_xero_id: inv.Contact?.ContactID ?? null,
    date: inv.DateString?.split('T')[0] ?? null,
    due_date: inv.DueDateString?.split('T')[0] ?? null,
    total: inv.Total ?? 0,
    subtotal: inv.SubTotal ?? 0,
    total_tax: inv.TotalTax ?? 0,
    currency: inv.CurrencyCode ?? 'AUD',
    reference: inv.Reference ?? null,
    line_items: (inv.LineItems ?? []).map((l) => ({
      description: l.Description ?? null,
      quantity: l.Quantity ?? null,
      unit_amount: l.UnitAmount ?? null,
      line_amount: l.LineAmount ?? null,
      account_code: l.AccountCode ?? null,
      tax_type: l.TaxType ?? null,
      item_code: l.ItemCode ?? null,
      tracking: (l.Tracking ?? []).flatMap((t) =>
        t.Name && t.Option ? [{ name: t.Name, option: t.Option }] : []
      ),
    })),
    deep_link: `https://go.xero.com/AccountsReceivable/Edit.aspx?InvoiceID=${inv.InvoiceID}`,
  };
}
