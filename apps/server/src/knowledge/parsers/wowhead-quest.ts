import { INT4_MAX } from '@forever-ledger/contracts';
import type { HTMLElement, Node } from 'node-html-parser';
import { bracketedAfter, codeMarkers, tryJson } from './scan.js';

/**
 * Quest-page facts for the atlas (parser v5): where a quest starts and ends, where its objectives are, the chain it
 * belongs to, and who may take it. Shapes checked against the 68 stored /forever/quest= pages (2026-10-08).
 *
 * `new Mapper({...})` holds `objectives: { <wowheadZoneId>: { zone, mappable, levels: [[point, …], …] } }`; a point is
 * `{ type, point, name, id, coord, coords, reactalliance?, reacthorde?, objective?, item? }`:
 * - `type` 1 is an NPC, 2 a game object (no `react*` then); another number is kept as `type<n>`, anything else is
 *   `unknown`.
 * - `point` is `start`, `end`, `requirement` (a target: kill / use it; `objective` is the NPC id itself, or 0 for an
 *   object) or `sourcerequirement` (drops the objective item named in `item`; `objective` is the item objective's
 *   index, 0-based).
 * - `coord: [""]` with no `coords` means Wowhead has no spawn for it (instances).
 * The level arrays are floors of a multi-level map; every real page has one.
 *
 * Page data is untrusted: ids outside 1..INT4_MAX are skipped (and counted in `skipped`), every list is capped.
 */

export type SpotKind = 'npc' | 'object' | 'item' | 'unknown' | `type${number}`;

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
/** At most this many objective spots per quest. */
export const MAX_OBJECTIVE_SPOTS = 200;
/** At most this many start (or end) points per quest. */
export const MAX_END_SPOTS = 20;
/** At most this many mapper zones, and floors per zone. */
export const MAX_ZONES = 30;
export const MAX_FLOORS = 10;
/** At most this many series steps, and quests per step. */
export const MAX_SERIES_STEPS = 100;
export const MAX_STEP_QUESTS = 10;
/** Longest name or item text kept. */
const MAX_NAME = 200;

/** A game id we can store: an integer in 1..INT4_MAX. */
export const isGameId = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= INT4_MAX;

const KINDS: Record<number, SpotKind> = { 1: 'npc', 2: 'object', 3: 'item' };
function kindOf(type: unknown): SpotKind {
  const n =
    typeof type === 'number'
      ? type
      : typeof type === 'string' && /^\d{1,6}$/.test(type)
        ? Number(type)
        : undefined;
  if (n === undefined || !Number.isInteger(n)) return 'unknown';
  return KINDS[n] ?? `type${n}`;
}

const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : undefined);
const text = (v: unknown) =>
  typeof v === 'string' && v.length > 0 ? v.slice(0, MAX_NAME) : undefined;
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
  const name = text(p.name);
  if (!isGameId(p.id) || !name) return null;
  const coords: [number, number][] = [];
  if (Array.isArray(p.coords)) {
    for (const c of p.coords) {
      if (coords.length >= MAX_COORDS) break;
      if (isPair(c)) coords.push([c[0], c[1]]);
    }
  }
  if (coords.length === 0 && isPair(p.coord)) coords.push([p.coord[0], p.coord[1]]);
  const spot: QuestSpot = {
    kind: kindOf(p.type),
    id: p.id,
    name,
    wowheadZone: zone.id,
    zoneName: zone.name,
    coords,
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
  /** Points dropped: bad ids or names. */
  skipped: number;
  /** Points over a cap. */
  capped: number;
}

