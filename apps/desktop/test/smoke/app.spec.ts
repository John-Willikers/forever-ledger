import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test } from '@playwright/test';

const appDir = fileURLToPath(new URL('../..', import.meta.url));

test('starts, shows the four cards and writes its log', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fl-smoke-'));
  const wow = join(dir, 'World of Warcraft');
  await mkdir(join(wow, '_classic_beta_', 'WTF', 'Account', 'SMOKE', 'SavedVariables'), {
    recursive: true,
  });
  await mkdir(join(wow, '_classic_beta_', 'Interface', 'AddOns'), { recursive: true });
  const config = join(dir, 'config.json');
  await writeFile(
    config,
    JSON.stringify({
      wowPath: wow,
      accounts: [],
      // Nothing listens on port 9: uploads and addon sync fail fast, which is fine for a smoke test.
      serverUrl: 'http://127.0.0.1:9',
      token: 'flt_smoke',
      uploaderId: 'smoke',
      stateDir: join(dir, 'state'),
    }),
  );

  // Launch the app folder (not dist/main.mjs) so app.getVersion() and productName come from package.json.
  const app = await electron.launch({
    args: [appDir],
    env: { ...process.env, FOREVER_LEDGER_CONFIG: config, FL_SMOKE: '1' },
  });
  try {
    const win = await app.firstWindow();
    for (const card of ['uploads', 'addon', 'app', 'settings']) {
      await expect(win.locator(`[data-card="${card}"]`)).toBeVisible();
    }
    const version = await app.evaluate(({ app: a }) => a.getVersion());
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
