# Deploy runbook — Workers Builds (auto-deploy from GitHub)

End-to-end ship guide. After the one-time dashboard setup below, every `git push` to the production branch triggers a Cloudflare-side build + deploy. You never run `wrangler` locally.

The Worker serves **both** the API and the SPA from a single URL via Workers Assets — there's only one thing to deploy, not two.

---

## 0. Prerequisites (one time)

- A Cloudflare account with Workers + D1 + R2 enabled (free tier fine).
- Admin access on the GitHub repo (`Driven-Waterproofing-Solutions-Pty-Ltd/take-off`) so Cloudflare can install its GitHub App.
- A Xero account; admin permission to register a developer app.

---

## 1. Cloudflare resources (already exist on Driven's account)

| Resource | Name | ID |
|---|---|---|
| D1 | `takeoff-production` | `cacd85f3-b42e-4d09-be7a-bbe11cbb2cdc` (Oceania) |
| R2 | `takeoff-pdfs` | (ENAM) |

All three D1 migrations have been applied to the remote DB (`0001_init`, `0002_auth`, `0003_page_legend`). 17 tables live.

Future migrations: when you add `apps/worker/migrations/0004_*.sql`, run **once** from a machine that has wrangler installed:
```bash
cd take-off-web/apps/worker
wrangler d1 migrations apply takeoff-production --remote
```
That's the only `wrangler` you'll touch — we deliberately do NOT run migrations from the build, because a bad migration shouldn't ship silently on push.

---

## 2. Register a Xero developer app

