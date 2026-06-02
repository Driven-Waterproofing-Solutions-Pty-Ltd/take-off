# Deploy runbook

End-to-end ship guide for `take-off-web/`. Follow top to bottom on a fresh machine and the system will be live, gated, and connectable from Claude Desktop in under 30 minutes.

If a step says "you do this", the harness or the worker cannot do it for you — credentials, OAuth registrations, domain bindings.

---

## 0. Prerequisites (you do this once)

- A Cloudflare account with billing enabled (free tier is fine for this; R2 needs a credit card on file but won't bill at this volume).
- A Xero account with admin access. Anything you push will go to the **Demo Company** until you switch it.
- `node` ≥ 20 and `pnpm` ≥ 9 installed locally (the repo uses `pnpm@9.0.0`).
- A clone of this repo on a machine you trust to hold deploy credentials.

---

## 1. Install + verify locally

```bash
cd take-off-web
pnpm install                   # ~30s on a warm cache
pnpm -r typecheck              # must be green before deploy
pnpm -r build                  # produces apps/web/dist + worker bundle dry-run
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm exec playwright test
                               # 4 e2e tests — must all pass
```

If any of those fail, **do not deploy**. Open the failing output and fix or escalate.

---

## 2. Cloudflare resources

The D1 database and R2 bucket already exist (created during build):

| Resource | Name | ID / note |
|---|---|---|
| D1 | `takeoff-production` | `cacd85f3-b42e-4d09-be7a-bbe11cbb2cdc` (Oceania) |
| R2 | `takeoff-pdfs` | ENAM |

These are referenced from `apps/worker/wrangler.toml`. Nothing to do unless you're starting fresh on a new account.

### Starting fresh on a new account

```bash
wrangler login

# Create resources
wrangler d1 create takeoff-production --location oc      # copy uuid → wrangler.toml
wrangler r2 bucket create takeoff-pdfs

# Apply schema to the remote D1 (local was already applied during dev)
cd apps/worker
wrangler d1 migrations apply takeoff-production --remote
```

---

## 3. Generate the two secret keys

Both need to be cryptographically random and **never** committed.

```bash
# 32-byte AES key for encrypting Xero tokens at rest
XERO_TOKEN_KEY=$(openssl rand -base64 32)
echo "XERO_TOKEN_KEY=$XERO_TOKEN_KEY"        # stash in your password manager

# 32-byte bootstrap token (mints MCP client tokens; also HMACs OAuth state)
MCP_BOOTSTRAP_TOKEN=$(openssl rand -base64 32)
echo "MCP_BOOTSTRAP_TOKEN=$MCP_BOOTSTRAP_TOKEN"
```

**Rotation**: rotating `XERO_TOKEN_KEY` requires the user to reconnect Xero (old encrypted refresh tokens become unreadable). Rotating `MCP_BOOTSTRAP_TOKEN` invalidates all minted MCP tokens — be deliberate.

---

## 4. Register a Xero developer app (you do this)

1. Go to <https://developer.xero.com/app/manage>.
2. **New app** → "Web app".
3. Name: `Driven Takeoff`.
4. Company / app URL: `https://takeoff.drivenwp.com`.
5. OAuth 2.0 redirect URI: **`https://takeoff.drivenwp.com/xero/oauth/callback`** (must match exactly).
6. Scopes you need on the app's configuration page:
   - `accounting.transactions`
   - `accounting.contacts`
   - `offline_access`
7. Copy **Client ID** and generate **Client Secret**. Both go into worker secrets next.

---

## 5. Set worker secrets

```bash
cd apps/worker

wrangler secret put XERO_CLIENT_ID         # from Xero developer page
wrangler secret put XERO_CLIENT_SECRET     # from Xero developer page
wrangler secret put XERO_REDIRECT_URI      # paste: https://takeoff.drivenwp.com/xero/oauth/callback
wrangler secret put XERO_TOKEN_KEY         # paste the value from step 3
wrangler secret put MCP_BOOTSTRAP_TOKEN    # paste the value from step 3
wrangler secret put APP_BASE_URL           # paste: https://takeoff.drivenwp.com
```

`ANTHROPIC_API_KEY` is **not** needed yet — Phase 5 only. Skip.

Verify they're all present:

```bash
wrangler secret list
```

---

## 6. Deploy the worker

```bash
cd apps/worker
wrangler deploy
```

You should see:

```
Total Upload: ~1.9 MiB / gzip: ~340 KiB
Your worker has access to the following bindings:
  - D1: DB (takeoff-production)
  - R2: PDFS (takeoff-pdfs)
Published takeoff-worker (...)
  https://takeoff-worker.<your-subdomain>.workers.dev
```

Smoke-test:

```bash
curl -s https://takeoff-worker.<your-subdomain>.workers.dev/health
# → {"ok":true}
```

If that fails, run `wrangler tail` in another terminal and re-hit the URL to see live logs.

---

## 7. Custom domain + Cloudflare Access (production gate)

The MVP plan auth model is **Cloudflare Access (Zero Trust) in front of the worker, single org**. This is what the auth middleware expects via `Cf-Access-Authenticated-User-Email`.

### 7a. Bind the worker to `takeoff.drivenwp.com`

In the Cloudflare dashboard:
1. Workers & Pages → `takeoff-worker` → **Settings → Triggers → Custom Domains**.
2. **Add custom domain** → `takeoff.drivenwp.com`. Cloudflare auto-provisions the cert via the existing zone.

### 7b. Put Access in front of it

1. Zero Trust dashboard → **Access → Applications → Add an application → Self-hosted**.
2. Application domain: `takeoff.drivenwp.com`.
3. **Bypass paths** (so Xero's OAuth callback and the MCP endpoint can reach the worker without an Access challenge):
   - `/xero/oauth/callback` — Xero's redirect carries no Access cookie. CSRF is enforced by the HMAC-signed state cookie set in `/oauth/start`.
   - `/mcp` — bearer-token authed at the application layer.
   - `/health` — public liveness probe.
   - `/admin/mcp/tokens` — bootstrap-token authed at the application layer.
   - `/auth/login`, `/auth/logout` — the login page itself must be reachable.

   **Do NOT bypass `/xero/oauth/start`** — it requires an authenticated session at the worker layer to prevent unauthenticated visitors from hijacking which Xero tenant is connected.
4. Identity provider: Google (or your team's preferred SSO).
5. Access policy: `Allow if email ends with @drivenwp.com` — start strict, loosen later.

After this, hitting `https://takeoff.drivenwp.com/` from a non-Driven email gets the Access login screen. The worker reads `Cf-Access-Authenticated-User-Email` and admits the request.

---

## 8. Deploy the web app

The web app is a static SPA (Vite build → `apps/web/dist/`). Easiest path: Cloudflare Pages, set to deploy from this repo's branch.

```bash
# One-time setup via dashboard:
# Workers & Pages → Create application → Pages → Connect to Git
# - Repository: Driven-Waterproofing-Solutions-Pty-Ltd/take-off
# - Production branch: main (or whatever branch you ship from)
# - Build command:        cd take-off-web && pnpm install --frozen-lockfile && pnpm --filter @takeoff/web build
# - Build output:         take-off-web/apps/web/dist
# - Root directory:       /            (leave default)
# - Environment variables: none — the SPA is fully client-side
```

Bind it to the **same** custom domain you used for the worker, but a different path (the worker handles `/api/*`, `/mcp`, `/xero/*`, and the Pages app serves everything else). Or, simpler: put Pages on `takeoff.drivenwp.com` and let it route `/api/*` etc. to the worker via a Pages Function. The cleanest setup uses **Workers Routes** so `takeoff.drivenwp.com/api/*`, `/mcp`, `/xero/*` go to the worker and everything else to Pages.

### Route configuration (in dashboard)

Worker route patterns (Workers & Pages → `takeoff-worker` → Settings → Triggers → Routes):

```
takeoff.drivenwp.com/api/*
takeoff.drivenwp.com/mcp
takeoff.drivenwp.com/mcp/*
takeoff.drivenwp.com/xero
takeoff.drivenwp.com/xero/*
takeoff.drivenwp.com/health
takeoff.drivenwp.com/admin/*
```

Everything else falls through to Pages.

---

## 9. Mint an MCP token + wire Claude Desktop

```bash
curl -X POST https://takeoff.drivenwp.com/admin/mcp/tokens \
  -H "Authorization: Bearer $MCP_BOOTSTRAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Claude Desktop — Office laptop"}'
# → {"id":"<uuid>","token":"<long random string>"}
```

Save the token. Then in Claude Desktop's MCP config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "driven-takeoff": {
      "url": "https://takeoff.drivenwp.com/mcp",
      "headers": {
        "Authorization": "Bearer <token from above>"
      }
    }
  }
}
```

Restart Claude Desktop. Open a chat and ask: *"List the takeoff tools you have."* You should see 14 tools enumerate.

---

## 10. End-to-end smoke test (live)

In Claude Desktop, walk through a fake job:

1. *"Create a project called 'Smoke Test Roof'."* → expect a UUID back.
2. *"Set page 0 of project `<id>` to scale 1:100."* → expect `{isSet: true, pixelsPerUnit: 28.3465, unit: 'm'}`.
3. *"Add an area shape on page 0 with these corners: (0,0), (283.4645,0), (283.4645,283.4645), (0,283.4645)."* → expect `value ≈ 99.9996` (≈ 100 m²).
4. *"Build the quote draft."* → expect `subtotal: 0, gst: 0, total: 0` (no assemblies attached).
5. Visit `https://takeoff.drivenwp.com/?project=<id>` in a browser. After Access login, the sidebar shows "Smoke Test Roof".

