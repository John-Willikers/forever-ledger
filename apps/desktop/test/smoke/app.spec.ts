import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test } from '@playwright/test';

// resolve() drops the trailing separator: on Windows `...\\desktop\\"` would escape the closing quote of the argument.
const appDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));

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
    timeout: 30_000,
    env: { ...process.env, FOREVER_LEDGER_CONFIG: config, FL_SMOKE: '1' },
  });
  const output: string[] = [];
  app.process().stdout?.on('data', (d: Buffer) => output.push(`[stdout] ${String(d)}`));
  app.process().stderr?.on('data', (d: Buffer) => output.push(`[stderr] ${String(d)}`));
  const logsDir = await app.evaluate(({ app: a }) => a.getPath('logs'));

  try {
    const win = await app.firstWindow({ timeout: 30_000 });
    for (const card of ['uploads', 'addon', 'app', 'settings']) {
      await expect(win.locator(`[data-card="${card}"]`)).toBeVisible({ timeout: 20_000 });
    }
    const version = await app.evaluate(({ app: a }) => a.getVersion());
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  } catch (err) {
    // Print what the app said, so a CI failure on Windows can be diagnosed from the job log.
    const log = await readFile(join(logsDir, 'forever-ledger.log'), 'utf8').catch(
      (e: unknown) => `(no log: ${String(e)})`,
    );
    console.log(`--- app output ---\n${output.join('')}\n--- ${logsDir} ---\n${log}`);
    throw err;
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
