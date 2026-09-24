import { describe, expect, it } from 'vitest';
import { kindLabel, sortKinds, summarizeRecords } from './records';

describe('kindLabel', () => {
  it('splits camelCase', () => {
    expect(kindLabel('itemSnapshots')).toBe('item snapshots');
    expect(kindLabel('nodeLoot')).toBe('node loot');
    expect(kindLabel('characters')).toBe('characters');
    expect(kindLabel('apiSamples')).toBe('api samples');
  });
});

describe('sortKinds', () => {
  it('drops empty kinds and sorts biggest first, ties by name', () => {
    expect(sortKinds({ quests: 2, items: 12, runs: 0, drops: 2 }).map((k) => k.kind)).toEqual([
      'items',
      'drops',
      'quests',
    ]);
  });
});

describe('summarizeRecords', () => {
  it('summarizes the top kinds and counts the rest', () => {
    const s = summarizeRecords({
      items: 1096,
      itemSnapshots: 1216,
      recipes: 727,
      quests: 39,
      runs: 1,
    });
    expect(s.total).toBe(1096 + 1216 + 727 + 39 + 1);
    expect(s.top.map((k) => k.kind)).toEqual(['itemSnapshots', 'items', 'recipes']);
    expect(s.more).toBe(2);
    expect(s.text).toBe('1,216 item snapshots · 1,096 items · 727 recipes +2 more');
  });

  it('handles small and empty uploads', () => {
    expect(summarizeRecords({ characters: 1 }).text).toBe('1 characters');
    expect(summarizeRecords({}).text).toBe('no records');
    expect(summarizeRecords({}).total).toBe(0);
  });
});
