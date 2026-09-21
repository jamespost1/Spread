import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.js'],
      thresholds: { lines: 85, functions: 85, branches: 75, statements: 85 },
    },
  },
});
