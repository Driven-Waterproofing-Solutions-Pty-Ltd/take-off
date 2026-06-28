#!/usr/bin/env node
/**
 * form43-app — local Node build.
 *
 * Runs the EXACT same Hono app + routes as the Cloudflare Worker, but
 * with the four CF bindings replaced by local shims:
 *   D1        -> node:sqlite file           (local/shims/d1.mjs)
 *   Vectorize -> brute-force cosine store    (local/shims/vectorize.mjs)
 *   Workers AI-> OpenAI embeddings API       (local/shims/ai.mjs)
 *   R2 / KV   -> omitted (backup disabled, rate-limit uses the D1 table)
 *
 * Run:  npm run local      (from form43-app/)
 * Env:
 *   PORT                 default 8787
 *   FORM43_API_TOKEN     default 'local-dev-token' (printed on boot)
 *   OPENAI_API_KEY       enables semantic memory search (else literal fallback)
 *   GEOSCAPE_API_KEY     enables Geoscape address search (else OSM fallback)
 *   FORM43_DB_FILE       default local/data/form43.db
 */
import { serve } from '@hono/node-server';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { D1Sqlite } from './shims/d1.mjs';
import { VectorizeLocal } from './shims/vectorize.mjs';
import { makeAiShim } from './shims/ai.mjs';
// tsx resolves the TypeScript Worker entry; we reuse its app verbatim.
import { app } from '../src/index.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const PORT = parseInt(process.env.PORT || '8787', 10);
const DB_FILE = process.env.FORM43_DB_FILE || join(__dirname, 'data', 'form43.db');
const API_TOKEN = process.env.FORM43_API_TOKEN || 'local-dev-token';

// 1. Open the SQLite-backed D1 and apply migrations (all idempotent).
mkdirSync(dirname(DB_FILE), { recursive: true });
const db = new D1Sqlite(DB_FILE);

const migrationsDir = join(ROOT, 'migrations');
const migrations = readdirSync(migrationsDir)
  .filter((f) => /^\d+.*\.sql$/.test(f))
  .sort();
for (const file of migrations) {
  db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
}

// 2. Build the local binding shims.
const memoryIndex = new VectorizeLocal(db.raw);
const ai = makeAiShim({
  provider: process.env.EMBEDDINGS_PROVIDER || 'openai',
  apiKey: process.env.OPENAI_API_KEY,
});

// 3. Assemble the env object the Worker code reads via c.env.
const env = {
  FORM43_DB: db,
  MEMORY_INDEX: memoryIndex,
  AI: ai,
  FORM43_BACKUPS: undefined,        // R2 backup disabled locally
  RATE_LIMIT_KV: undefined,         // rate-limit falls back to the D1 table
  ENV: 'local',
  FORM43_API_TOKEN: API_TOKEN,
  GEOSCAPE_API_KEY: process.env.GEOSCAPE_API_KEY,
  DISABLE_RATE_LIMIT: process.env.DISABLE_RATE_LIMIT || '1',
  DISABLE_R2_BACKUP: '1',
};

// 4. Serve. Passing env as the 2nd arg to app.fetch makes Hono treat it
//    as the runtime bindings — exactly like Workers does.
serve({ fetch: (request) => app.fetch(request, env), port: PORT }, (info) => {
  const base = `http://localhost:${info.port}`;
  console.log('');
  console.log('  form43-app (local Node build) is running');
  console.log('  ' + '─'.repeat(48));
  console.log(`  URL          ${base}`);
  console.log(`  Form 43 page ${base}/form43`);
  console.log(`  MCP endpoint ${base}/mcp`);
  console.log(`  Health       ${base}/health`);
  console.log(`  Bearer       ${API_TOKEN}`);
  console.log(`  DB file      ${DB_FILE}`);
  console.log(`  Migrations   ${migrations.length} applied`);
  console.log(`  Embeddings   ${process.env.OPENAI_API_KEY ? 'OpenAI (semantic search ON)' : 'no key — literal search fallback'}`);
  console.log(`  Address      ${process.env.GEOSCAPE_API_KEY ? 'Geoscape G-NAF' : 'OSM Nominatim fallback'}`);
  console.log('');
});
