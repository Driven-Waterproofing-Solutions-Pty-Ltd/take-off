import { LazyStore } from '@tauri-apps/plugin-store';
import { open } from '@tauri-apps/plugin-shell';
// Xero's identity and Accounting APIs do not send CORS headers, so the WebView's
// own fetch is blocked. The Tauri HTTP plugin performs the request natively;
// its allowed URLs are scoped in src-tauri/capabilities/default.json.
import { fetch } from '@tauri-apps/plugin-http';

// ── Keys used in persistent storage ─────────────────────────────────────────
const KEY_CLIENT_ID = 'xero_client_id';
const KEY_TOKENS = 'xero_tokens';
const KEY_TENANT_ID = 'xero_tenant_id';
const KEY_CODE_VERIFIER = 'xero_code_verifier';
const KEY_STATE = 'xero_state';

// ── Public types ─────────────────────────────────────────────────────────────
export interface XeroTokens {
    access_token: string;
    refresh_token: string;
    expires_at: number; // Unix ms timestamp
}

export interface XeroTenant {
    tenantId: string;
    tenantName: string;
    tenantType: string;
}

export interface XeroContact {
    ContactID: string;
    Name: string;
    EmailAddress?: string;
    FirstName?: string;
    LastName?: string;
}

export interface XeroAccount {
    AccountID: string;
    Code: string;
    Name: string;
    Type: string;
    Class?: string;
    Status?: string;
}

export interface XeroTaxRate {
    Name: string;
    TaxType: string;
    ReportTaxType?: string;
    Status: string;
    CanApplyToRevenue?: boolean;
    EffectiveRate?: number;
}

export interface XeroLineItem {
    Description: string;
    Quantity: number;
    UnitAmount: number;
    AccountCode?: string;
    TaxType?: string;
    LineAmount?: number;
}

export interface XeroInvoicePayload {
    Type: 'ACCREC' | 'ACCPAY';
    Contact: { ContactID: string };
    LineItems: XeroLineItem[];
    Date?: string;     // YYYY-MM-DD
    DueDate?: string;  // YYYY-MM-DD
    Reference?: string;
    InvoiceNumber?: string; // omitted: Xero assigns the next number
    Status?: 'DRAFT' | 'SUBMITTED' | 'AUTHORISED';
    LineAmountTypes?: 'Exclusive' | 'Inclusive' | 'NoTax';
    CurrencyCode?: string;
}

interface XeroTokenResponse {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
}

/**
 * Least-privilege scopes, using Xero's granular scope names: apps created on or
 * after 2 March 2026 cannot use the broad `accounting.transactions` scope.
 * `accounting.settings.read` is required by the Accounts and TaxRates endpoints.
 */
export const XERO_SCOPES = [
    'openid',
    'profile',
    'email',
    'accounting.invoices',
    'accounting.contacts.read',
    'accounting.settings.read',
    'offline_access',
].join(' ');

// ── Internal PKCE helpers ────────────────────────────────────────────────────
/**
 * Xero authenticates a PKCE (secret-less) client on the token and revocation
 * endpoints with Basic base64("<client_id>:"), keeping the trailing colon.
 */
function pkceClientAuth(clientId: string): string {
    return `Basic ${btoa(`${clientId}:`)}`;
}

