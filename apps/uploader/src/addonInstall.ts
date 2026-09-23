import { randomBytes } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ADDON_NAME, tocVersion } from '@forever-ledger/contracts';
import { errorMessage } from './errors.js';
import { isNotFound, renameDirWithRetry, RM_DIR } from './fsutil.js';
import type { Logger } from './log.js';

type Rename = (from: string, to: string) => Promise<void>;

export interface InstallDeps {
  /** Folder rename (default: renameDirWithRetry). */
  rename?: Rename;
  /** Recursive delete used for cleanup (default: rm with retries). */
  remove?: (path: string) => Promise<void>;
  logger?: Logger;
}

const STAGING = `.${ADDON_NAME}.new`;
const BAK = `${ADDON_NAME}.bak`;
const TRASH_PREFIX = `.${ADDON_NAME}.trash-`;
/** Side folders an interrupted run can leave behind (`.old` is the pre-trash name). */
const isLeftover = (name: string) =>
  name === STAGING || name === `.${ADDON_NAME}.old` || name.startsWith(TRASH_PREFIX);

/** `<flavor>/WTF` → `<flavor>/Interface/AddOns`. */
export const addonsDirFor = (wtfDir: string) => join(dirname(wtfDir), 'Interface', 'AddOns');

const exists = (p: string) =>
  lstat(p).then(
    () => true,
    (err: unknown) => {
      if (isNotFound(err)) return false;
      throw err;
    },
  );

/** True when AddOns/ForeverLedger is a symlink or junction (a developer's checkout): never replace it. */
export async function isAddonLinked(addonsDir: string): Promise<boolean> {
  try {
    return (await lstat(join(addonsDir, ADDON_NAME))).isSymbolicLink();
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

/** Version from AddOns/ForeverLedger/ForeverLedger.toc, or undefined when missing. */
export async function readInstalledVersion(
  addonsDir: string,
  folder = ADDON_NAME,
): Promise<string | undefined> {
  try {
    return tocVersion(await readFile(join(addonsDir, folder, `${ADDON_NAME}.toc`), 'utf8'));
  } catch (err) {
    if (isNotFound(err)) return undefined;
    throw err;
  }
}

function resolveDeps(deps: InstallDeps) {
  const remove = deps.remove ?? ((p: string) => rm(p, RM_DIR));
  return {
    rename: deps.rename ?? renameDirWithRetry,
    remove,
    /** Deletes a side folder; failures are only logged (the next install sweeps it). */
    discard: async (path: string) => {
      try {
        await remove(path);
      } catch (err) {
        deps.logger?.warn({ path, err: errorMessage(err) }, 'cannot delete leftover addon folder');
      }
    },
    /** Runs a restore step after a failure; its own failure is logged so the original error survives. */
    restore: async (what: string, step: () => Promise<void>) => {
      try {
        await step();
      } catch (err) {
        deps.logger?.error({ step: what, err: errorMessage(err) }, 'addon restore step failed');
      }
    },
  };
}

/** A unique name to move a folder to before deleting it, so nothing is half-deleted under a real name. */
const trashPath = (addonsDir: string) =>
  join(addonsDir, `${TRASH_PREFIX}${randomBytes(4).toString('hex')}`);

async function refuseLinked(addonsDir: string) {
  if (await isAddonLinked(addonsDir))
    throw new Error(`${join(addonsDir, ADDON_NAME)} is a link; not replacing it`);
}

async function sweepLeftovers(addonsDir: string, discard: (path: string) => Promise<void>) {
  let names: string[];
  try {
    names = await readdir(addonsDir);
  } catch (err) {
    if (isNotFound(err)) return;
    throw err;
  }
  for (const name of names.filter(isLeftover)) await discard(join(addonsDir, name));
}

/**
 * Writes the new files to AddOns/.ForeverLedger.new, moves the current folder to ForeverLedger.bak and the new one
 * into place. An older .bak is moved to a trash folder first and deleted only after the swap. If the swap fails the
 * current folder and the older .bak are moved back, so the user keeps both; if even that fails, `recoverAddon`
 * puts the .bak back on the next sync. WoW ignores the side folders: a folder only loads when it holds a .toc with
 * its own name.
 */
export async function installAddon(
  addonsDir: string,
  files: Map<string, Uint8Array>,
  deps: InstallDeps = {},
): Promise<void> {
  const { rename, remove, discard, restore } = resolveDeps(deps);
  const target = join(addonsDir, ADDON_NAME);
  const staging = join(addonsDir, STAGING);
  const bak = join(addonsDir, BAK);

  await mkdir(addonsDir, { recursive: true });
  await refuseLinked(addonsDir);
  await sweepLeftovers(addonsDir, discard);
  // Staging must start empty: if the sweep could not delete it, fail with the real error.
  if (await exists(staging)) await remove(staging);
  for (const [rel, data] of files) {
    const path = join(staging, ...rel.split('/'));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data, { flush: true });
  }

  const hadOld = await exists(target);
  let oldBak: string | undefined;
  try {
    if (hadOld) {
      if (await exists(bak)) {
        oldBak = trashPath(addonsDir);
        await rename(bak, oldBak);
      }
      await rename(target, bak);
    }
  } catch (err) {
    if (oldBak) await restore('older .bak back', () => rename(oldBak as string, bak));
    await discard(staging);
    throw err;
  }
  try {
    await rename(staging, target);
  } catch (err) {
    if (hadOld) await restore('current folder back', () => rename(bak, target));
    if (oldBak) await restore('older .bak back', () => rename(oldBak as string, bak));
    await discard(staging);
    throw err;
  }
  if (oldBak) await discard(oldBak);
}

/** Swaps ForeverLedger.bak back in. Returns the restored version. */
export async function rollbackAddon(addonsDir: string, deps: InstallDeps = {}): Promise<string> {
  const { rename, discard, restore } = resolveDeps(deps);
  const target = join(addonsDir, ADDON_NAME);
  const bak = join(addonsDir, BAK);
  await refuseLinked(addonsDir);
  const version = await readInstalledVersion(addonsDir, BAK);
  if (!version) throw new Error(`no previous version to roll back to in ${addonsDir}`);

  const old = trashPath(addonsDir);
  const hadCurrent = await exists(target);
  if (hadCurrent) await rename(target, old);
  try {
    await rename(bak, target);
  } catch (err) {
    if (hadCurrent) await restore('current folder back', () => rename(old, target));
    throw err;
  }
  if (hadCurrent) await discard(old);
  return version;
}

/**
 * Heals an install interrupted between its renames: when AddOns/ForeverLedger is missing or has no readable version
 * but ForeverLedger.bak has one, moves the .bak back. Returns the restored version, or undefined when nothing was
 * needed. Linked folders are never touched.
 */
export async function recoverAddon(
  addonsDir: string,
  deps: InstallDeps = {},
): Promise<string | undefined> {
  if (await isAddonLinked(addonsDir)) return undefined;
  if (await readInstalledVersion(addonsDir).catch(() => undefined)) return undefined;
  if (!(await readInstalledVersion(addonsDir, BAK))) return undefined;
  const restored = await rollbackAddon(addonsDir, deps);
  deps.logger?.warn({ dir: addonsDir, version: restored }, 'restored addon from ForeverLedger.bak');
  return restored;
}

/** True when AddOns/ForeverLedger exists (a link counts). */
export const hasAddonFolder = (addonsDir: string) => exists(join(addonsDir, ADDON_NAME));
