import { createHash } from 'node:crypto';
import { strFromU8, unzipSync } from 'fflate';
import { ADDON_NAME, MAX_ADDON_BYTES, tocVersion } from './addon.js';

export class AddonZipError extends Error {
  override name = 'AddonZipError';
}

/** Path segments allowed in the addon zip: portable, no traversal, nothing Windows treats specially. */
const SEGMENT_RE = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;
const RESERVED_RE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
const STORED = 0;
const DEFLATE = 8;
/** The only .toc allowed, relative to the addon folder. */
const TOC_PATH = `${ADDON_NAME}.toc`;

/** Splits an entry name into its path inside the addon folder; throws unless every segment is safe. */
function addonPath(name: string, isDir: boolean): string {
  const parts = (isDir ? name.slice(0, -1) : name).split('/');
  const safe = parts.every((p) => SEGMENT_RE.test(p) && !p.endsWith('.') && !RESERVED_RE.test(p));
  if (!safe || parts[0] !== ADDON_NAME || (!isDir && parts.length < 2)) {
    throw new AddonZipError(`unexpected entry in addon zip: ${name}`);
  }
  return parts.slice(1).join('/');
}

/** Case- and normalization-insensitive key, the way Windows and macOS compare file names. */
const fold = (path: string) => path.normalize('NFC').toLowerCase();

/**
 * Checks a downloaded addon zip before anything touches disk: sha256, entry paths (all under ForeverLedger/, no
 * traversal, no collisions), compression, unpacked size and the .toc version. Returns file contents keyed by path
 * inside the addon folder. Per-entry CRCs are not checked: the whole-zip sha256 already pins the bytes.
 */
export function verifyAddonZip(
  zip: Uint8Array,
  expected: { version: string; sha256: string },
): Map<string, Uint8Array> {
  if (zip.byteLength > MAX_ADDON_BYTES) throw new AddonZipError('addon zip is too large');
  const actual = createHash('sha256').update(zip).digest('hex');
  if (actual !== expected.sha256) {
    throw new AddonZipError(`sha256 mismatch: expected ${expected.sha256}, got ${actual}`);
  }

  // Every central-directory entry passes through the filter before fflate copies or inflates anything.
  const declared = new Map<string, number>(); // file entry name -> declared unpacked size
  const dirs = new Set<string>(); // folded paths of every directory, explicit or implied
  const seen = new Set<string>();
  let unpacked = 0;
  let packed = 0;
  const filter = (f: { name: string; size: number; originalSize: number; compression: number }) => {
    if (seen.has(f.name)) throw new AddonZipError(`duplicate entry in addon zip: ${f.name}`);
    seen.add(f.name);
    const isDir = f.name.endsWith('/');
    const path = addonPath(f.name, isDir);
    const segments = path === '' ? [] : path.split('/');
    for (let i = 1; i < segments.length + (isDir ? 1 : 0); i++) {
      dirs.add(fold(segments.slice(0, i).join('/')));
    }
    if (isDir) return false;

    if (f.compression !== STORED && f.compression !== DEFLATE) {
      throw new AddonZipError(`unsupported compression method ${f.compression} in ${f.name}`);
    }
    // fflate copies `size` bytes for a stored entry whatever `originalSize` claims.
    if (f.compression === STORED && f.size !== f.originalSize) {
      throw new AddonZipError(`stored entry ${f.name} has mismatched sizes`);
    }
    unpacked += Math.max(f.size, f.originalSize);
    if (unpacked > MAX_ADDON_BYTES) throw new AddonZipError('addon is too large when unpacked');
    // Coarse guard only: entries whose data adds up to more than the zip itself must share bytes. Overlaps that
    // stay under the zip's length slip past it; the `unpacked` counter above is what bounds memory.
    packed += f.size;
    if (packed > zip.byteLength) throw new AddonZipError('addon zip has overlapping entries');
    declared.set(f.name, f.originalSize);
    return true;
  };

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip, { filter });
  } catch (e) {
    if (e instanceof AddonZipError) throw e;
    throw new AddonZipError(`malformed addon zip: ${e instanceof Error ? e.message : String(e)}`, {
      cause: e,
    });
  }

  const files = new Map<string, Uint8Array>();
  const folded = new Set<string>();
  for (const [name, data] of Object.entries(entries)) {
    const size = declared.get(name);
    if (data.length !== size) {
      throw new AddonZipError(`${name} unpacked to ${data.length} bytes, expected ${size}`);
    }
    const path = addonPath(name, false);
    const key = fold(path);
    if (folded.has(key))
      throw new AddonZipError(`entries collide on case-insensitive disks: ${name}`);
    if (dirs.has(key)) throw new AddonZipError(`${name} is both a file and a directory`);
    // WoW prefers flavor tocs (ForeverLedger_Vanilla.toc, -Classic.toc, …) over the one we verify.
    if (key.endsWith('.toc') && path !== TOC_PATH) {
      throw new AddonZipError(`unexpected .toc in addon zip: ${name}`);
    }
    folded.add(key);
    files.set(path, data);
  }

  const toc = files.get(TOC_PATH);
  if (!toc) throw new AddonZipError(`addon zip has no ${ADDON_NAME}/${ADDON_NAME}.toc`);
  const v = tocVersion(strFromU8(toc));
  if (v !== expected.version) {
    throw new AddonZipError(`.toc version ${v ?? '(none)'} does not match ${expected.version}`);
  }
  return files;
}
