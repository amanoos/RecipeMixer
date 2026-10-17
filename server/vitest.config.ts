import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Performance checks are slow; run them with `npm run bench`.
    exclude: [...configDefaults.exclude, 'test/bench/**'],
  },
});
