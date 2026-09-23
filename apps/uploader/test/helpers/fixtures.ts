import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSavedVariables } from '@forever-ledger/lua-sv-parser';
import { resolveConfig } from '../../src/config.js';
import type { Config } from '../../src/config.js';
import type { ReadOptions } from '../../src/reader.js';

export const fixturePath = (name: string) =>
  fileURLToPath(new URL(`../../../../fixtures/synthetic/${name}`, import.meta.url));

export const readFixture = (name: string) => readFile(fixturePath(name), 'utf8');

export async function loadFixtureDb(name: string): Promise<unknown> {
  return parseSavedVariables(await readFile(fixturePath(name))).ForeverLedgerDB;
}

/** Fast timings so tests do not wait for real WoW-sized pauses. */
export const FAST_READ: ReadOptions = { stableIntervalMs: 5, truncatedRetryDelaysMs: [20, 40] };

export interface TempEnv {
  dir: string;
  wowPath: string;
  svFile(account?: string): string;
  writeSv(content: string, account?: string): Promise<string>;
  config(overrides?: Partial<Config>): Config;
  cleanup(): Promise<void>;
}

/** A temp folder shaped like `<install>/_classic_era_/WTF/Account/<ACCOUNT>/SavedVariables`. */
export async function tempEnv(): Promise<TempEnv> {
  const dir = await mkdtemp(join(tmpdir(), 'fl-uploader-'));
  const wowPath = join(dir, 'World of Warcraft');
  const svFile = (account = 'TESTACCT') =>
    join(
      wowPath,
      '_classic_era_',
      'WTF',
      'Account',
      account,
      'SavedVariables',
      'ForeverLedger.lua',
    );
  return {
    dir,
    wowPath,
    svFile,
    async writeSv(content, account) {
      const file = svFile(account);
      await mkdir(join(file, '..'), { recursive: true });
      await writeFile(file, content);
      return file;
    },
    config(overrides = {}) {
      const configPath = join(dir, 'config', 'config.json');
      return {
        ...resolveConfig(
          { wowPath, accounts: [], uploaderId: 'test-uploader', token: 'test-token' },
          configPath,
        ),
        ...overrides,
      };
    },
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
