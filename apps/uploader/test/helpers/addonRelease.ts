import { createHash } from 'node:crypto';
import { addonDownloadUrl } from '@forever-ledger/contracts';
import type { AddonManifest } from '@forever-ledger/contracts';
import { strToU8, zipSync } from 'fflate';

export interface AddonRelease {
  zip: Uint8Array;
  manifest: AddonManifest;
  /** The zip's contents inside ForeverLedger/, for installAddon. */
  files: Map<string, Uint8Array>;
}

/** A minimal ForeverLedger release zip for `version` and the manifest the server would publish for it. */
export function release(version: string): AddonRelease {
  const toc = `## Interface: 11508\n## Version: ${version}\n`;
  const zip = zipSync({
    'ForeverLedger/ForeverLedger.toc': strToU8(toc),
    'ForeverLedger/ForeverLedger.lua': strToU8(`-- ${version}`),
  });
  const manifest: AddonManifest = {
    addon: 'ForeverLedger',
    version,
    url: addonDownloadUrl(version),
    sha256: createHash('sha256').update(zip).digest('hex'),
    size: zip.length,
  };
  const files = new Map([
    ['ForeverLedger.toc', strToU8(toc)],
    ['ForeverLedger.lua', strToU8(`-- ${version}`)],
  ]);
  return { zip, manifest, files };
}
