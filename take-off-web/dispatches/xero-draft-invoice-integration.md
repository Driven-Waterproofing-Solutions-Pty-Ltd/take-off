# Xero draft-invoice integration — scope & plan

**Status:** Phase A + B BUILT, code-review fixes BUILT (15 findings actioned). Phase C (webhooks) deferred. Live smoke test pending user go-ahead.
**Audience:** Driven Waterproofing Solutions operator + future implementer.
**Mission in one sentence:** Polish the existing-but-buried Xero draft-invoice path so producing a priced quote in the take-off app and creating a reviewed draft invoice in Xero is a single, reliable, observable action — and do it correctly.

---

## ✅ Implementation status

The original Phase A+B work shipped, then an xhigh-effort code review surfaced
**15 ranked findings** (≈8 high-impact) plus a deep Xero-API research pass that
collapsed two whole bug-clusters into deletions. The fix PR is built and green;
the dispatch below reflects the **current state**.

**Worker — `apps/worker/src/tools/xero.ts`:**
- **Tax-code machinery deleted.** No `resolveOrgConfig`, no `/TaxRates` lookup,
  no `pickGstOnIncome` regex, no `xero_org_config` table. Line items now omit
  `TaxType`; Xero applies the rate configured on the `AccountCode` (Sales
  account — set by Driven's accountant). Authoritative source of truth,
  zero failure modes.
- **AU-local dates** (`auDateString`) — Invoice Date / DueDate computed in
  Australia/Sydney via `Intl.DateTimeFormat('en-CA', {timeZone})`. No more
  off-by-one when pushing at AU evening.
- **Stable idempotency key** (`buildIdempotencyKey`) — hashes only rounded
  logical fields (description + cents + qty), sorted, includes `reference`.
  An identical retry replays Xero's stored draft; a Reference edit mints a
  fresh key. Uses the shared `sha256Hex` from `lib/crypto`.
- **Bulk live status** (`listProjectXeroDocs`) — one
  `GET /Invoices?IDs=<csv>&summaryOnly=true` + one `GET /Quotes?QuoteIDs=<csv>`
  in parallel, replacing the prior N-iteration serial loop. Three subrequests
  worst case (was up to ~60, breaching CF Workers' 50-subrequest budget).
  Token fetched once. `accepted` flag corrected per row: AUTHORISED/PAID for
  Invoices, ACCEPTED/INVOICED for Quotes (SUBMITTED is Xero's internal
  awaiting-approval — never customer-accepted). Status-fetch failures leave
  the existing flag alone (no overwriting known-good with a transient blip).
- **`findOrCreateXeroContact` overhaul** — `AND` not `&&` in the email-fallback
  where-clause (Xero's documented operator; `&&` silently ignored the filter
  and returned the wrong contact); `tryMatch` throws on non-2xx (transient
  429/5xx no longer cascades into duplicate CREATE); `Idempotency-Key` on
  POST /Contacts (double-click race collapses to one contact); local row-claim
  logic (attach to an existing unlinked customer row rather than fork
  `customers.id` history); persists CANONICAL `match.Name` (no name clobber).
- **`xeroHeaders` spread order** — `extra` first, well-known headers last
  (caller can't accidentally override Authorization).
- **`xeroDeepLink(kind, id)` helper** — single source of truth for the deep
  link URLs (QUOTE → modern `/app/quotes/view/<id>`; INVOICE → documented
  legacy `AccountsReceivable/Edit.aspx`).

**Worker — `apps/worker/src/lib/auth.ts` + `routes/xero.ts`:**
- New `requireSession` middleware: any logged-in browser session passes;
  server-to-server MCP/API tokens get 403. Applied to `/xero/push`,
  `/xero/contacts/find-or-create`, `/xero/project-docs`. (The MCP `push_to_xero`
  tool calls `pushToXero()` directly via `mcp/server.ts`; the agent surface is
  unaffected. `/xero/sync` and `/xero/invoices/pull` stay on `requireAuth` —
  legitimately used by the agent.)

**Web — `apps/web/src/components/SendToXeroModal.tsx`:**
- Effect split: data-fetch keyed on `(open, projectId)`; reference-seed keyed
  on `(open, projectName)`. A project rename mid-flow no longer wipes typed
  state or re-fires the Xero call.
- Cancellation flag — stale promise resolutions can't overwrite fresh state.
- Honest errors — quote-fetch failure shows the real message (only the
  "price some items first" toast on a 404/empty-quote); docs-fetch failure
  surfaces a real message instead of silently rendering empty.
- Reference sent VERBATIM (including empty string) so a deliberately-cleared
  field is honoured.
- A11y — `aria-label` on each `Input`; `<label htmlFor>` on Reference.

Both packages typecheck clean; the production web build passes.

**⚠️ Before this deploys to prod:**
- **Live smoke test needs your OK.** No real invoice has been pushed to
  Driven's Xero org. When ready: create one $1 test draft, confirm Xero
  applied the Sales-account tax rate correctly (it should — that's Xero's
  configured default), confirm the Reference reads `Take-off: <project>`,
  then void it.
- **No new migrations** — the original `0006_xero_org_config.sql` was deleted
  (never applied to remote D1; the tax-resolution machinery it backed is
  gone). The remote schema is unchanged from the pre-Xero state.

**Phase C (webhooks) — deferred.** Bulk-fetch-on-open is already cheap
(3 subrequests) and surfaces fresh status. Webhooks become worthwhile when we
want push-driven status updates across all projects without a modal open.

## TL;DR

The take-off app **already creates Xero draft invoices**. The code is at
`take-off-web/apps/worker/src/tools/xero.ts:87-211`, the OAuth flow is wired
at `take-off-web/apps/worker/src/routes/xero.ts:45-146`, contacts sync
nightly via a cron job, and there's a working "Push DRAFT to Xero" button.

The reason it feels like the feature doesn't exist: that button is buried in
`AgentPanel.tsx` (the agent-review sidebar), not surfaced on the priced-quote
view (`EstimatesView.tsx`). A user finishing a quote in the natural flow
never sees the path.

This dispatch is **not "build from scratch."** It's:

1. Fix one latent bug (wrong AU GST tax code) — must-do
2. Add Idempotency-Key + contact find-or-create — small reliability wins
3. Surface the existing push as a prominent CTA on the priced-quote view
4. Add invoice-status visibility via webhooks
5. Tidy a few hardcoded values (account code, due date, branding theme)

Recommended phasing makes Phase A a 1-2 hour PR, Phase B half a day, Phase C
half a day. Total ~1-2 days of focused work.

## What's already built

| Concern | Where | Notes |
|---|---|---|
| Create draft ACCREC invoice | `apps/worker/src/tools/xero.ts:87-211` (`pushToXero`) | Supports `QUOTE` and `INVOICE`, status `DRAFT`, 14-day due date |
| OAuth2 user flow | `apps/worker/src/routes/xero.ts:45-146` | Auth code → access + refresh; tokens AES-GCM encrypted at rest (`XERO_TOKEN_KEY`) |
| Token refresh | `apps/worker/src/tools/xero.ts:44-85` | Auto-refreshes on expiry |
| Scopes granted | `apps/worker/src/routes/xero.ts:14` | `accounting.invoices accounting.contacts accounting.settings.read offline_access` |
| Contacts sync | `apps/worker/src/tools/xero.ts:213-262` (`syncXeroContacts`) + cron `0 16 * * *` UTC = 02:00 AEST | Upserts `customers` table, tenant-stamped |
| Tenant scoping | Migration `0004_customers_xero_tenant.sql` | `customers.xero_tenant_id` |
| Push tracking | `past_quotes` table | `xero_id`, `kind`, `deep_link`, `snapshot_json`, `accepted` (write-side unused) |
| Pull invoice (read-only) | `apps/worker/src/tools/xero.ts:271-369` (`pullXeroInvoice`) | By InvoiceID or InvoiceNumber |
| Frontend push UI | `apps/web/src/components/AgentPanel.tsx:111-118, 220-238` | "Push DRAFT to Xero" with contact picker + deep link to drafts |
| API client | `apps/web/src/lib/api.ts:331-377` | `pushQuote`, `pushInvoice`, `pullInvoice` |
| Hardcoded `AccountCode: '200'` | `apps/worker/src/tools/xero.ts:104` | Sales account |
| Hardcoded `TaxType: 'OUTPUT'` | `apps/worker/src/tools/xero.ts:104` | **This is the latent bug — see below** |
| Worker secrets | `apps/worker/wrangler.toml:40-47` | `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_REDIRECT_URI`, `XERO_TOKEN_KEY`, `APP_BASE_URL` |

The data model lines up well with what Xero expects:

- `QuoteDraft.lines` (`packages/shared/src/types.ts:185-202`) → maps cleanly to Xero `LineItems`
- `QuoteDraft.subtotal/gst/total` → Xero calculates this server-side from `Exclusive` line amounts; current in-app math (`subtotal * 0.1`) matches
- `customers.xero_contact_id` → already populated by nightly sync, used to pass `Contact: { ContactID }` instead of by-name

## What's missing or wrong

### 1. Latent bug: wrong AU GST tax code (P1)

`apps/worker/src/tools/xero.ts:104` uses `TaxType: 'OUTPUT'`. Per Xero's
docs (Tax Rates API + AU defaults), modern AU GST-registered orgs use
**`OUTPUT2`** ("GST on Income" 10%) — `OUTPUT` is the legacy code retained
only on long-standing orgs. Driven's behaviour today depends on which code
their org has active.

Safest fix: at push time, call `GET /TaxRates`, find the rate whose Name is
"GST on Income" (or whose effective rate is 10% and class is `OUTPUT`),
cache the resolved `TaxType` per tenant in a small KV/DB lookup, and use it.

Failure mode if not fixed on an org that has migrated to `OUTPUT2`:
invoice creation may reject the LineItem, or apply a stale tax rate that's
been deactivated. Silent revenue mis-recording is the worst case.

### 2. Surface gap — push button is hidden

`AgentPanel.tsx:200-260` has the working push UI. `EstimatesView.tsx`
(the priced-quote display) has no Xero CTA at all. A user who finishes a
quote and lands on `EstimatesView` sees:

- per-group subtotal
- expandable line breakdown
- Excel export button
- no Xero anything

They have to navigate back into the agent panel to push. That's the wrong
flow — the priced view is where "send" lives in every other quoting tool.

### 3. Hardcoded values that should be config

- **`AccountCode: '200'`** — fine as a default, but no override. If Driven
  wants to split revenue between e.g. waterproofing labour (`200`) and
  materials on-charge (`210`), this needs to be either per-line-type or
  configurable in app settings.
- **14-day due date** — hardcoded in `pushToXero`. Should respect Xero org
  default payment terms, or be per-project, or at minimum configurable.
- **No `BrandingThemeID`** — defaults to org default. Probably fine; flag
  for confirmation. If Driven has a "Waterproofing Quote" template, we'd
  want to specify it.
- **No `Reference`** — currently the invoice has no Reference field set.
  Should be the take-off project name or job number so it's findable in
  Xero. Likely a one-line fix.

### 4. No retry safety

`pushToXero` doesn't send an `Idempotency-Key` header. Xero supports it
(128-char client-generated key; replay returns the previously-stored
response with the same InvoiceID). Without it, a network drop between
"Xero committed the invoice" and "response landed at the Worker" causes
a retry to create a duplicate draft in Xero.

Easy fix: `Idempotency-Key: takeoff-quote-<projectId>-<quoteHash>` —
deterministic per project+payload, so the same logical push always
dedups.

Open question: Xero's exact dedup TTL isn't in the docs I could find.
Industry common is 24 h. Sufficient for our case; the user is doing a
single push, not nightly retries.

### 5. New customers can't be pushed

The push relies on `customer.xero_contact_id` being populated. That field
comes from the nightly contact sync. If a takeoff is created for a brand
new customer that hasn't been synced yet (or hasn't been added to Xero at
all), the push fails.

Needed: a "find or create contact" path. Pattern per Xero docs:
1. `GET /Contacts?where=Name=="<exact>"` — case-insensitive, returns array (empty if no match)
2. If no match, `GET /Contacts?where=EmailAddress!=null&&EmailAddress=="<email>"` — fallback
3. If still no match, `POST /Contacts` with `{ Name, EmailAddress, Phones, Addresses }`
4. Persist returned `ContactID` to `customers.xero_contact_id` and never look up by name again

This belongs as either an explicit "Create contact in Xero" step in the
push modal, or implicit behind a feature flag — Driven's call.

### 6. No invoice-status visibility

Once a draft is pushed, the take-off app has no idea what happens next.
Did the user approve it in Xero? Did the customer pay it? `past_quotes`
has an `accepted` column but it's never written.

Two options:
- **Pull on demand:** when the user re-opens the project, call `pullXeroInvoice` (already implemented) and show current status. Simple, slightly stale.
- **Push via webhooks:** subscribe to Xero's `INVOICE.UPDATE` webhook. Payload is thin (just resourceId), so we'd re-fetch the invoice on each event, persist `Status` + `AmountDue` + `AmountPaid` to `past_quotes`. Live updates, more moving parts.

Recommendation: do **pull on demand** in Phase B (no infra change), add
**webhooks** as Phase C only if Driven wants the project list to show
paid/unpaid badges proactively.

### 7. Dead `past_quotes.accepted` column

Currently never written. Either wire it up (set true when invoice
transitions DRAFT → AUTHORISED, via Phase B pull or Phase C webhook) or
drop it from the schema. Don't leave a documented field that lies.

## Recommended phasing

### Phase A — bug fix + reliability (~2 hours, single PR)

**Scope:**
- Replace hardcoded `TaxType: 'OUTPUT'` with per-tenant lookup. Add a small
  `xero_tax_codes` cache table (or KV entry per tenant), populated on
  first push by `GET /TaxRates`, refreshed on 400 errors.
- Add `Idempotency-Key` header on `POST /Invoices` and `POST /Quotes`.
  Key formula: `takeoff-${kind}-${projectId}-${sha256(stableQuoteJson).slice(0,16)}`
- Add `Reference` field to outbound invoice payload — use project name +
  short id.
- Smoke test on Driven's actual Xero org with a known-tiny test quote.

**Files touched (~80 LOC):**
- `apps/worker/src/tools/xero.ts` — `pushToXero` body
- `apps/worker/migrations/000X_xero_tax_codes.sql` — new cache table (or skip; KV)
- `apps/worker/src/env.ts` — no change
- No frontend change

**Why first:** invisible from the UI; pure correctness/reliability win;
unblocks safe retries in later phases.

### Phase B — surface the existing push (~half day, single PR)

**Scope:**
- Add prominent "Send to Xero as Draft Invoice" button on `EstimatesView`
  at the top of the priced view, grouped with the Excel export.
- Click → opens new `SendQuoteToXeroModal` (mostly a refactor of the
  existing AgentPanel UI).
  - Resolved customer → Xero contact: show "Linked to <Name> in Xero" or
    "No matching Xero contact — [Create] / [Pick existing]"
  - Editable fields: Reference (default: project name), Due date (default:
    today + 14d, or org default), Account code (default: 200, dropdown of
    fetched `GET /Accounts` so user picks Sales-class accounts only).
- On success: show "Draft INV-1234 created" + deep link, persist
  `xero_id` to `past_quotes` (already happens).
- Project header gets a small "Linked Xero drafts: [INV-1234 (DRAFT)]"
  chip. Click chip → opens Xero in new tab.
- On project load, if a `past_quotes.xero_id` exists, call `pullXeroInvoice`
  in background, update chip with current status (DRAFT / AUTHORISED /
  PAID / VOIDED). Write `accepted = true` on `past_quotes` when status
  reaches AUTHORISED or beyond.

**Files touched (~250-300 LOC):**
- `apps/web/src/components/EstimatesView.tsx` — CTA button
- `apps/web/src/components/SendQuoteToXeroModal.tsx` — new
- `apps/web/src/components/ProjectHeader.tsx` (or equivalent) — status chip
- `apps/web/src/lib/api.ts` — `findOrCreateContact`, `getAccounts` API client methods
- `apps/worker/src/routes/xero.ts` — new `POST /xero/contacts/find-or-create`, `GET /xero/accounts`
- `apps/worker/src/tools/xero.ts` — `findOrCreateXeroContact`, `listSalesAccounts` helpers
- `apps/web/src/components/AgentPanel.tsx` — leave existing button as-is for the agent flow, or refactor to share the new modal

**Decisions needed from you before this lands:** see "Decisions for you" below.

### Phase C — invoice-status visibility via webhooks (~half day, optional)

**Scope:**
- New endpoint `POST /xero/webhooks/invoice` on the Worker, public, no auth.
- HMAC verification: compute `base64(HMAC-SHA256(rawBody, XERO_WEBHOOK_KEY))`,
  compare to `x-xero-signature`, return 401 on mismatch, **200 within 5s**.
- On valid `INVOICE.UPDATE` event, look up `past_quotes` by `xero_id` =
  event `resourceId`. If we own it, enqueue a re-fetch via Workers Queues
  (or just synchronously call `pullXeroInvoice` if we're fast enough),
  persist new status + amounts to `past_quotes`.
- Configure the webhook URL in Xero developer portal once. Click "Send
  Intent to receive" — endpoint must echo back a 200 on the empty challenge.
- Add `XERO_WEBHOOK_KEY` to Worker secrets.

**Open uncertainty:** Custom Connection compatibility. The take-off app uses
user OAuth, not a Custom Connection, so webhooks should work the standard
way (events fire app-wide for all connected tenants). Confirmed by the
official Xero docs and devblog.

**Why optional:** Phase B's "pull on load" gets you 90% of the value with
zero new infra. Webhooks are about live updates — only worth it if you
want a dashboard view showing paid/unpaid status across projects without
having to open each one.

## Decisions for you

| # | Decision | Recommendation | Why |
|---|---|---|---|
| 1 | **AccountCode** — single default, per-line-type, or per-project? | Single default (200), but make it user-configurable in app settings | Driven's existing flow uses one account; configurability covers future split (labour vs materials) without complexity now |
| 2 | **Branding theme** — Xero org default, or pick specifically? | Xero org default unless you have a "Waterproofing Quote" template you want enforced | Org default is what Xero applies if omitted; one less field to manage. Tell me if you have a named theme |
| 3 | **New customer handling** — auto-create contact in Xero, or require user to add it in Xero first? | Modal offers both: "[Create in Xero]" button + "[Pick existing]" picker | Auto-creating silently leads to duplicates from name typos. Explicit button is one extra click but prevents that |
| 4 | **Custom Connection migration** — move take-off off user OAuth onto a 3rd Custom Connection? | **No.** Stay on user OAuth. | User OAuth already works, is free, and supports webhooks. Custom Connection costs $10/mo per connection and only saves you the (already-automated) refresh-token rotation. Your existing 2 Custom Connections are presumably for other Xero apps (JAX etc.) — don't touch |

## Open uncertainties (need confirmation, not blockers)

1. **Xero Idempotency-Key TTL** — docs describe the mechanism but the exact retention window wasn't surfaced in any cached page I could read. Industry-common 24 h is sufficient for our case. If unsure, raise a Xero support ticket — but Phase A can ship without knowing the exact number.
2. **Webhooks + Custom Connections** — not relevant to us (we're on user OAuth) but noted for completeness if you ever do migrate.
3. **The "OUTPUT vs OUTPUT2" question for Driven's specific org** — answer is empirical: hit `GET /TaxRates` on Driven's tenant, see what's active. The fix code does this lookup, so it'll auto-handle whichever the org has.

## Implementation sketch (Phase A, the must-do)

### A1. Tax-code lookup

```
// apps/worker/src/tools/xero.ts (new helper)
async function resolveGstOutputTaxType(env, accessToken, tenantId): Promise<string> {
  const cached = await env.KV.get(`xero:tax:${tenantId}`);
  if (cached) return cached;
  const res = await xeroFetch(env, accessToken, tenantId, '/api.xro/2.0/TaxRates');
  const rates: Array<{Name: string; TaxType: string; Status: string}> = res.TaxRates ?? [];
  const gstOnIncome = rates.find(r =>
    r.Status === 'ACTIVE' &&
    /gst on income/i.test(r.Name)
  );
  if (!gstOnIncome) throw new Error('No active GST-on-income tax rate in Xero org');
  await env.KV.put(`xero:tax:${tenantId}`, gstOnIncome.TaxType, { expirationTtl: 86_400 });
  return gstOnIncome.TaxType;
}
```

Then in `pushToXero` replace the hardcoded `TaxType: 'OUTPUT'` with
`TaxType: await resolveGstOutputTaxType(...)`. Cache per tenant for a day;
invalidate on 400 from Xero.

### A2. Idempotency-Key

```
// apps/worker/src/tools/xero.ts (in pushToXero, before fetch)
const stableJson = JSON.stringify(payload, Object.keys(payload).sort());
const keyDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableJson));
const keyHex = Array.from(new Uint8Array(keyDigest)).map(b => b.toString(16).padStart(2,'0')).join('').slice(0, 16);
const idempotencyKey = `takeoff-${kind.toLowerCase()}-${projectId}-${keyHex}`;

// then in the fetch:
headers: {
  ...existingHeaders,
  'Idempotency-Key': idempotencyKey,
}
```

Same key for same project+payload → Xero replays the original response on
retry, never duplicates.

### A3. Reference field

```
payload.Reference = `Take-off: ${project.name}`; // or include short project_id
```

That's Phase A. Three small changes, single PR, immediately reduces a real
silent-failure surface (wrong tax code) and a real retry hazard (duplicate
drafts).

## Test plan

**Phase A:**
1. Unit: mock `GET /TaxRates` returning org with `OUTPUT2` active and `OUTPUT` archived. Assert `resolveGstOutputTaxType` returns `OUTPUT2`.
2. Unit: mock the same call twice in quick succession with different responses. Assert second call hits cache, not network.
3. Unit: call `pushToXero` twice with identical input. Assert both calls send the same `Idempotency-Key`. Assert the second call's response equals the first (mocked Xero).
4. Integration on Driven's actual Xero sandbox (or a one-off test invoice on prod, immediately voided): create a $1 test invoice, confirm GST is 10% with the correct TaxType in the Xero UI.

**Phase B:**
1. Click "Send to Xero" from EstimatesView on a project with an already-synced customer. Confirm modal pre-fills correctly. Submit → draft appears in Xero with right line items, right total, right Reference.
2. Same flow on a project with a new customer (no `xero_contact_id`). Confirm modal offers Create / Pick. Submit → contact created, then invoice created against it. Re-open project → invoice chip shows DRAFT.
3. Approve invoice in Xero, re-open project. Confirm chip flips to AUTHORISED (via the pull-on-load).
4. Mark invoice paid in Xero, re-open. Confirm chip shows PAID, `past_quotes.accepted = true`.

**Phase C (if built):**
1. Local: tunnel via cloudflared, configure webhook URL in Xero dev portal, click "Send Intent to receive". Confirm Worker returns 200 + valid HMAC.
2. Approve a draft invoice in Xero → confirm Worker receives `INVOICE.UPDATE` within seconds → confirm `past_quotes.accepted` is set in D1.

## What this doesn't cover

- **Sending the invoice email to the customer** — we're only creating the draft. Xero handles "send" itself once you approve. Out of scope.
- **Payment reconciliation beyond what webhooks tell us** — bank feed reconciliation is Xero's job.
- **Quote workflow** (Customer accepts a Quote, you convert to Invoice) — existing `pushToXero` supports `kind: QUOTE`. If Driven's workflow is "send a Quote first, customer accepts, then push to Invoice", that's worth surfacing separately. Current default is straight-to-draft-invoice, which is what JAX recommended.
- **Multi-tenant Xero connections** — Driven is single-tenant; the current code is already tenant-aware, no change needed.

## What changes for the consolidation plan

This dispatch surfaces a 7th bug pattern that fits cleanly into the Codex P2
investigation summary at
`take-off-web/dispatches/codex-p2-investigation/README.md`:

**Pattern 5: Hardcoded magic strings that ought to be looked up from the
external system.** The `OUTPUT` / `200` / 14-day values are all "we wrote
what Driven's org happens to use today" — but Driven's Xero org or Driven's
chart of accounts could change tomorrow. Same "validation gates" point
Hermes §7.7 made: invariants should be derived from the source of truth at
runtime, not committed as literals.

Add a one-liner cross-reference in the Codex investigation README if/when
this dispatch is committed.
