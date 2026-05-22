# Dispatch: Driven Takeoff — Live MCP End-to-End Proof

**Audience:** a terminal-capable agent (or a human) executing this from a fresh session with zero prior context. Read top to bottom, follow the phases in order, stop on any `STOP` condition, report back in the Phase 6 format.

**Mission in one sentence:** verify that the Driven Takeoff worker is live, that the MCP endpoint mirrors REST, that the geometry math survives the full chain (project → calibrate → area → quote), and (optionally) that a DRAFT Quote lands in Xero. Then wire Claude Desktop so the human can drive it conversationally.

---

## Fill these in before dispatching

```
BASE_URL    = ???   # e.g. https://takeoff.drivenwp.com  OR  https://takeoff-worker.<your-sub>.workers.dev
BOOTSTRAP   = ???   # the MCP_BOOTSTRAP_TOKEN secret value (the one used to mint MCP tokens)
XERO_TENANT = ???   # OPTIONAL — a Xero ContactID to push a Draft Quote to. Leave blank to skip Phase 4.
OS          = ???   # one of: macos, linux, windows. Determines Claude Desktop config path in Phase 5.
```

If `BASE_URL` or `BOOTSTRAP` are blank, **stop and ask** — don't guess.

---

## You are

A terminal-only agent. You have `curl`, `jq`, a file editor, and (probably) `git`. You do **not** have a browser. The user will handle anything that needs a browser (Xero OAuth, Cloudflare dashboard clicks) when prompted.

## Your scope

**Allowed:**

- `curl` any endpoint on `BASE_URL`
- Write to local config files in the user's Claude Desktop config directory (Phase 5 only)
- Read & edit files under the repo at `/home/user/take-off/take-off-web/` (or wherever it lives locally)
- Append to a report file in `take-off-web/dispatches/` and (if you have GitHub MCP) post it as a PR comment

**Prohibited:**

- Do **not** push live Xero data — Demo Company tenant only
- Do **not** run `wrangler deploy` — that's the operator's job
- Do **not** delete D1 rows or R2 objects that aren't yours
- Do **not** commit any secrets to git
- Do **not** continue past a STOP condition

---

## Phase 0 — Diagnose

Goal: confirm the worker is alive, reachable, and behaves as expected. Bail loudly if it isn't.

```bash
# 0.1 — Worker reachable & healthy
curl -sf "$BASE_URL/health"
# Expect:  {"ok":true}
# STOP if not 200 or body != {"ok":true}.  Report which URL failed + the body you got.

# 0.2 — Identity check
curl -sf "$BASE_URL/" | jq -r '.name'
# Expect:  takeoff-worker
# STOP if it returns anything else (you may be hitting the wrong subdomain).

# 0.3 — MCP endpoint exists and rejects un-auth'd requests
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$BASE_URL/mcp" \
  -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}'
# Expect:  401
# STOP if you get 200 (auth is broken) or 5xx (worker error).
```

If all three pass, proceed.

---

## Phase 1 — Mint an MCP token

```bash
MINT=$(curl -sf -X POST "$BASE_URL/admin/mcp/tokens" \
  -H "Authorization: Bearer $BOOTSTRAP" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"dispatch-$(date +%s)\"}")

echo "$MINT" | jq .
MCP_TOKEN=$(echo "$MINT" | jq -r .token)
test -n "$MCP_TOKEN" || { echo "no token"; exit 1; }
```

