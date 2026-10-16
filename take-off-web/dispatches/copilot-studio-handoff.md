# Handoff: Build the Driven Takeoff MCP connector in Copilot Studio

You're picking this up to:
1. Create a Power Apps **custom connector** that points at our MCP server.
2. Attach that connector to a **Copilot Studio agent** so the agent can
   measure plans, recall customers/assemblies, build quotes, and push
   DRAFT invoices/quotes to Xero — by chatting with it.

The MCP server, the 14 tools, and the worker are already built and live
in PR #2 on the `driven-waterproofing-solutions-pty-ltd/take-off` repo.
Your job is the Copilot-side wiring only.

Estimated time: **15 minutes** of clicking. No code.

---

## What you'll need before you start

| Item | Where it comes from | Notes |
|---|---|---|
| Worker base URL | Office@drivenwp.com | Probably `https://takeoff.drivenwp.com`. Test with `curl <url>/health` — must return `{"ok":true}`. |
| MCP bearer token | Office@drivenwp.com (via 1Password / encrypted message) | Long random string. Treat like a password. Don't paste into chat / email / screenshots. |
| OpenAPI YAML file | This repo: `take-off-web/dispatches/copilot-studio-mcp-connector.yaml` | Download a local copy first — Power Apps needs to upload it from disk. |
| Power Apps + Copilot Studio access | Your Microsoft 365 account | Must be in the **same environment** for both portals. Use the top-right environment picker if you have more than one. |

If the worker base URL doesn't return `{"ok":true}`, **stop here** — the
worker isn't deployed yet. Ping Office@drivenwp.com before continuing.

---

## Step 1 — Create the custom connector in Power Apps (≈ 5 min)

1. <https://make.powerapps.com> → top-right environment picker, pick the
   right environment.
2. Left nav: **More** → **Discover all** → **Custom connectors**.
3. Top-right: **+ New custom connector** → **Import an OpenAPI file**.
4. **Connector name:** `Driven Takeoff MCP`.
5. Upload `copilot-studio-mcp-connector.yaml` → **Continue**.

You're now in the connector wizard, on the **General** tab.

### General tab
Should already be filled in from the YAML — just verify:
- **Scheme:** `HTTPS`
- **Host:** matches the worker URL (without `https://` and without path).
  If the worker is at `takeoff.drivenwp.com`, host should say exactly
  `takeoff.drivenwp.com`. **Edit if needed.**
- **Base URL:** `/`

Click **Security ⟶**.

### Security tab
- **Authentication type:** `API Key`
- **Parameter label:** `Bearer token`
- **Parameter name:** `Authorization`
- **Parameter location:** `Header`

Click **Definition ⟶**.

### Definition tab
You should see one POST operation `InvokeMCP` at `/mcp`. Toggle
**Swagger Editor** on (top of the page) and confirm this line is present
inside the POST:

```yaml
x-ms-agentic-protocol: mcp-streamable-1.0
```

If it's missing, the connector will not be treated as an MCP source —
ping Office@drivenwp.com.

Top-right: **Create connector**. Wait for the green "Connector updated"
banner. You're done with Power Apps.

---

## Step 2 — Attach the connector to a Copilot Studio agent (≈ 5 min)

1. <https://copilotstudio.microsoft.com> → top-right environment picker,
   same environment as Power Apps.
2. Open the agent you want to give takeoff powers (or **Create** a new
   one called something like "Driven Takeoff Agent").
3. **Tools** tab → **+ Add a tool** → **Model Context Protocol**.
4. From the connector list, pick **Driven Takeoff MCP** (the one you
   just created).
5. Copilot Studio will prompt **Create a new connection**. In the API key
   field, paste **the entire string**:

   ```
   Bearer <paste-token-here>
   ```

   ⚠ Include the word `Bearer` and the space. The worker rejects
   anything else with 401.

6. **Create** the connection → **Add to agent**.

Copilot Studio probes the server immediately. Within a few seconds you
should see **14 tools** populate under the connector:

```
set_scale_preset, set_scale_manual,
add_area, add_linear, add_count, add_arc,
snap_to_vector,
list_items, search_projects, recall_customer,
list_assemblies, apply_assembly,
build_quote, push_to_xero
```

If you see 0 tools or an auth error, jump to **Troubleshooting** below.

---

## Step 3 — Smoke test (≈ 3 min)

In the right-hand **Test your agent** pane, type:

> Search projects for "smith"

The orchestrator should pick `search_projects` and reply with whatever's
in the memory layer (probably an empty result on a fresh tenant — that's
fine, it proves the connection works).

For a fuller end-to-end test, paste this prompt:

> Create a new project called "Test Job". On page 1, set the scale to
> 1:100 metric. Add a 10m × 10m area called "Roof". Show me the quote.

You should see the agent call `search_projects` (to check for an existing
match), then a chain of measurement tools, then `build_quote` returning
a JSON with lines, subtotal, GST, total. **Do not** ask it to push to
Xero in this smoke test — first real push should happen with a human
watching the Xero Demo Company tenant.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Failed to fetch tools" / 401 | API-key value missing `Bearer ` prefix | Edit the connection → re-enter with `Bearer <token>` |
| "Failed to fetch tools" / 404 | Wrong host in connector General tab | Edit connector → General → Host → save → retry connection |
| Tools list empty, no error | Custom domain not bound / `x-ms-agentic-protocol` missing | Verify YAML uploaded correctly; re-import if needed |
| Works in test pane, fails when published | DLP policy blocking the custom connector | Ask your Power Platform admin to allow this connector in the Business data group |
| Token revoked | Office@drivenwp.com rotated it | Ask for a fresh one, edit the connection |

---

## What to hand back to Office@drivenwp.com when you're done

1. ✅ Connector created — share the connector name + environment name.
2. ✅ Agent linked — share the agent name + a screenshot of the 14
   tools listed under it.
3. ✅ Smoke test result — confirm `search_projects` returns a response
   (even an empty one).

Do **not** push to Xero, even the Demo tenant, until you've handed off
to Office@drivenwp.com for the first manual review.

---

## Background (skim if curious)

- The worker is a Cloudflare Worker at `apps/worker/src/index.ts` in
  this repo. The MCP endpoint lives at `/mcp` (see
  `apps/worker/src/mcp/server.ts`).
- All Xero pushes are hard-coded `Status: "DRAFT"`. Nothing the agent
  does can send a real invoice — that always needs a human in Xero.
- The token you're pasting is server-side hashed (SHA-256) in D1.
  Rotating it deletes the hash; the agent's connection 401s and needs
  a fresh key. Same blast radius as Claude Desktop or any other MCP
  client.
- More detail in `dispatches/copilot-studio-mcp-setup.md` and the
  PR #2 description.
