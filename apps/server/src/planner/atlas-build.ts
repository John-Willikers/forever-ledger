// The quest atlas from rows: Wowhead's wowhead@5 quest claims plus what our own players' uploads saw, merged into one
// AtlasQuest per quest. Pure (knowledge/atlas-load.ts does the SQL). Best evidence per field: our observations (tier 1:
// the quest log's title / level / objectives, the giver and turn-in NPC where our players stood, objective progress
// spots, turn-in XP) beat Wowhead's; among claims the better source tier, then VERIFIED (Forever) before CLASSIC, then
// the newest build. What could not be built is said in `gaps`, never guessed silently.
import { mapInfo } from './geo.js';
import { MAP_ROWS } from './maps.js';
import type {
  Atlas,
  AtlasObjective,
  AtlasQuest,
  MapSpot,
  ObjectiveKind,
  QuestPoint,
} from './types.js';

/** One claim about a quest (claims joined with its source's tier). */
export interface ClaimRow {
  questId: number;
  attribute: string;
  value: unknown;
  label: string;
  tier: number;
  build?: number | null;
}

/** A quest NPC our players saw: `detail` = the quest window when taking it (the giver), `complete` = the turn-in. */
export interface SeenRow {
  questId: number;
  stage: string;
  npcId: number | null;
  npcName: string | null;
  mapId: number | null;
  x: number | null;
  y: number | null;
}

/** Objective progress our players made, one row per spot (uiMap, percent) with how many increments happened there. */
export interface ProgressRow {
  questId: number;
  /** The client's objective index, 1-based. */
  idx: number;
  mapId: number | null;
  x: number;
  y: number;
  n: number;
  need: number | null;
  text: string | null;
}

export interface TurnInRow {
  questId: number;
  xp: number | null;
  /** The character's level at the turn-in. */
  level: number | null;
}

/** Our `quests` row: the client's own title, level and objectives. */
export interface QuestRow {
  questId: number;
  title: string | null;
  level: number | null;
  objectives: string[] | null;
}

/** One objective increment: the count a character had after it, and when (epoch seconds). */
export interface TickRow {
  questId: number;
  /** The client's objective index, 1-based. */
  idx: number;
  char: string;
  at: number;
  have: number;
}

/** A quest one of our characters took or saw, and that character's faction. */
export interface TakerRow {
  questId: number;
  faction: string | null;
}

export interface AtlasRows {
  claims: ClaimRow[];
  /** Objective increments, for seconds per unit; optional. */
  ticks?: TickRow[];
  /** Our characters' factions per quest, for a side Wowhead does not give; optional. */
  takers?: TakerRow[];
  seen: SeenRow[];
  progress: ProgressRow[];
  turnIns: TurnInRow[];
  quests: QuestRow[];
}

export interface AtlasBuild {
  atlas: Atlas;
  gaps: string[];
  /** Forever's quest XP against Wowhead's: the median ratio over quests with both, null under XP_PAIRS_MIN pairs. */
  calibration: { xpRatio: number | null; pairs: number };
}

/** At most this many spots per giver, ender or objective. */
const MAX_SPOTS = 200;
/** A turn-in this many levels or fewer above the quest gave its full XP (planner/xp.ts questXp). */
const FULL_XP_LEVELS = 5;
/** Quests with both our full XP and Wowhead's needed before Wowhead-only XP is scaled. */
export const XP_PAIRS_MIN = 5;
/** Usable steps (consecutive increments, no break or restart between) needed before an objective is timed. */
export const TICKS_MIN = 3;
/** A pause longer than this between two increments is a break, not time spent on the objective. */
export const TICK_BREAK_SECONDS = 600;
/** Quests listed per unmapped-zone gap. */
const GAP_QUESTS = 10;

const LABEL_RANK: Record<string, number> = { VERIFIED: 0, CLASSIC: 1, ANECDOTE: 2, UNVERIFIED: 3 };

// ---------------------------------------------------------------------------------------------------------------
// Names

/** Lower case, letters and digits only, single spaces: "Zephra's Isle" and "zephras isle" are one name. */
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Kind order when two client maps share a name: a zone (3) before smaller maps, a continent (2) last. */
const typeRank = (t: number) => (t === 3 ? 0 : t === 2 ? 9 : t);
const ZONES = new Map<string, number>();
for (const r of [...MAP_ROWS]
  .filter((r) => mapInfo(r[0]))
  .sort((a, b) => typeRank(a[2]) - typeRank(b[2]))) {
  const key = norm(r[1]);
  if (!ZONES.has(key)) ZONES.set(key, r[0]);
}

