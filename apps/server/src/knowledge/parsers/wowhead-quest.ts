import type { HTMLElement } from 'node-html-parser';
import { bracketedAfter, codeMarkers, tryJson } from './scan.js';

/**
 * Quest-page facts for the atlas (parser v5): where a quest starts and ends, where its objectives are, the chain it
 * belongs to, and who may take it. Shapes checked against the 68 stored /forever/quest= pages (2026-10-08).
 *
 * `new Mapper({...})` holds `objectives: { <wowheadZoneId>: { zone, mappable, levels: [[point, …], …] } }`; a point is
 * `{ type, point, name, id, coord, coords, reactalliance?, reacthorde?, objective?, item? }`:
 * - `type` 1 is an NPC, 2 a game object (no `react*` then); anything else is kept as `type<n>`.
 * - `point` is `start`, `end`, `requirement` (a target: kill / use it; `objective` is the NPC id itself, or 0 for an
 *   object) or `sourcerequirement` (drops the objective item named in `item`; `objective` is the item objective's
 *   index, 0-based).
 * - `coord: [""]` with no `coords` means Wowhead has no spawn for it (instances).
 * The level arrays are floors of a multi-level map; every real page has one.
 */

export type SpotKind = 'npc' | 'object' | 'item' | `type${number}`;

export interface QuestSpot {
  kind: SpotKind;
  id: number;
  name: string;
  /** Wowhead zone id (not the client's uiMapID). */
  wowheadZone: number | null;
  zoneName: string | null;
  /** Percent coordinates, [x, y] each; empty when Wowhead has none. */
  coords: [number, number][];
  /** Map floor, when the zone has more than one. */
  floor?: number;
  /** Reaction to each faction: -1 hostile, 0 neutral, 1 friendly. */
  react?: { alliance: number; horde: number };
}

export interface ObjectiveSpot extends QuestSpot {
  /** `requirement` is the target itself; `sourcerequirement` drops `item`. */
  role: 'target' | 'source';
  item?: string;
  /** 0-based objective index, when the page gives one (item objectives). */
  objective?: number;
}

export interface SeriesEntry {
  id: number;
  name: string;
  side?: 'Alliance' | 'Horde';
}

/** At most this many coordinates per spot (a mob with 170 spawns is plenty). */
export const MAX_COORDS = 200;

const KINDS: Record<number, SpotKind> = { 1: 'npc', 2: 'object', 3: 'item' };
const kindOf = (type: unknown): SpotKind =>
  typeof type === 'number' ? (KINDS[type] ?? `type${type}`) : 'npc';

const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : undefined);
const isPair = (c: unknown): c is [number, number] =>
  Array.isArray(c) &&
  c.length === 2 &&
  typeof c[0] === 'number' &&
  typeof c[1] === 'number' &&
  Number.isFinite(c[0]) &&
  Number.isFinite(c[1]);

function spotOf(
  p: Record<string, unknown>,
  zone: { id: number | null; name: string | null },
  floor: number,
  floors: number,
): QuestSpot | null {
  const id = int(p.id);
  if (id === undefined || typeof p.name !== 'string') return null;
  const coords = (Array.isArray(p.coords) ? p.coords : []).filter(isPair).slice(0, MAX_COORDS);
  if (coords.length === 0 && isPair(p.coord)) coords.push(p.coord);
  const spot: QuestSpot = {
    kind: kindOf(p.type),
    id,
    name: p.name,
    wowheadZone: zone.id,
    zoneName: zone.name,
    coords: coords.map(([x, y]) => [x, y]),
  };
  if (floors > 1) spot.floor = floor;
  const ra = int(p.reactalliance);
  const rh = int(p.reacthorde);
  if (ra !== undefined && rh !== undefined) spot.react = { alliance: ra, horde: rh };
  return spot;
}

export interface MapperFacts {
  startsAt: QuestSpot[];
  endsAt: QuestSpot[];
  objectiveSpots: ObjectiveSpot[];
}

/** The quest's `new Mapper({...})`, or null when the page has none (or it is not JSON: then `problem` says so). */
export function mapperFacts(script: string): { facts: MapperFacts | null; problem?: string } {
  const [at] = codeMarkers(script, 'new Mapper(', 1);
  if (at === undefined) return { facts: null };
  const text = bracketedAfter(script, at);
  const data = text ? tryJson(text) : undefined;
  if (!data || typeof data !== 'object') return { facts: null, problem: 'mapper is not JSON' };
  const objectives = (data as Record<string, unknown>).objectives;
  const facts: MapperFacts = { startsAt: [], endsAt: [], objectiveSpots: [] };
  if (!objectives || typeof objectives !== 'object') return { facts };
  for (const [zoneKey, z] of Object.entries(objectives as Record<string, unknown>)) {
    if (!z || typeof z !== 'object') continue;
    const zr = z as Record<string, unknown>;
    const zone = {
      id: /^-?\d+$/.test(zoneKey) ? Number(zoneKey) : null,
      name: typeof zr.zone === 'string' ? zr.zone : null,
    };
    const levels = Array.isArray(zr.levels) ? zr.levels : [];
    levels.forEach((level, floor) => {
      if (!Array.isArray(level)) return;
      for (const raw of level) {
        if (!raw || typeof raw !== 'object') continue;
        const p = raw as Record<string, unknown>;
        const spot = spotOf(p, zone, floor, levels.length);
        if (!spot) continue;
        if (p.point === 'start') facts.startsAt.push(spot);
        else if (p.point === 'end') facts.endsAt.push(spot);
        else {
          const o: ObjectiveSpot = {
            ...spot,
            role: p.point === 'sourcerequirement' ? 'source' : 'target',
          };
          if (typeof p.item === 'string' && p.item) o.item = p.item;
          // On a target the field repeats the NPC id; only a different small number is an index.
          const objective = int(p.objective);
          if (objective !== undefined && objective !== spot.id && objective >= 0 && objective < 20)
            o.objective = objective;
          facts.objectiveSpots.push(o);
        }
      }
    });
  }
  return { facts };
}

