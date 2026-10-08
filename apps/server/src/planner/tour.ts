// Planner stop order: the objective loop through a set of stops (mob camps, objects, NPCs). Nearest neighbour from the
// start, then 2-opt until no segment reversal shortens the path. The path is open: it ends at `end` when one is given
// (on the start's continent), else at its last stop. Stops on another continent keep their relative order at the end;
// the travel network gets the character there. Pure.
import { distance } from './geo.js';
import type { WorldPos } from './types.js';

/** Straight-line length of start → stops → end (end optional); legs across continents count 0. */
export function pathLength<T extends { pos: WorldPos }>(
  start: WorldPos,
  stops: T[],
  end: WorldPos | null,
): number {
  const pts = [start, ...stops.map((s) => s.pos), ...(end ? [end] : [])];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = distance(pts[i - 1]!, pts[i]!);
    if (Number.isFinite(d)) total += d;
  }
  return total;
}

/** Greedy order: always the closest remaining stop next. */
export function nearestNeighbour<T extends { pos: WorldPos }>(start: WorldPos, stops: T[]): T[] {
  const left = [...stops];
  const out: T[] = [];
  let at = start;
  while (left.length) {
    let best = 0;
    for (let i = 1; i < left.length; i++)
      if (distance(at, left[i]!.pos) < distance(at, left[best]!.pos)) best = i;
    const [next] = left.splice(best, 1);
    out.push(next!);
    at = next!.pos;
  }
  return out;
}

/** 2-opt on an open path start → s[0..n-1] → end (no end: the last leg is free). Mutates and returns `s`. */
function twoOpt<T extends { pos: WorldPos }>(start: WorldPos, s: T[], end: WorldPos | null): T[] {
  const n = s.length;
  const eps = 1e-9;
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < n - 1; i++) {
      const before = i === 0 ? start : s[i - 1]!.pos;
      for (let j = i + 1; j < n; j++) {
        const after = j === n - 1 ? end : s[j + 1]!.pos;
        // Reversing s[i..j] swaps the legs before→s[i], s[j]→after for before→s[j], s[i]→after.
        const old = distance(before, s[i]!.pos) + (after ? distance(s[j]!.pos, after) : 0);
        const neu = distance(before, s[j]!.pos) + (after ? distance(s[i]!.pos, after) : 0);
        if (neu < old - eps) {
          for (let a = i, b = j; a < b; a++, b--) [s[a], s[b]] = [s[b]!, s[a]!];
          improved = true;
        }
      }
    }
  }
  return s;
}

/** The order to visit `stops` from `start`, finishing at `end` when given. */
export function orderStops<T extends { pos: WorldPos }>(
  start: WorldPos,
  stops: T[],
  end: WorldPos | null,
): T[] {
  const here = stops.filter((s) => s.pos.continent === start.continent);
  const away = stops.filter((s) => s.pos.continent !== start.continent);
  const finish = end && end.continent === start.continent && away.length === 0 ? end : null;
  return [...twoOpt(start, nearestNeighbour(start, here), finish), ...away];
}
