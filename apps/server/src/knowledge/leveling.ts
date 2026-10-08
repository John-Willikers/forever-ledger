// Leveling routes for the MCP server: the quests our own players turned in, in order, on their way to a level. A
// route is what one character really did (turn-ins with their level, XP and quest givers), so "the quickest way to 13
// as an Undead" is answered by the Undead characters that got there, fastest first. Quests carry their quest-log
// zone header (`quests.category`), which is how a zone's quests are found. Kill XP is not recorded: a route is the
// quests, and its time includes the grinding between them.
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { rows } from '../routes/adminData.js';
import { containsPattern } from '../routes/shared.js';
import { chicagoIso } from '../time.js';
import { findCharacters } from './upgrades.js';

/**
 * A pause longer than this between two quest events is a break, not play time. Only quest events are timed (kills are
 * counted per session, not per character and time), so play time is an estimate: grinding between quests counts.
 */
export const BREAK_MINUTES = 60;
/** Steps of a route listed in full; longer routes are cut and say so. */
export const ROUTE_STEPS_MAX = 120;
/** Other characters listed next to the chosen route. */
const OTHERS_MAX = 5;

/** `UnitRace` tokens, from what players type. */
const RACES: Record<string, string> = {
  undead: 'Scourge',
  scourge: 'Scourge',
  forsaken: 'Scourge',
  orc: 'Orc',
  troll: 'Troll',
  tauren: 'Tauren',
  human: 'Human',
  dwarf: 'Dwarf',
  gnome: 'Gnome',
  'night elf': 'NightElf',
  nightelf: 'NightElf',
};

/**
 * Classic starting zones per race token, then the starting area's own quest-log header: Forever files the first
 * quests under it (12 of an Undead's first quests are "Deathknell", not "Tirisfal Glades").
 */
export const START_ZONES: Record<string, string[]> = {
  Scourge: ['Tirisfal Glades', 'Deathknell'],
  Orc: ['Durotar', 'Valley of Trials'],
  Troll: ['Durotar', 'Valley of Trials'],
  Tauren: ['Mulgore', 'Camp Narache'],
  Human: ['Elwynn Forest', 'Northshire Valley'],
  Dwarf: ['Dun Morogh', 'Coldridge Valley'],
  Gnome: ['Dun Morogh', 'Coldridge Valley'],
  NightElf: ['Teldrassil', 'Shadowglen'],
};

export function raceToken(ref: string | undefined): string | null {
  if (!ref) return null;
  return RACES[ref.trim().toLowerCase().replace(/s$/, '')] ?? null;
}

/** Minutes between the first and last event, without pauses longer than `BREAK_MINUTES`. */
export function activeMinutes(times: Date[]): number {
  let ms = 0;
  for (let i = 1; i < times.length; i++) {
    const gap = times[i]!.getTime() - times[i - 1]!.getTime();
    if (gap > 0 && gap <= BREAK_MINUTES * 60_000) ms += gap;
  }
  return Math.round(ms / 60_000);
}

interface Point {
  at: Date;
  level: number;
}

interface Progress {
  key: string;
  name: string;
  race: string | null;
  class: string | null;
  level: number | null;
  start: Date | null;
  reached: Date | null;
  activeMinutes: number | null;
  wallMinutes: number | null;
  turnIns: number;
}

/** When a character was first seen at each level (quest events and their last upload). */
async function levelPoints(db: Db, key: string): Promise<Point[]> {
  const found = await rows<{ at: Date | string; level: number }>(
    db,
    sql`select at, level from (
          select observed_at as at, level from quest_observations
           where char = ${key} and observed_at is not null and level is not null
          union select turned_in_at, level from turn_ins where char = ${key} and level is not null
        ) x order by at, level`,
  );
  // A union's timestamps can come back as text.
  return found.map((p) => ({ at: new Date(p.at), level: p.level }));
}

