#!/usr/bin/env bash
#
# upload-aqua-agent.sh
# Publishes the AQUA Operations declarative agent to your Microsoft 365
# org app catalog using your logged-in Azure CLI session.
#
# PREREQS:
#   - az CLI installed
#   - az login   (as a Teams admin or Global admin)
#   - the zip downloaded (edit ZIP path below if not in ~/Downloads)
#
# USAGE:
#   chmod +x upload-aqua-agent.sh
#   ./upload-aqua-agent.sh
#
set -euo pipefail

ZIP="${1:-$HOME/Downloads/aqua-operations-agent.zip}"

if [ ! -f "$ZIP" ]; then
  echo "❌ Zip not found at: $ZIP"
  echo "   Pass the path as an argument:  ./upload-aqua-agent.sh /path/to/aqua-operations-agent.zip"
  exit 1
fi

if ! command -v az >/dev/null 2>&1; then
  echo "❌ Azure CLI (az) not found. Install it or use the browser route:"
  echo "   https://dev.teams.microsoft.com  ->  Apps  ->  Import an existing app"
  exit 1
fi

echo "→ Getting a Microsoft Graph token from your az session..."
TOKEN=$(az account get-access-token --resource https://graph.microsoft.com --query accessToken -o tsv)

echo "→ Publishing $ZIP to the org app catalog..."
RESP=$(curl -s -w $'\n%{http_code}' -X POST \
  "https://graph.microsoft.com/v1.0/appCatalogs/teamsApps" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/zip" \
  --data-binary "@$ZIP")

BODY=$(echo "$RESP" | sed '$d')
CODE=$(echo "$RESP" | tail -n 1)

echo "── HTTP $CODE ──────────────────────────────"
echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
echo "────────────────────────────────────────────"

case "$CODE" in
  200|201) echo "✅ Published. Open M365 Copilot Chat → look for @AQUA Operations." ;;
  409)     echo "⚠️ Already in the catalog. Paste this output back and I'll give you the update (PUT) command." ;;
  403)     echo "❌ Forbidden — your account likely lacks AppCatalog.ReadWrite.All / admin consent (tenant governance). Use the browser Import instead, or tell me and we'll do an app registration." ;;
  *)       echo "❌ Failed. Paste the output above to me and I'll diagnose." ;;
esac
