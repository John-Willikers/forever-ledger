// Checks that an addon release tag, ForeverLedger.toc and ForeverLedger.lua agree on the version, and optionally
// that a built release zip passes the same checks the uploader runs before installing it.
// Usage: node --conditions=development --import tsx scripts/check-addon-version.ts <version> [--zip <path>]
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADDON_NAME, isAddonVersion, tocVersion, verifyAddonZip } from '@forever-ledger/contracts';

const ADDON_DIR = join('addon', ADDON_NAME);
const TOC = join(ADDON_DIR, `${ADDON_NAME}.toc`);
const LUA = join(ADDON_DIR, `${ADDON_NAME}.lua`);

const read = (path: string): string | Error => {
  try {
    return readFileSync(path, 'utf8');
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  }
};

/** Problems with releasing `tagVersion` from the repo at `root`; empty when the tag, .toc and Lua agree. */
export function checkAddonVersion(root: string, tagVersion: string): string[] {
  if (!isAddonVersion(tagVersion)) return [`tag version "${tagVersion}" is not x.y.z`];
  const problems: string[] = [];

  const toc = read(join(root, TOC));
  if (toc instanceof Error) problems.push(`${TOC}: cannot read (${toc.message})`);
  else {
    const v = tocVersion(toc);
    if (v === undefined) problems.push(`${TOC}: needs exactly one "## Version:" line`);
    else if (v !== tagVersion) {
      problems.push(`${TOC}: ## Version ${v} does not match tag ${tagVersion}`);
    }
  }

  const lua = read(join(root, LUA));
  if (lua instanceof Error) problems.push(`${LUA}: cannot read (${lua.message})`);
  else {
    const found = [...lua.matchAll(/^local VERSION = "([^"]*)"/gm)];
    if (found.length !== 1) problems.push(`${LUA}: needs exactly one 'local VERSION = "…"' line`);
    else if (found[0]?.[1] !== tagVersion) {
      problems.push(`${LUA}: VERSION ${found[0]?.[1]} does not match tag ${tagVersion}`);
    }
  }
  return problems;
}

/** Problems with a built release zip, judged exactly as the uploader's `verifyAddonZip` would. */
export function checkAddonZip(zipPath: string, version: string): string[] {
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(zipPath);
  } catch (e) {
    return [`${zipPath}: cannot read (${e instanceof Error ? e.message : String(e)})`];
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  try {
    verifyAddonZip(bytes, { version, sha256 });
    return [];
  } catch (e) {
    return [`${zipPath}: ${e instanceof Error ? e.message : String(e)}`];
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [version, flag, zipPath] = process.argv.slice(2);
  if (version === undefined || (flag !== undefined && (flag !== '--zip' || !zipPath))) {
    console.error('usage: check-addon-version.ts <version> [--zip <path>]');
    process.exitCode = 2;
  } else {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const problems = checkAddonVersion(root, version);
    if (zipPath && problems.length === 0) problems.push(...checkAddonZip(zipPath, version));
    for (const p of problems) console.error(p);
    if (problems.length > 0) process.exitCode = 1;
    else console.log(`${ADDON_NAME} ${version} ok${zipPath ? ` (${zipPath} verified)` : ''}`);
  }
}
