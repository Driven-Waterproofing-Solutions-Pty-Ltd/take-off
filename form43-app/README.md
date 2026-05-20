# form43-app

Standalone Cloudflare Worker for the QLD **Form 43 — Certificate of Compliance
for Waterproofing**, with a built-in MCP connector, self-contained memory
(D1 + Vectorize), and an Australian address service backed by Geoscape G-NAF.

Designed so any AI — ChatGPT, Claude.ai, Claude Desktop, aqua, or your own
agents — can drive Form 43 over a single bearer-authenticated MCP endpoint.

## What it gives you

- **Form 43 PDF generator** at `/form43` (lifted from aqua, byte-for-byte).
- **REST API** under `/api/v1/form43/*`, `/api/v1/address/*`, `/api/v1/memory/*`.
- **Remote MCP** at `/mcp` (Streamable HTTP, JSON-RPC 2.0). 12 tools across
  Form 43, address, and memory groups.
- **Stdio MCP adapter** (`mcp-stdio/`) for Claude Desktop and any MCP client
  that doesn't yet speak remote transport.
- **Self-contained memory**: D1 `chat_memory` table + Workers AI BGE
  embeddings (1024-dim) + Vectorize. Mirrors aqua's memory shape so any
  client familiar with aqua sees the same surface. Hard-delete is blocked
  by a D1 trigger.
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
| Form 43 | `form43_prefill`, `form43_save`, `form43_list`, `form43_get`, `form43_delete` |
| Address | `address_autocomplete`, `address_verify`, `parse_address` |
| Memory | `save_memory`, `search_memory`, `list_recent_memory`, `pin_memory` |

State-changing tools (`*_save`, `*_delete`, `*_pin`) require `confirm: true`
on the second call (HR-12 two-turn pattern). First call returns the proposed
payload + a hint.

## Deploy

```bash
wrangler secret put FORM43_API_TOKEN         # 32+ random bytes (hex)
wrangler secret put GEOSCAPE_API_KEY         # optional; absent → OSM fallback
npm run db:migrate:prod
npm run deploy
```

Replace the `database_id` and `RATE_LIMIT_KV.id` placeholders in
`wrangler.jsonc` with the values printed by `wrangler d1 create` and
`wrangler kv namespace create`.

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
