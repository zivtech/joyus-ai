import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: ['node_modules', 'dist', '**/*.test.ts', 'vitest.config.ts'],
      thresholds: {
        statements: 55,
        branches: 73,
        functions: 66,
        lines: 55,
      },
    },
    testTimeout: 10000,
  },
});
