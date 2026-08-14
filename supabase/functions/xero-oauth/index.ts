/**
 * Xero OAuth Callback Handler
 *
 * This Supabase Edge Function acts as the redirect URI for the Xero OAuth 2.0 PKCE
 * authorization flow used by the ProTakeoff desktop application.
 *
 * When Xero redirects here after user authorization, this function extracts the
 * authorization code from the URL and displays it on a simple page so the user
 * can copy it back into the ProTakeoff app to complete the connection.
 *
 * Route:  GET /functions/v1/xero-oauth/callback?code=XXX&state=YYY
 */

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    const url = new URL(req.url);

    // ── Success callback from Xero ────────────────────────────────────────
    if (url.pathname.endsWith('/callback')) {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');
        const errorDesc = url.searchParams.get('error_description');

        if (error) {
            const html = buildErrorPage(error, errorDesc || '');
            return new Response(html, {
                headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
            });
        }

        if (!code) {
            const html = buildErrorPage('Missing Code', 'No authorization code was returned by Xero.');
            return new Response(html, {
                headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
                status: 400,
            });
        }

        const html = buildSuccessPage(code, state || '');
        return new Response(html, {
            headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
        });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 404,
    });
});

// ── HTML page builders ────────────────────────────────────────────────────────

function buildSuccessPage(code: string, state: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ProTakeoff – Xero Connected</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #f0fdf4;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: white;
      border-radius: 16px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
      padding: 40px;
      max-width: 520px;
      width: 100%;
      text-align: center;
    }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 22px; font-weight: 700; color: #111827; margin-bottom: 8px; }
    p { font-size: 14px; color: #6b7280; margin-bottom: 24px; line-height: 1.6; }
    .field-label { font-size: 12px; font-weight: 600; color: #374151; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; text-align: left; }
    .code-box {
      background: #f9fafb;
      border: 1.5px solid #d1d5db;
      border-radius: 10px;
      padding: 14px 18px;
      font-family: "SF Mono", "Fira Code", monospace;
      font-size: 13px;
      color: #111827;
      word-break: break-all;
      margin-bottom: 16px;
      user-select: all;
      cursor: text;
      text-align: left;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: #16a34a;
      color: white;
      border: none;
      border-radius: 8px;
      padding: 10px 24px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
      margin: 4px;
    }
    .btn:hover { background: #15803d; }
    .btn:active { background: #166534; }
    .btn-secondary { background: #2563eb; }
    .btn-secondary:hover { background: #1d4ed8; }
    .copied { background: #7c3aed !important; }
    .note { margin-top: 20px; font-size: 12px; color: #9ca3af; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h1>Xero Authorization Successful</h1>
    <p>
      Copy the <strong>Authorization Code</strong> and <strong>State</strong> below and paste them back into the<br />
      <strong>ProTakeoff</strong> app to complete the connection.
    </p>
    <div class="field-label">Authorization Code</div>
    <div class="code-box" id="code">${escapeHtml(code)}</div>
    ${state ? `<div class="field-label">State</div>
    <div class="code-box" id="state">${escapeHtml(state)}</div>` : ''}
    <button class="btn" id="copyCodeBtn" onclick="copyField('code', 'copyCodeBtn')">
      📋 Copy Code
    </button>
    ${state ? `<button class="btn btn-secondary" id="copyStateBtn" onclick="copyField('state', 'copyStateBtn')">
      📋 Copy State
    </button>` : ''}
    <p class="note">You can close this tab after copying both values.</p>
  </div>
  <script>
    function copyField(fieldId, btnId) {
      const text = document.getElementById(fieldId).textContent;
      navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById(btnId);
        const original = btn.innerHTML;
        btn.textContent = '✓ Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.innerHTML = original;
          btn.classList.remove('copied');
        }, 2000);
      });
    }
  </script>
</body>
</html>`;
}

function buildErrorPage(error: string, description: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ProTakeoff – Xero Error</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #fef2f2;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: white;
      border-radius: 16px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
      padding: 40px;
      max-width: 480px;
      width: 100%;
      text-align: center;
    }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 22px; font-weight: 700; color: #111827; margin-bottom: 8px; }
    p { font-size: 14px; color: #6b7280; line-height: 1.6; }
    .error-detail {
      margin-top: 16px;
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 8px;
      padding: 12px;
      font-size: 13px;
      color: #991b1b;
      font-family: monospace;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">❌</div>
    <h1>Authorization Failed</h1>
    <p>Xero returned an error during the authorization process. Please close this tab and try again in ProTakeoff.</p>
    ${description ? `<div class="error-detail">${escapeHtml(error)}: ${escapeHtml(description)}</div>` : ''}
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
