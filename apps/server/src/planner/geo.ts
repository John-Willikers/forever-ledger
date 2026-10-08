// Planner geometry: the client map catalog (maps.ts) turns a map spot in percent into world yards, so distances on one
// continent can be measured across zone maps. World x grows north, world y grows west; a map's (0,0) corner is its
// north-west, (1,1) its south-east.
import { MAP_ROWS } from './maps.js';
import type { MapSpot, WorldPos } from './types.js';

export interface MapInfo {
  id: number;
  name: string;
  parent: number;
  continent: number;
  width: number;
  height: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// A map whose corners lie on two continents (947 Azeroth) has no single world frame: left out.
const MAPS = new Map<number, MapInfo>(
  MAP_ROWS.filter((r) => r[6] === r[9]).map(
    ([id, name, , parent, width, height, c0, x0, y0, , x1, y1]) => [
      id,
      { id, name, parent, continent: c0, width, height, x0, y0, x1, y1 },
    ],
  ),
);

export const mapInfo = (id: number): MapInfo | null => MAPS.get(id) ?? null;

/** A map spot (percent) in world yards; null when the map is unknown. */
export function toWorld(s: MapSpot): WorldPos | null {
  const m = MAPS.get(s.mapId);
  if (!m) return null;
  const u = s.x / 100;
  const v = s.y / 100;
  return { continent: m.continent, x: m.x0 + v * (m.x1 - m.x0), y: m.y0 + u * (m.y1 - m.y0) };
}

/** A world position as a spot (percent) on one map; null when the map is unknown or on another continent. */
export function fromWorld(mapId: number, p: WorldPos): MapSpot | null {
  const m = MAPS.get(mapId);
  if (!m || m.continent !== p.continent) return null;
  return {
    mapId,
    x: (100 * (p.y - m.y0)) / (m.y1 - m.y0),
    y: (100 * (p.x - m.x0)) / (m.x1 - m.x0),
  };
}

/** Straight-line yards; Infinity across continents. */
export function distance(a: WorldPos, b: WorldPos): number {
  if (a.continent !== b.continent) return Infinity;
  return Math.hypot(a.x - b.x, a.y - b.y);
}
