import { describe, expect, it } from 'vitest';
import { classifySource, defaultLabel, FetchReport, normalizeUrl } from '../src/index.js';

const okReport = (over: Record<string, unknown> = {}) => ({
  url: 'https://mobalytics.gg/wow-forever/guides/zone-map-level-ranges',
  worker: 'cruiser',
  outcome: 'ok',
  finalUrl: 'https://mobalytics.gg/wow-forever/guides/zone-map-level-ranges',
  httpStatus: 200,
  fetchedAt: '2026-10-06T07:12:03-05:00',
  sha256: 'a'.repeat(64),
  htmlGzBase64: 'H4sIAAAAAAAAA8tIzcnJBwCGphA2BQAAAA==',
  fetcher: 'fetchpage/0.1.0',
  ...over,
});

describe('classifySource', () => {
  it('splits Wowhead by path: Forever is datamined, Classic is Classic-era', () => {
    expect(classifySource('https://www.wowhead.com/forever/item=4655')).toEqual({
      site: 'wowhead.com',
      tier: 3,
      gameVersion: 'forever',
    });
    expect(classifySource('https://www.wowhead.com/classic/item=4655')).toEqual({
      site: 'wowhead.com',
      tier: 5,
      gameVersion: 'classic',
    });
  });

  it('ranks the brief sources', () => {
    expect(classifySource('https://news.blizzard.com/en-us/article/24304075').tier).toBe(2);
    expect(classifySource('https://mobalytics.gg/wow-forever/guides/dungeon-raid-map')).toEqual({
      site: 'mobalytics.gg',
      tier: 4,
      gameVersion: 'forever',
    });
    expect(
      classifySource('https://us.forums.blizzard.com/en/blizzard/t/fishing-is-it-worth-it/59737')
        .tier,
    ).toBe(6);
    expect(classifySource('https://www.expcarry.com/fishing').tier).toBe(7);
    expect(classifySource('https://example.org/forever/x')).toEqual({
      site: 'example.org',
      tier: 6,
      gameVersion: 'forever',
    });
  });
});

describe('defaultLabel', () => {
  it('labels by tier and version', () => {
    expect(defaultLabel(4, 'forever')).toBe('VERIFIED');
    expect(defaultLabel(5, 'classic')).toBe('CLASSIC');
    expect(defaultLabel(3, 'classic')).toBe('CLASSIC');
    expect(defaultLabel(6, 'forever')).toBe('ANECDOTE');
    expect(defaultLabel(7, 'forever')).toBe('UNVERIFIED');
    expect(defaultLabel(4, 'unknown')).toBe('UNVERIFIED');
  });
});

describe('normalizeUrl', () => {
  it('drops the fragment and trailing slash and lowercases the host', () => {
    expect(normalizeUrl('https://WWW.Wowhead.com/forever/item=4655/#comments')).toBe(
      'https://www.wowhead.com/forever/item=4655',
    );
    expect(normalizeUrl('https://mobalytics.gg/')).toBe('https://mobalytics.gg/');
  });
});

describe('FetchReport', () => {
  it('accepts an ok report and a challenge without a page', () => {
    expect(FetchReport.safeParse(okReport()).success).toBe(true);
    const challenge = okReport({ outcome: 'challenge' });
    delete (challenge as Record<string, unknown>).htmlGzBase64;
    expect(FetchReport.safeParse(challenge).success).toBe(true);
  });

  it('refuses an ok report without its page, a naive timestamp and non-http URLs', () => {
    expect(FetchReport.safeParse(okReport({ htmlGzBase64: undefined })).success).toBe(false);
    expect(FetchReport.safeParse(okReport({ fetchedAt: '2026-10-06T07:12:03' })).success).toBe(
      false,
    );
    expect(FetchReport.safeParse(okReport({ url: 'file:///etc/passwd' })).success).toBe(false);
    expect(FetchReport.safeParse(okReport({ url: 'https://u:p@example.org/' })).success).toBe(
      false,
    );
  });
});
