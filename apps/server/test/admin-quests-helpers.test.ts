// Pure helpers behind /admin/api/quests and the character timeline (no database).
import { describe, expect, it } from 'vitest';
import {
  compressLevelRuns,
  containsPattern,
  flagParam,
  locOf,
  textParam,
  withCumulativeXp,
} from '../src/routes/adminQuests.js';

describe('textParam', () => {
  it('trims, treats empty as absent and refuses oversized text with a 400', () => {
    expect(textParam({ q: '  Hogger ' }, 'q', 10)).toBe('Hogger');
    expect(textParam({ q: '   ' }, 'q', 10)).toBeNull();
    expect(textParam({}, 'q', 10)).toBeNull();
    expect(textParam({ q: ['a', 'b'] }, 'q', 10)).toBeNull();
    expect(() => textParam({ q: 'x'.repeat(11) }, 'q', 10)).toThrow(
      expect.objectContaining({ statusCode: 400 }),
    );
  });
});

describe('flagParam', () => {
  it('is true only for 1 / true', () => {
    expect(flagParam({ f: '1' }, 'f')).toBe(true);
    expect(flagParam({ f: 'true' }, 'f')).toBe(true);
    for (const f of ['0', 'false', 'yes', '', undefined]) expect(flagParam({ f }, 'f')).toBe(false);
  });
});

describe('containsPattern', () => {
  it('escapes LIKE wildcards and the escape character', () => {
    expect(containsPattern('Hogger')).toBe('%Hogger%');
    expect(containsPattern('100%_a\\b')).toBe('%100\\%\\_a\\\\b%');
  });
});

describe('locOf', () => {
  it('keeps only known fields of the right type', () => {
    expect(
      locOf({ zone: 'Elwynn Forest', subzone: 'Goldshire', mapID: 1429, x: 42.1, y: 65.9 }),
    ).toEqual({ zone: 'Elwynn Forest', subzone: 'Goldshire', mapID: 1429, x: 42.1, y: 65.9 });
    expect(locOf({ zone: 'Z', x: '1', y: null, extra: '<script>' })).toEqual({
      zone: 'Z',
      subzone: null,
      mapID: null,
      x: null,
      y: null,
    });
  });

  it('is null for missing, non-object or empty locations', () => {
    for (const v of [null, undefined, 'x', 5, [], {}, { other: 1 }]) expect(locOf(v)).toBeNull();
  });
});

describe('compressLevelRuns', () => {
  const p = (at: number, level: number) => ({ at, level });

  it('keeps the first and last point of each run at one level', () => {
    expect(
      compressLevelRuns([p(1, 10), p(2, 10), p(3, 10), p(4, 11), p(5, 12), p(6, 12), p(7, 12)]),
    ).toEqual([p(1, 10), p(3, 10), p(4, 11), p(5, 12), p(7, 12)]);
  });

  it('handles empty, single and two-point lists', () => {
    expect(compressLevelRuns([])).toEqual([]);
    expect(compressLevelRuns([p(1, 5)])).toEqual([p(1, 5)]);
    expect(compressLevelRuns([p(1, 5), p(2, 5)])).toEqual([p(1, 5), p(2, 5)]);
  });

  it('keeps a level that goes back down (data from another PC clock)', () => {
    expect(compressLevelRuns([p(1, 10), p(2, 11), p(3, 10)])).toEqual([
      p(1, 10),
      p(2, 11),
      p(3, 10),
    ]);
  });
});

describe('withCumulativeXp', () => {
  it('adds a running total, missing XP counting as 0', () => {
    expect(withCumulativeXp([{ xp: 100 }, { xp: null }, { xp: 50 }])).toEqual([
      { xp: 100, cumulativeXp: 100 },
      { xp: null, cumulativeXp: 100 },
      { xp: 50, cumulativeXp: 150 },
    ]);
    expect(withCumulativeXp([])).toEqual([]);
  });
});
