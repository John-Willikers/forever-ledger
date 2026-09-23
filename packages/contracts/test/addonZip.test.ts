import { createHash } from 'node:crypto';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { AddonZipError, verifyAddonZip } from '../src/index.js';

const TOC = '## Interface: 16001\n## Title: Forever Ledger\n## Version: 0.2.2\nForeverLedger.lua\n';
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const zip = (entries: Record<string, string>) =>
  zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)])));
const good = () =>
  zip({ 'ForeverLedger/ForeverLedger.toc': TOC, 'ForeverLedger/ForeverLedger.lua': '-- lua' });

describe('verifyAddonZip', () => {
  it('returns files relative to the addon folder', () => {
    const z = good();
    const files = verifyAddonZip(z, { version: '0.2.2', sha256: sha(z) });
    expect([...files.keys()].sort()).toEqual(['ForeverLedger.lua', 'ForeverLedger.toc']);
  });

  it('rejects a sha256 mismatch', () => {
    expect(() => verifyAddonZip(good(), { version: '0.2.2', sha256: '0'.repeat(64) })).toThrow(
      /sha256/,
    );
  });

  it.each([
    ['../evil.lua'],
    ['ForeverLedger/../../evil.lua'],
    ['/etc/evil'],
    ['C:/evil.lua'],
    ['ForeverLedger\\..\\evil.lua'],
    ['OtherAddon/x.lua'],
    ['ForeverLedger.lua'],
  ])('rejects unsafe entry %s', (name) => {
    const z = zip({ 'ForeverLedger/ForeverLedger.toc': TOC, [name]: 'x' });
    expect(() => verifyAddonZip(z, { version: '0.2.2', sha256: sha(z) })).toThrow(AddonZipError);
  });

  it('rejects a .toc with another version', () => {
    const z = good();
    expect(() => verifyAddonZip(z, { version: '0.2.3', sha256: sha(z) })).toThrow(/version/);
  });

  it('rejects a zip without a .toc', () => {
    const z = zip({ 'ForeverLedger/ForeverLedger.lua': '-- lua' });
    expect(() => verifyAddonZip(z, { version: '0.2.2', sha256: sha(z) })).toThrow(/toc/);
  });

  it('rejects oversized contents', () => {
    const z = zip({
      'ForeverLedger/ForeverLedger.toc': TOC,
      'ForeverLedger/big.lua': 'x'.repeat(6 * 1024 * 1024),
    });
    expect(() => verifyAddonZip(z, { version: '0.2.2', sha256: sha(z) })).toThrow(/large/);
  });
});
