import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'mcp',
    include: ['test/**/*.test.ts'],
    // The tests start a real Postgres container.
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
