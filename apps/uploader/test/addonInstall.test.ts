import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename as fsRename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8 } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addonsDirFor,
  installAddon,
  isAddonLinked,
  readInstalledVersion,
  recoverAddon,
  rollbackAddon,
} from '../src/addonInstall.js';

const toc = (v: string) => `## Interface: 16001\n## Version: ${v}\n`;
const files = (v: string) =>
  new Map([
    ['ForeverLedger.toc', strToU8(toc(v))],
    ['ForeverLedger.lua', strToU8(`-- ${v}`)],
  ]);

/** A rename that fails with EBUSY on the calls listed (1-based), like a file held open by a virus scanner. */
function failingRename(...failOn: number[]) {
  let calls = 0;
  return async (from: string, to: string) => {
    calls++;
    if (failOn.includes(calls)) throw Object.assign(new Error(`busy#${calls}`), { code: 'EBUSY' });
    await fsRename(from, to);
  };
}

const failingRemove = async () => {
  throw Object.assign(new Error('locked'), { code: 'EBUSY' });
};

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
    expect((await readdir(dir)).sort()).toEqual(['ForeverLedger', 'ForeverLedger.bak']);
  });

  it('puts the old version back when the final rename fails', async () => {
    await installAddon(dir, files('0.2.1'));
    await expect(installAddon(dir, files('0.2.2'), { rename: failingRename(2) })).rejects.toThrow(
      /busy/,
    );
    expect(await readInstalledVersion(dir)).toBe('0.2.1');
    expect((await readdir(dir)).sort()).toEqual(['ForeverLedger']);
  });

  it('keeps the older .bak too when an install over a .bak fails', async () => {
    await installAddon(dir, files('0.2.1'));
    await installAddon(dir, files('0.2.2'));
    // 1: old .bak → trash, 2: current → .bak, 3: staging → current (fails)
    await expect(installAddon(dir, files('0.2.3'), { rename: failingRename(3) })).rejects.toThrow(
      /busy#3/,
    );
    expect(await readInstalledVersion(dir)).toBe('0.2.2');
    expect(await readInstalledVersion(dir, 'ForeverLedger.bak')).toBe('0.2.1');
    expect((await readdir(dir)).sort()).toEqual(['ForeverLedger', 'ForeverLedger.bak']);
  });

  it('rethrows the original error when the restore fails too, and recoverAddon heals it', async () => {
    await installAddon(dir, files('0.2.1'));
    await expect(
      installAddon(dir, files('0.2.2'), { rename: failingRename(2, 3) }),
    ).rejects.toThrow('busy#2');
    // The swap marker stays so the next sync knows this .bak is to be restored.
    expect((await readdir(dir)).sort()).toEqual(['.ForeverLedger.swap', 'ForeverLedger.bak']);

    expect(await recoverAddon(dir)).toBe('0.2.1');
    expect(await readInstalledVersion(dir)).toBe('0.2.1');
    expect(await readdir(dir)).toEqual(['ForeverLedger']);
  });

  it('sweeps leftovers of interrupted runs', async () => {
    for (const name of ['.ForeverLedger.new', '.ForeverLedger.old', '.ForeverLedger.trash-1a2b'])
      await mkdir(join(dir, name, 'sub'), { recursive: true });
    await installAddon(dir, files('0.2.1'));
    expect(await readdir(dir)).toEqual(['ForeverLedger']);
  });

  it('does not fail a finished install when cleanup fails', async () => {
    await installAddon(dir, files('0.2.1'));
    await installAddon(dir, files('0.2.2'));
    await installAddon(dir, files('0.2.3'), { remove: failingRemove });
    expect(await readInstalledVersion(dir)).toBe('0.2.3');
    expect(await readInstalledVersion(dir, 'ForeverLedger.bak')).toBe('0.2.2');
  });

  it('rolls back to .bak', async () => {
    await installAddon(dir, files('0.2.1'));
    await installAddon(dir, files('0.2.2'));
    expect(await rollbackAddon(dir)).toBe('0.2.1');
    expect(await readInstalledVersion(dir)).toBe('0.2.1');
    expect(await readdir(dir)).toEqual(['ForeverLedger']);
  });

  it('keeps the current version when the rollback rename fails', async () => {
    await installAddon(dir, files('0.2.1'));
    await installAddon(dir, files('0.2.2'));
    await expect(rollbackAddon(dir, { rename: failingRename(2) })).rejects.toThrow(/busy/);
    expect((await readdir(dir)).sort()).toEqual(['ForeverLedger', 'ForeverLedger.bak']);
    expect(await readInstalledVersion(dir)).toBe('0.2.2');
    expect(await readInstalledVersion(dir, 'ForeverLedger.bak')).toBe('0.2.1');
  });

  it('does not fail a finished rollback when cleanup fails', async () => {
    await installAddon(dir, files('0.2.1'));
    await installAddon(dir, files('0.2.2'));
    expect(await rollbackAddon(dir, { remove: failingRemove })).toBe('0.2.1');
    expect(await readInstalledVersion(dir)).toBe('0.2.1');
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

describe('recoverAddon', () => {
  it('leaves a working install alone', async () => {
    await installAddon(dir, files('0.2.1'));
    await installAddon(dir, files('0.2.2'));
    expect(await recoverAddon(dir)).toBeUndefined();
    expect(await readInstalledVersion(dir)).toBe('0.2.2');
  });

  /** What a crash in the middle of a swap leaves: the marker, plus whatever the renames got to. */
  const interruptedSwap = () => writeFile(join(dir, '.ForeverLedger.swap'), '');

  it('replaces a folder without a valid .toc by the .bak after an interrupted swap', async () => {
    await installAddon(dir, files('0.2.1'));
    await installAddon(dir, files('0.2.2'));
    await writeFile(join(dir, 'ForeverLedger', 'ForeverLedger.toc'), '## Title: x\n');
    await interruptedSwap();
    expect(await recoverAddon(dir)).toBe('0.2.1');
    expect(await readInstalledVersion(dir)).toBe('0.2.1');
    expect(await readdir(dir)).toEqual(['ForeverLedger']);
  });

  it('restores a missing folder after an interrupted swap', async () => {
    await installAddon(dir, files('0.2.1'));
    await installAddon(dir, files('0.2.2'));
    await rm(join(dir, 'ForeverLedger'), { recursive: true });
    await interruptedSwap();
    expect(await recoverAddon(dir)).toBe('0.2.1');
    expect(await readdir(dir)).toEqual(['ForeverLedger']);
  });

  it('does not undo a deliberate uninstall (no swap marker)', async () => {
    await installAddon(dir, files('0.2.1'));
    await installAddon(dir, files('0.2.2'));
    await rm(join(dir, 'ForeverLedger'), { recursive: true });
    expect(await recoverAddon(dir)).toBeUndefined();
    expect(await readdir(dir)).toEqual(['ForeverLedger.bak']);
  });

  it('never trashes a folder whose .toc it cannot read', async (ctx) => {
    if (process.platform === 'win32' || process.getuid?.() === 0) return ctx.skip();
    await installAddon(dir, files('0.2.1'));
    await installAddon(dir, files('0.2.2'));
    await interruptedSwap();
    const tocPath = join(dir, 'ForeverLedger', 'ForeverLedger.toc');
    await chmod(tocPath, 0);
    try {
      await expect(recoverAddon(dir)).rejects.toMatchObject({ code: 'EACCES' });
    } finally {
      await chmod(tocPath, 0o644);
    }
    expect(await readInstalledVersion(dir)).toBe('0.2.2');
    expect(await readInstalledVersion(dir, 'ForeverLedger.bak')).toBe('0.2.1');
  });

  it('does nothing without a .bak', async () => {
    expect(await recoverAddon(dir)).toBeUndefined();
    expect(await readdir(dir)).toEqual([]);
  });
});

describe('linked addon folders', () => {
  /** Links AddOns/ForeverLedger to a checkout elsewhere; false where the OS refuses links. */
  async function linkCheckout(): Promise<string | false> {
    const checkout = join(dir, 'checkout');
    await mkdir(checkout);
    await writeFile(join(checkout, 'ForeverLedger.toc'), toc('9.9.9'));
    await mkdir(join(dir, 'AddOns'));
    try {
      await symlink(checkout, join(dir, 'AddOns', 'ForeverLedger'), 'junction');
    } catch {
      return false;
    }
    return join(dir, 'AddOns');
  }

  it('refuses to replace or recover over a linked folder', async (ctx) => {
    const addons = await linkCheckout();
    if (!addons) return ctx.skip();
    expect(await isAddonLinked(addons)).toBe(true);
    await expect(installAddon(addons, files('0.2.1'))).rejects.toThrow(/link/);
    expect((await lstat(join(addons, 'ForeverLedger'))).isSymbolicLink()).toBe(true);
    await mkdir(join(addons, 'ForeverLedger.bak'));
    await writeFile(join(addons, 'ForeverLedger.bak', 'ForeverLedger.toc'), toc('0.2.0'));
    expect(await recoverAddon(addons)).toBeUndefined();
    await expect(rollbackAddon(addons)).rejects.toThrow(/link/);
    expect((await lstat(join(addons, 'ForeverLedger'))).isSymbolicLink()).toBe(true);
    expect(await readInstalledVersion(addons)).toBe('9.9.9');
    expect(await isAddonLinked(dir)).toBe(false);
  });
});
