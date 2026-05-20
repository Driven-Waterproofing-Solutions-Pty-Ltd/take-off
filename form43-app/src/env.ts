/**
 * Cloudflare Worker bindings + secrets for form43-app.
 *
 * Bindings are declared in wrangler.jsonc; secrets are set via
 * `wrangler secret put <NAME>` (or .dev.vars for local dev).
 */

export interface Env {
  // D1
  FORM43_DB: D1Database;

  // Vectorize (1024-dim cosine — Workers AI BGE)
  MEMORY_INDEX: VectorizeIndex;

  // Workers AI (BGE embeddings)
  AI: Ai;

  // R2 (optional memory snapshots)
  FORM43_BACKUPS?: R2Bucket;

  // KV (optional rate limit; falls back to D1 table if absent)
  RATE_LIMIT_KV?: KVNamespace;

  // Vars
  ENV: string;

  // Secrets
  FORM43_API_TOKEN: string;
  GEOSCAPE_API_KEY?: string;

  // Toggles (string '0'/'1')
  DISABLE_RATE_LIMIT?: string;
  DISABLE_R2_BACKUP?: string;
}

export interface RequestVars {
  correlationId: string;
  tokenHash: string;
}