/**
 * The client uiMapID of a Wowhead zone, by name; null when the client has no such map (Wowhead names dungeons and
 * subzones the 1.60.1 client has no map for). Of two maps with one name (Zephras Isle 2521 / 2665) the first listed.
 */
export const zoneMapId = (name: string): number | null => ZONES.get(norm(name)) ?? null;

/** `UnitClass` token: 'Warlock' → 'WARLOCK'. */
export const classToken = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** `UnitRace` tokens where they differ from Wowhead's name (the Skyborne one from our characters' uploads). */
const RACE_TOKENS: Record<string, string> = {
  undead: 'Scourge',
  'night elf': 'NightElf',
  'blood elf': 'BloodElf',
  'high order skyborne': 'Skyborne',
};
/** `UnitRace` token: 'Undead' → 'Scourge', 'Night Elf' → 'NightElf'; others lose their spaces. */
export const raceToken = (name: string) =>
  RACE_TOKENS[norm(name)] ?? name.replace(/[^A-Za-z0-9]/g, '');

// ---------------------------------------------------------------------------------------------------------------
// Claim values (untrusted jsonb: every field checked)

interface WhSpot {
  kind: string;
  id: number;
  name: string;
  zoneName: string | null;
  coords: [number, number][];
  role?: string;
  item?: string;
  objective?: number;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isId = (v: unknown): v is number => isNum(v) && Number.isInteger(v) && v > 0;
const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : undefined);

function whSpots(v: unknown): WhSpot[] {
  if (!Array.isArray(v)) return [];
  const out: WhSpot[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue;
    const p = raw as Record<string, unknown>;
    const name = str(p.name);
    if (!isId(p.id) || !name) continue;
    const coords = Array.isArray(p.coords)
      ? (p.coords as unknown[]).filter(
          (c): c is [number, number] =>
            Array.isArray(c) && c.length === 2 && isNum(c[0]) && isNum(c[1]),
        )
      : [];
    out.push({
      kind: str(p.kind) ?? 'unknown',
      id: p.id,
      name,
      zoneName: str(p.zoneName) ?? null,
      coords,
      ...(str(p.role) ? { role: str(p.role) } : {}),
      ...(str(p.item) ? { item: str(p.item) } : {}),
      ...(isNum(p.objective) ? { objective: p.objective } : {}),
    });
  }
  return out;
}

const pointKind = (k: string): QuestPoint['kind'] =>
  k === 'object' ? 'object' : k === 'item' ? 'item' : 'npc';

// ---------------------------------------------------------------------------------------------------------------

/** Unmapped Wowhead zones: coordinates dropped and the quests they belong to. */
type ZoneGaps = Map<string, { dropped: number; quests: Set<number> }>;

