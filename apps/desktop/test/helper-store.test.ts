import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { helperStore } from '../src/main/helper/store.js';

const crypto = (available: boolean) => ({
  available: () => available,
  encrypt: (t: string) => Buffer.from(`enc:${t}`).toString('base64'),
  decrypt: (d: string) => Buffer.from(d, 'base64').toString().replace(/^enc:/, ''),
});

describe('fetch helper settings', () => {
  it('starts off, with the consent screen unanswered', () => {
    const s = helperStore(
      join(mkdtempSync(join(tmpdir(), 'fh-')), 'fetch-helper.json'),
      crypto(true),
    );
    expect(s.get()).toEqual({ consentAnswered: false, enabled: false });
  });

  it('keeps the token encrypted on disk and reads it back', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'fh-')), 'fetch-helper.json');
    helperStore(file, crypto(true)).set({
      consentAnswered: true,
      enabled: true,
      token: 'flt_secret',
    });
    const disk = readFileSync(file, 'utf8');
    expect(disk).not.toContain('flt_secret');
    expect(helperStore(file, crypto(true)).get()).toEqual({
      consentAnswered: true,
      enabled: true,
      token: 'flt_secret',
    });
  });

  it('an unreadable file starts over (the consent screen shows again)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fh-'));
    const file = join(dir, 'fetch-helper.json');
    writeFileSync(file, '{not json');
    expect(helperStore(file, crypto(true)).get().consentAnswered).toBe(false);
  });
});
