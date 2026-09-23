import { randomBytes } from 'node:crypto';
import { deflateSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { AddonZipError, verifyAddonZip } from '../src/index.js';
import { rawZip, sha, zip } from './helpers/zip.js';

const TOC = '## Interface: 16001\n## Title: Forever Ledger\n## Version: 0.2.2\nForeverLedger.lua\n';
const TOC_NAME = 'ForeverLedger/ForeverLedger.toc';
const good = () => zip({ [TOC_NAME]: TOC, 'ForeverLedger/ForeverLedger.lua': '-- lua' });
const verify = (z: Uint8Array) => () => verifyAddonZip(z, { version: '0.2.2', sha256: sha(z) });

describe('verifyAddonZip', () => {
  it('returns files relative to the addon folder', () => {
    const z = good();
    const files = verifyAddonZip(z, { version: '0.2.2', sha256: sha(z) });
    expect([...files.keys()].sort()).toEqual(['ForeverLedger.lua', 'ForeverLedger.toc']);
  });

  it('accepts subfolders and directory entries under the addon folder', () => {
    const z = rawZip([
      { name: 'ForeverLedger/' },
      { name: TOC_NAME, data: TOC },
      { name: 'ForeverLedger/libs/' },
      { name: 'ForeverLedger/libs/Lib-1.0.lua', data: '-- lib' },
    ]);
    expect([...verify(z)().keys()].sort()).toEqual(['ForeverLedger.toc', 'libs/Lib-1.0.lua']);
  });

  it('verifies a CRLF .toc', () => {
    expect(
      verify(zip({ [TOC_NAME]: TOC.replaceAll('\n', '\r\n') }))().has('ForeverLedger.toc'),
    ).toBe(true);
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
    ['ForeverLedger/C:/Windows/evil.dll'],
    ['ForeverLedger/C:evil.lua'],
    ['ForeverLedger/x.lua:ads'],
    ['ForeverLedger/CON'],
    ['ForeverLedger/aux.lua'],
    ['ForeverLedger/x.lua.'],
    ['ForeverLedger/x.lua '],
    ['ForeverLedger/a\u0000b.lua'],
    ['ForeverLedger/.. /x'],
    ['ForeverLedger/./x.lua'],
    ['ForeverLedger//x.lua'],
    ['foreverledger/x.lua'],
  ])('rejects unsafe entry %j', (name) => {
    const z = zip({ [TOC_NAME]: TOC, [name]: 'x' });
    expect(verify(z)).toThrow(AddonZipError);
    expect(verify(z)).toThrow(/unexpected entry/);
  });

  it('rejects a directory entry outside the addon folder', () => {
    const z = rawZip([{ name: TOC_NAME, data: TOC }, { name: 'OtherAddon/' }]);
    expect(verify(z)).toThrow(/unexpected entry in addon zip: OtherAddon\//);
  });

  it('rejects entries that collide case-insensitively', () => {
    const z = zip({ [TOC_NAME]: TOC, 'ForeverLedger/FOREVERLEDGER.TOC': '## Version: 9.9.9\n' });
    expect(verify(z)).toThrow(/collide/);
  });

  it('rejects a path that is both a file and a directory', () => {
    const z = zip({ [TOC_NAME]: TOC, 'ForeverLedger/a': '1', 'ForeverLedger/a/b': '2' });
    expect(verify(z)).toThrow(/both a file and a directory/);
    const d = rawZip([
      { name: TOC_NAME, data: TOC },
      { name: 'ForeverLedger/a' },
      { name: 'ForeverLedger/A/' },
    ]);
    expect(verify(d)).toThrow(/both a file and a directory/);
  });

  it('rejects duplicate entry names', () => {
    const z = rawZip([
      { name: TOC_NAME, data: TOC },
      { name: TOC_NAME, data: '## Version: 9.9.9\n' },
    ]);
    expect(verify(z)).toThrow(/duplicate entry/);
  });

  it('rejects a .toc with another version', () => {
    const z = good();
    expect(() => verifyAddonZip(z, { version: '0.2.3', sha256: sha(z) })).toThrow(/version/);
  });

  it('rejects a zip without a .toc', () => {
    expect(verify(zip({ 'ForeverLedger/ForeverLedger.lua': '-- lua' }))).toThrow(/toc/);
  });

  it('rejects a raw zip over the size cap', () => {
    const z = zip({ [TOC_NAME]: TOC, 'ForeverLedger/noise.bin': randomBytes(5 * 1024 * 1024) }, 0);
    expect(verify(z)).toThrow(/^addon zip is too large$/);
  });

  it('rejects oversized contents', () => {
    const z = zip({ [TOC_NAME]: TOC, 'ForeverLedger/big.lua': 'x'.repeat(6 * 1024 * 1024) });
    expect(verify(z)).toThrow(/^addon is too large when unpacked$/);
  });

  it('rejects stored entries that share one local record', () => {
    // 4 x 1 MB unpacked stays under the cap, but only 1 MB of data backs it.
    const mb = new Uint8Array(1024 * 1024).fill(0x41);
    const z = rawZip([
      { name: TOC_NAME, data: TOC },
      { name: 'ForeverLedger/p0.lua', data: mb },
      { name: 'ForeverLedger/p1.lua', size: mb.length, originalSize: mb.length, at: 1 },
      { name: 'ForeverLedger/p2.lua', size: mb.length, originalSize: mb.length, at: 1 },
      { name: 'ForeverLedger/p3.lua', size: mb.length, originalSize: mb.length, at: 1 },
    ]);
    expect(verify(z)).toThrow(/overlapping entries/);
  });

  it('rejects the zero-originalSize overlap bomb', () => {
    const mb = new Uint8Array(1024 * 1024).fill(0x41);
    const z = rawZip([
      { name: TOC_NAME, data: TOC },
      { name: 'ForeverLedger/p.lua', data: mb },
      ...Array.from({ length: 50 }, (_, i) => ({
        name: `ForeverLedger/p${i}.lua`,
        size: mb.length,
        originalSize: 0,
        at: 1,
      })),
    ]);
    expect(verify(z)).toThrow(/mismatched sizes/);
  });

  it('rejects a stored entry whose sizes disagree', () => {
    const z = rawZip([
      { name: TOC_NAME, data: TOC },
      { name: 'ForeverLedger/x.lua', data: '0123456789', originalSize: 5 },
    ]);
    expect(verify(z)).toThrow(/stored entry ForeverLedger\/x.lua has mismatched sizes/);
  });

  it('rejects a deflated entry that unpacks to fewer bytes than declared', () => {
    const z = rawZip([
      { name: TOC_NAME, data: TOC },
      {
        name: 'ForeverLedger/x.lua',
        data: deflateSync(strToU8('-- lua')),
        method: 8,
        originalSize: 100,
      },
    ]);
    expect(verify(z)).toThrow(/unpacked to 6 bytes, expected 100/);
  });

  it('rejects an unsupported compression method', () => {
    const z = rawZip([
      { name: TOC_NAME, data: TOC },
      { name: 'ForeverLedger/x.lua', data: 'x', method: 12 },
    ]);
    expect(verify(z)).toThrow(/unsupported compression method 12/);
  });

  it('wraps a malformed zip in AddonZipError', () => {
    const g = good();
    const z = g.slice(0, g.length - 30);
    expect(verify(z)).toThrow(AddonZipError);
    expect(verify(z)).toThrow(/malformed addon zip/);
  });
});