function mapSpots(questId: number, s: WhSpot, zoneGaps: ZoneGaps): MapSpot[] {
  if (s.coords.length === 0) return [];
  const mapId = s.zoneName ? zoneMapId(s.zoneName) : null;
  if (mapId === null) {
    const key = s.zoneName ?? '?';
    const g = zoneGaps.get(key) ?? { dropped: 0, quests: new Set<number>() };
    g.dropped += s.coords.length;
    g.quests.add(questId);
    zoneGaps.set(key, g);
    return [];
  }
  return s.coords.slice(0, MAX_SPOTS).map(([x, y]) => ({ mapId, x, y }));
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const tenth = (v: number) => Math.round(v * 10) / 10;

/** The NPC most of our sightings name, at the middle of where they stood on its most seen map. */
function seenPoint(rows: SeenRow[], wowhead: QuestPoint | null): QuestPoint | null {
  const ok = rows.filter(
    (r) =>
      r.mapId !== null &&
      mapInfo(r.mapId) &&
      isNum(r.x) &&
      isNum(r.y) &&
      (r.npcId !== null || wowhead),
  );
  if (ok.length === 0) return null;
  const mostSeen = <T>(list: SeenRow[], k: (r: SeenRow) => T): T => {
    const m = new Map<T, number>();
    for (const r of list) m.set(k(r), (m.get(k(r)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  };
  const npc = mostSeen(ok, (r) => r.npcId);
  const mine = ok.filter((r) => r.npcId === npc);
  const map = mostSeen(mine, (r) => r.mapId!);
  const at = mine.filter((r) => r.mapId === map);
  const spot = {
    mapId: map,
    x: tenth(median(at.map((r) => r.x!))),
    y: tenth(median(at.map((r) => r.y!))),
  };
  if (npc === null) return { ...wowhead!, spots: [spot] };
  const sameAsWowhead = wowhead && wowhead.id === npc;
  return {
    id: npc,
    name: mine.find((r) => r.npcName)?.npcName ?? (sameAsWowhead ? wowhead.name : `NPC ${npc}`),
    kind: sameAsWowhead ? wowhead.kind : 'npc',
    spots: [spot],
  };
}

/** Wowhead's giver / ender: the first point with a mapped spot, else the first point. */
function wowheadPoint(questId: number, v: unknown, zoneGaps: ZoneGaps): QuestPoint | null {
  let first: QuestPoint | null = null;
  for (const s of whSpots(v)) {
    const p = {
      id: s.id,
      name: s.name,
      kind: pointKind(s.kind),
      spots: mapSpots(questId, s, zoneGaps),
    };
    if (p.spots.length > 0) return p;
    first ??= p;
  }
  return first;
}

/**
 * Seconds per unit of one objective: the steps between one character's consecutive increments (a count that drops or
 * stays is a restart, a pause over TICK_BREAK_SECONDS a break), each counted once per unit gained; the median.
 */
function secondsEach(ticks: TickRow[]): number | undefined {
  const steps: number[] = [];
  let usable = 0;
  const byChar = new Map<string, TickRow[]>();
  for (const t of ticks) byChar.set(t.char, [...(byChar.get(t.char) ?? []), t]);
  for (const list of byChar.values()) {
    list.sort((a, b) => a.at - b.at);
    for (let i = 1; i < list.length; i++) {
      const units = list[i]!.have - list[i - 1]!.have;
      const dt = list[i]!.at - list[i - 1]!.at;
      if (units <= 0 || dt <= 0 || dt > TICK_BREAK_SECONDS) continue;
      usable++;
      for (let u = 0; u < units; u++) steps.push(dt / units);
    }
  }
  return usable >= TICKS_MIN ? Math.round(median(steps) * 10) / 10 : undefined;
}

/** "0/8 Mindless Zombie slain" (Forever) or "Mindless Zombie slain: 0/8" (Classic) → name and count; null without one. */
export function parseObjective(text: string): { name: string; count: number } | null {
  text = text.replace(/\|c[0-9a-fA-F]{8}|\|r/g, '');
  const lead = /^\s*\d+\s*\/\s*(\d+)\s*(.*)$/.exec(text);
  if (lead) return { name: lead[2]!.trim(), count: Number(lead[1]) };
  const trail = /^(.*?):?\s*\d+\s*\/\s*(\d+)\s*$/.exec(text);
  if (trail) return { name: trail[1]!.trim(), count: Number(trail[2]) };
  return null;
}

/** Wowhead's objective places: one per target NPC / object, one per item (all its sources together). */
interface WhObjective {
  kind: ObjectiveKind;
  name: string;
  spots: MapSpot[];
}
function wowheadObjectives(questId: number, v: unknown, zoneGaps: ZoneGaps): WhObjective[] {
  const out = new Map<string, WhObjective>();
  for (const s of whSpots(v)) {
    const collect = s.role === 'source' && s.item;
    const key = collect ? `item:${norm(s.item!)}` : `${s.kind}:${s.id}`;
    const o = out.get(key) ?? {
      kind: (collect
        ? 'collect'
        : s.kind === 'object'
          ? 'object'
          : s.kind === 'npc'
            ? 'kill'
            : 'other') as ObjectiveKind,
      name: collect ? s.item! : s.name,
      spots: [],
    };
    for (const p of mapSpots(questId, s, zoneGaps)) if (o.spots.length < MAX_SPOTS) o.spots.push(p);
    out.set(key, o);
  }
  return [...out.values()];
}

function objectivesOf(
  questId: number,
  texts: { index: number; name: string; count: number }[],
  wh: WhObjective[],
  progress: ProgressRow[],
): AtlasObjective[] {
  const ours = (index: number) =>
    progress
      .filter((p) => p.idx - 1 === index && p.mapId !== null && mapInfo(p.mapId))
      .sort((a, b) => b.n - a.n)
      .slice(0, MAX_SPOTS)
      .map((p) => ({ mapId: p.mapId!, x: p.x, y: p.y }));
  if (texts.length === 0)
    return wh.map((o, index) => {
      const mine = ours(index);
      return {
        index,
        kind: o.kind,
        text: o.name,
        count: 1,
        spots: mine.length > 0 ? mine : o.spots,
      };
    });
  const used = new Set<WhObjective>();
  const matched = texts.map((t) => {
    const n = ` ${norm(t.name)} `;
    const m = wh
      .filter((o) => !used.has(o) && norm(o.name) && n.includes(` ${norm(o.name)} `))
      .sort((a, b) => b.name.length - a.name.length)[0];
    if (m) used.add(m);
    return m;
  });
  // Forever often leaves an objective's text blank ("0/6  "): the Wowhead places no text claimed fill those in order.
  const spare = wh.filter((o) => !used.has(o));
  texts.forEach((t, i) => {
    if (!matched[i] && !t.name && spare.length > 0) matched[i] = spare.shift();
  });
  return texts.map((t, i) => {
    const m = matched[i];
    const mine = ours(t.index);
    return {
      index: t.index,
      kind: /^(speak|talk)\b/i.test(t.name)
        ? 'talk'
        : (m?.kind ?? (/\b(slain|killed)\b/i.test(t.name) ? 'kill' : 'other')),
      text: t.name || m?.name || '',
      count: t.count,
      spots: mine.length > 0 ? mine : (m?.spots ?? []),
    };
  });
}

interface SeriesEntry {
  id: number;
  side?: string;
}
function seriesSteps(v: unknown): SeriesEntry[][] | null {
  if (!Array.isArray(v)) return null;
  const steps = v.filter(Array.isArray).map((step: unknown[]) =>
    step
      .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
      .filter((e) => isId(e.id))
      .map((e) => ({ id: e.id as number, ...(str(e.side) ? { side: str(e.side) } : {}) })),
  );
  return steps.length > 0 ? steps : null;
}

/** The quests of the series step before this quest's; on a faction-split step only this quest's faction's. */
function prereqsOf(id: number, side: string, steps: SeriesEntry[][] | undefined): number[] {
  if (!steps) return [];
  const at = steps.findIndex((s) => s.some((e) => e.id === id));
  if (at <= 0) return [];
  const mySide = steps[at]!.find((e) => e.id === id)!.side ?? (side === 'both' ? undefined : side);
  return steps[at - 1]!.filter((e) => !mySide || !e.side || e.side === mySide)
    .map((e) => e.id)
    .filter((p) => p !== id);
}

const RACE_SIDE: Record<string, 'Alliance' | 'Horde'> = {
  Human: 'Alliance',
  Dwarf: 'Alliance',
  NightElf: 'Alliance',
  Gnome: 'Alliance',
  Draenei: 'Alliance',
  Skyborne: 'Alliance',
  Orc: 'Horde',
  Scourge: 'Horde',
  Tauren: 'Horde',
  Troll: 'Horde',
  Goblin: 'Horde',
  BloodElf: 'Horde',
};
/** The one faction every entry names; undefined when they are mixed, unknown or none. */
function oneSide(list: (string | null | undefined)[]): 'Alliance' | 'Horde' | undefined {
  const sides = new Set(list);
  const [only] = sides;
  return sides.size === 1 && (only === 'Alliance' || only === 'Horde') ? only : undefined;
}

// ---------------------------------------------------------------------------------------------------------------

export function buildAtlas(rows: AtlasRows): AtlasBuild {
  const gaps: string[] = [];
  const zoneGaps: ZoneGaps = new Map();
  /** Per-quest gaps, by reason. */
  const lacking = new Map<string, number[]>();
  const lack = (reason: string, id: number) =>
    lacking.set(reason, [...(lacking.get(reason) ?? []), id]);

  // Best claim per quest and attribute.
  const ranked = rows.claims
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.label in LABEL_RANK)
    .sort(
      (a, b) =>
        a.c.tier - b.c.tier ||
        LABEL_RANK[a.c.label]! - LABEL_RANK[b.c.label]! ||
        (b.c.build ?? -1) - (a.c.build ?? -1) ||
        // Equal otherwise: the newest claim (rows come in claim order).
        b.i - a.i,
    );
  const best = new Map<number, Map<string, { value: unknown; label: string }>>();
  for (const { c } of ranked) {
    const m = best.get(c.questId) ?? new Map<string, { value: unknown; label: string }>();
    if (!m.has(c.attribute)) m.set(c.attribute, { value: c.value, label: c.label });
    best.set(c.questId, m);
  }

  // Each quest's series: its own claim, else the first other quest's that names it.
  const series = new Map<number, SeriesEntry[][]>();
  for (const [, m] of best) {
    const steps = seriesSteps(m.get('series')?.value);
    if (!steps) continue;
    for (const e of steps.flat()) if (!series.has(e.id)) series.set(e.id, steps);
  }
  for (const [id, m] of best) {
    const steps = seriesSteps(m.get('series')?.value);
    if (steps?.some((s) => s.some((e) => e.id === id))) series.set(id, steps);
  }

  const group = <T extends { questId: number }>(list: T[]) => {
    const out = new Map<number, T[]>();
    for (const r of list) out.set(r.questId, [...(out.get(r.questId) ?? []), r]);
    return out;
  };
  const ours = new Map(rows.quests.map((q) => [q.questId, q]));
  const seen = group(rows.seen);
  const progress = group(rows.progress);
  const turnIns = group(rows.turnIns);
  const ticks = group(rows.ticks ?? []);
  const takers = group(rows.takers ?? []);
  const xpPairs: number[] = [];
  const wowheadOnly: number[] = [];

  const quests = new Map<number, AtlasQuest>();
  const ids = [...new Set([...best.keys(), ...ours.keys()])].sort((a, b) => a - b);
  for (const id of ids) {
    const claims = best.get(id);
    const c = { get: (k: string) => claims?.get(k)?.value };
    const q = ours.get(id);
    const num = (k: string) => (isNum(c.get(k)) ? (c.get(k) as number) : undefined);
    const title = str(q?.title) ?? str(c.get('name'));
    const level = (isNum(q?.level) && q.level > 0 ? q.level : undefined) ?? num('level');
    if (!title || level === undefined) {
      lack(`no ${title ? 'level' : 'title'}, left out`, id);
      continue;
    }
    const lacks = { push: (reason: string) => lack(reason, id) };
    const reqLevel = num('req_level');
    if (reqLevel === undefined) lacks.push('no req_level (1 assumed)');
    const names = (v: unknown) =>
      Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string')
        ? (v as string[])
        : null;
    const classes = names(c.get('classes'));
    const races = names(c.get('races'))?.map(raceToken) ?? null;
    // Side: Wowhead's, else this quest's own series entry, else races of one faction, else our players' faction.
    const sideClaim = c.get('side');
    const side =
      sideClaim === 'Alliance' || sideClaim === 'Horde' || sideClaim === 'both'
        ? sideClaim
        : (oneSide([
            series
              .get(id)
              ?.flat()
              .find((e) => e.id === id)?.side,
          ]) ??
          (races ? oneSide(races.map((r) => RACE_SIDE[r])) : undefined) ??
          oneSide((takers.get(id) ?? []).map((t) => t.faction)) ??
          'both');
    if (side === 'both' && sideClaim !== 'both') lacks.push("no side ('both' assumed)");

    const qSeen = seen.get(id) ?? [];
    const whGiver = wowheadPoint(id, c.get('starts_at'), zoneGaps);
    const whEnder = wowheadPoint(id, c.get('ends_at'), zoneGaps);
    const giver =
      seenPoint(
        qSeen.filter((r) => r.stage === 'detail'),
        whGiver,
      ) ?? whGiver;
    const ender =
      seenPoint(
        qSeen.filter((r) => r.stage === 'complete'),
        whEnder,
      ) ?? whEnder;
    for (const [what, p] of [
      ['giver', giver],
      ['ender', ender],
    ] as const) {
      if (!p) lacks.push(`no ${what}`);
      else if (p.spots.length === 0 && p.kind !== 'item') lacks.push(`no ${what} spot`);
    }

    const qProgress = progress.get(id) ?? [];
    // A text with no count ("Speak to Shikrik") is one thing to do.
    const fromLog = (Array.isArray(q?.objectives) ? (q.objectives as unknown[]) : [])
      .map((t, index) => ({
        index,
        parsed:
          typeof t !== 'string'
            ? null
            : (parseObjective(t) ??
              (t.trim()
                ? { name: t.replace(/\|c[0-9a-fA-F]{8}|\|r/g, '').trim(), count: 1 }
                : null)),
      }))
      .filter((t) => t.parsed)
      .map((t) => ({ index: t.index, ...t.parsed! }));
    const fromProgress = [...new Set(qProgress.map((p) => p.idx))]
      .sort((a, b) => a - b)
      .map((idx) => {
        const r = qProgress.filter((p) => p.idx === idx);
        const parsed = r.map((p) => (p.text ? parseObjective(p.text) : null)).find(Boolean);
        const need = r.find((p) => isNum(p.need))?.need;
        return { index: idx - 1, name: parsed?.name ?? '', count: need ?? parsed?.count ?? 1 };
      });
    const qTicks = ticks.get(id) ?? [];
    const objectives = objectivesOf(
      id,
      fromLog.length > 0 ? fromLog : fromProgress,
      wowheadObjectives(id, c.get('objective_spots'), zoneGaps),
      qProgress,
    ).map((o) => {
      const s = secondsEach(qTicks.filter((t) => t.idx - 1 === o.index));
      return s === undefined ? o : { ...o, secondsEach: s };
    });

    const fullXp = (turnIns.get(id) ?? [])
      .filter((t) => isNum(t.xp) && t.xp > 0 && isNum(t.level) && t.level <= level + FULL_XP_LEVELS)
      .map((t) => t.xp!);
    const ourXp = fullXp.length > 0 ? median(fullXp) : undefined;
    const whXp = num('xp_reward');
    // Only Classic-era (CLASSIC) Wowhead XP is calibrated: Forever's own (VERIFIED) is taken as it is.
    const classicXp = claims?.get('xp_reward')?.label === 'CLASSIC';
    if (classicXp && ourXp !== undefined && whXp !== undefined && whXp > 0)
      xpPairs.push(ourXp / whXp);
    else if (classicXp && ourXp === undefined && whXp !== undefined) wowheadOnly.push(id);
    const xp = ourXp ?? whXp;
    if (xp === undefined) lacks.push('no xp (0 assumed)');

    quests.set(id, {
      id,
      title,
      level,
      reqLevel: reqLevel ?? 1,
      side,
      classes: classes ? classes.map(classToken) : null,
      races,
      giver,
      ender,
      prereqs: prereqsOf(id, side, series.get(id)),
      objectives,
      xp: xp ?? 0,
    });
  }

  // Prereqs the atlas has, and on a split step not the other faction's.
  for (const q of quests.values()) {
    const kept = q.prereqs.filter((p) => {
      const pre = quests.get(p);
      if (!pre) return false;
      return q.side === 'both' || pre.side === 'both' || pre.side === q.side;
    });
    if (q.prereqs.some((p) => !quests.has(p))) lack('prereq not in the atlas, dropped', q.id);
    q.prereqs = kept;
  }

  // Forever's quest XP differs from Wowhead's (Classic-era) numbers: scale Wowhead-only XP by what our turn-ins show.
  const xpRatio = xpPairs.length >= XP_PAIRS_MIN ? Math.round(median(xpPairs) * 100) / 100 : null;
  if (xpRatio !== null && wowheadOnly.length > 0) {
    for (const id of wowheadOnly) {
      const q = quests.get(id);
      if (q) q.xp = Math.round(q.xp * xpRatio);
    }
    gaps.push(
      `quest XP: Wowhead's xp_reward × ${xpRatio} (median of ours / Wowhead's over ${xpPairs.length} quests) for ${wowheadOnly.length} quest${wowheadOnly.length === 1 ? '' : 's'} our players have not turned in at full XP`,
    );
  }

  for (const [zone, g] of [...zoneGaps].sort((a, b) => b[1].dropped - a[1].dropped)) {
    const qs = [...g.quests].sort((a, b) => a - b);
    const list = qs.slice(0, GAP_QUESTS).join(', ') + (qs.length > GAP_QUESTS ? ', …' : '');
    gaps.push(
      `Wowhead zone "${zone}" has no client map: ${g.dropped} spot${g.dropped === 1 ? '' : 's'} dropped (quest${qs.length === 1 ? '' : 's'} ${list})`,
    );
  }
  for (const [reason, ids] of lacking) {
    const list = ids.slice(0, GAP_QUESTS).join(', ') + (ids.length > GAP_QUESTS ? ', …' : '');
    gaps.push(`${reason}: ${ids.length} quest${ids.length === 1 ? '' : 's'} (${list})`);
  }
  return { atlas: { quests }, gaps, calibration: { xpRatio, pairs: xpPairs.length } };
}
