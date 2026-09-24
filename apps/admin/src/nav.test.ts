import { describe, expect, it } from 'vitest';
import { NAV } from './nav';

describe('NAV', () => {
  it('lists the planned pages in order, Overview at the index', () => {
    expect(NAV.map((n) => n.label)).toEqual([
      'Overview',
      'Characters',
      'Quests',
      'Loot',
      'Dungeons',
      'Professions',
      'Vendors & trainers',
      'Builds',
      'Health',
      'Access',
    ]);
    expect(NAV[0]!.path).toBe('');
  });

  it('uses unique, URL-safe paths', () => {
    const paths = NAV.map((n) => n.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const p of paths) expect(p).toMatch(/^[a-z-]*$/);
  });
});
