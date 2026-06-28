# form43-app — local Node build

Run the **exact same** Hono app and routes as the Cloudflare Worker, on your
own machine, with **zero Cloudflare dependency**. The four CF bindings are
swapped for local shims:

| CF binding | Local replacement | File |
|---|---|---|
| D1 (`FORM43_DB`) | `node:sqlite` file (`local/data/form43.db`) | `shims/d1.mjs` |
| Vectorize (`MEMORY_INDEX`) | brute-force cosine store in the same SQLite file | `shims/vectorize.mjs` |
| Workers AI (`AI`) | OpenAI embeddings API (`text-embedding-3-small`, 1024-dim) | `shims/ai.mjs` |
| R2 / KV | omitted — backup disabled; rate-limit uses the D1 table | — |

No code in `src/` was forked. `src/index.ts` exports its `app`; this build
imports it and injects a Node env via `app.fetch(request, env)` — exactly how
Workers passes bindings.

## Run

```bash
cd form43-app
npm install
npm run local
```

Boots on `http://localhost:8787`, applies all migrations into a fresh SQLite
file, and prints the URL + bearer token.

## Configure (all optional, via env vars)

```bash
PORT=8787                       # default
FORM43_API_TOKEN=local-dev-token  # default; printed on boot
OPENAI_API_KEY=sk-...           # enables SEMANTIC memory search (else literal)
GEOSCAPE_API_KEY=...            # enables Geoscape G-NAF address search (else OSM)
FORM43_DB_FILE=local/data/form43.db
EMBEDDINGS_PROVIDER=openai      # default
```

Example with semantic search + Geoscape:

```bash
OPENAI_API_KEY=sk-... GEOSCAPE_API_KEY=... npm run local
```

## Smoke test

```bash
URL=http://localhost:8787 ; TOKEN=local-dev-token
curl -s $URL/health
curl -s -X POST $URL/mcp -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Notes

- Requires Node ≥ 22 (uses the built-in `node:sqlite` — no native compile).
- Without `OPENAI_API_KEY`, `save_memory` still stores rows; only the semantic
  vector is skipped and `search_memory` uses SQL `LIKE` (literal) matching.
- Data lives in `local/data/form43.db` (git-ignored). Delete it to reset.
- This build is for local dev / self-host. The Worker (`npm run deploy`) and
  this Node server share the same routes, so behaviour matches.