/**
 * Starts / ends from the infobox markup (`[icon name=quest-start]Start: [url=/forever/npc=248242/…]Name[/url]`), for
 * quests the mapper has no point for (started by an item, or no known spawn). No coordinates.
 */
export function infoboxEnds(script: string): { start: QuestSpot[]; end: QuestSpot[] } {
  const out = { start: [] as QuestSpot[], end: [] as QuestSpot[] };
  const re =
    /\[icon name=quest-(start|end)\][A-Za-z ]*:\s*\[url=\\?\/[a-z-]*\\?\/?(npc|object|item)=(\d+)[^\]]*\]([^[]*)\[\\?\/url\]/g;
  for (const m of script.matchAll(re)) {
    out[m[1] as 'start' | 'end'].push({
      kind: m[2] as SpotKind,
      id: Number(m[3]),
      name: m[4]!.trim(),
      wowheadZone: null,
      zoneName: null,
      coords: [],
    });
  }
  return out;
}

/**
 * The quest chain from `<table class="series">`: one entry per row (`<th>N.</th>`), each row the quests at that step
 * (a faction-split step lists one per side, `<span class="icon-horde">`). The current quest is the bold, unlinked one:
 * it gets `currentId`.
 */
export function seriesOf(root: HTMLElement, currentId: number): SeriesEntry[][] | null {
  const table = root.querySelector('table.series');
  if (!table) return null;
  const steps: SeriesEntry[][] = [];
  for (const tr of table.querySelectorAll('tr')) {
    const td = tr.querySelector('td');
    if (!td) continue;
    const step: SeriesEntry[] = [];
    for (const el of td.querySelectorAll('a, b')) {
      const side = el.closest('.icon-horde')
        ? 'Horde'
        : el.closest('.icon-alliance, .icon-alliance-padded')
          ? 'Alliance'
          : undefined;
      let id: number | undefined;
      if (el.tagName === 'A') {
        const m = /\/quest=(\d+)/.exec(el.getAttribute('href') ?? '');
        if (!m) continue;
        id = Number(m[1]);
      } else {
        if (el.closest('a')) continue;
        id = currentId;
      }
      step.push({ id, name: el.textContent.trim(), ...(side ? { side } : {}) });
    }
    if (step.length > 0) steps.push(step);
  }
  return steps.length > 0 ? steps : null;
}

/** Classic class ids by `reqclass` bit (bit = id - 1). */
const CLASSES: Record<number, string> = {
  1: 'Warrior',
  2: 'Paladin',
  3: 'Hunter',
  4: 'Rogue',
  5: 'Priest',
  7: 'Shaman',
  8: 'Mage',
  9: 'Warlock',
  11: 'Druid',
};

/**
 * Race ids by `reqrace` bit. Bit = id - 1 for the Classic races; bit 32 is race 95, High Order Skyborne, Forever's own
 * race (checked: mask 4294967372 is the infobox's "Races: Dwarf, Night Elf, Gnome, High Order Skyborne").
 */
const RACES: Record<number, string> = {
  1: 'Human',
  2: 'Orc',
  3: 'Dwarf',
  4: 'Night Elf',
  5: 'Undead',
  6: 'Tauren',
  7: 'Gnome',
  8: 'Troll',
  9: 'Goblin',
  10: 'Blood Elf',
  11: 'Draenei',
  95: 'High Order Skyborne',
};
const RACE_BITS: Record<number, number> = { 32: 95 };

/** Set bits of a mask up to 2^52 (beyond 32 bits, so no bitwise operators). */
function bits(mask: number): number[] {
  const out: number[] = [];
  for (let b = 0, m = mask; m > 0 && b < 53; b++, m = Math.floor(m / 2))
    if (m % 2 === 1) out.push(b);
  return out;
}

/** Class names a `reqclass` mask allows; unknown bits as `class<id>`. Null for no restriction. */
export function classesOf(mask: unknown): string[] | null {
  if (typeof mask !== 'number' || !Number.isSafeInteger(mask) || mask <= 0) return null;
  return bits(mask).map((b) => CLASSES[b + 1] ?? `class${b + 1}`);
}

/** Race names a `reqrace` mask allows; unknown bits as `raceBit<n>`. Null for no restriction. */
export function racesOf(mask: unknown): string[] | null {
  if (typeof mask !== 'number' || !Number.isSafeInteger(mask) || mask <= 0) return null;
  return bits(mask).map((b) => {
    const id = RACE_BITS[b] ?? (b < 11 ? b + 1 : undefined);
    return (id !== undefined ? RACES[id] : undefined) ?? `raceBit${b}`;
  });
}
