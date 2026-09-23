import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'uploader', include: ['src/**/*.test.ts', 'test/**/*.test.ts'] },
});
