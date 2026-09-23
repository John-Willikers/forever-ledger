import { createHash } from 'node:crypto';
import { strFromU8, unzipSync } from 'fflate';
import { ADDON_NAME, MAX_ADDON_BYTES, tocVersion } from './addon.js';

export class AddonZipError extends Error {
  override name = 'AddonZipError';
}

/**
 * Checks a downloaded addon zip before anything touches disk: sha256, entry paths (all under ForeverLedger/, no
 * traversal), unpacked size and the .toc version. Returns file contents keyed by path inside the addon folder.
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

  let total = 0;
  const entries = unzipSync(zip, {
    filter: (f) => {
      total += f.originalSize;
      if (total > MAX_ADDON_BYTES) throw new AddonZipError('addon is too large when unpacked');
      return true;
    },
  });

  const files = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith('/')) continue; // directory entry
    const parts = name.split('/');
    const unsafe =
      name.includes('\\') ||
      name.startsWith('/') ||
      /^[A-Za-z]:/.test(name) ||
      parts.some((p) => p === '' || p === '.' || p === '..');
    if (unsafe || parts[0] !== ADDON_NAME || parts.length < 2) {
      throw new AddonZipError(`unexpected entry in addon zip: ${name}`);
    }
    files.set(parts.slice(1).join('/'), data);
  }

  const toc = files.get(`${ADDON_NAME}.toc`);
  if (!toc) throw new AddonZipError(`addon zip has no ${ADDON_NAME}/${ADDON_NAME}.toc`);
  const v = tocVersion(strFromU8(toc));
  if (v !== expected.version) {
    throw new AddonZipError(`.toc version ${v ?? '(none)'} does not match ${expected.version}`);
  }
  return files;
}
