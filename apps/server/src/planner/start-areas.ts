// Race start areas: where each race's characters begin (the first quest giver), and how far the area reaches. The
// planner keeps a character to its own race's starter class quests (available.ts); character-state.ts starts a
// character with no known position at its race's spot. Pure.
import { distance, toWorld } from './geo.js';
import type { MapSpot } from './types.js';

export interface StartArea {
  name: string;
  /** `UnitRace` tokens of the races that start here. */
  races: string[];
  /** The first quest giver (percent on the zone map). */
  spot: MapSpot;
  /** Yards from `spot` the area reaches; a whole continent when `continent` is set. */
  radius: number;
  /** An area that is a continent of its own (Zephras Isle). */
  continent?: number;
}

/** Start areas are small: givers of each area's own class quests stand within this many yards of its first giver. */
export const START_RADIUS = 350;

/**
 * Checked against the live atlas (2026-10-10): every start area's class quest givers are within 180 yd of its spot;
 * the nearest class quest givers outside are 429 yd from the Valley of Trials (Telf Joolam, whose Call of Fire Tauren
 * shamans take too), 458 from Shadowglen (Dolanaar), 551 from Northshire (Goldshire), 606 from Camp Narache
 * (Bloodhoof Village), 748 from Deathknell and 808 from Coldridge Valley (Kharanos), so 350 yd (450 for the larger
 * Coldridge Valley, whose Minor Manifestation of Earth is 398 yd out) keeps the areas apart. Trolls start in the
 * Valley of Trials on Forever too (Jim Willikers' first quests, 4641 from Kaltunk, level 1); the Darkspear Islands
 * (2524) have a level-39 battle quest, not a start. Zephras Isle (2521 / 2665, its own continent) is all Skyborne
 * starter content; Rorian the Dayseeker gives its first class quests.
 */
export const START_AREAS: StartArea[] = [
  {
    name: 'Deathknell',
    races: ['Scourge'],
    spot: { mapId: 1420, x: 30.8, y: 66.2 },
    radius: START_RADIUS,
  },
  {
    name: 'Valley of Trials',
    races: ['Orc', 'Troll'],
    spot: { mapId: 1411, x: 43.3, y: 68.5 },
    radius: START_RADIUS,
  },
  {
    name: 'Camp Narache',
    races: ['Tauren'],
    spot: { mapId: 1412, x: 44.7, y: 77.0 },
    radius: START_RADIUS,
  },
  {
    name: 'Northshire Valley',
    races: ['Human'],
    spot: { mapId: 1429, x: 48.2, y: 42.9 },
    radius: START_RADIUS,
  },
  {
    name: 'Coldridge Valley',
    races: ['Dwarf', 'Gnome'],
    spot: { mapId: 1426, x: 29.9, y: 71.2 },
    radius: 450,
  },
  {
    name: 'Shadowglen',
    races: ['NightElf'],
    spot: { mapId: 1438, x: 58.6, y: 44.2 },
    radius: START_RADIUS,
  },
  {
    name: 'Zephras Isle',
    races: ['Skyborne'],
    spot: { mapId: 2521, x: 42.0, y: 23.4 },
    radius: 0,
    continent: 2991,
  },
];

/** The race's start area; undefined for a race we don't know. */
export const raceStartArea = (race: string): StartArea | undefined =>
  START_AREAS.find((a) => a.races.includes(race));

/** The start area `spot` is in; null when none (or the map is unknown). */
export function startAreaOf(spot: MapSpot): StartArea | null {
  const p = toWorld(spot);
  if (!p) return null;
  for (const a of START_AREAS) {
    if (a.continent !== undefined) {
      if (p.continent === a.continent) return a;
      continue;
    }
    const c = toWorld(a.spot);
    if (c && distance(c, p) <= a.radius) return a;
  }
  return null;
}
