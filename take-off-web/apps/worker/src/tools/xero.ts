import type { Env } from '../env';
import { buildQuote } from './memory';
import { encryptString, decryptString, sha256Hex } from '../lib/crypto';

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

// Default Sales account in Xero's standard AU chart of accounts. The account
// itself carries a default tax rate (set by Driven's accountant on the
// account — typically "GST on Income" 10%), and we deliberately do NOT set
// TaxType on LineItems so Xero applies that account-level default. This
// replaces an earlier attempt that hardcoded TaxType:'OUTPUT', which silently
// mis-recorded GST on modern AU orgs whose code is OUTPUT2 — the account's
// configured rate is the authoritative source of truth.
const SALES_ACCOUNT_CODE = '200';

// `extra` first, well-known headers last: a caller cannot accidentally
// override Authorization / xero-tenant-id / Accept via the extra map.
function xeroHeaders(
  token: DecryptedXeroToken,
  extra?: Record<string, string>
): Record<string, string> {
  return {
    ...extra,
    Authorization: `Bearer ${token.access_token}`,
    'xero-tenant-id': token.tenant_id,
    Accept: 'application/json',
  };
}

// Xero's filter strings are wrapped in double quotes; a literal quote or
// backslash in a customer name would otherwise break the where clause.
function escapeXeroString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Format `at` as YYYY-MM-DD in Australia/Sydney (handles AEST/AEDT switch).
// Xero treats invoice Date / DueDate as local org dates; using the UTC date
// for an evening AU push would book the invoice a day early.
function auDateString(at: number = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at));
}

// Single source of truth for "open this Xero doc in Xero". QUOTE uses the
// modern /app SPA route; INVOICE keeps the documented legacy
// AccountsReceivable URL (the only form known to resolve every ACCREC UUID).
function xeroDeepLink(kind: 'QUOTE' | 'INVOICE', xeroId: string): string {
  return kind === 'QUOTE'
    ? `https://go.xero.com/app/quotes/view/${xeroId}`
    : `https://go.xero.com/AccountsReceivable/Edit.aspx?InvoiceID=${xeroId}`;
}

