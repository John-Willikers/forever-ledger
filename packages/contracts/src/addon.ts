import { z } from 'zod';

/** The addon the tray app and `addon-sync` manage. ForeverLedgerProbe is never auto-updated. */
export const ADDON_NAME = 'ForeverLedger';
export const ADDON_REPO = 'John-Willikers/forever-ledger';
/** Downloads must come from this repo's releases. */
export const ADDON_DOWNLOAD_PREFIX = `https://github.com/${ADDON_REPO}/releases/download/`;
export const MAX_ADDON_BYTES = 5 * 1024 * 1024;

const VERSION_RE = /^\d+\.\d+\.\d+$/;
export const isAddonVersion = (v: string) => VERSION_RE.test(v);
export const addonTag = (version: string) => `addon-v${version}`;
export const addonAssetName = (version: string) => `${ADDON_NAME}-${version}.zip`;

/** Compares dotted numeric versions ("0.2.10" > "0.2.9"); missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

/** Reads `## Version: x.y.z` from a .toc file's text. */
export function tocVersion(toc: string): string | undefined {
  return /^##\s*Version:\s*(\S+)\s*$/m.exec(toc)?.[1];
}

/** GET /v1/addon/manifest response: the addon version this client build should run. */
export const AddonManifest = z.object({
  addon: z.literal(ADDON_NAME),
  version: z.string().regex(VERSION_RE),
  url: z.string().startsWith(ADDON_DOWNLOAD_PREFIX),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.number().int().positive().max(MAX_ADDON_BYTES),
});
export type AddonManifest = z.infer<typeof AddonManifest>;
