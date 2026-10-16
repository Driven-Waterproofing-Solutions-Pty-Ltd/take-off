import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

/**
 * Integration test config — runs inside Cloudflare workerd via miniflare.
 * Use `npm run test:integration`. Requires:
 *   - A wrangler-test.jsonc (or wrangler.jsonc) without bindings that
 *     miniflare can't simulate locally (Vectorize, AI in some environments).
 *   - `DISABLE_RATE_LIMIT=1` (set inside the test) to avoid KV/D1 RL.
 *
 * The harness-managed sandbox where this repo lives may not have working
 * Vectorize/AI emulation; in that case, run integration tests locally
 * against a real `wrangler dev` instance instead.
 */
export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.test.jsonc' },
        miniflare: {
          compatibilityDate: '2025-01-01',
          compatibilityFlags: ['nodejs_compat'],
        },
      },
    },
    include: ['tests/routes.test.ts', 'tests/integration/**/*.test.ts'],
  },
});
