import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  defaultConfigPath,
  loadConfig,
  resolveConfigPath,
  saveConfig,
  validateConfigFile,
} from '../src/config.js';
import { discoverSavedVariables } from '../src/discover.js';
import { ConfigError } from '../src/errors.js';
import { tempEnv } from './helpers/fixtures.js';
import type { TempEnv } from './helpers/fixtures.js';

describe('config paths', () => {
  it('uses %APPDATA% on Windows', () => {
    expect(
      defaultConfigPath({ platform: 'win32', env: { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' } }),
    ).toContain(join('C:\\Users\\me\\AppData\\Roaming', 'forever-ledger', 'config.json'));
  });

  it('uses XDG_CONFIG_HOME or ~/.config elsewhere', () => {
    expect(defaultConfigPath({ platform: 'linux', env: { XDG_CONFIG_HOME: '/x' } })).toBe(
      join('/x', 'forever-ledger', 'config.json'),
    );
    expect(defaultConfigPath({ platform: 'darwin', env: {}, home: '/home/me' })).toBe(
      join('/home/me', '.config', 'forever-ledger', 'config.json'),
    );
  });

  it('--config beats FOREVER_LEDGER_CONFIG beats the default', () => {
    const env = { FOREVER_LEDGER_CONFIG: '/env/config.json' };
    expect(resolveConfigPath('/cli/c.json', { env })).toBe('/cli/c.json');
    expect(resolveConfigPath(undefined, { env })).toBe('/env/config.json');
  });
});

describe('config validation', () => {
  it('accepts a full config and normalises the server URL', () => {
    const c = validateConfigFile({
      wowPath: '/wow',
      accounts: ['A'],
      serverUrl: 'https://ledger.example.com/',
      token: 't',
      uploaderId: 'u',
    });
    expect(c.serverUrl).toBe('https://ledger.example.com');
  });

  it('lists every problem', () => {
    const err = (() => {
      try {
        validateConfigFile({ accounts: 'x', serverUrl: 'ftp://x', token: 5 });
      } catch (e) {
        return e as Error;
      }
    })();
    expect(err).toBeInstanceOf(ConfigError);
    for (const part of ['accounts:', 'http://', 'token:', 'uploaderId:'])
      expect(err?.message).toContain(part);
  });

  it('missing config → tells the user to run init', async () => {
    await expect(loadConfig('/nonexistent/fl/config.json')).rejects.toThrow(ConfigError);
    await expect(loadConfig('/nonexistent/fl/config.json')).rejects.toThrow(/init/);
  });
});

describe('config file', () => {
  let env: TempEnv;
  beforeEach(async () => {
    env = await tempEnv();
  });
  afterEach(() => env.cleanup());

  it('round-trips, defaults stateDir next to the config, is owner-only', async () => {
    const path = join(env.dir, 'cfg', 'config.json');
    await saveConfig(path, {
      wowPath: env.wowPath,
      accounts: [],
      uploaderId: 'u',
      token: 'secret',
    });
    const c = await loadConfig(path);
    expect(c.stateDir).toBe(join(env.dir, 'cfg', 'state'));
    expect(c.token).toBe('secret');
    expect(JSON.parse(await readFile(path, 'utf8'))).not.toHaveProperty('stateDir');
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o077).toBe(0);
  });
});

describe('discovery', () => {
  let env: TempEnv;
  beforeEach(async () => {
    env = await tempEnv();
    await env.writeSv('ForeverLedgerDB = {}', 'ACCOUNT1');
    await env.writeSv('ForeverLedgerDB = {}', 'ACCOUNT2');
    await mkdir(join(env.wowPath, '_classic_era_', 'WTF', 'Account', 'NOADDON', 'SavedVariables'), {
      recursive: true,
    });
  });
  afterEach(() => env.cleanup());

  const flavor = () => join(env.wowPath, '_classic_era_');

  it.each([
    ['install root', () => env.wowPath],
    ['flavor folder', flavor],
    ['WTF folder', () => join(flavor(), 'WTF')],
    ['Account folder', () => join(flavor(), 'WTF', 'Account')],
  ])('finds accounts from the %s', async (_name, path) => {
    const d = await discoverSavedVariables(path());
    expect(d.files.map((f) => f.account)).toEqual(['ACCOUNT1', 'ACCOUNT2']);
    expect(d.notes.join('\n')).toMatch(/NOADDON: no ForeverLedger\.lua yet/);
  });

  it('filters by configured accounts and reports unknown ones', async () => {
    const d = await discoverSavedVariables(env.wowPath, { accounts: ['account2', 'GHOST'] });
    expect(d.files.map((f) => f.account)).toEqual(['ACCOUNT2']);
    expect(d.notes.join('\n')).toMatch(/GHOST has no ForeverLedger\.lua/);
  });

  it('explains a wrong path', async () => {
    const d = await discoverSavedVariables(join(env.dir, 'nope'));
    expect(d.files).toEqual([]);
    expect(d.notes[0]).toMatch(/does not exist/);
    const empty = join(env.dir, 'empty');
    await mkdir(empty);
    expect((await discoverSavedVariables(empty)).notes.join('\n')).toMatch(/no WTF folder/);
  });

  it('prefixes the flavor when the same account exists in two game folders', async () => {
    const other = join(env.wowPath, '_classic_', 'WTF', 'Account', 'ACCOUNT1', 'SavedVariables');
    await mkdir(other, { recursive: true });
    await writeFile(join(other, 'ForeverLedger.lua'), 'ForeverLedgerDB = {}');
    const d = await discoverSavedVariables(env.wowPath);
    expect(d.files.map((f) => f.account).sort()).toEqual([
      'ACCOUNT2',
      '_classic_/ACCOUNT1',
      '_classic_era_/ACCOUNT1',
    ]);
  });
});
