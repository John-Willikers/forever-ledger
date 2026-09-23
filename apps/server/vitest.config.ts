import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'server',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Integration tests start a real Postgres container.
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
