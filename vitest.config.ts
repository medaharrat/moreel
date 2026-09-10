import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 10_000,
    hookTimeout: 10_000,
    reporters: 'default',
    // Integration tests share one real Postgres/Redis and TRUNCATE shared
    // tables in beforeEach; running test files in parallel workers causes
    // cross-file races against that shared state. The whole suite runs in
    // well under a second serially, so there's no real cost to disabling
    // file-level parallelism to make that safe.
    fileParallelism: false,
  },
});
