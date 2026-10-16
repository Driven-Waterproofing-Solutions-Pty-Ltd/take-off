#!/usr/bin/env bash
#
# One-shot local deploy for the Driven Takeoff worker.
# Run this on YOUR machine (not the cloud sandbox) after `wrangler login`.
#
#   cd take-off/take-off-web
#   ./deploy-local.sh
#
# It builds the SPA + worker and ships to your Cloudflare account, then
# walks you through setting secrets. D1 + R2 are already provisioned and
# migrated, so nothing else is needed for the first deploy.
#
set -euo pipefail

cd "$(dirname "$0")"
WORKER_DIR="apps/worker"

echo "==> Checking wrangler auth…"
if ! pnpm --filter @takeoff/worker exec wrangler whoami >/dev/null 2>&1; then
  echo "Not logged in. Launching wrangler login (a browser window will open)…"
  pnpm --filter @takeoff/worker exec wrangler login
fi
pnpm --filter @takeoff/worker exec wrangler whoami | sed -n '1,6p'

echo
echo "==> Installing dependencies…"
pnpm install --frozen-lockfile

echo
echo "==> Deploying worker (this runs the SPA build first; ~1–2 min)…"
pnpm --filter @takeoff/worker exec wrangler deploy

echo
echo "==> Deploy done. Now set secrets (skip any with Ctrl-C; re-run anytime)."
echo "    Generate strong values with:  openssl rand -base64 32"
echo

set_secret() {
  local name="$1" hint="$2"
  echo "---- $name ----"
  echo "    $hint"
  read -r -p "Set $name now? [y/N] " ans
  if [[ "${ans:-N}" =~ ^[Yy]$ ]]; then
    ( cd "$WORKER_DIR" && npx wrangler secret put "$name" )
  else
    echo "    skipped."
  fi
  echo
}

set_secret MCP_BOOTSTRAP_TOKEN "Random 32+ bytes. SAVE A COPY — mints MCP tokens + signs sessions/OAuth."
set_secret XERO_TOKEN_KEY      "Random 32+ bytes. AES-GCM key encrypting Xero tokens at rest."
set_secret APP_BASE_URL        "Your public URL, e.g. https://takeoff-worker.<subdomain>.workers.dev"
set_secret ANTHROPIC_API_KEY   "From console.anthropic.com — powers the in-app takeoff agent."
echo "Xero secrets (XERO_CLIENT_ID/SECRET/REDIRECT_URI) — set these later once"
echo "you've registered the developer app at developer.xero.com."
echo

echo "==> Redeploying so the worker picks up the secrets…"
pnpm --filter @takeoff/worker exec wrangler deploy

echo
echo "==> Done. Find your URL in the deploy output above (…workers.dev), then:"
echo "    curl https://<your-url>/health     # expect {\"ok\":true}"
echo
echo "Send that URL back to the chat and the admin user + MCP tokens can be minted."
