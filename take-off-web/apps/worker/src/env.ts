import type { D1Database, Fetcher, R2Bucket } from '@cloudflare/workers-types';

export interface Env {
  DB: D1Database;
  PDFS: R2Bucket;
  // Workers Assets binding — runtime serves static SPA files automatically
  // (we don't call .fetch() on this; declared for type completeness).
  ASSETS: Fetcher;

  APP_BASE_URL: string;

  // Xero
  XERO_CLIENT_ID?: string;
  XERO_CLIENT_SECRET?: string;
  XERO_REDIRECT_URI?: string;
  XERO_TOKEN_KEY?: string; // AES-GCM key for encrypting Xero tokens at rest

  // Anthropic (Phase 5)
  ANTHROPIC_API_KEY?: string;

  // MCP bootstrap (one-off, used to mint per-client tokens)
  MCP_BOOTSTRAP_TOKEN?: string;
}
