import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ADDON_NAME, tocVersion } from '@forever-ledger/contracts';
import { isNotFound, renameWithRetry } from './fsutil.js';

type Rename = (from: string, to: string) => Promise<void>;

/** `<flavor>/WTF` → `<flavor>/Interface/AddOns`. */
export const addonsDirFor = (wtfDir: string) => join(dirname(wtfDir), 'Interface', 'AddOns');

const exists = (p: string) =>
  stat(p).then(
    () => true,
    (err: unknown) => {
      if (isNotFound(err)) return false;
      throw err;
    },
  );

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

/**
 * Writes the new files to AddOns/.ForeverLedger.new, moves the current folder to ForeverLedger.bak and the new one
 * into place. If the last rename fails the old folder is moved back. WoW ignores both side folders: a folder only
 * loads when it holds a .toc with its own name.
 */
export async function installAddon(
  addonsDir: string,
  files: Map<string, Uint8Array>,
  deps: { rename?: Rename } = {},
): Promise<void> {
  const rename = deps.rename ?? renameWithRetry;
  const target = join(addonsDir, ADDON_NAME);
  const staging = join(addonsDir, `.${ADDON_NAME}.new`);
  const bak = join(addonsDir, `${ADDON_NAME}.bak`);

  await mkdir(addonsDir, { recursive: true });
  await rm(staging, { recursive: true, force: true });
  for (const [rel, data] of files) {
    const path = join(staging, ...rel.split('/'));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  const hadOld = await exists(target);
  if (hadOld) {
    await rm(bak, { recursive: true, force: true });
    await rename(target, bak);
  }
  try {
    await rename(staging, target);
  } catch (err) {
    if (hadOld) await rename(bak, target);
    await rm(staging, { recursive: true, force: true });
    throw err;
  }
}

/** Swaps ForeverLedger.bak back in. Returns the restored version. */
export async function rollbackAddon(
  addonsDir: string,
  deps: { rename?: Rename } = {},
): Promise<string> {
  const rename = deps.rename ?? renameWithRetry;
  const target = join(addonsDir, ADDON_NAME);
  const bak = join(addonsDir, `${ADDON_NAME}.bak`);
  const old = join(addonsDir, `.${ADDON_NAME}.old`);
  const version = await readInstalledVersion(addonsDir, `${ADDON_NAME}.bak`);
  if (!version) throw new Error(`no previous version to roll back to in ${addonsDir}`);

  await rm(old, { recursive: true, force: true });
  const hadCurrent = await exists(target);
  if (hadCurrent) await rename(target, old);
  try {
    await rename(bak, target);
  } catch (err) {
    if (hadCurrent) await rename(old, target);
    throw err;
  }
  await rm(old, { recursive: true, force: true });
  return version;
}
