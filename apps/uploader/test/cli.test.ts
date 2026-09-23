import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installAddon, readInstalledVersion } from '../src/addonInstall.js';
import { acquireLock } from '../src/lock.js';
import { release } from './helpers/addonRelease.js';
import { fixturePath, readFixture, tempEnv } from './helpers/fixtures.js';
import type { TempEnv } from './helpers/fixtures.js';
import { startMockServer } from './helpers/mockServer.js';
import type { MockServer } from './helpers/mockServer.js';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const githubRedirect = fileURLToPath(new URL('./helpers/githubRedirect.ts', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * Runs the CLI from source (tsx, workspace packages via the `development` condition). FL_TEST_GITHUB in `env` sends
 * addon downloads to the mock server.
 */
async function forever(args: string[], env: NodeJS.ProcessEnv = {}) {
  try {
    const { stdout, stderr } = await run(
      process.execPath,
      ['--conditions=development', '--import', 'tsx', '--import', githubRedirect, cli, ...args],
      { cwd: repoRoot, env: { ...process.env, ...env }, timeout: 30_000 },
    );
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout: string; stderr: string };
    return { code: e.code ?? 1, stdout: e.stdout, stderr: e.stderr };
  }
}

let env: TempEnv;
let server: MockServer | undefined;
beforeEach(async () => {
  env = await tempEnv();
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  await env.cleanup();
});

describe('cli', () => {
  it(
    'init → upload-once twice → status, via FOREVER_LEDGER_CONFIG',
    { timeout: 60_000 },
    async () => {
      await env.writeSv(await readFixture('session-v1.lua'));
      server = await startMockServer();
      const configPath = join(env.dir, 'cfg', 'config.json');
      const e = { FOREVER_LEDGER_CONFIG: configPath };

      const init = await forever(
        ['init', '--wow-path', env.wowPath, '--server', server.url, '--token', 'test-token'],
        e,
      );
      expect(init.code).toBe(0);
      expect(init.stdout).toContain('TESTACCT');
      expect(init.stdout).toContain('server health: ok');
      expect(init.stdout).not.toContain('test-token');
      const saved = JSON.parse(await readFile(configPath, 'utf8')) as { uploaderId: string };
      expect(saved.uploaderId).toMatch(/^[0-9a-f-]{36}$/);

      const first = await forever(['upload-once'], e);
      expect(first.code).toBe(0);
      expect(first.stdout).toMatch(/uploaded 1 batch\(es\), \d+ record\(s\) acknowledged/);
      const received = server.receivedKeys.length;

      const second = await forever(['upload-once'], e);
      expect(second.code).toBe(0);
      expect(second.stdout).toMatch(/0 new\/changed queued/);
      expect(server.receivedKeys.length).toBe(received);

      const status = await forever(['--config', configPath, 'status']);
      expect(status.code).toBe(0);
      expect(status.stdout).toMatch(new RegExp(`acked records:\\s+${received}`));
      expect(status.stdout).toMatch(/last upload:\s+\d{4}-\d\d-\d\d \d\d:\d\d:\d\d C[DS]T/);
    },
  );

  it(
    'upload-once exits non-zero when the server is down, and on a v0 file',
    { timeout: 60_000 },
    async () => {
      const configPath = join(env.dir, 'config.json');
      await writeFile(
        configPath,
        JSON.stringify({
          wowPath: env.wowPath,
          serverUrl: 'http://127.0.0.1:9',
          token: 't',
          uploaderId: 'u',
        }),
      );
      await env.writeSv(await readFixture('session-v1.lua'));
      const down = await forever(['--config', configPath, 'upload-once']);
      expect(down.code).toBe(1);
      expect(down.stdout).toMatch(/still queued/);

      await env.writeSv(await readFixture('session-v0.lua'));
      const v0 = await forever(['--config', configPath, 'upload-once']);
      expect(v0.code).toBe(1);
      expect(v0.stdout).toMatch(/no schemaVersion .*migrate/);
    },
  );

  it('export and probe-dump need no server', { timeout: 60_000 }, async () => {
    const out = join(env.dir, 'records.json');
    const exp = await forever(['export', out, '--file', fixturePath('session-v1.lua')]);
    expect(exp.code).toBe(0);
    const doc = JSON.parse(await readFile(out, 'utf8')) as {
      accounts: { records: { runs: unknown[] } }[];
    };
    expect(doc.accounts[0]?.records.runs).toHaveLength(2);

    const api = join(env.dir, 'api.json');
    const probe = await forever(['probe-dump', fixturePath('probe-dump.lua'), api]);
    expect(probe.code).toBe(0);
    expect(probe.stdout).toMatch(/API docs available: yes/);
    expect(probe.stdout).toMatch(/ENCOUNTER_END/);
  });

  it('missing config → helpful error', { timeout: 30_000 }, async () => {
    const res = await forever(['--config', join(env.dir, 'none.json'), 'status']);
    expect(res.code).toBe(1);
    expect(res.stderr).toMatch(/run `forever-ledger init/);
  });

  describe('addon-sync', () => {
    let configPath: string;
    let addonsDir: string;
    let githubUrl: string;
    const sync = (...args: string[]) =>
      forever(['--config', configPath, 'addon-sync', ...args], { FL_TEST_GITHUB: githubUrl });

    beforeEach(async () => {
      server = await startMockServer();
      githubUrl = server.url;
      configPath = join(env.dir, 'config.json');
      await writeFile(
        configPath,
        JSON.stringify({
          wowPath: env.wowPath,
          serverUrl: server.url,
          token: 'test-token',
          uploaderId: 'u',
        }),
      );
      await env.writeSv(await readFixture('session-v1.lua'));
      addonsDir = join(env.wowPath, '_classic_era_', 'Interface', 'AddOns');
    });

    it(
      'no release → installed → up to date → rollback pauses → --force',
      { timeout: 90_000 },
      async () => {
        const none = await sync();
        expect(none.code).toBe(0);
        expect(none.stdout).toBe('no addon release published\n');

        const srv = server as MockServer;
        srv.addonRelease = release('0.2.2');
        const first = await sync();
        expect(first.code).toBe(0);
        expect(first.stdout).toBe(`addon 0.2.2 installed in ${addonsDir}\n`);
        expect(await readInstalledVersion(addonsDir)).toBe('0.2.2');

        const again = await sync();
        expect(again.stdout).toBe('addon up to date (0.2.2)\n');

        srv.addonRelease = release('0.2.3');
        expect((await sync()).stdout).toBe(`addon 0.2.3 installed in ${addonsDir}\n`);

        const back = await sync('--rollback');
        expect(back.code).toBe(0);
        expect(back.stdout).toBe(
          'rolled back to 0.2.2; auto-update paused until the server recommends another version\n',
        );
        expect(await readInstalledVersion(addonsDir)).toBe('0.2.2');

        const paused = await sync();
        expect(paused.code).toBe(0);
        expect(paused.stdout).toBe(
          'paused after rollback: server still recommends 0.2.3 (use --force)\n',
        );

        const forced = await sync('--force');
        expect(forced.stdout).toBe(`addon 0.2.3 installed in ${addonsDir}\n`);
        expect(await readInstalledVersion(addonsDir)).toBe('0.2.3');
      },
    );

    it(
      'exits 1 when the sync fails, when there is nothing to roll back, and while locked',
      { timeout: 90_000 },
      async () => {
        await (server as MockServer).close();
        server = undefined;
        const down = await sync();
        expect(down.code).toBe(1);
        expect(down.stdout).toMatch(/^addon sync failed: manifest request failed/);

        const nothing = await sync('--rollback');
        expect(nothing.code).toBe(1);
        expect(nothing.stderr).toMatch(/no previous version to roll back to/);

        const unlock = await acquireLock(join(env.dir, 'state'));
        try {
          const locked = await sync();
          expect(locked.code).toBe(1);
          expect(locked.stderr).toMatch(/another forever-ledger uploader/);
        } finally {
          await unlock();
        }
      },
    );

    it('reports skipped linked folders and recovered installs', { timeout: 60_000 }, async () => {
      (server as MockServer).addonRelease = release('0.2.2');
      // An interrupted swap: the marker and ForeverLedger.bak are left, ForeverLedger is gone.
      await installAddon(addonsDir, release('0.2.1').files);
      await writeFile(join(addonsDir, '.ForeverLedger.swap'), '');
      await rename(join(addonsDir, 'ForeverLedger'), join(addonsDir, 'ForeverLedger.bak'));
      const res = await sync();
      expect(res.code).toBe(0);
      expect(res.stdout).toContain(`recovered ForeverLedger in ${addonsDir}\n`);
      expect(res.stdout).toContain(`addon 0.2.2 installed in ${addonsDir}\n`);

      const other = join(env.dir, 'checkout');
      await mkdir(other, { recursive: true });
      await installAddon(other, release('0.3.0').files);
      await rm(join(addonsDir, 'ForeverLedger'), { recursive: true });
      await symlink(join(other, 'ForeverLedger'), join(addonsDir, 'ForeverLedger'), 'dir');
      const linked = await sync();
      expect(linked.code).toBe(0);
      expect(linked.stdout).toContain(`skipped ${addonsDir} (linked folder)\n`);
    });
  });
});