/** A character's run from `fromLevel` to `toLevel`: when it started, when it got there, how long it played. */
async function progressOf(
  db: Db,
  c: { key: string; name: string; race: string | null; class: string | null; level: number | null },
  fromLevel: number,
  toLevel: number,
): Promise<Progress> {
  const points = await levelPoints(db, c.key);
  const start = points.find((p) => p.level >= fromLevel)?.at ?? null;
  const reached = points.find((p) => p.level >= toLevel)?.at ?? null;
  const inRun = points.filter((p) => start && p.at >= start && (!reached || p.at <= reached));
  const [count] = start
    ? await rows<{ n: number }>(
        db,
        sql`select count(*)::int as n from turn_ins where char = ${c.key} and turned_in_at >= ${start}
             and (${reached}::timestamptz is null or turned_in_at <= ${reached})`,
      )
    : [];
  return {
    ...c,
    start,
    reached,
    activeMinutes: start ? activeMinutes(inRun.map((p) => p.at)) : null,
    wallMinutes:
      start && reached ? Math.round((reached.getTime() - start.getTime()) / 60_000) : null,
    turnIns: count?.n ?? 0,
  };
}

const progressView = (p: Progress, toLevel: number) => ({
  character: p.name,
  race: p.race,
  class: p.class,
  level: p.level,
  reachedTarget: p.reached !== null,
  startedAt: p.start && chicagoIso(p.start),
  reachedAt: p.reached && chicagoIso(p.reached),
  activeMinutes: p.activeMinutes,
  wallClockMinutes: p.wallMinutes,
  questsTurnedIn: p.turnIns,
  note: p.reached ? undefined : `has not reached ${toLevel} in our data`,
});

interface Where {
  zone?: string;
  subzone?: string;
  x?: number;
  y?: number;
  /** The addon's UiMapID (what a map pin needs). */
  mapID?: number;
}

/** Where one of a quest's objectives went up (schema 9): the middle of the most used spot. */
export interface ObjectiveSpot {
  index: number;
  zone: string | null;
  subzone: string | null;
  mapId: number | null;
  x: number;
  y: number;
  /** Increments the spot is made of. */
  seen: number;
}

/** One pickup or turn-in from a character's run, as the guide is built from them. */
export interface GuideEvent {
  kind: 'accept' | 'turn_in';
  at: Date;
  questId: number;
  title: string | null;
  questLevel: number | null;
  zone: string | null;
  objectives: string[] | null;
  npc: string | null;
  where: Where | null;
  /** Turn-ins: the character's level and the XP the quest paid. */
  level?: number | null;
  xp?: number | null;
  /** Turn-ins: where its objectives were done, per objective (schema 9). */
  spots?: ObjectiveSpot[];
}

/**
 * "Mindless Zombie slain: 0/8" or Forever's "0/8 Mindless Zombie slain" → "Mindless Zombie slain: 8" (the guide shows
 * what to do, not the progress).
 */
export function objectiveText(o: string): string {
  const s = o.trim();
  const lead = /^\d+\s*\/\s*(\d+)\s+(.+)$/.exec(s);
  if (lead) return `${lead[2]!.trim()}: ${lead[1]}`;
  return s.replace(/:?\s*\d+\s*\/\s*(\d+)\s*$/, ': $1').trim();
}

const round1 = (n: number) => Math.round(n * 10) / 10;

const coords = (w: Where | null) =>
  w && typeof w.x === 'number' && typeof w.y === 'number' && (w.x > 0 || w.y > 0)
    ? `${w.x.toFixed(1)}, ${w.y.toFixed(1)}`
    : null;

/**
 * Zygor-style steps from a run's pickups and turn-ins, in the order the character did them: pickups and turn-ins at
 * the same NPC in a row become one step, and before each turn-in a "complete" step lists those quests' objectives.
 * Only quests turned in during the run are kept (abandoned ones would only send a player the wrong way), and quests in
 * `skip` (already done by the player asking) are left out.
 */