// Deterministic key for Xero's Idempotency-Key header. A replay of the exact
// same logical push (e.g. after a dropped response) hits Xero's stored result
// instead of creating a duplicate draft. We hash only fields that survive a
// retry intact:
//   * LOGICAL line shape — description + qty + unitPrice, rounded so FP drift
//     in buildQuote can't mint a new key for the same logical quote
//   * sorted by description so re-ordering doesn't change the hash
//   * explicit reference (so a "send, edit Reference, retry" submits a fresh
//     key — the earlier behaviour silently replayed the stale Reference)
// We deliberately exclude server-resolved fields (tax type, account code,
// date) so a transient resolution blip between attempts can't break retry
// safety. Comfortably under Xero's 128-char limit.
async function buildIdempotencyKey(args: {
  kind: 'QUOTE' | 'INVOICE';
  project_id: string;
  customer_xero_id: string;
  reference: string | undefined;
  lines: Array<{ description: string; qty: number; unitPrice: number }>;
  total: number;
}): Promise<string> {
  const stableShape = {
    kind: args.kind,
    contact: args.customer_xero_id,
    reference: args.reference ?? '',
    total_cents: Math.round(args.total * 100),
    lines: args.lines
      .map((l) => ({
        d: l.description,
        q: Math.round(l.qty * 1000),
        p_cents: Math.round(l.unitPrice * 100),
      }))
      .sort((a, b) => a.d.localeCompare(b.d) || a.q - b.q),
  };
  const digest = (await sha256Hex(JSON.stringify(stableShape))).slice(0, 24);
  return `takeoff-${args.kind.toLowerCase()}-${args.project_id}-${digest}`;
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
//
// Anti-footgun details, each motivated by a code-review finding on the
// pre-fix implementation:
//   * Email-fallback `where` uses Xero's documented `AND` operator (with
//     spaces). The earlier `&&` form was silently ignored: Xero returned the
//     first contact in the org and we'd link the local row to whoever that
//     happened to be.
//   * `tryMatch` re-throws on non-2xx — a transient 429/5xx is NOT a "no
//     match", so we don't cascade into a duplicate-contact CREATE.
//   * POST /Contacts carries an Idempotency-Key derived from the normalised
//     (name, email). A double-click / two-tab race replays Xero's stored
//     contact instead of creating two with the same Name.
//   * Before INSERTing locally, attach to an existing unlinked row matching
//     the name (case-insensitive) rather than creating a parallel
//     `customers` row that splits history across two ids.
//   * On a Xero match we persist the CANONICAL Name returned by Xero; we
//     never clobber an existing local name with the user's just-typed string.
export async function findOrCreateXeroContact(
  env: Env,
  args: { name: string; email?: string; phone?: string }
): Promise<{ contact_id: string; name: string; created: boolean }> {
  const name = args.name?.trim();
  if (!name) throw new Error('Customer name is required');
  const email = args.email?.trim() || undefined;
  const phone = args.phone?.trim() || undefined;
  const token = await getActiveXeroToken(env);

  const tryMatch = async (where: string): Promise<{ ContactID: string; Name: string } | null> => {
    const res = await fetch(`${XERO_API}/Contacts?where=${encodeURIComponent(where)}`, {
      headers: xeroHeaders(token),
    });
    if (!res.ok) {
      // Re-throw rather than silently treating an upstream error as "no match"
      // — otherwise a transient 429/5xx cascades into a duplicate CREATE.
      throw new Error(`Xero Contacts lookup failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { Contacts?: Array<{ ContactID: string; Name: string }> };
    return json.Contacts?.[0] ?? null;
  };

  let match = await tryMatch(`Name=="${escapeXeroString(name)}"`);
  if (!match && email) {
    match = await tryMatch(`EmailAddress!=null AND EmailAddress=="${escapeXeroString(email)}"`);
  }

  let contactId: string;
  let canonicalName: string;
  let created = false;
  if (match) {
    contactId = match.ContactID;
    canonicalName = match.Name;
  } else {
    const body = {
      Contacts: [
        {
          Name: name,
          ...(email ? { EmailAddress: email } : {}),
          ...(phone ? { Phones: [{ PhoneType: 'DEFAULT', PhoneNumber: phone }] } : {}),
        },
      ],
    };
    // Keyed on the normalised (name, email) so a double-click / two-tab race
    // collapses to a single Xero contact. Different name+email = fresh key.
    const idempotencyKey = `takeoff-contact-${(
      await sha256Hex(name.toLowerCase() + '|' + (email ?? ''))
    ).slice(0, 32)}`;
    const res = await fetch(`${XERO_API}/Contacts`, {
      method: 'POST',
      headers: xeroHeaders(token, {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      }),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Xero Contact create failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { Contacts: Array<{ ContactID: string; Name: string }> };
    contactId = json.Contacts[0].ContactID;
    canonicalName = json.Contacts[0].Name;
    created = true;
  }

  // Local persistence: attach to an already-linked row (nightly sync) or to an
  // unlinked-by-name row (manually-added customer) before falling back to a
  // fresh INSERT. Preserves customers.id so past_quotes.customer_id history
  // doesn't fork across two parallel rows for the same human customer.
  const linkedRow = (await env.DB.prepare(
    'SELECT id FROM customers WHERE xero_contact_id = ?'
  )
    .bind(contactId)
    .first()) as { id: string } | null;

  if (linkedRow) {
    await env.DB.prepare(
      `UPDATE customers
       SET xero_tenant_id = ?,
           name = ?,
           email = COALESCE(?, email),
           phone = COALESCE(?, phone),
           last_synced_at = ?
       WHERE id = ?`
    )
      .bind(token.tenant_id, canonicalName, email ?? null, phone ?? null, Date.now(), linkedRow.id)
      .run();
  } else {
    const unlinkedRow = (await env.DB.prepare(
      'SELECT id FROM customers WHERE xero_contact_id IS NULL AND lower(name) = lower(?) LIMIT 1'
    )
      .bind(name)
      .first()) as { id: string } | null;

    if (unlinkedRow) {
      await env.DB.prepare(
        `UPDATE customers
         SET xero_contact_id = ?,
             xero_tenant_id = ?,
             email = COALESCE(?, email),
             phone = COALESCE(?, phone),
             last_synced_at = ?
         WHERE id = ?`
      )
        .bind(contactId, token.tenant_id, email ?? null, phone ?? null, Date.now(), unlinkedRow.id)
        .run();
    } else {
      await env.DB.prepare(
        `INSERT INTO customers (id, xero_contact_id, xero_tenant_id, name, email, phone, last_synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          crypto.randomUUID(),
          contactId,
          token.tenant_id,
          canonicalName,
          email ?? null,
          phone ?? null,
          Date.now()
        )
        .run();
    }
  }

  return { contact_id: contactId, name: canonicalName, created };
}

// List the Xero documents already pushed for a project, with live status
// pulled via a SINGLE bulk fetch per kind. Replaces an earlier per-row loop
// that issued up to ~60 subrequests per modal open (one token re-fetch and
// one /Invoices/{id} call per row, ×20 rows), which exceeded Cloudflare
// Workers' default 50-subrequest budget on any project with ~17+ pushes.
//
// Also corrects `past_quotes.accepted` from authoritative Xero state on each
// open: AUTHORISED/PAID for Invoices, ACCEPTED/INVOICED for Quotes. (SUBMITTED
// is Xero's internal "awaiting approval" stage, NOT customer-accepted — the
// earlier code conflated them.) Status-fetch failures leave the existing
// accepted flag untouched, so a transient Xero blip can't overwrite a known-
// good value.
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

  if (rows.length === 0) return { docs: [] };

  const invoiceIds = rows.filter((r) => r.kind === 'INVOICE').map((r) => r.xero_id);
  const quoteIds = rows.filter((r) => r.kind === 'QUOTE').map((r) => r.xero_id);

  // Fetch token once, then in parallel run at most ONE Invoices and ONE Quotes
  // bulk GET. Three subrequests worst case, regardless of row count.
  const token = await getActiveXeroToken(env);
  const statusByXeroId = new Map<string, string>();

  await Promise.all([
    (async () => {
      if (invoiceIds.length === 0) return;
      try {
        const url = `${XERO_API}/Invoices?IDs=${invoiceIds.join(',')}&summaryOnly=true`;
        const res = await fetch(url, { headers: xeroHeaders(token) });
        if (!res.ok) {
          console.warn('Xero bulk Invoices fetch failed', res.status);
          return;
        }
        const json = (await res.json()) as {
          Invoices?: Array<{ InvoiceID: string; Status: string }>;
        };
        for (const inv of json.Invoices ?? []) statusByXeroId.set(inv.InvoiceID, inv.Status);
      } catch (err) {
        console.warn('Xero bulk Invoices lookup error', err);
      }
    })(),
    (async () => {
      if (quoteIds.length === 0) return;
      try {
        const url = `${XERO_API}/Quotes?QuoteIDs=${quoteIds.join(',')}`;
        const res = await fetch(url, { headers: xeroHeaders(token) });
        if (!res.ok) {
          console.warn('Xero bulk Quotes fetch failed', res.status);
          return;
        }
        const json = (await res.json()) as {
          Quotes?: Array<{ QuoteID: string; Status: string }>;
        };
        for (const q of json.Quotes ?? []) statusByXeroId.set(q.QuoteID, q.Status);
      } catch (err) {
        console.warn('Xero bulk Quotes lookup error', err);
      }
    })(),
  ]);

  const docs: Array<{
    id: string;
    kind: string;
    xero_id: string;
    total: number;
    created_at: number;
    status: string | null;
    deep_link: string;
  }> = [];
  const updates: ReturnType<typeof env.DB.prepare>[] = [];

  for (const r of rows) {
    const status = statusByXeroId.get(r.xero_id) ?? null;
    docs.push({
      id: r.id,
      kind: r.kind,
      xero_id: r.xero_id,
      total: r.total,
      created_at: r.created_at,
      status,
      deep_link: xeroDeepLink(r.kind as 'QUOTE' | 'INVOICE', r.xero_id),
    });

    // Only sync `accepted` when Xero gave us ground truth; a missing status
    // (failed fetch / deleted in Xero) MUST leave the flag alone, otherwise a
    // transient blip overwrites a known-good value.
    if (!status) continue;
    const s = status.toUpperCase();
    const accepted =
      r.kind === 'INVOICE'
        ? s === 'AUTHORISED' || s === 'PAID'
          ? 1
          : 0
        : s === 'ACCEPTED' || s === 'INVOICED'
          ? 1
          : 0;
    // `accepted IS NOT ?` skips the write when the row already matches, so
    // 20 unchanged rows cost zero D1 writes.
    updates.push(
      env.DB.prepare('UPDATE past_quotes SET accepted = ? WHERE id = ? AND accepted IS NOT ?').bind(
        accepted,
        r.id,
        accepted
      )
    );
  }

  if (updates.length > 0) {
    try {
      await env.DB.batch(updates);
    } catch (err) {
      console.warn('past_quotes accepted batch update failed', err);
    }
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
  // Server-side default; the modal sends the user-edited reference verbatim
  // (including an explicit empty string), so this only fires for callers that
  // omitted the field entirely (e.g. the agent path).
  const reference = args.reference ?? (await defaultReference(env, args.project_id));

  // LineItems carry NO TaxType: Xero applies the AccountCode's configured
  // default tax rate (set on the Sales account by Driven's accountant), which
  // is the authoritative source of truth and avoids us guessing OUTPUT vs
  // OUTPUT2 — both the bug the original code had and the bug a regex-based
  // /TaxRates lookup would still risk.
  const lineItems = quote.lines.map((l) => ({
    Description: l.description,
    Quantity: l.qty,
    UnitAmount: l.unitPrice,
    AccountCode: SALES_ACCOUNT_CODE,
  }));

  const idempotencyKey = await buildIdempotencyKey({
    kind: args.kind,
    project_id: args.project_id,
    customer_xero_id: args.customer_xero_id,
    reference,
    lines: quote.lines.map((l) => ({
      description: l.description,
      qty: l.qty,
      unitPrice: l.unitPrice,
    })),
    total: quote.total,
  });

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

  const today = auDateString();
  const headers = xeroHeaders(token, {
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey,
  });

  if (args.kind === 'QUOTE') {
    const body = {
      Quotes: [
        {
          Contact: { ContactID: args.customer_xero_id },
          Date: today,
          LineItems: lineItems,
          Status: 'DRAFT' as const,
          Reference: reference,
        },
      ],
    };
    const res = await fetch(`${XERO_API}/Quotes`, {
      method: 'POST',
      headers,
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
    return { xero_id: xeroId, deep_link: xeroDeepLink('QUOTE', xeroId) };
  }

  const body = {
    Invoices: [
      {
        Type: 'ACCREC',
        Contact: { ContactID: args.customer_xero_id },
        Date: today,
        DueDate: auDateString(Date.now() + 14 * 86400_000),
        LineItems: lineItems,
        Status: 'DRAFT' as const,
        Reference: reference,
      },
    ],
  };
  const res = await fetch(`${XERO_API}/Invoices`, {
    method: 'POST',
    headers,
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
  return { xero_id: xeroId, deep_link: xeroDeepLink('INVOICE', xeroId) };
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
