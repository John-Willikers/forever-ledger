// Planner geometry (planner/geo.ts): the client map catalog turns map percent into world yards.
import { describe, expect, it } from 'vitest';
import { distance, mapInfo, toWorld } from '../src/planner/geo.js';

describe('planner geometry', () => {
  it('knows the client maps', () => {
    expect(mapInfo(1420)?.name).toBe('Tirisfal Glades');
    expect(mapInfo(1420)?.continent).toBe(0);
    expect(mapInfo(99999)).toBeNull();
  });

  it('turns map percent into world yards (x north, y west)', () => {
    const nw = toWorld({ mapId: 1420, x: 0, y: 0 })!;
    expect(nw).toEqual({ continent: 0, x: 3837.5, y: 3033.3 });
    const se = toWorld({ mapId: 1420, x: 100, y: 100 })!;
    expect(se.x).toBeCloseTo(825, 1);
    expect(se.y).toBeCloseTo(-1485.4, 1);
  });

  it('measures yards on one map like the arrow does', () => {
    // Harlan's probe walk (2026-10-07): map y 0.6551 → 0.6322 on Tirisfal is ~69 yd north.
    const a = toWorld({ mapId: 1420, x: 31.76, y: 65.51 })!;
    const b = toWorld({ mapId: 1420, x: 31.76, y: 63.22 })!;
    expect(distance(a, b)).toBeCloseTo(69, 0);
  });

  it('measures across maps of one continent and refuses across continents', () => {
    const brill = toWorld({ mapId: 1420, x: 61, y: 52 })!;
    const uc = toWorld({ mapId: 1458, x: 50, y: 50 })!;
    expect(distance(brill, uc)).toBeGreaterThan(100);
    expect(distance(brill, uc)).toBeLessThan(1000);
    const org = toWorld({ mapId: 1454, x: 50, y: 50 })!;
    expect(distance(brill, org)).toBe(Infinity);
  });
});
