import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'discord',
    include: ['test/**/*.test.ts'],
    // Unit tests with fakes.
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
