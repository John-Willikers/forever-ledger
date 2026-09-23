import { defineConfig } from '@playwright/test';

/** Electron smoke test only (unit tests run under vitest). Build first: pnpm build. */
export default defineConfig({
  testDir: 'test/smoke',
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
});
