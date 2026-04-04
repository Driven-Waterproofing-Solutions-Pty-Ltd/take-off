import { LazyStore } from '@tauri-apps/plugin-store';
import { open } from '@tauri-apps/plugin-shell';

// ── Keys used in persistent storage ─────────────────────────────────────────
const KEY_CLIENT_ID = 'xero_client_id';
const KEY_TOKENS = 'xero_tokens';
const KEY_TENANT_ID = 'xero_tenant_id';
const KEY_CODE_VERIFIER = 'xero_code_verifier';

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
    Status?: 'DRAFT' | 'SUBMITTED' | 'AUTHORISED';
    LineAmountTypes?: 'EXCLUSIVE' | 'INCLUSIVE' | 'NOTAX';
    CurrencyCode?: string;
}

// ── Internal PKCE helpers ────────────────────────────────────────────────────
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
        await store.set(KEY_CODE_VERIFIER, verifier);
        await store.save();

        const params = new URLSearchParams({
            response_type: 'code',
            client_id: clientId,
            redirect_uri: XERO_REDIRECT_URI,
            scope: 'openid profile email accounting.transactions accounting.contacts.read offline_access',
            state: crypto.randomUUID(),
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
    async exchangeCode(code: string, clientId: string): Promise<XeroTokens> {
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
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Xero token exchange failed: ${text}`);
        }

        const data = await response.json();
        const tokens: XeroTokens = {
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            expires_at: Date.now() + (data.expires_in ?? 1800) * 1000,
        };

        await this.setTokens(tokens);
        await store.delete(KEY_CODE_VERIFIER);
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
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });

        if (!response.ok) throw new Error('Xero token refresh failed');

        const data = await response.json();
        const newTokens: XeroTokens = {
            access_token: data.access_token,
            refresh_token: data.refresh_token ?? tokens.refresh_token,
            expires_at: Date.now() + (data.expires_in ?? 1800) * 1000,
        };

        await this.setTokens(newTokens);
        return newTokens;
    },

    async getValidToken(clientId: string): Promise<string> {
        let tokens = await this.getTokens();
        if (!tokens) throw new Error('Not connected to Xero. Please connect first.');
        // Refresh if expiring within 5 minutes
        if (tokens.expires_at < Date.now() + 5 * 60 * 1000) {
            tokens = await this.refreshTokens(clientId);
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
            'https://api.xero.com/api.xro/2.0/Contacts?where=IsCustomer%3D%3Dtrue&order=Name',
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
            'https://api.xero.com/api.xro/2.0/Accounts?where=Type%3D%3D%22REVENUE%22&order=Name',
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Xero-Tenant-Id': tenantId,
                    Accept: 'application/json',
                },
            }
        );
        if (!res.ok) throw new Error('Failed to fetch Xero accounts');
        const data = await res.json();
        return data.Accounts ?? [];
    },

    async createInvoice(
        accessToken: string,
        tenantId: string,
        payload: XeroInvoicePayload
    ): Promise<{ InvoiceID: string; InvoiceNumber: string }> {
        const res = await fetch('https://api.xero.com/api.xro/2.0/Invoices', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Xero-Tenant-Id': tenantId,
                'Content-Type': 'application/json',
                Accept: 'application/json',
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
