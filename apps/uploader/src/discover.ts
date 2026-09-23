import type { Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

export const SV_FILE_NAME = 'ForeverLedger.lua';

export interface SavedVariablesFile {
  /** Account id sent to the server: the account folder name (prefixed with the flavor folder on clashes). */
  account: string;
  accountFolder: string;
  file: string;
  wtfDir: string;
}

export interface Discovery {
  files: SavedVariablesFile[];
  wtfDirs: string[];
  /** Human-readable explanation of what was found, for `init`. */
  notes: string[];
}

async function listDirs(dir: string): Promise<Dirent[]> {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory());
  } catch {
    return [];
  }
}

/** Case-insensitive child lookup: WoW folders are `WTF`/`Account`, but Wine or copies may differ. */
async function findChild(dir: string, name: string, kind: 'dir' | 'file'): Promise<string | null> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const want = name.toLowerCase();
  const hit =
    entries.find((e) => e.name === name) ?? entries.find((e) => e.name.toLowerCase() === want);
  if (!hit) return null;
  const path = join(dir, hit.name);
  if (hit.isSymbolicLink()) {
    const s = await stat(path).catch(() => null);
    if (!s || (kind === 'dir' ? !s.isDirectory() : !s.isFile())) return null;
    return path;
  }
  return (kind === 'dir' ? hit.isDirectory() : hit.isFile()) ? path : null;
}

/**
 * Finds WTF folders for a user-supplied path. Accepts the WTF folder itself, `WTF/Account`,
 * a flavor folder containing `WTF`, or an install root whose direct subfolders contain `WTF`.
 */
async function findWtfDirs(path: string, notes: string[]): Promise<string[]> {
  const s = await stat(path).catch(() => null);
  if (!s) {
    notes.push(`${path} does not exist`);
    return [];
  }
  if (!s.isDirectory()) {
    notes.push(`${path} is a file, expected a folder`);
    return [];
  }
  const name = basename(path).toLowerCase();
  if (name === 'wtf') return [path];
  if (name === 'account' && basename(dirname(path)).toLowerCase() === 'wtf') {
    notes.push(`${path} is an Account folder; using its parent WTF folder`);
    return [dirname(path)];
  }
  const direct = await findChild(path, 'WTF', 'dir');
  if (direct) return [direct];

  const found: string[] = [];
  for (const sub of await listDirs(path)) {
    const wtf = await findChild(join(path, sub.name), 'WTF', 'dir');
    if (wtf) found.push(wtf);
  }
  if (found.length === 0)
    notes.push(
      `no WTF folder in ${path} or its subfolders: point wowPath at the game folder that contains WTF (e.g. the _classic_era_ folder)`,
    );
  return found.sort();
}

export interface DiscoverOptions {
  /** Only these accounts (folder names, case-insensitive); empty = all. */
  accounts?: string[];
}

/** Globs `WTF/Account/<ACCOUNT>/SavedVariables/ForeverLedger.lua` under `wowPath`. */
export async function discoverSavedVariables(
  wowPath: string,
  opts: DiscoverOptions = {},
): Promise<Discovery> {
  const notes: string[] = [];
  const wtfDirs = await findWtfDirs(wowPath, notes);
  const all: SavedVariablesFile[] = [];

  for (const wtfDir of wtfDirs) {
    const flavor = basename(dirname(wtfDir));
    notes.push(`WTF folder: ${wtfDir}${wtfDirs.length > 1 ? ` (${flavor})` : ''}`);
    const accountRoot = await findChild(wtfDir, 'Account', 'dir');
    if (!accountRoot) {
      notes.push(`  no Account folder yet (log in to the game once)`);
      continue;
    }
    const accountDirs = (await listDirs(accountRoot)).filter(
      (d) => d.name.toLowerCase() !== 'savedvariables',
    );
    if (accountDirs.length === 0) notes.push('  no account folders');
    for (const d of accountDirs.sort((a, b) => a.name.localeCompare(b.name))) {
      const svDir = await findChild(join(accountRoot, d.name), 'SavedVariables', 'dir');
      const file = svDir ? await findChild(svDir, SV_FILE_NAME, 'file') : null;
      if (file) {
        notes.push(`  account ${d.name}: ${SV_FILE_NAME} found`);
        all.push({ account: d.name, accountFolder: d.name, file, wtfDir });
      } else {
        notes.push(
          `  account ${d.name}: no ${SV_FILE_NAME} yet (enable the addon, log in, then /reload)`,
        );
      }
    }
  }

  // The same account folder under two flavors must not share upload state.
  const counts = new Map<string, number>();
  for (const f of all) counts.set(f.accountFolder, (counts.get(f.accountFolder) ?? 0) + 1);
  for (const f of all)
    if ((counts.get(f.accountFolder) ?? 0) > 1)
      f.account = `${basename(dirname(f.wtfDir))}/${f.accountFolder}`;

  let files = all;
  const wanted = (opts.accounts ?? []).map((a) => a.toLowerCase());
  if (wanted.length) {
    files = all.filter(
      (f) =>
        wanted.includes(f.account.toLowerCase()) || wanted.includes(f.accountFolder.toLowerCase()),
    );
    for (const w of opts.accounts ?? [])
      if (
        !all.some(
          (f) =>
            f.account.toLowerCase() === w.toLowerCase() ||
            f.accountFolder.toLowerCase() === w.toLowerCase(),
        )
      )
        notes.push(`configured account ${w} has no ${SV_FILE_NAME}`);
  }
  return { files, wtfDirs, notes };
}
