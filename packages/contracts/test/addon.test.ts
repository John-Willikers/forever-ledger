import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  addonAssetName,
  addonSchemaVersion,
  addonTag,
  AddonManifest,
  compareVersions,
  isAddonVersion,
  LEGACY_ADDON_SCHEMA,
  MAX_SUPPORTED_SCHEMA,
  SCHEMA_VERSION,
  SUPPORTED_SCHEMA_VERSIONS,
  tocVersion,
} from '../src/index.js';

const addonDir = fileURLToPath(new URL('../../../addon/', import.meta.url));

describe('addon versions', () => {
  it('compares dotted numeric versions', () => {
    expect(compareVersions('0.2.10', '0.2.9')).toBe(1);
    expect(compareVersions('0.2.1', '0.2.1')).toBe(0);
    expect(compareVersions('1.0.0', '0.9.9')).toBe(1);
    expect(compareVersions('0.1.0', '0.2.0')).toBe(-1);
  });

  it('refuses to compare anything but x.y.z', () => {
    expect(() => compareVersions('0.2', '0.2.0')).toThrow(/version/);
    expect(() => compareVersions('0.2.1', '0.2.x')).toThrow(/version/);
  });

  it('accepts only x.y.z versions', () => {
    expect(isAddonVersion('0.2.1')).toBe(true);
    expect(isAddonVersion('0.2')).toBe(false);
    expect(isAddonVersion('0.2.1-beta')).toBe(false);
    expect(isAddonVersion('../0.2.1')).toBe(false);
    expect(isAddonVersion('10.0.0')).toBe(true);
    expect(isAddonVersion('1.02.0')).toBe(false);
    expect(isAddonVersion('1234567890.0.0')).toBe(false);
  });

  it('reads ## Version from a .toc', () => {
    expect(tocVersion('## Interface: 16001\r\n## Title: X\r\n## Version: 0.2.1\r\n')).toBe('0.2.1');
    expect(tocVersion('## Interface: 16001\n')).toBeUndefined();
    expect(tocVersion('## Version:\n0.2.2\n')).toBeUndefined();
    expect(tocVersion('## Version: 0.2.1\n## Version: 0.2.2\n')).toBeUndefined();
  });

  it('reads SCHEMA_VERSION from the addon source as text', () => {
    expect(
      addonSchemaVersion('local VERSION = "0.3.4"\nlocal SCHEMA_VERSION = 6\nlocal X = 1\n'),
    ).toBe(6);
    expect(addonSchemaVersion('local SCHEMA_VERSION = 2 -- 2 adds turnIns[].choice\r\n')).toBe(2);
    expect(addonSchemaVersion('local SCHEMA_VERSION = 12   \n')).toBe(12);
    // Anything but one plain integer assignment at the start of a line is unreadable.
    for (const bad of [
      '',
      'local VERSION = "0.1.0"\n',
      'local SCHEMA_VERSION = 5\nlocal SCHEMA_VERSION = 6\n',
      'local SCHEMA_VERSION = 5 + 1\n',
      'local SCHEMA_VERSION = tonumber("6")\n',
      'local SCHEMA_VERSION = 06\n',
      'local SCHEMA_VERSION = 0\n',
      'local SCHEMA_VERSION = 6.0\n',
      '  local SCHEMA_VERSION = 6\n',
      '-- local SCHEMA_VERSION = 6\n',
      'local SCHEMA_VERSION=6\n',
      'local SCHEMA_VERSION = 1234567890\n',
    ]) {
      expect(addonSchemaVersion(bad), bad).toBeUndefined();
    }
  });

  it('reads the schema of the addon and of every legacy release kept for tests', () => {
    const lua = (p: string) => readFileSync(`${addonDir}${p}`, 'utf8');
    expect(addonSchemaVersion(lua('ForeverLedger/ForeverLedger.lua'))).toBe(SCHEMA_VERSION);
    const legacy = readdirSync(`${addonDir}tests/legacy`).filter((f) => f.endsWith('.lua'));
    const schemas = Object.fromEntries(
      legacy.map((f) => [f, addonSchemaVersion(lua(`tests/legacy/${f}`))]),
    );
    expect(schemas).toMatchObject({
      'ForeverLedger-0.2.2.lua': 1,
      'ForeverLedger-0.2.3.lua': 2,
      'ForeverLedger-0.2.4.lua': 3,
      'ForeverLedger-0.3.2.lua': 4,
      'ForeverLedger-0.3.3.lua': LEGACY_ADDON_SCHEMA,
    });
  });

  it('names the newest supported schema', () => {
    expect(MAX_SUPPORTED_SCHEMA).toBe(SCHEMA_VERSION);
    expect(MAX_SUPPORTED_SCHEMA).toBe(Math.max(...SUPPORTED_SCHEMA_VERSIONS));
  });

  it('names tags and assets', () => {
    expect(addonTag('0.2.1')).toBe('addon-v0.2.1');
    expect(addonAssetName('0.2.1')).toBe('ForeverLedger-0.2.1.zip');
  });

  it('validates a manifest', () => {
    const ok = {
      addon: 'ForeverLedger',
      version: '0.2.1',
      url: 'https://github.com/John-Willikers/forever-ledger/releases/download/addon-v0.2.1/ForeverLedger-0.2.1.zip',
      sha256: 'a'.repeat(64),
      size: 1234,
    };
    expect(AddonManifest.parse(ok)).toEqual(ok);
    expect(AddonManifest.safeParse({ ...ok, sha256: 'xyz' }).success).toBe(false);
    for (const url of [
      'http://evil.example/x.zip',
      'https://github.com/John-Willikers/forever-ledger/releases/download/../../../../attacker/repo/releases/download/v1/ForeverLedger-0.2.1.zip',
      'https://github.com/John-Willikers/forever-ledger/releases/download/%2e%2e/%2e%2e/%2e%2e/%2e%2e/attacker/repo/x.zip',
      'https://github.com/John-Willikers/forever-ledger/releases/download/addon-v0.2.0/ForeverLedger-0.2.0.zip',
    ]) {
      expect(AddonManifest.safeParse({ ...ok, url }).success).toBe(false);
    }
  });
});