If all five pass, you're live.

---

## 11. Connect Xero (one-time)

1. From a browser logged into Cloudflare Access, navigate to `https://takeoff.drivenwp.com/xero/oauth/start`.
2. Xero login → pick the Demo Company first.
3. After redirect, hit `https://takeoff.drivenwp.com/api/projects` (with browser cookies) — Xero contact sync runs on the next nightly cron, or trigger manually:

```bash
TOKEN=<the MCP token from step 9>
curl -X POST https://takeoff.drivenwp.com/xero/sync \
  -H "Authorization: Bearer $TOKEN"
# → {"synced":<n>}
```

---

## 12. Monitoring

```bash
wrangler tail                                  # live worker logs
wrangler d1 execute takeoff-production --remote \
  --command "SELECT COUNT(*) FROM projects"    # quick DB probe
```

Cloudflare dashboard → Workers & Pages → `takeoff-worker` → **Observability** for request volume, p50/p95, errors. Set up an alert on 5xx rate > 1% if you want a pager.

---

## 13. Rollback

```bash
wrangler deployments list                      # find the previous version
wrangler rollback <deployment-id>              # restore
```

Static assets on Pages roll back via the dashboard (each Git push is a deployment with a Restore button).

---

## 14. Known gotchas

- **MuPDF WASM version drift** — `public/mupdf-wasm.wasm` must match the `mupdf` package version in `node_modules`. The build does not enforce this; after a `pnpm up mupdf` you must `cp node_modules/.pnpm/mupdf@*/node_modules/mupdf/dist/mupdf-wasm.wasm apps/web/public/`. The Playwright suite catches this if you run it.
- **Xero `Status: "DRAFT"` is hard-coded** — `push_to_xero` cannot send `AUTHORISED`. To make a quote live, the user accepts it inside Xero.
- **`MCP_BOOTSTRAP_TOKEN` doubles as the OAuth-state HMAC key** — if you rotate it, in-flight Xero connection flows will fail; restart the connect flow.
- **First D1 query after a worker cold start** can be ~50ms slower; subsequent queries are sub-ms.
- **Local dev needs an MCP token in `localStorage.takeoff_token`** so the canvas's REST calls authorise. Mint one against the local worker once, paste it into DevTools.
- **R2 bucket region is ENAM** (the create API ignored my `oc` hint). If AU latency matters for PDF downloads, drop and recreate with the right jurisdiction.

---

## 15. Post-deploy hand-off checklist

Tick each before declaring "shipped":

- [ ] `pnpm -r typecheck` and `pnpm -r build` both green locally
- [ ] `pnpm exec playwright test` — 4 passes
- [ ] `wrangler deploy` succeeded; `/health` returns `{ok:true}` on the workers.dev URL
- [ ] Custom domain bound to worker; `https://takeoff.drivenwp.com/health` returns `{ok:true}`
- [ ] Cloudflare Access policy active; bypass paths configured
- [ ] All 6 secrets set; `wrangler secret list` shows them
- [ ] Xero dev app registered; OAuth callback URI matches `XERO_REDIRECT_URI`
- [ ] Xero connected to Demo Company; `/xero/sync` returns `{synced:n}` with n > 0
- [ ] MCP token minted; Claude Desktop sees 14 tools
- [ ] Smoke test (step 10) passes end-to-end
- [ ] `wrangler tail` shows zero errors during the smoke test
