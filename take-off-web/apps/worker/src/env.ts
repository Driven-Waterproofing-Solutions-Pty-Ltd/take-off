import type { D1Database, R2Bucket } from '@cloudflare/workers-types';

export interface Env {
  DB: D1Database;
  PDFS: R2Bucket;

  APP_BASE_URL: string;

  // Xero
  XERO_CLIENT_ID?: string;
  XERO_CLIENT_SECRET?: string;
  XERO_REDIRECT_URI?: string;

  // Anthropic (Phase 5)
  ANTHROPIC_API_KEY?: string;

  // MCP bootstrap (one-off, used to mint per-client tokens)
  MCP_BOOTSTRAP_TOKEN?: string;
}
