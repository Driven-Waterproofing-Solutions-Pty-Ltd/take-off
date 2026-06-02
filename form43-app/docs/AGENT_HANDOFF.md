# Form 43 Agent — Handoff

> Everything needed to build an AI agent on top of the deployed **Form 43**
> service. Self-contained: hand this to a coworker or another agent and they
> can stand up the agent without prior context.

---

## 1. What this is

**Form 43** is the QLD *Certificate of Compliance for Waterproofing*. We lifted
it out of the AQUA platform into a **standalone Cloudflare Worker** so any AI
(Copilot, Claude, ChatGPT, Power Platform) can drive it over one
bearer-authenticated endpoint. It has:

- A **PDF generator** web page (`/form43`)
- A **REST API** (Form 43 CRUD + address + memory)
- A **remote MCP server** (`/mcp`) exposing 12 tools
- **Self-contained memory** (Cloudflare D1 + Workers AI embeddings + Vectorize)
- **Australian address search** (Geoscape G-NAF, with OpenStreetMap fallback)

It is **live in production right now.**

---

## 2. Connection details (the only things an agent needs)

| Thing | Value |
|---|---|
| Base URL | `https://form43-app.office-351.workers.dev` |
| MCP endpoint | `https://form43-app.office-351.workers.dev/mcp` (Streamable HTTP, JSON-RPC 2.0) |
| Auth header | `Authorization: Bearer <FORM43_API_TOKEN>` |
| Token | In the file `form43-bearer.txt` (sent separately — **do not commit it**) |
| Form 43 page | `https://form43-app.office-351.workers.dev/form43` |
| Health (no auth) | `https://form43-app.office-351.workers.dev/health` |

> The token is a shared secret. Treat it like a password; rotate with
> `wrangler secret put FORM43_API_TOKEN` if it leaks.

---

## 3. The 12 MCP tools

**Form 43**
- `form43_prefill` — build a certificate payload from a job (address, scope, dates)
- `form43_save` — persist a certificate *(needs `confirm:true`)*
- `form43_list` — list saved certificates
- `form43_get` — fetch one by id
- `form43_delete` — soft-delete *(needs `confirm:true`)*

**Address**
- `address_autocomplete` — Geoscape G-NAF predictive search (OSM fallback)
- `address_verify` — canonical G-NAF record + lat/lng + LGA
- `parse_address` — offline regex parse → lot/unit/street/suburb/state/postcode + QLD LGA

**Memory**
- `save_memory` — store a fact/preference/decision *(needs `confirm:true`)*
- `search_memory` — semantic search (literal fallback)
- `list_recent_memory` — recent memories, optional category filter
- `pin_memory` — pin a memory so it never expires *(needs `confirm:true`)*

> Write tools follow a **two-turn confirm**: call once to preview, call again
> with `confirm:true` to commit. Prevents accidental/injected writes.

---

## 4. Build the agent — pick the platform

### Option A — Microsoft Copilot Studio (recommended for M365)
1. copilotstudio.microsoft.com → **Create → New agent**
2. **Tools → + Add a tool → Model Context Protocol**
3. Server name `form43`; URL `https://form43-app.office-351.workers.dev/mcp`
4. Auth = **API Key**, header `Authorization`, value `Bearer <FORM43_API_TOKEN>`
5. Add → it pulls all 12 tools → enable them → **Save → Publish**
6. Suggested agent instructions (paste into the agent's system prompt):
   > "You help Driven Waterproofing staff create QLD Form 43 certificates.
   > Use `address_verify`/`parse_address` to normalise site addresses and
   > resolve the LGA. Use `form43_prefill` to draft, confirm details with the
   > user, then `form43_save` with confirm:true. Default membranes and wet
   > areas come from memory — check `search_memory` first."

### Option B — Power Apps / Power Automate (custom connector)
1. make.powerapps.com → **Data → Custom connectors → + New → Import an OpenAPI file**
2. Upload `powerapps-connector.swagger.json` (in repo at
   `form43-app/docs/powerapps-connector.swagger.json`, also sent separately)
3. **Create connector** → **+ New connection** → paste `Bearer <FORM43_API_TOKEN>`
4. The 13 REST operations are now available as actions in apps/flows.

### Option C — Claude / ChatGPT / Cursor (remote MCP)
Add a custom MCP connector with the URL + bearer header above. All 12 tools
appear automatically.

---

## 5. Smoke tests (prove it works)

```bash
URL=https://form43-app.office-351.workers.dev
TOKEN=<paste from form43-bearer.txt>

# Liveness
curl -s $URL/health
# → {"success":true,"data":{"ok":true,"env":"production"}}

# Tool list (expect 12)
curl -s -X POST $URL/mcp \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Parse an address
curl -s -X POST $URL/mcp \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"parse_address","arguments":{"raw":"Lot 42, 25 Cameron Rd, Morayfield QLD 4506"}}}'
# → lga: "Moreton Bay Regional Council"
```

---

## 6. Infrastructure already provisioned (Cloudflare account: Office@drivenwp.com)

| Resource | Name / ID |
|---|---|
| Worker | `form43-app` → `form43-app.office-351.workers.dev` |
| D1 database | `form43` — `29482173-2dd4-40d0-826a-c7ac8af5f08a` (Sydney) |
| KV namespace | `form43-rate-limit` — `721ff5eff217497e9f3e65c78e508bd5` |
| R2 bucket | `form43-backups` |
| Vectorize index | `form43-memory` (1024-dim, cosine) |
| Cron | daily memory snapshot to R2, 14:30 UTC |

**Optional:** set `GEOSCAPE_API_KEY` (`wrangler secret put`) to switch address
search from OSM fallback to Geoscape G-NAF (official AU national address data).

---

## 7. Source & deployment

- Repo: `Driven-Waterproofing-Solutions-Pty-Ltd/take-off`
- Worker code: `form43-app/` (merged to `release`, PR #3)
- Connector spec: `form43-app/docs/powerapps-connector.swagger.json` (PR #4)
- Redeploy: `cd form43-app && wrangler deploy` (needs a Cloudflare API token)
- CI: `.github/workflows/form43-app-ci.yml` (typecheck + tests on every push)
- One-click redeploy workflow: `.github/workflows/form43-app-deploy.yml`

---

## 8. Known notes

- Semantic `search_memory` has a ~30–60s indexing delay after a new
  `save_memory` (Vectorize async). Literal fallback covers the gap.
- The aqua-era `GET /api/v1/form43/job-data/:jobId` returns **410** here — this
  app has no `jobs` table. Use `form43_prefill` / `POST /api/v1/form43/prefill`
  with a job payload instead.
- All deletes are **soft** (`is_active = 0`); `chat_memory` has a DB trigger
  blocking hard deletes.