export function buildGuide(events: GuideEvent[], skip: Set<number> = new Set()) {
  const turnedIn = new Set(events.filter((e) => e.kind === 'turn_in').map((e) => e.questId));
  const kept = events
    .filter((e) => turnedIn.has(e.questId) && !skip.has(e.questId))
    .sort((a, b) => a.at.getTime() - b.at.getTime() || (a.kind === 'accept' ? -1 : 1));
  type Step = {
    step: number;
    action: 'accept' | 'complete' | 'turn_in';
    npc: string | null;
    zone: string | null;
    subzone: string | null;
    coords: string | null;
    /** For a map pin: the map and the position (0-100) of the step. */
    mapId: number | null;
    x: number | null;
    y: number | null;
    quests: {
      questId: number;
      title: string | null;
      questLevel?: number | null;
      objectives?: string[];
      /** Where each objective was done, when the addon recorded it. */
      spots?: ObjectiveSpot[];
      xp?: number | null;
    }[];
    levelAfter?: number | null;
  };
  const steps: Step[] = [];
  const at = (e: GuideEvent) => e.npc ?? e.where?.subzone ?? null;
  const pin = (w: Where | null) =>
    w && typeof w.x === 'number' && typeof w.y === 'number' && (w.x > 0 || w.y > 0)
      ? { mapId: typeof w.mapID === 'number' ? w.mapID : null, x: round1(w.x), y: round1(w.y) }
      : { mapId: null, x: null, y: null };
  for (const e of kept) {
    const last = steps.at(-1);
    if (e.kind === 'accept') {
      if (last?.action === 'accept' && last.npc === at(e)) {
        last.quests.push({ questId: e.questId, title: e.title, questLevel: e.questLevel });
        continue;
      }
      steps.push({
        step: 0,
        action: 'accept',
        npc: at(e),
        zone: e.where?.zone ?? e.zone,
        subzone: e.where?.subzone ?? null,
        coords: coords(e.where),
        ...pin(e.where),
        quests: [{ questId: e.questId, title: e.title, questLevel: e.questLevel }],
      });
      continue;
    }
    const quest = { questId: e.questId, title: e.title, xp: e.xp };
    const objectives = (e.objectives ?? []).map(objectiveText).filter(Boolean);
    const spots = e.spots ?? [];
    const doing = {
      questId: e.questId,
      title: e.title,
      objectives,
      ...(spots.length > 0 ? { spots } : {}),
    };
    if (last?.action === 'turn_in' && last.npc === at(e)) {
      // Same NPC: its objectives join the "complete" step before it.
      last.quests.push(quest);
      last.levelAfter = e.level ?? last.levelAfter;
      const done = steps.at(-2);
      if (objectives.length > 0 && done?.action === 'complete') done.quests.push(doing);
      continue;
    }
    if (objectives.length > 0) {
      // Where the objectives were done (schema 9) places the step; without it, the turn-in's zone is the best hint
      // (a quest's log header can be a class or a profession, "Warlock", not a place).
      const spot = spots[0];
      steps.push({
        step: 0,
        action: 'complete',
        npc: null,
        zone: spot?.zone ?? e.where?.zone ?? e.zone,
        subzone: spot?.subzone ?? null,
        coords: spot ? `${spot.x.toFixed(1)}, ${spot.y.toFixed(1)}` : null,
        ...(spot ? { mapId: spot.mapId, x: spot.x, y: spot.y } : pin(null)),
        quests: [doing],
      });
    }
    steps.push({
      step: 0,
      action: 'turn_in',
      npc: at(e),
      zone: e.where?.zone ?? e.zone,
      subzone: e.where?.subzone ?? null,
      coords: coords(e.where),
      ...pin(e.where),
      quests: [quest],
      levelAfter: e.level ?? null,
    });
  }
  steps.forEach((x, i) => (x.step = i + 1));
  return steps;
}

