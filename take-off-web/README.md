# take-off-web

Standalone AI-connectable measurement & quoting platform for Driven Waterproofing.

A Cloudflare Worker that serves both a web canvas (port of the existing ProTakeoff desktop app) and an MCP endpoint that Claude / Copilot / Aqua can connect to. Builds Draft Quotes / Invoices in Xero.

## Repo layout

```
take-off-web/
├── apps/
│   ├── web/        React + Konva canvas (Vite). Talks to the worker over /api/*.
│   └── worker/     Cloudflare Worker (Hono). REST at /api/*, MCP at /mcp, Xero OAuth at /xero/*.
└── packages/
    └── shared/     Pure TS shared between web + worker.
                    Lifted verbatim from /home/user/take-off:
                    - types.ts, utils/geometry.ts, utils/math.ts
                    Plus Zod tool schemas (single source of truth).
```

## Phases (AI-last build order)

After Phase 2, **MCP clients can already drive the system** with their own AI subscription — Phase 5 is only needed for an in-app chat experience.

| # | Phase | Status |
|---|---|---|
| 1 | Web canvas + R2 + D1 | scaffolded; full `BlueprintCanvas` port pending |
| 2 | Tools + MCP endpoint | **done** — 14 tools live on `/mcp`, plus REST mirrors |
| 3 | Memory layer | **done** — assemblies (with labour), customers, project search |
| 4 | Xero Draft Quote/Invoice | **done** — OAuth (CSRF-protected) + push + nightly contact sync + tokens AES-GCM at rest |
| 5 | AI chat panel (optional) | not started |
| 6 | Aqua iframe embed | not started |

## Auth model

- **Browser (web app)** — Cloudflare Access (Zero Trust) in front of `takeoff.drivenwp.com`. Access sets `Cf-Access-Authenticated-User-Email` on every request.
- **MCP / programmatic** — `Authorization: Bearer <mcp-token>`. Tokens are minted via `POST /admin/mcp/tokens` (requires `MCP_BOOTSTRAP_TOKEN`) and stored SHA-256-hashed in D1.
- **Xero OAuth callback** — public by necessity; CSRF-protected via HMAC-signed state cookie.

## Running locally

```bash
cd take-off-web
pnpm install

# One-time: create the D1 database
pnpm --filter @takeoff/worker exec wrangler d1 create takeoff
# Copy the printed database_id into apps/worker/wrangler.toml

# Apply migrations to the local D1
pnpm --filter @takeoff/worker migrate:local

# Run both processes (two terminals)
pnpm dev:worker  # → http://127.0.0.1:8787
pnpm dev:web     # → http://127.0.0.1:5173 (proxies /api, /mcp, /xero to the worker)
```

## Secrets (per environment)

```bash
cd apps/worker
wrangler secret put XERO_CLIENT_ID
wrangler secret put XERO_CLIENT_SECRET
wrangler secret put XERO_REDIRECT_URI       # e.g. https://takeoff.drivenwp.com/xero/oauth/callback
wrangler secret put XERO_TOKEN_KEY          # 32+ random bytes — AES-GCM key for Xero tokens at rest
wrangler secret put MCP_BOOTSTRAP_TOKEN     # used to mint per-client MCP tokens AND to HMAC OAuth state
wrangler secret put APP_BASE_URL            # e.g. https://takeoff.drivenwp.com
# Phase 5 only:
wrangler secret put ANTHROPIC_API_KEY
```

## Connecting Claude Desktop (or any MCP client)

```bash
# 1. Mint a per-client token (requires MCP_BOOTSTRAP_TOKEN in Authorization)
curl -X POST https://takeoff.drivenwp.com/admin/mcp/tokens \
  -H "Authorization: Bearer $MCP_BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Claude Desktop — my laptop"}'
# → { "id": "...", "token": "..." }

# 2. In Claude Desktop MCP config:
{
  "mcpServers": {
    "driven-takeoff": {
      "url": "https://takeoff.drivenwp.com/mcp",
      "headers": { "Authorization": "Bearer <token from step 1>" }
    }
  }
}
```

## Tools exposed (REST + MCP)

| Tool | Purpose |
|---|---|
| `load_pdf` | Register an uploaded PDF (client uploads to R2 first) |
| `get_page_image` | Render page → PNG + vector summary (client-side) |
| `set_scale_preset` / `set_scale_manual` | Calibrate page scale |
| `add_area` / `add_linear` / `add_count` / `add_arc` | Place measurements |
| `snap_to_vector` | Snap proposed coords to nearest PDF vertex/segment |
| `list_items` | All takeoff items for a project |
| `search_projects` / `recall_customer` / `list_assemblies` | Memory queries |
| `apply_assembly` | Attach a material/labour assembly to an item |
| `build_quote` | Compute the current Quote/Invoice draft (no Xero call) |
| `push_to_xero` | Create DRAFT Quote/Invoice in Xero (never AUTHORISED) |

Schema is one source of truth: `packages/shared/src/tool-schemas.ts`.

## Safety guarantees

- Xero pushes are always `Status: "DRAFT"` — hard-coded, never AUTHORISED.
- MCP tokens are SHA-256 hashed in D1; the bootstrap token mints per-client tokens.
- Page scale is required before any measurement tool persists (server-enforced).