1. Go to <https://developer.xero.com/app/manage>.
2. **New app** → "Web app".
3. Name: `Driven Takeoff`.
4. Company URL: `https://takeoff.drivenwp.com` (or your eventual production URL).
5. OAuth 2.0 redirect URI: **`https://takeoff.drivenwp.com/xero/oauth/callback`** (must match the `XERO_REDIRECT_URI` you'll set as a secret).
6. Scopes: `accounting.transactions`, `accounting.contacts`, `offline_access`.
7. Copy the **Client ID** and generate a **Client Secret** — both go into worker secrets in step 4.

---

## 3. Connect the repo to Workers Builds

In the Cloudflare dashboard:

1. **Workers & Pages → Create**.
2. Pick **Workers** → **Import a Repository**.
3. Authorize the Cloudflare GitHub App if prompted; pick the `take-off` repository.
4. **Branch:** initially `claude/ai-measurement-invoice-app-2s7bP`. Switch to `main` (or your prod branch) after merge.
5. **Build configuration:**
   - **Root directory:** `take-off-web/apps/worker`
   - **Build command:** *(leave empty)* — the `[build]` block in `wrangler.toml` handles it.
   - **Deploy command:** `npx wrangler deploy` (default; leave as-is).
6. Click **Save and deploy**.

The first build will install pnpm deps, run `vite build` on the SPA, bundle the worker, and deploy. Watch **Workers & Pages → `takeoff-worker` → Deployments** for green.

After this connection, every push to the chosen branch triggers a new build automatically. You never run anything locally.

---

## 4. Set secrets (one time, in the dashboard)

After the first deploy succeeds, go to **Workers & Pages → `takeoff-worker` → Settings → Variables and Secrets** and add these six secrets (all "Encrypt"):

| Name | Value |
|---|---|
| `XERO_CLIENT_ID` | from developer.xero.com |
| `XERO_CLIENT_SECRET` | from developer.xero.com |
| `XERO_REDIRECT_URI` | e.g. `https://takeoff.drivenwp.com/xero/oauth/callback` |
| `XERO_TOKEN_KEY` | `openssl rand -base64 32` — AES-GCM key encrypting Xero tokens at rest |
| `MCP_BOOTSTRAP_TOKEN` | `openssl rand -base64 32` — **save a copy locally**; mints MCP tokens AND HMAC-signs OAuth state. Rotating it invalidates every session and every MCP token. |
| `APP_BASE_URL` | e.g. `https://takeoff.drivenwp.com` |

`ANTHROPIC_API_KEY` is **not** needed yet — Phase 5 only.

Hit **Deploy** again from the dashboard so the worker picks up the secrets, or push any commit to trigger a redeploy.

---

## 5. Custom domain

**Workers & Pages → `takeoff-worker` → Settings → Triggers → Custom Domains → Add Custom Domain.**

Add `takeoff.drivenwp.com` (or your preferred subdomain). Cloudflare auto-provisions the cert via the existing zone in ~1 minute.

---

## 6. Bootstrap your first admin user

Once the worker is live with secrets set:

```bash
# Replace <host> with your domain, $BOOTSTRAP with the secret you saved in step 4.
curl -X POST https://<host>/admin/users \
  -H "Authorization: Bearer $BOOTSTRAP" \
  -H "Content-Type: application/json" \
  -d '{"email":"office@drivenwp.com","password":"<choose a strong password>","name":"Office","role":"admin"}'
# → {"id":"...","email":"office@drivenwp.com","name":"Office","role":"admin"}
```

Visit `https://<host>/` in a browser — the login page should appear; log in with the email + password you just set.

---

## 7. Live smoke test

Walk a fake roof through the system to prove every layer works.

```bash
HOST=https://<your-host>
BOOTSTRAP=<your bootstrap token>

# Mint a per-test MCP token
TOKEN=$(curl -s -X POST $HOST/admin/mcp/tokens \
  -H "Authorization: Bearer $BOOTSTRAP" \
  -H "Content-Type: application/json" \
  -d '{"name":"first-smoke"}' | jq -r .token)

# Create project + calibrate page 0 + add 10m × 10m area + build quote
PID=$(curl -s -X POST $HOST/api/projects \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"First Smoke Test"}' | jq -r .id)

curl -s -X POST $HOST/api/measure/scale/preset \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"project_id\":\"$PID\",\"page_index\":0,\"preset_label\":\"1:100\"}"

curl -s -X POST $HOST/api/measure/shapes/area \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"project_id\":\"$PID\",\"page_index\":0,\"snap\":false,\"points\":[{\"x\":0,\"y\":0},{\"x\":283.4645,\"y\":0},{\"x\":283.4645,\"y\":283.4645},{\"x\":0,\"y\":283.4645}]}"

curl -s $HOST/api/memory/quote/$PID -H "Authorization: Bearer $TOKEN" | jq
# Expect: 1 line, ≈ 99.9996 m²
```

The detailed packet for a full end-to-end (REST + MCP equivalence + optional Xero draft push + Claude Desktop wiring) lives at `take-off-web/dispatches/mcp-live-proof.md`. Fill in `BASE_URL`, `BOOTSTRAP`, optionally `XERO_TENANT`, and execute.

---

## 8. Connect Xero (one-time)

After login, navigate to `https://<host>/xero/oauth/start` in the browser. Xero login → pick the Demo Company → redirect lands back on the app. From then on, `push_to_xero` works.

To prime the customer cache before the nightly cron:
```bash
curl -X POST $HOST/xero/sync -H "Authorization: Bearer $TOKEN"
# → {"synced":<n>}
```

---

## 9. Wire Claude Desktop

```bash
# Mint a token specific to this Claude install
curl -X POST $HOST/admin/mcp/tokens \
  -H "Authorization: Bearer $BOOTSTRAP" -H "Content-Type: application/json" \
  -d '{"name":"Claude Desktop — Office laptop"}'
# → { "token": "..." }
```

Paste into `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS), `~/.config/Claude/claude_desktop_config.json` (Linux), or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "driven-takeoff": {
      "url": "https://<host>/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

Restart Claude Desktop. In a fresh chat: *"What takeoff tools do you have?"* → 14 tools should enumerate.

---

## 10. Monitoring & rollback

| What | Where |
|---|---|
| Live logs | Dashboard → `takeoff-worker` → **Logs** (or `wrangler tail` if you've got it set up locally) |
| Build history | Dashboard → `takeoff-worker` → **Deployments** — every push gets a row; click into the failing one to see logs |
| Rollback | Dashboard → **Deployments** → previous green deployment → **Rollback** |
| Metrics | Dashboard → `takeoff-worker` → **Observability** (request volume, p50/p95, error rate) |
| D1 inspect | `wrangler d1 execute takeoff-production --remote --command "SELECT COUNT(*) FROM projects"` |

Future deploys: just `git push`. ~2 minutes for the build to land.

---

## 11. Known gotchas

- **MuPDF WASM drift** — `apps/web/public/mupdf-wasm.wasm` must match the installed `mupdf` package. The CI workflow (`take-off-web-ci.yml`) checks this and fails loud if they diverge.
- **Xero `Status: "DRAFT"` is hard-coded** — `push_to_xero` cannot send `AUTHORISED`. To make a quote live, the customer accepts it inside Xero or you do it manually.
- **`MCP_BOOTSTRAP_TOKEN` is dual-use** — both mints MCP tokens AND HMAC-signs Xero OAuth state cookies. Rotating it logs everyone out and invalidates all MCP tokens. Treat it like a god credential.
- **`/xero/oauth/start` requires auth** — only an authenticated user can connect the Xero tenant. Don't add it to any Access bypass list.
- **First D1 query after cold start** ~50ms slower than subsequent; expected.
- **R2 bucket region is ENAM** — if AU latency for PDF downloads matters, recreate the bucket with the right jurisdiction.

---

## 12. Cloudflare Access (optional belt-and-braces)

In-app auth (email/password + sessions) is the primary gate. If you want an SSO layer on top while testing — useful to keep the login page itself invisible to crawlers — add an Access policy:

1. Zero Trust → **Access → Applications → Add → Self-hosted**.
2. Domain: `takeoff.drivenwp.com`.
3. **Bypass paths** (so OAuth/MCP/health/admin/login keep working):
   - `/xero/oauth/callback` (Xero's redirect carries no Access cookie — CSRF is the HMAC state)
   - `/mcp` (bearer-token authed)
   - `/health`
   - `/admin/mcp/tokens` (bootstrap-token authed)
   - `/auth/login`, `/auth/logout`
   - **Do NOT bypass `/xero/oauth/start`** — it requires auth at the worker layer to prevent tenant hijack.
4. Policy: `Allow if email ends with @drivenwp.com`.

When you remove Access, the in-app login still gates everything.

---

## 13. Hand-off checklist

Tick before declaring shipped:

- [ ] Workers Builds connected to the repo; first deploy green
- [ ] 6 secrets visible in dashboard
- [ ] Custom domain bound; `/health` returns `{ok:true}` on it
- [ ] First admin user created; can log in via SPA
- [ ] Smoke test passes: project → scale → 10m × 10m area → quote line ≈ 99.9996 m²
- [ ] Xero developer app registered; OAuth callback matches `XERO_REDIRECT_URI`
- [ ] Xero connected via `/xero/oauth/start`; `/xero/sync` returns synced > 0
- [ ] Claude Desktop MCP token minted + config wired; `tools/list` returns 14 tools
- [ ] (Optional) Cloudflare Access policy with the correct bypass paths