/** A run's pickups and turn-ins: the quests turned in from `start` to `end`, and their pickups, whenever they were. */
async function guideEvents(
  db: Db,
  key: string,
  start: Date,
  end: Date | null,
): Promise<GuideEvent[]> {
  const found = await rows<{
    kind: 'accept' | 'turn_in';
    at: Date | string;
    quest_id: number;
    title: string | null;
    quest_level: number | null;
    zone: string | null;
    objectives: string[] | null;
    npc: string | null;
    loc: Where | null;
    level: number | null;
    xp: number | null;
  }>(
    db,
    sql`with run as (
          select t.quest_id, t.turned_in_at, t.level, t.xp from turn_ins t
           where t.char = ${key} and t.turned_in_at >= ${start}
             and (${end}::timestamptz is null or t.turned_in_at <= ${end}))
        select 'turn_in' as kind, r.turned_in_at as at, r.quest_id, r.level, r.xp,
               c.npc_name as npc, coalesce(c.npc_loc, c.loc) as loc
          from run r
          left join lateral (select o.npc_name, o.npc_loc, o.loc from quest_observations o
                              where o.char = ${key} and o.quest_id = r.quest_id and o.stage = 'complete'
                              order by o.observed_at desc nulls last limit 1) c on true
        union all
        select 'accept', a.observed_at, a.quest_id, a.level, null,
               coalesce(a.npc_name, d.npc_name), coalesce(a.npc_loc, d.npc_loc, a.loc)
          from (select distinct on (o.quest_id) o.quest_id, o.observed_at, o.level, o.npc_name, o.npc_loc, o.loc
                  from quest_observations o
                 where o.char = ${key} and o.stage = 'accept' and o.observed_at is not null
                   and o.quest_id in (select quest_id from run)
                 order by o.quest_id, o.observed_at desc) a
          -- The accept event carries no NPC on Forever builds; the quest window just before it (stage detail) does.
          left join lateral (select o.npc_name, o.npc_loc from quest_observations o
                              where o.char = ${key} and o.quest_id = a.quest_id and o.stage = 'detail'
                                and o.npc_name is not null
                              order by o.observed_at desc nulls last limit 1) d on true`,
  );
  const ids = [...new Set(found.map((f) => f.quest_id))];
  const quests =
    ids.length === 0
      ? []
      : await rows<{
          quest_id: number;
          title: string | null;
          level: number | null;
          category: string | null;
          objectives: string[] | null;
        }>(
          db,
          sql`select quest_id, title, level, category, objectives from quests where quest_id in (${sql.join(
            ids.map((i) => sql`${i}`),
            sql`, `,
          )})`,
        );
  const byId = new Map(quests.map((x) => [x.quest_id, x]));
  const spots = await objectiveSpots(db, key, ids);
  return found.map((f) => {
    const qq = byId.get(f.quest_id);
    return {
      kind: f.kind,
      at: new Date(f.at),
      questId: f.quest_id,
      title: qq?.title ?? null,
      questLevel: qq?.level ?? null,
      zone: qq?.category ?? null,
      objectives: Array.isArray(qq?.objectives) ? qq.objectives : null,
      npc: f.npc,
      where: f.loc && typeof f.loc === 'object' ? f.loc : null,
      level: f.level,
      xp: f.xp,
      ...(f.kind === 'turn_in' ? { spots: spots.get(f.quest_id) ?? [] } : {}),
    };
  });
}

/**
 * Where each objective of these quests was done (schema 9): per objective, the spot (map and subzone) most of its
 * increments happened in, preferring the route character's own, and the middle of those increments.
 */