**STOP** if the response is 403 — `BOOTSTRAP` is wrong. Ask the operator for the correct value (it's the `MCP_BOOTSTRAP_TOKEN` secret on the worker).

---

## Phase 2 — MCP capability probe

```bash
# 2.1 — initialize
curl -sf -X POST "$BASE_URL/mcp" \
  -H "Authorization: Bearer $MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}' | jq .

# Expect protocolVersion 2025-06-18 and serverInfo.name = "takeoff-mcp"

# 2.2 — tools/list
TOOLS=$(curl -sf -X POST "$BASE_URL/mcp" \
  -H "Authorization: Bearer $MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')

echo "$TOOLS" | jq -r '.result.tools[].name'
# Expect 14 names, including: set_scale_preset, add_area, build_quote, push_to_xero
# Capture the list verbatim for the report.
```

---

## Phase 3 — Live workflow proof (REST)

Run a fake roof job. The numbers below are deterministic — every value in the report should match within ±0.01.

```bash
# 3.1 — Create project
PROJECT_ID=$(curl -sf -X POST "$BASE_URL/api/projects" \
  -H "Authorization: Bearer $MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Dispatch Test Job $(date -u +%FT%TZ)\"}" | jq -r .id)
echo "PROJECT_ID=$PROJECT_ID"

# 3.2 — Calibrate page 0 with 1:100 metric preset
curl -sf -X POST "$BASE_URL/api/measure/scale/preset" \
  -H "Authorization: Bearer $MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"project_id\":\"$PROJECT_ID\",\"page_index\":0,\"preset_label\":\"1:100\"}" | jq .
# Expect: {"isSet":true,"pixelsPerUnit":28.3465,"unit":"m"}

# 3.3 — Create an item with unit price $75.50/m²
ITEM_ID=$(curl -sf -X POST "$BASE_URL/api/measure/items" \
  -H "Authorization: Bearer $MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"project_id\":\"$PROJECT_ID\",\"label\":\"Flat Roof\",\"type\":\"AREA\",\"color\":\"#10b981\",\"unit\":\"sq m\",\"price\":75.50}" | jq -r .id)
echo "ITEM_ID=$ITEM_ID"

# 3.4 — Add a 10m × 10m square area (= 283.4645 pixels × 283.4645 pixels at 28.3465 ppu)
SHAPE=$(curl -sf -X POST "$BASE_URL/api/measure/shapes/area" \
  -H "Authorization: Bearer $MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"project_id\":\"$PROJECT_ID\",\"page_index\":0,\"item_id\":\"$ITEM_ID\",\"snap\":false,\"points\":[{\"x\":0,\"y\":0},{\"x\":283.4645,\"y\":0},{\"x\":283.4645,\"y\":283.4645},{\"x\":0,\"y\":283.4645}]}")
echo "$SHAPE" | jq .
# Expect: shape.value between 99.99 and 100.01

# 3.5 — Build the quote (computed, not pushed)
QUOTE=$(curl -sf "$BASE_URL/api/memory/quote/$PROJECT_ID" \
  -H "Authorization: Bearer $MCP_TOKEN")
echo "$QUOTE" | jq .
# Expect:
#   lines.length      = 1
#   lines[0].lineTotal ≈ 7549.97   (= 99.9996 × 75.50)
#   subtotal          ≈ 7549.97
#   gst               ≈  754.997
#   total             ≈ 8304.97
```

**STOP** with a regression report if any number is off by more than ±0.01.

---

## Phase 3b — Same workflow via MCP (proves the surfaces are equivalent)

```bash
# Equivalent build_quote via /mcp
MCP_QUOTE=$(curl -sf -X POST "$BASE_URL/mcp" \
  -H "Authorization: Bearer $MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":99,\"method\":\"tools/call\",\"params\":{\"name\":\"build_quote\",\"arguments\":{\"project_id\":\"$PROJECT_ID\"}}}")
echo "$MCP_QUOTE" | jq '.result.structuredContent.total'
# Expect the same total as Phase 3.5 (≈ 8304.97)
```

---

## Phase 4 — Xero push (OPTIONAL, only if `XERO_TENANT` is set)

Skip this phase entirely if `XERO_TENANT` is blank.

```bash
test -n "$XERO_TENANT" || { echo "skipping Phase 4"; }

if [ -n "$XERO_TENANT" ]; then
  PUSH=$(curl -sf -X POST "$BASE_URL/mcp" \
    -H "Authorization: Bearer $MCP_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":100,\"method\":\"tools/call\",\"params\":{\"name\":\"push_to_xero\",\"arguments\":{\"project_id\":\"$PROJECT_ID\",\"kind\":\"QUOTE\",\"customer_xero_id\":\"$XERO_TENANT\",\"reference\":\"DISPATCH-$(date +%s)\"}}}")
  echo "$PUSH" | jq .
  XERO_ID=$(echo "$PUSH" | jq -r '.result.structuredContent.xero_id // empty')
  DEEP_LINK=$(echo "$PUSH" | jq -r '.result.structuredContent.deep_link // empty')
fi
```

Then **print** for the human:

> Visit `$DEEP_LINK` in your browser. Confirm: (a) the Quote is in DRAFT status — never AUTHORISED, (b) one line at $75.50/m² × 99.99 m² ≈ $7549.97 ex GST, (c) the customer matches `$XERO_TENANT`. Reply `xero ok` or paste a screenshot.

**Do not proceed** if the response shows `isError: true` — the push failed. Capture the error message verbatim in the report.

---

## Phase 5 — Wire Claude Desktop

Locate the config file (you have terminal access, so write directly):

| OS | Path |
|---|---|
| `macos` | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| `linux` | `~/.config/Claude/claude_desktop_config.json` |
| `windows` | `%APPDATA%\Claude\claude_desktop_config.json` |

```bash
case "$OS" in
  macos)   CFG="$HOME/Library/Application Support/Claude/claude_desktop_config.json" ;;
  linux)   CFG="$HOME/.config/Claude/claude_desktop_config.json" ;;
  windows) CFG="$APPDATA/Claude/claude_desktop_config.json" ;;
  *)       echo "set OS to macos|linux|windows"; exit 1 ;;
esac

mkdir -p "$(dirname "$CFG")"

# If the file exists, MERGE — don't clobber existing mcpServers.
if [ -f "$CFG" ]; then
  EXISTING=$(cat "$CFG")
else
  EXISTING='{}'
fi

NEW=$(echo "$EXISTING" | jq \
  --arg url "$BASE_URL/mcp" \
  --arg auth "Bearer $MCP_TOKEN" \
  '.mcpServers["driven-takeoff"] = { "url": $url, "headers": { "Authorization": $auth } }')

echo "$NEW" | jq . > "$CFG"
echo "Wrote $CFG"
```

Then print to the operator:

> Restart Claude Desktop. In a fresh chat, ask: *"What tools do you have from driven-takeoff?"* — you should see 14 tool names. Try: *"List the items on project `$PROJECT_ID`."* — Claude should call `list_items` and report one item, "Flat Roof", with totalValue ≈ 99.9996.

---

## Phase 6 — Report back

Write your report to **`take-off-web/dispatches/report-<unix-timestamp>.md`** in the repo. Use exactly this structure — the dispatcher will parse it.

```markdown
# Dispatch Report — <ISO-8601 timestamp>

## Environment
- BASE_URL:        <url>
- Worker name:     <from / endpoint>
- /health:         <"ok" or the error>
- /mcp un-auth:    <HTTP code, expected 401>

## MCP capabilities
- Protocol version: <reported>
- Tool count:       <number, expected 14>
- Tool names:       <comma-separated list>

## Workflow numbers
- PROJECT_ID:                       <uuid>
- ITEM_ID:                          <uuid>
- pixelsPerUnit (after 1:100):      <number, expected 28.3465>
- shape.value (10m square at 1:100): <number, expected 99.9996 ±0.01>
- quote.subtotal:                   <number, expected 7549.97 ±0.01>
- quote.gst:                        <number, expected 754.997 ±0.01>
- quote.total:                      <number, expected 8304.97 ±0.01>
- MCP build_quote.total:            <number, must equal quote.total>

## Xero (only if XERO_TENANT was set)
- xero_id:        <id or "skipped">
- deep_link:      <url or "skipped">
- DRAFT status confirmed by human: <yes / no / pending>

## Claude Desktop
- Config path:    <path>
- Wrote new:      <yes / merged into existing>
- Operator confirmed Claude sees 14 tools: <yes / no / pending>

## Anomalies
<numbered list — any HTTP non-2xx, any number off by more than ±0.01, any
errors from MCP tool calls, any surprises in JSON shape. ONE LINE EACH.>

## Recommended next step for the human
<one short sentence>
```

If you have GitHub MCP access, also post the report as a comment on PR #2 of `Driven-Waterproofing-Solutions-Pty-Ltd/take-off`. Otherwise just save the file.

---

## STOP conditions (summary)

| When | What to do |
|---|---|
| `BASE_URL` or `BOOTSTRAP` blank | Ask the operator, don't guess |
| Phase 0 health/index check fails | Print the URL + body, STOP |
| Phase 1 token mint returns 403 | Operator gave the wrong `BOOTSTRAP`; STOP |
| Any geometry number off by > ±0.01 | This is a regression; STOP, capture the exact numbers |
| MCP `tools/call` returns `isError: true` | Capture the message; continue but flag in anomalies |
| Xero push fails | Capture the error; do NOT retry; report and let the human investigate |
| You don't understand what you're seeing | STOP, report, ask |

---

## Glossary (so you can answer without grepping)

- **Worker** = the Cloudflare Workers serverless function at `BASE_URL`. Code lives in `take-off-web/apps/worker/`.
- **D1** = Cloudflare SQLite, used for projects/items/shapes/customers/etc.
- **R2** = Cloudflare object storage, used for PDF blobs.
- **MCP** = Model Context Protocol. The worker exposes 14 tools over `/mcp` so Claude Desktop / Copilot can drive measurements.
- **Bootstrap token** = a single super-token (`MCP_BOOTSTRAP_TOKEN` secret) that mints per-client MCP tokens via `/admin/mcp/tokens`.
- **Per-client token** = what each MCP installation uses (Claude Desktop on a laptop, etc.). Hashed in D1.
- **Cloudflare Access** = SSO gate in front of `BASE_URL` for browser users; bypassed for `/mcp`, `/xero/oauth/*`, `/health`, `/admin/mcp/tokens`.
- **Draft Quote** = a Xero `Quote` with `Status: "DRAFT"` — never auto-sent. Hard-coded in `apps/worker/src/tools/xero.ts`.
- **Test geometry** = a 10 m × 10 m polygon. At 1:100 scale (28.3465 ppu) the pixel coords are `(0,0)→(283.4645, 0)→(283.4645, 283.4645)→(0, 283.4645)`. The shoelace formula gives 99.9996 m².
