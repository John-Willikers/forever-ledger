import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8 } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addonsDirFor,
  installAddon,
  readInstalledVersion,
  rollbackAddon,
} from '../src/addonInstall.js';

const toc = (v: string) => `## Interface: 16001\n## Version: ${v}\n`;
const files = (v: string) =>
  new Map([
    ['ForeverLedger.toc', strToU8(toc(v))],
    ['ForeverLedger.lua', strToU8(`-- ${v}`)],
  ]);

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fl-addon-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('addon install', () => {
  it('derives Interface/AddOns from a WTF folder', () => {
    expect(addonsDirFor(join('C:', 'Games', 'Forever', '_classic_', 'WTF'))).toBe(
      join('C:', 'Games', 'Forever', '_classic_', 'Interface', 'AddOns'),
    );
  });

  it('installs into an empty AddOns folder', async () => {
    await installAddon(dir, files('0.2.1'));
    expect(await readInstalledVersion(dir)).toBe('0.2.1');
    expect(await readdir(dir)).toEqual(['ForeverLedger']);
  });

  it('keeps the previous version as ForeverLedger.bak', async () => {
    await installAddon(dir, files('0.2.1'));
    await installAddon(dir, files('0.2.2'));
    expect(await readInstalledVersion(dir)).toBe('0.2.2');
    expect(await readFile(join(dir, 'ForeverLedger.bak', 'ForeverLedger.lua'), 'utf8')).toBe(
      '-- 0.2.1',
    );
  });

  it('puts the old version back when the final rename fails', async () => {
    await installAddon(dir, files('0.2.1'));
    let calls = 0;
    const rename = async (from: string, to: string) => {
      calls++;
      if (calls === 2) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      const { rename: fsRename } = await import('node:fs/promises');
      await fsRename(from, to);
    };
    await expect(installAddon(dir, files('0.2.2'), { rename })).rejects.toThrow(/busy/);
    expect(await readInstalledVersion(dir)).toBe('0.2.1');
    expect((await readdir(dir)).sort()).toEqual(['ForeverLedger']);
  });

  it('rolls back to .bak', async () => {
    await installAddon(dir, files('0.2.1'));
    await installAddon(dir, files('0.2.2'));
    expect(await rollbackAddon(dir)).toBe('0.2.1');
    expect(await readInstalledVersion(dir)).toBe('0.2.1');
  });

  it('keeps the current version when the rollback rename fails', async () => {
    await installAddon(dir, files('0.2.1'));
    await installAddon(dir, files('0.2.2'));
    let calls = 0;
    const rename = async (from: string, to: string) => {
      calls++;
      if (calls === 2) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      const { rename: fsRename } = await import('node:fs/promises');
      await fsRename(from, to);
    };
    await expect(rollbackAddon(dir, { rename })).rejects.toThrow(/busy/);
    expect(await readInstalledVersion(dir)).toBe('0.2.2');
    expect(await readInstalledVersion(dir, 'ForeverLedger.bak')).toBe('0.2.1');
  });

  it('refuses to roll back without a .bak', async () => {
    await installAddon(dir, files('0.2.1'));
    await expect(rollbackAddon(dir)).rejects.toThrow(/no previous version/);
  });

  it('reports no version when the addon is missing', async () => {
    expect(await readInstalledVersion(dir)).toBeUndefined();
    await mkdir(join(dir, 'ForeverLedger'));
    await writeFile(join(dir, 'ForeverLedger', 'ForeverLedger.toc'), '## Title: x\n');
    expect(await readInstalledVersion(dir)).toBeUndefined();
  });
});
