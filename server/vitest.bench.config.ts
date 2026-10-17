import { defineConfig } from 'vitest/config';

// Performance checks: slow, so they are excluded from `npm test` and run with `npm run bench`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/bench/**/*.test.ts'],
    testTimeout: 600_000,
  },
});
