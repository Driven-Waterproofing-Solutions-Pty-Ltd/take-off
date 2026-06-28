# form43-app

Standalone Cloudflare Worker for the QLD **Form 43 — Certificate of Compliance
for Waterproofing**, with a built-in MCP connector, self-contained memory
(D1 + Vectorize), and an Australian address service backed by Geoscape G-NAF.

Designed so any AI — ChatGPT, Claude.ai, Claude Desktop, aqua, or your own
agents — can drive Form 43 over a single bearer-authenticated MCP endpoint.

## What it gives you

- **Form 43 PDF generator** at `/form43` (lifted from aqua, byte-for-byte).
- **REST API** under `/api/v1/form43/*`, `/api/v1/address/*`, `/api/v1/memory/*`.
- **Remote MCP** at `/mcp` (Streamable HTTP, JSON-RPC 2.0). 13 tools across
  Form 43, address, and memory groups.
- **Server-side PDF** — `form43_pdf` tool + `POST /api/v1/form43/pdf` render
  the certificate as a real PDF (pdf-lib), so an AI/aqua can get the bytes
  without the browser page.
- **Local Node build** — `npm run local` runs the whole app off Cloudflare
  on `node:sqlite` (see `local/README.md`).
- **Stdio MCP adapter** (`mcp-stdio/`) for Claude Desktop and any MCP client
  that doesn't yet speak remote transport.
- **Self-contained memory**: D1 `chat_memory` table + Workers AI BGE
  embeddings (1024-dim) + Vectorize. Mirrors aqua's memory shape so any
  client familiar with aqua sees the same surface. Hard-delete is blocked
  by a D1 trigger, a daily cron snapshots memory to R2, and a CI guard
  (`tests/unit/memory-protection.test.ts`) fails the build if any code
  tries to DROP/DELETE/TRUNCATE `chat_memory`.
- **Geoscape Predictive Address & Property API** for autocomplete + verify,
  falling back to OpenStreetMap Nominatim when `GEOSCAPE_API_KEY` is absent.
  Geoscape sources the G-NAF dataset — the official Australian national
  address file, updated weekly.

## Quick start (local)

```bash
cd form43-app
npm install

# Create the D1 db once; the ID goes into wrangler.jsonc.
wrangler d1 create form43

# Create the Vectorize index (1024-dim cosine, matches Workers AI BGE).
npm run vectorize:create

# Apply migrations locally.
npm run db:migrate:local

# Run.
cp .dev.vars.example .dev.vars   # then edit
npm run dev                      # http://localhost:8787
```

Open `http://localhost:8787/form43`, fill in a job, generate, save. The PDF
is built client-side; the save call hits `/api/v1/form43/save`.

## Connect an AI

### Claude.ai / ChatGPT / any remote-MCP client

Point the client at `https://<your-worker>/mcp` with header
`Authorization: Bearer <FORM43_API_TOKEN>`.

```bash
claude mcp add form43 \
  --transport http \
  --url https://form43.drivenwp.workers.dev/mcp \
  --header "Authorization: Bearer $FORM43_API_TOKEN"
```

### Claude Desktop / mcp-cli (stdio)

Build and configure the adapter (see `mcp-stdio/README.md`).

### From aqua

The same `AQUA_API_TOKEN` pattern aqua already uses applies — point
`FORM43_BASE_URL` + `FORM43_API_TOKEN` at this Worker.

## MCP tools

| Group | Tool |
|---|---|
| Form 43 | `form43_prefill`, `form43_pdf`, `form43_save`, `form43_list`, `form43_get`, `form43_delete` |
| Address | `address_autocomplete`, `address_verify`, `parse_address` |
| Memory | `save_memory`, `search_memory`, `list_recent_memory`, `pin_memory` |

State-changing tools (`*_save`, `*_delete`, `*_pin`) require `confirm: true`
on the second call (HR-12 two-turn pattern). First call returns the proposed
payload + a hint.

## Deploy

The Cloudflare infrastructure is **already provisioned** on the Driven
account and the IDs are wired into `wrangler.jsonc`:

| Resource | Name | ID |
|---|---|---|
| D1 database | `form43` | `29482173-2dd4-40d0-826a-c7ac8af5f08a` |
| KV namespace | `form43-rate-limit` | `721ff5eff217497e9f3e65c78e508bd5` |
| R2 bucket | `form43-backups` | — |

All 5 migrations have been applied (6 tables + 12 indexes + the
chat_memory protection trigger), and a few starter memories are seeded.

### Finish the deploy (one-click, no CLI)

1. In GitHub: **Settings → Secrets and variables → Actions** and add:
   - `CLOUDFLARE_API_TOKEN` — token with Workers Scripts / D1 / Vectorize /
     KV / R2 edit perms on the Driven account.
   - `FORM43_API_TOKEN` — the bearer clients use (`openssl rand -hex 32`).
   - `GEOSCAPE_API_KEY` *(optional)* — enables Geoscape G-NAF; without it the
     Worker uses the OSM Nominatim fallback.
2. **Actions → form43-app Deploy → Run workflow.** It creates the Vectorize
   index, applies migrations, pushes the secrets, and deploys the Worker.

### Or from a CLI (if you'd rather)

```bash
cd form43-app
wrangler vectorize create form43-memory --dimensions=1024 --metric=cosine
wrangler secret put FORM43_API_TOKEN
wrangler secret put GEOSCAPE_API_KEY   # optional
npm run deploy
```

## Source layout

See the plan at `/root/.claude/plans/take-my-form-43-snazzy-bear.md` (in the
session that built this) for the full layout and porting rationale.

## Porting notes (vs. aqua)

- `src/shared/address-parse.ts` and `src/shared/qld-lga.ts` are **verbatim
  copies** of `aqua/src/shared/`. Source-of-truth lives in aqua — sync
  manually if you fix a bug.
- `src/modules/form43/standalone.ts` is a byte-for-byte port of aqua's
  `standalone.ts`. Only the header comment was rewritten.
- The aqua-era `GET /api/v1/form43/job-data/:jobId` endpoint returns 410
  here — there is no `jobs` table in this app. Use `POST /api/v1/form43/prefill`
  or the `form43_prefill` MCP tool with a job payload directly.
- aqua's `/jobs-list` endpoint is intentionally absent — no `jobs` table.