/** The quest's `new Mapper({...})`, or null when the page has none (or it is not JSON: then `problem` says so). */
export function mapperFacts(script: string): { facts: MapperFacts | null; problem?: string } {
  const [at] = codeMarkers(script, 'new Mapper(', 1);
  if (at === undefined) return { facts: null };
  const body = bracketedAfter(script, at);
  const data = body ? tryJson(body) : undefined;
  if (!data || typeof data !== 'object' || Array.isArray(data))
    return { facts: null, problem: 'mapper is not JSON' };
  const objectives = (data as Record<string, unknown>).objectives;
  const facts: MapperFacts = {
    startsAt: [],
    endsAt: [],
    objectiveSpots: [],
    skipped: 0,
    capped: 0,
  };
  if (!objectives || typeof objectives !== 'object' || Array.isArray(objectives)) return { facts };
  for (const [zoneKey, z] of Object.entries(objectives as Record<string, unknown>).slice(
    0,
    MAX_ZONES,
  )) {
    if (!z || typeof z !== 'object') continue;
    const zr = z as Record<string, unknown>;
    const zoneId = /^\d{1,10}$/.test(zoneKey) ? Number(zoneKey) : null;
    const zone = { id: isGameId(zoneId) ? zoneId : null, name: text(zr.zone) ?? null };
    const levels = Array.isArray(zr.levels)
      ? zr.levels.filter(Array.isArray).slice(0, MAX_FLOORS)
      : [];
    levels.forEach((level: unknown[], floor) => {
      for (const raw of level) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const p = raw as Record<string, unknown>;
        const spot = spotOf(p, zone, floor, levels.length);
        if (!spot) {
          facts.skipped++;
          continue;
        }
        const list = p.point === 'start' ? facts.startsAt : p.point === 'end' ? facts.endsAt : null;
        if (list) {
          if (list.length < MAX_END_SPOTS) list.push(spot);
          else facts.capped++;
          continue;
        }
        if (facts.objectiveSpots.length >= MAX_OBJECTIVE_SPOTS) {
          facts.capped++;
          continue;
        }
        const o: ObjectiveSpot = {
          ...spot,
          role: p.point === 'sourcerequirement' ? 'source' : 'target',
        };
        const item = text(p.item);
        if (item) o.item = item;
        // On a target the field repeats the NPC id; only a different small number is an index.
        const objective = int(p.objective);
        if (objective !== undefined && objective !== spot.id && objective >= 0 && objective < 20)
          o.objective = objective;
        facts.objectiveSpots.push(o);
      }
    });
  }
  return { facts };
}

/** The string literal starting at `at` (a quote), unescaped enough for markup matching, and the index after it. */
function stringLiteral(src: string, at: number): { value: string; end: number } | null {
  const quote = src[at];
  if (quote !== '"' && quote !== "'") return null;
  let out = '';
  for (let i = at + 1; i < src.length; i++) {
    const c = src[i]!;
    if (c === '\\') {
      out += src[i + 1] ?? '';
      i++;
    } else if (c === quote) return { value: out, end: i + 1 };
    else out += c;
  }
  return null;
}

/** At most this many infobox Start / End links. */
const MAX_INFOBOX_LINKS = 10;

/**
 * Starts / ends from the infobox markup (`[icon name=quest-start]Start: [url=/forever/npc=248242/…]Name[/url]`), for
 * quests the mapper has no point for (started by an item, or no known spawn). No coordinates. Only the markup printed
 * into `infobox-contents-0` is read: comments quote the same markup.
 */