export async function objectiveSpots(
  db: Db,
  key: string,
  questIds: number[],
): Promise<Map<number, ObjectiveSpot[]>> {
  const out = new Map<number, ObjectiveSpot[]>();
  if (questIds.length === 0) return out;
  const found = await rows<{
    quest_id: number;
    idx: number;
    zone: string | null;
    subzone: string | null;
    map_id: number | null;
    x: number;
    y: number;
    seen: number;
  }>(
    db,
    sql`with p as (
          select quest_id, idx, zone, subzone, map_id, x, y, char = ${key} as mine
            from quest_objective_progress
           where quest_id in (${sql.join(
             questIds.map((i) => sql`${i}`),
             sql`, `,
           )}) and x is not null and y is not null
        ), best as (
          select distinct on (quest_id, idx) quest_id, idx, zone, subzone, map_id
            from p group by quest_id, idx, zone, subzone, map_id
           order by quest_id, idx, bool_or(mine) desc, count(*) desc
        )
        select b.quest_id, b.idx, b.zone, b.subzone, b.map_id,
               percentile_cont(0.5) within group (order by p.x) as x,
               percentile_cont(0.5) within group (order by p.y) as y,
               count(*)::int as seen
          from best b join p on p.quest_id = b.quest_id and p.idx = b.idx
                            and p.map_id is not distinct from b.map_id and p.subzone is not distinct from b.subzone
         group by b.quest_id, b.idx, b.zone, b.subzone, b.map_id
         order by b.quest_id, b.idx`,
  );
  for (const f of found) {
    const list = out.get(f.quest_id) ?? [];
    list.push({
      index: f.idx,
      zone: f.zone,
      subzone: f.subzone,
      mapId: f.map_id,
      x: round1(Number(f.x)),
      y: round1(Number(f.y)),
      seen: f.seen,
    });
    out.set(f.quest_id, list);
  }
  return out;
}

/** Quests our players turned in whose quest-log zone header is one of these zones. */
export async function zoneQuests(db: Db, zones: string[], limit = 60) {
  if (zones.length === 0) return [];
  return rows<{
    questId: number;
    title: string | null;
    zone: string;
    level: number | null;
    characters: number;
    avgXp: number | null;
    giver: string | null;
  }>(
    db,
    sql`select q.quest_id as "questId", q.title, q.category as zone, q.level,
               count(distinct t.char)::int as characters, round(avg(t.xp))::int as "avgXp",
               (select mode() within group (order by o.npc_name) from quest_observations o
                 where o.quest_id = q.quest_id and o.stage in ('accept', 'detail') and o.npc_name is not null) as giver
          from quests q left join turn_ins t on t.quest_id = q.quest_id
         where lower(q.category) in (${sql.join(
           zones.map((z) => sql`${z.toLowerCase()}`),
           sql`, `,
         )})
         group by q.quest_id
         order by q.level nulls last, q.title
         limit ${limit}`,
  );
}

export interface LevelingQuery {
  /** A race ("undead", "Tauren") or a zone ("Tirisfal Glades"). */
  start?: string;
  /** One of our players' characters, by name. */
  character?: string;
  toLevel: number;
  fromLevel?: number;
  /** The player asking: the guide starts at their level and leaves out the quests they already turned in. */
  forCharacter?: string;
  /** Steps listed in full (default ROUTE_STEPS_MAX; in-game guides take more). */
  stepsMax?: number;
}

/**
 * The quickest recorded route to a level: our characters of that race (or who quested in that zone) that reached it,
 * the fastest by play time first, with its quests in order. Without anyone reaching it, the furthest one is shown.
 */
