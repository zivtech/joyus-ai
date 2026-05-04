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
      exclude: [
        'node_modules',
        'dist',
        '**/*.test.ts',
        'vitest.config.ts',
        '.eslintrc.cjs',
        'drizzle.config.ts',
        'scripts/**',
        'src/index.ts',
        'src/**/index.ts',
        'src/types/**',
      ],
      thresholds: {
        statements: 59,
        branches: 74,
        functions: 67,
        lines: 59,
      },
    },
    testTimeout: 10000,
  },
});
