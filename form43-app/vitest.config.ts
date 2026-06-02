import { defineConfig } from 'vitest/config';

/**
 * Default config — pure unit tests, plain Node, no Workers runtime.
 * For integration tests against the Workers runtime (D1, AI, Vectorize),
 * see vitest.workers.config.ts and `npm run test:integration`.
 */
export default defineConfig({
  test: {
    include: ['tests/parse.test.ts', 'tests/unit/**/*.test.ts'],
  },
});