function base64UrlEncode(bytes: Uint8Array): string {
    const base64 = btoa(String.fromCharCode(...Array.from(bytes)));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function generateCodeVerifier(): Promise<string> {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return base64UrlEncode(array);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
    const data = new TextEncoder().encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return base64UrlEncode(new Uint8Array(digest));
}

// ── Service ──────────────────────────────────────────────────────────────────
const store = new LazyStore('xero-settings.json');

// Xero rotates the refresh token on every use, so only one refresh may run at
// a time; concurrent callers share the in-flight one.
let refreshInFlight: Promise<XeroTokens> | null = null;

export const XERO_REDIRECT_URI = 'https://poyashauvewhifohkxeg.supabase.co/functions/v1/xero-oauth/callback';

export const xeroService = {
    // ── Settings persistence ────────────────────────────────────────────────
    async getClientId(): Promise<string | null> {
        return (await store.get<string>(KEY_CLIENT_ID)) ?? null;
    },
    async setClientId(clientId: string): Promise<void> {
        await store.set(KEY_CLIENT_ID, clientId);
        await store.save();
    },

    async getTokens(): Promise<XeroTokens | null> {
        return (await store.get<XeroTokens>(KEY_TOKENS)) ?? null;
    },
    async setTokens(tokens: XeroTokens): Promise<void> {
        await store.set(KEY_TOKENS, tokens);
        await store.save();
    },
    async clearTokens(): Promise<void> {
        await store.delete(KEY_TOKENS);
        await store.delete(KEY_TENANT_ID);
        await store.delete(KEY_CODE_VERIFIER);
        await store.delete(KEY_STATE);
        await store.save();
    },

    async getTenantId(): Promise<string | null> {
        return (await store.get<string>(KEY_TENANT_ID)) ?? null;
    },
    async setTenantId(tenantId: string): Promise<void> {
        await store.set(KEY_TENANT_ID, tenantId);
        await store.save();
    },

    async isConnected(): Promise<boolean> {
        const tokens = await this.getTokens();
        return !!tokens?.access_token;
    },

    // ── OAuth2 PKCE flow ────────────────────────────────────────────────────
    async buildAuthUrl(clientId: string): Promise<string> {
        const verifier = await generateCodeVerifier();
        const challenge = await generateCodeChallenge(verifier);
        const state = crypto.randomUUID();
        await store.set(KEY_CODE_VERIFIER, verifier);
        await store.set(KEY_STATE, state);
        await store.save();

        const params = new URLSearchParams({
            response_type: 'code',
            client_id: clientId,
            redirect_uri: XERO_REDIRECT_URI,
            scope: XERO_SCOPES,
            state,
            code_challenge: challenge,
            code_challenge_method: 'S256',
        });

        return `https://login.xero.com/identity/connect/authorize?${params}`;
    },

    /** Open the Xero authorization page in the user's default browser. */
    async startOAuthFlow(clientId: string): Promise<void> {
        const url = await this.buildAuthUrl(clientId);
        await open(url);
    },

    /** Exchange the authorization code from Xero for access + refresh tokens. */
    async exchangeCode(code: string, clientId: string, state: string): Promise<XeroTokens> {
        const storedState = await store.get<string>(KEY_STATE);
        if (!storedState) throw new Error('OAuth state missing. Please restart the authorization flow.');
        if (state !== storedState) throw new Error('OAuth state mismatch. Please restart the authorization flow.');

        const verifier = await store.get<string>(KEY_CODE_VERIFIER);
        if (!verifier) throw new Error('Code verifier missing. Please restart the authorization flow.');

        const body = new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: XERO_REDIRECT_URI,
            client_id: clientId,
            code_verifier: verifier,
        });

        const response = await fetch('https://identity.xero.com/connect/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Authorization: pkceClientAuth(clientId),
            },
            body: body.toString(),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Xero token exchange failed: ${text}`);
        }

        const data: XeroTokenResponse = await response.json();
        const tokens: XeroTokens = {
            access_token: data.access_token,
            refresh_token: data.refresh_token ?? '',
            expires_at: Date.now() + (data.expires_in ?? 1800) * 1000,
        };

        await this.setTokens(tokens);
        await store.delete(KEY_CODE_VERIFIER);
        await store.delete(KEY_STATE);
        await store.save();
        return tokens;
    },

    async refreshTokens(clientId: string): Promise<XeroTokens> {
        const tokens = await this.getTokens();
        if (!tokens?.refresh_token) throw new Error('No refresh token available');

        const body = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: tokens.refresh_token,
            client_id: clientId,
        });

        const response = await fetch('https://identity.xero.com/connect/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Authorization: pkceClientAuth(clientId),
            },
            body: body.toString(),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Xero token refresh failed (${response.status}): ${text}`);
        }

        const data: XeroTokenResponse = await response.json();
        const newTokens: XeroTokens = {
            access_token: data.access_token,
            refresh_token: data.refresh_token ?? tokens.refresh_token,
            expires_at: Date.now() + (data.expires_in ?? 1800) * 1000,
        };

        await this.setTokens(newTokens);
        return newTokens;
    },

    /**
     * Revokes the refresh token at Xero, which also removes the app's
     * connections to the user's organisations, then clears the local copy.
     * Returns false if Xero could not confirm the revocation.
     */
    async disconnect(clientId: string): Promise<boolean> {
        const tokens = await this.getTokens();
        let revoked = !tokens?.refresh_token;
        if (tokens?.refresh_token && clientId) {
            try {
                const response = await fetch('https://identity.xero.com/connect/revocation', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        Authorization: pkceClientAuth(clientId),
                    },
                    body: new URLSearchParams({ token: tokens.refresh_token, client_id: clientId }).toString(),
                });
                revoked = response.ok;
            } catch {
                revoked = false;
            }
        }
        await this.clearTokens();
        return revoked;
    },

    async getValidToken(clientId: string): Promise<string> {
        let tokens = await this.getTokens();
        if (!tokens) throw new Error('Not connected to Xero. Please connect first.');
        // Refresh if expiring within 5 minutes
        if (tokens.expires_at < Date.now() + 5 * 60 * 1000) {
            refreshInFlight ??= this.refreshTokens(clientId).finally(() => {
                refreshInFlight = null;
            });
            tokens = await refreshInFlight;
        }
        return tokens.access_token;
    },

    // ── Xero API helpers ────────────────────────────────────────────────────
    async getTenants(accessToken: string): Promise<XeroTenant[]> {
        const res = await fetch('https://api.xero.com/connections', {
            headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        });
        if (!res.ok) throw new Error('Failed to fetch Xero organisations');
        return res.json();
    },

    async getContacts(accessToken: string, tenantId: string): Promise<XeroContact[]> {
        const res = await fetch(
            // All active contacts: IsCustomer only becomes true after a contact's
            // first sales invoice, so filtering on it would hide new customers.
            'https://api.xero.com/api.xro/2.0/Contacts?order=Name',
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Xero-Tenant-Id': tenantId,
                    Accept: 'application/json',
                },
            }
        );
        if (!res.ok) throw new Error('Failed to fetch Xero contacts');
        const data = await res.json();
        return data.Contacts ?? [];
    },

    async getAccounts(accessToken: string, tenantId: string): Promise<XeroAccount[]> {
        const res = await fetch(
            // Revenue class covers the REVENUE, SALES and OTHERINCOME account types.
            'https://api.xero.com/api.xro/2.0/Accounts?where=Class%3D%3D%22REVENUE%22&order=Name',
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Xero-Tenant-Id': tenantId,
                    Accept: 'application/json',
                },
            }
        );
        if (!res.ok) throw new Error('Failed to fetch Xero accounts');
        const data: { Accounts?: XeroAccount[] } = await res.json();
        return (data.Accounts ?? []).filter((a) => !a.Status || a.Status === 'ACTIVE');
    },

    /** Active tax rates that can be applied to sales (revenue) lines. */
    async getTaxRates(accessToken: string, tenantId: string): Promise<XeroTaxRate[]> {
        const res = await fetch('https://api.xero.com/api.xro/2.0/TaxRates', {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Xero-Tenant-Id': tenantId,
                Accept: 'application/json',
            },
        });
        if (!res.ok) throw new Error('Failed to fetch Xero tax rates');
        const data: { TaxRates?: XeroTaxRate[] } = await res.json();
        return (data.TaxRates ?? []).filter((r) => r.Status === 'ACTIVE' && r.CanApplyToRevenue !== false);
    },

    /**
     * Creates the invoice. Reusing `idempotencyKey` when retrying the same
     * invoice makes Xero return the original result instead of a second draft.
     */
    async createInvoice(
        accessToken: string,
        tenantId: string,
        payload: XeroInvoicePayload,
        idempotencyKey: string
    ): Promise<{ InvoiceID: string; InvoiceNumber: string }> {
        const res = await fetch('https://api.xero.com/api.xro/2.0/Invoices', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Xero-Tenant-Id': tenantId,
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'Idempotency-Key': idempotencyKey,
            },
            body: JSON.stringify({ Invoices: [payload] }),
        });

        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Failed to create Xero invoice: ${text}`);
        }

        const data = await res.json();
        const invoice = data.Invoices?.[0];
        if (!invoice) throw new Error('Xero returned no invoice data');
        return { InvoiceID: invoice.InvoiceID, InvoiceNumber: invoice.InvoiceNumber };
    },

    /** Opens a Xero invoice in the browser. */
    async openInvoiceInXero(invoiceId: string): Promise<void> {
        await open(`https://go.xero.com/AccountsReceivable/View.aspx?invoiceID=${invoiceId}`);
    },
};
