import { defineProject } from 'vitest/config';

// Pure-function tests only (formatting, mappers); no DOM needed.
export default defineProject({
  test: { name: 'admin', include: ['src/**/*.test.ts'], environment: 'node' },
});
