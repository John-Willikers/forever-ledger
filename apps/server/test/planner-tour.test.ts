// Planner stop order (planner/tour.ts): nearest neighbour from the start, then 2-opt.
import { describe, expect, it } from 'vitest';
import { nearestNeighbour, orderStops, pathLength } from '../src/planner/tour.js';
import type { WorldPos } from '../src/planner/types.js';

const p = (x: number, y: number, continent = 0): WorldPos => ({ continent, x, y });
const stop = (name: string, x: number, y: number, continent = 0) => ({
  name,
  pos: p(x, y, continent),
});
const names = (s: { name: string }[]) => s.map((t) => t.name);

describe('planner stop order', () => {
  it('handles no stops and one stop', () => {
    expect(orderStops(p(0, 0), [], null)).toEqual([]);
    const a = stop('a', 5, 5);
    expect(orderStops(p(0, 0), [a], p(9, 9))).toEqual([a]);
  });

  it('visits points on a line in line order', () => {
    const stops = [stop('c', 30, 0), stop('a', 10, 0), stop('d', 40, 0), stop('b', 20, 0)];
    expect(names(orderStops(p(0, 0), stops, null))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('walks a square around its edge instead of crossing it', () => {
    // Nearest neighbour lures the path into the square (to i), then across it twice: 40.0 yd. 2-opt walks the edge.
    const stops = [
      stop('a', 0, 0),
      stop('b', 10, 0),
      stop('c', 10, 10),
      stop('d', 0, 10),
      stop('i', 5, 2),
    ];
    const start = p(9, 10);
    const nn = nearestNeighbour(start, stops);
    expect(names(nn)).toEqual(['c', 'i', 'a', 'b', 'd']);
    const best = orderStops(start, stops, null);
    expect(pathLength(start, best, null)).toBeLessThan(pathLength(start, nn, null));
    expect(pathLength(start, best, null)).toBeCloseTo(31.8, 1);
    // No two legs of the result cross.
    const pts = [start, ...best.map((s) => s.pos)];
    const cross = (a: WorldPos, b: WorldPos, c: WorldPos, d: WorldPos) => {
      const o = (p1: WorldPos, p2: WorldPos, p3: WorldPos) =>
        Math.sign((p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x));
      return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
    };
    for (let i = 0; i + 1 < pts.length; i++)
      for (let j = i + 2; j + 1 < pts.length; j++)
        expect(cross(pts[i]!, pts[i + 1]!, pts[j]!, pts[j + 1]!)).toBe(false);
  });

  it('reverses the order when the end lies near the first stop', () => {
    const stops = [stop('a', 0, 0), stop('b', 10, 0), stop('c', 20, 0)];
    const start = p(0, 10);
    expect(names(orderStops(start, stops, null))).toEqual(['a', 'b', 'c']);
    expect(names(orderStops(start, stops, p(0, -1)))).toEqual(['c', 'b', 'a']);
  });

  it('keeps stops on another continent at the end, in their order', () => {
    const stops = [stop('k2', 1, 1, 1), stop('b', 20, 0), stop('k1', 0, 0, 1), stop('a', 10, 0)];
    expect(names(orderStops(p(0, 0), stops, null))).toEqual(['a', 'b', 'k2', 'k1']);
  });
});