export async function levelingRoute(db: Db, q: LevelingQuery) {
  const query = JSON.stringify(q);
  const gaps: string[] = [];
  const toLevel = q.toLevel;
  // Personal: start where the asker is and skip what they've done.
  let forCharacter: { name: string; level: number | null; questsAlreadyDone: number } | null = null;
  let done = new Set<number>();
  let fromLevel = q.fromLevel ?? 1;
  if (q.forCharacter) {
    const [me] = await findCharacters(db, q.forCharacter);
    if (!me)
      gaps.push(
        `the ledger has no character named "${q.forCharacter}": the guide is not personalized`,
      );
    else {
      const mine = await rows<{ quest_id: number }>(
        db,
        sql`select distinct quest_id from turn_ins where char = ${me.key}`,
      );
      done = new Set(mine.map((m) => m.quest_id));
      if (q.fromLevel === undefined && me.level && me.level < toLevel) fromLevel = me.level;
      forCharacter = { name: me.name, level: me.level, questsAlreadyDone: 0 };
    }
  }
  const race = raceToken(q.start);
  const zones = race ? (START_ZONES[race] ?? []) : q.start ? [q.start.trim()] : [];

  type Who = {
    key: string;
    name: string;
    race: string | null;
    class: string | null;
    level: number | null;
  };
  let who: Who[];
  if (q.character) {
    who = (await findCharacters(db, q.character)).slice(0, 1);
    if (who.length === 0) gaps.push(`the ledger has no character named "${q.character}"`);
  } else {
    who = await rows<Who>(
      db,
      sql`select c.key, c.name, c.race, c.class, c.level from characters c
           where exists (select 1 from turn_ins t where t.char = c.key)
             and (${race}::text is null or c.race = ${race})
             and (${race}::text is not null or ${zones.length === 0}
                  or exists (select 1 from turn_ins t join quests qq on qq.quest_id = t.quest_id
                              where t.char = c.key and qq.category ilike ${containsPattern(zones[0] ?? '')} escape '\\'))
           order by c.level desc nulls last limit 50`,
    );
  }
  if (who.length === 0 && !q.character) {
    gaps.push(
      race
        ? `none of our players' ${q.start} characters has turned in a quest yet`
        : `no character of ours turned in quests${zones.length > 0 ? ` in ${zones[0]}` : ''}`,
    );
  }

  const progress = await Promise.all(who.map((c) => progressOf(db, c, fromLevel, toLevel)));
  // Got there first; among those, the least play time; otherwise the furthest along.
  progress.sort(
    (a, b) =>
      Number(b.reached !== null) - Number(a.reached !== null) ||
      (a.reached && b.reached
        ? (a.activeMinutes ?? 0) - (b.activeMinutes ?? 0)
        : (b.level ?? 0) - (a.level ?? 0)),
  );
  const best = progress.find((p) => p.start !== null) ?? null;

  let route = null;
  if (best?.start) {
    const events = await guideEvents(db, best.key, best.start, best.reached);
    const guide = buildGuide(events, done);
    if (forCharacter) {
      const runQuests = new Set(events.filter((e) => e.kind === 'turn_in').map((e) => e.questId));
      forCharacter.questsAlreadyDone = [...runQuests].filter((x) => done.has(x)).length;
    }
    if (!best.reached)
      gaps.push(
        `no character of ours has reached ${toLevel} this way yet: this is the furthest one`,
      );
    const stepsMax = q.stepsMax ?? ROUTE_STEPS_MAX;
    if (guide.length > stepsMax)
      gaps.push(`guide cut to its first ${stepsMax} of ${guide.length} steps`);
    if (events.some((e) => e.kind === 'turn_in' && !e.npc))
      gaps.push('some turn-ins have no NPC or position recorded (older addon versions)');
    const points = (await levelPoints(db, best.key)).filter(
      (p) => p.at >= best.start! && (!best.reached || p.at <= best.reached),
    );
    const levelUps: { level: number; at: string; minutesIn: number }[] = [];
    for (const p of points) {
      if (levelUps.some((l) => l.level >= p.level)) continue;
      levelUps.push({
        level: p.level,
        at: chicagoIso(p.at),
        minutesIn: activeMinutes(points.filter((x) => x.at <= p.at).map((x) => x.at)),
      });
    }
    route = {
      ...progressView(best, toLevel),
      levelUps,
      guide: guide.slice(0, q.stepsMax ?? ROUTE_STEPS_MAX),
    };
  }
  const zoneList = zones.length > 0 ? await zoneQuests(db, zones) : [];
  if (route && !route.guide.some((x) => x.action === 'complete' && x.coords)) {
    gaps.push(
      "where objectives are done isn't recorded for this route yet (addon 0.6.0 records it as players quest)",
    );
  }
  gaps.push(
    'routes are what our players did, from their quest turn-ins: kill XP is not recorded, and play time includes the grinding between quests (an estimate: only quest events are timed, and pauses over an hour between them are left out)',
  );
  return {
    query,
    race,
    zones,
    fromLevel,
    toLevel,
    forCharacter,
    route,
    otherCharacters: progress
      .filter((p) => p.key !== best?.key)
      .slice(0, OTHERS_MAX)
      .map((p) => progressView(p, toLevel)),
    zoneQuests: zoneList,
    gaps,
  };
}
