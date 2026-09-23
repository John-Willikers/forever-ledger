import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'lua-sv-parser', include: ['src/**/*.test.ts', 'test/**/*.test.ts'] },
});