export function infoboxEnds(script: string): { start: QuestSpot[]; end: QuestSpot[] } {
  const out = { start: [] as QuestSpot[], end: [] as QuestSpot[] };
  for (const at of codeMarkers(script, 'WH.markup.printHtml(', 20)) {
    const lead = /^\s*/.exec(script.slice(at, at + 100))![0].length;
    const lit = stringLiteral(script, at + lead);
    if (!lit || !/^\s*,\s*["']infobox-contents-0["']/.test(script.slice(lit.end, lit.end + 100)))
      continue;
    const re =
      /\[icon name=quest-(start|end)\][A-Za-z ]*:\s*\[url=\/[a-z-]*\/?(npc|object|item)=(\d{1,10})[^\]]*\]([^[]*)\[\/url\]/g;
    let n = 0;
    for (const m of lit.value.matchAll(re)) {
      if (++n > MAX_INFOBOX_LINKS) break;
      const id = Number(m[3]);
      const name = text(m[4]!.trim());
      if (!isGameId(id) || !name) continue;
      out[m[1] as 'start' | 'end'].push({
        kind: m[2] as SpotKind,
        id,
        name,
        wowheadZone: null,
        zoneName: null,
        coords: [],
      });
    }
    break;
  }
  return out;
}

/** The faction an element sits under: an ancestor (up to `stop`) with a class starting `icon-horde` / `icon-alliance`. */
function sideOf(el: HTMLElement, stop: HTMLElement): 'Alliance' | 'Horde' | undefined {
  for (let n: Node | null = el; n && n !== stop; n = n.parentNode) {
    const cls = (n as HTMLElement).getAttribute?.('class') ?? '';
    for (const c of cls.split(/\s+/)) {
      if (c.startsWith('icon-horde')) return 'Horde';
      if (c.startsWith('icon-alliance')) return 'Alliance';
    }
  }
  return undefined;
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
    if (steps.length >= MAX_SERIES_STEPS) break;
    const td = tr.querySelector('td');
    if (!td) continue;
    const step: SeriesEntry[] = [];
    for (const el of td.querySelectorAll('a, b')) {
      if (step.length >= MAX_STEP_QUESTS) break;
      let id: number | undefined;
      if (el.tagName === 'A') {
        const m = /\/quest=(\d{1,10})/.exec(el.getAttribute('href') ?? '');
        if (!m || !isGameId(Number(m[1]))) continue;
        id = Number(m[1]);
      } else {
        if (el.closest('a')) continue;
        id = currentId;
      }
      const side = sideOf(el, td);
      step.push({ id, name: el.textContent.trim().slice(0, MAX_NAME), ...(side ? { side } : {}) });
    }
    if (step.length > 0) steps.push(step);
  }
  return steps.length > 0 ? steps : null;
}

/** Classic class ids by `reqclass` bit (bit = id - 1). These 9 are Forever's classes. */
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
/** Forever's playable races: the 8 Classic ones and High Order Skyborne. */
const FOREVER_RACES = [
  'Human',
  'Orc',
  'Dwarf',
  'Night Elf',
  'Undead',
  'Tauren',
  'Gnome',
  'Troll',
  'High Order Skyborne',
];

/** Set bits of a mask up to 2^52 (beyond 32 bits, so no bitwise operators). */
function bits(mask: number): number[] {
  const out: number[] = [];
  for (let b = 0, m = mask; m > 0 && b < 53; b++, m = Math.floor(m / 2))
    if (m % 2 === 1) out.push(b);
  return out;
}

/**
 * Class names a `reqclass` mask allows; unknown bits as `class<id>`. Null for no restriction (no mask, or every
 * Forever class).
 */
export function classesOf(mask: unknown): string[] | null {
  if (typeof mask !== 'number' || !Number.isSafeInteger(mask) || mask <= 0) return null;
  const names = bits(mask).map((b) => CLASSES[b + 1] ?? `class${b + 1}`);
  return Object.values(CLASSES).every((c) => names.includes(c)) ? null : names;
}

/**
 * Race names a `reqrace` mask allows; unknown bits as `raceBit<n>`. Null for no restriction (no mask, or every
 * Forever race).
 */
export function racesOf(mask: unknown): string[] | null {
  if (typeof mask !== 'number' || !Number.isSafeInteger(mask) || mask <= 0) return null;
  const names = bits(mask).map((b) => {
    const id = RACE_BITS[b] ?? (b < 11 ? b + 1 : undefined);
    return (id !== undefined ? RACES[id] : undefined) ?? `raceBit${b}`;
  });
  return FOREVER_RACES.every((r) => names.includes(r)) ? null : names;
}
