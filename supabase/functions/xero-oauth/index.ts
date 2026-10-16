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
 *
 * Deployment: Xero redirects the user's browser here without a Supabase JWT,
 * so this function must be deployed with JWT verification turned off:
 *
 *   supabase functions deploy xero-oauth --no-verify-jwt
 *
 * The page is plain text on purpose: Supabase Edge Functions rewrite GET
 * responses served as text/html to text/plain, so an HTML page would show up
 * as raw source. Plain text also leaves nothing for injected markup to do.
 *
 * The page is only ever a top-level navigation target, so it sends no CORS
 * headers (other origins must not be able to read the code) and asks browsers
 * not to cache, frame or leak it via the Referer header.
 */

const pageHeaders = {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
};

/** Keeps a query value on one line so it can't fake other lines of the page. */
function oneLine(value: string, max = 2048): string {
    return value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max);
}

Deno.serve((req: Request) => {
    if (req.method !== 'GET') {
        return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } });
    }

    const url = new URL(req.url);

    // ── Success callback from Xero ────────────────────────────────────────
    if (url.pathname.endsWith('/callback')) {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');
        const errorDesc = url.searchParams.get('error_description');

        if (error) {
            return new Response(buildErrorPage(error, errorDesc || ''), { headers: pageHeaders });
        }

        if (!code) {
            return new Response(buildErrorPage('Missing Code', 'No authorization code was returned by Xero.'), {
                headers: pageHeaders,
                status: 400,
            });
        }

        return new Response(buildSuccessPage(code, state || ''), { headers: pageHeaders });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 404,
    });
});

// ── Page builders ─────────────────────────────────────────────────────────────

function buildSuccessPage(code: string, state: string): string {
    return [
        'ProTakeoff - Xero authorization successful',
        '',
        'Copy the Authorization Code and the State below and paste them into',
        'ProTakeoff to finish connecting. You can close this tab afterwards.',
        '',
        'Authorization Code:',
        oneLine(code),
        '',
        'State:',
        state ? oneLine(state) : '(none returned)',
        '',
    ].join('\n');
}

function buildErrorPage(error: string, description: string): string {
    return [
        'ProTakeoff - Xero authorization failed',
        '',
        'Xero returned an error during authorization. Close this tab and try again in ProTakeoff.',
        '',
        description ? `${oneLine(error, 200)}: ${oneLine(description, 1000)}` : oneLine(error, 200),
        '',
    ].join('\n');
}
