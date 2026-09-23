import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tocVersion } from '@forever-ledger/contracts';
import { strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkAddonVersion, checkAddonZip } from './check-addon-version.js';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const ADDON = 'addon/ForeverLedger';
const hasZip = spawnSync('zip', ['-v']).status === 0;

describe('checkAddonVersion', () => {
  let root: string;
  const toc = () => join(root, ADDON, 'ForeverLedger.toc');
  const lua = () => join(root, ADDON, 'ForeverLedger.lua');
  const edit = (file: string, from: RegExp, to: string) =>
    writeFileSync(file, readFileSync(file, 'utf8').replace(from, to));

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'addon-version-'));
    cpSync(join(REPO, ADDON), join(root, ADDON), { recursive: true });
    edit(toc(), /^## Version:.*$/m, '## Version: 1.2.3');
    edit(lua(), /^local VERSION = ".*"$/m, 'local VERSION = "1.2.3"');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("passes the repo's own addon files", () => {
    const v = tocVersion(readFileSync(join(REPO, ADDON, 'ForeverLedger.toc'), 'utf8'));
    expect(v).toBeDefined();
    expect(checkAddonVersion(REPO, v!)).toEqual([]);
  });

  it('passes when the tag, .toc and Lua agree', () => {
    expect(checkAddonVersion(root, '1.2.3')).toEqual([]);
  });

  it('reports a .toc mismatch', () => {
    edit(toc(), /^## Version:.*$/m, '## Version: 1.2.4');
    const problems = checkAddonVersion(root, '1.2.3');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/ForeverLedger\.toc.*1\.2\.4.*1\.2\.3/);
  });

  it('reports a missing or doubled .toc version', () => {
    edit(toc(), /^## Version:.*$/m, '## Version: 1.2.3\n## Version: 1.2.3');
    expect(checkAddonVersion(root, '1.2.3')).toEqual([
      expect.stringMatching(/ForeverLedger\.toc.*exactly one/),
    ]);
  });

  it('reports a Lua VERSION mismatch', () => {
    edit(lua(), /^local VERSION = ".*"$/m, 'local VERSION = "1.2.0"');
    const problems = checkAddonVersion(root, '1.2.3');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/ForeverLedger\.lua.*1\.2\.0.*1\.2\.3/);
  });

  it('reports both mismatches at once', () => {
    expect(checkAddonVersion(root, '1.2.4')).toHaveLength(2);
  });

  it('reports a bad tag', () => {
    for (const tag of ['v1.2.3', '1.2', '01.2.3', '1.2.3-beta', '']) {
      expect(checkAddonVersion(root, tag)).toEqual([expect.stringMatching(/x\.y\.z/)]);
    }
  });

  it('reports missing files instead of throwing', () => {
    rmSync(lua());
    expect(checkAddonVersion(root, '1.2.3')).toEqual([
      expect.stringMatching(/ForeverLedger\.lua.*cannot read/),
    ]);
  });

  describe('checkAddonZip', () => {
    const zipOf = (files: Record<string, string>) => {
      const path = join(root, 'addon.zip');
      writeFileSync(
        path,
        zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))),
      );
      return path;
    };

    it('accepts a zip the client would install', () => {
      const path = zipOf({
        'ForeverLedger/ForeverLedger.toc': readFileSync(toc(), 'utf8'),
        'ForeverLedger/ForeverLedger.lua': readFileSync(lua(), 'utf8'),
      });
      expect(checkAddonZip(path, '1.2.3')).toEqual([]);
    });

    it('rejects a zip with the wrong .toc version', () => {
      const path = zipOf({ 'ForeverLedger/ForeverLedger.toc': '## Version: 1.2.2\n' });
      expect(checkAddonZip(path, '1.2.3')).toEqual([
        expect.stringMatching(/\.toc version 1\.2\.2/),
      ]);
    });

    it('rejects entries outside the addon folder', () => {
      const path = zipOf({
        'ForeverLedger/ForeverLedger.toc': '## Version: 1.2.3\n',
        'README.md': 'hi',
      });
      expect(checkAddonZip(path, '1.2.3')).toEqual([expect.stringMatching(/unexpected entry/)]);
    });

    it('reports an unreadable zip path', () => {
      expect(checkAddonZip(join(root, 'nope.zip'), '1.2.3')).toEqual([
        expect.stringMatching(/cannot read/),
      ]);
    });

    it.skipIf(!hasZip)('accepts the zip the release workflow builds with `zip -r`', () => {
      execFileSync(
        'zip',
        ['-qr', '../ForeverLedger-1.2.3.zip', 'ForeverLedger', '-x', '*/.luacheckrc'],
        {
          cwd: join(root, 'addon'),
        },
      );
      expect(checkAddonZip(join(root, 'ForeverLedger-1.2.3.zip'), '1.2.3')).toEqual([]);
    });
  });
});
