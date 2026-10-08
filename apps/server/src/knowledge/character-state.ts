// The planner's inputs from Postgres: one character's stored state (schema 10 `character_state` + `characters`) as a
// planner CharacterState, and the travel network every character's uploads taught us (flight nodes from all `taxi`
// maps, transport rides and flight times from `trips`). jsonb is untrusted: only well-formed values are used.
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { distance, mapInfo, toWorld, fromWorld } from '../planner/geo.js';
import { TAXI_NODE_FACTIONS } from '../planner/taxi-nodes.js';
import { TRANSPORTS, type Transport } from '../planner/transports.js';
import { DOCK_RADIUS, FLIGHT_OVERHEAD, FLIGHT_SPEED, type TravelData } from '../planner/travel.js';
import type { CharacterState, MapSpot, WorldPos } from '../planner/types.js';
import type { XpCurve } from '../planner/xp.js';
import { rows } from '../routes/adminData.js';

export interface LoadedCharacter {
  ch: CharacterState;
  travel: TravelData;
  /** What the stored state does not say, in words for the asker. */
  gaps: string[];
  /** XP per level recorded for the state's build (empty when none). */
  xpCurve: XpCurve;
}

/** GetAllTaxiNodes `state`: 0 current (the node the character stands at), 1 reachable (learned), 2 not learned. */
const LEARNED_STATES = new Set([0, 1]);
/** The continent map each world continent's flight nodes are shown on (the probe's GetTaxiNodesForMap maps). */
const CONTINENT_MAP: Record<number, number> = { 0: 1415, 1: 1414 };
/** Classic race tokens per faction, for a character row without a faction. */
const RACE_SIDE: Record<string, 'Alliance' | 'Horde'> = {
  Human: 'Alliance',
  Dwarf: 'Alliance',
  Gnome: 'Alliance',
  NightElf: 'Alliance',
  Orc: 'Horde',
  Scourge: 'Horde',
  Tauren: 'Horde',
  Troll: 'Horde',
};
/** A fitted flight detour outside this range is a bad trip (wrong nodes, a long wait on the ground): ignored. */
const DETOUR_RANGE = [0.5, 4] as const;

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const int = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && Number.isInteger(n) && n >= 0 ? n : null;
};

/** A stored `{ mapId, x, y }` (0..1 fraction) as a planner spot (percent); null when incomplete. */
function spotOf(v: unknown): MapSpot | null {
  const o = obj(v);
  const mapId = int(o?.mapId);
  const x = num(o?.x);
  const y = num(o?.y);
  if (mapId === null || x === null || y === null) return null;
  return { mapId, x: x * 100, y: y * 100 };
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

interface StateRow {
  build: number;
  level: number | null;
  xp: number | null;
  completed: number[] | null;
  completedTruncated: number | null;
  log: unknown;
  pos: unknown;
  bind: unknown;
  hearthReadyAt: number | null;
  taxi: unknown;
  mount: unknown;
}

/**
 * Flight master nodes from every character's taxi maps, deduped by node id (the newest state's copy wins). A taxi map
 * position (GetAllTaxiNodes on 1463 / 1464) is a 0..1 fraction of that map; both taxi maps are in the planner's map
 * catalog (maps.ts), so it goes to world yards and back onto the continent map (1415 / 1414) the rest of the planner
 * and the probe's GetTaxiNodesForMap use.
 */
function flightNodes(taxis: unknown[], gaps: string[]): TravelData['flightNodes'] {
  const out = new Map<number, TravelData['flightNodes'][number]>();
  for (const taxi of taxis) {
    for (const m of Array.isArray(taxi) ? taxi : []) {
      const taxiMapId = int(obj(m)?.taxiMapId);
      if (taxiMapId === null) continue;
      if (!mapInfo(taxiMapId)) {
        const line = `taxi map ${taxiMapId} is not in the map catalog: its flight nodes are left out`;
        if (!gaps.includes(line)) gaps.push(line);
        continue;
      }
      const nodes = obj(m)?.nodes;
      for (const n of Array.isArray(nodes) ? nodes : []) {
        const id = int(obj(n)?.nodeId);
        if (id === null || out.has(id)) continue;
        const onTaxi = spotOf({ mapId: taxiMapId, x: obj(n)?.x, y: obj(n)?.y });
        const world = onTaxi && toWorld(onTaxi);
        if (!onTaxi || !world) continue;
        const continentMap = CONTINENT_MAP[world.continent];
        const spot = (continentMap !== undefined && fromWorld(continentMap, world)) || onTaxi;
        const name = obj(n)?.name;
        out.set(id, {
          id,
          name: typeof name === 'string' && name ? name : `node ${id}`,
          faction: TAXI_NODE_FACTIONS[id] ?? 'both',
          spot,
        });
      }
    }
  }
  return [...out.values()].sort((a, b) => a.id - b.id);
}

interface TripRow {
  char: string;
  kind: string;
  /** Epoch seconds. */
  startedAt: number;
  seconds: number;
  from: unknown;
  to: unknown;
  fromNode: unknown;
  toNode: unknown;
}

/** A transport trip starting this soon (seconds) and this near (yards) to where the last one ended continues it. */
const SPLIT_GAP_SECONDS = 60;
const SPLIT_GAP_YARDS = 300;

/**
 * One ride recorded as two trips, joined: moving on deck interrupts the addon's transport detection (0.8.0). Harlan's
 * Ratchet → Booty Bay boat (build 70245, 2026-10-08) came in as 82 s Ratchet → mid-sea, then 24 s, starting 2 s later
 * and 57 yd on, → the Booty Bay dock. Consecutive transport trips of one character merge when the second starts
 * ≤ SPLIT_GAP_SECONDS after the first ends and ≤ SPLIT_GAP_YARDS from where it ended: first's from → second's to,
 * seconds = second's end − first's start.
 */
function mergeSplitRides(trips: TripRow[]): TripRow[] {
  const at = (v: unknown) => {
    const s = spotOf(v);
    return s && toWorld(s);
  };
  const out: TripRow[] = [];
  const last = new Map<string, TripRow>();
  const ordered = trips
    .filter((t) => t.kind === 'transport')
    .sort((a, b) => (a.char < b.char ? -1 : a.char > b.char ? 1 : a.startedAt - b.startedAt));
  for (const t of ordered) {
    const prev = last.get(t.char);
    if (prev) {
      const end = prev.startedAt + prev.seconds;
      const p = at(prev.to);
      const q = at(t.from);
      if (
        t.startedAt >= end - 1 &&
        t.startedAt - end <= SPLIT_GAP_SECONDS &&
        p &&
        q &&
        distance(p, q) <= SPLIT_GAP_YARDS
      ) {
        prev.to = t.to;
        prev.seconds = t.startedAt + t.seconds - prev.startedAt;
        continue;
      }
    }
    const copy = { ...t };
    out.push(copy);
    last.set(t.char, copy);
  }
  return [...trips.filter((t) => t.kind !== 'transport'), ...out];
}

/**
 * Transports with the ride time recorded by our players: the median of the `transport` trips whose two ends lie
 * within DOCK_RADIUS of the transport's two docks (either way). A trip times the ride only (the addon starts it when
 * the ship moves), so `crossing` is replaced and the schedule `wait` stays the curated guess.
 */
function measuredTransports(trips: TripRow[]): Transport[] {
  const rides = mergeSplitRides(trips)
    .filter((t) => t.kind === 'transport')
    .map((t) => {
      const a = spotOf(t.from);
      const b = spotOf(t.to);
      return { from: a && toWorld(a), to: b && toWorld(b), seconds: t.seconds };
    })
    .filter((r): r is { from: WorldPos; to: WorldPos; seconds: number } => !!r.from && !!r.to);
  const near = (p: WorldPos, q: WorldPos | null) => !!q && distance(p, q) <= DOCK_RADIUS;
  return TRANSPORTS.map((t) => {
    const a = toWorld(t.a);
    const b = toWorld(t.b);
    const secs = rides
      .filter((r) => (near(r.from, a) && near(r.to, b)) || (near(r.from, b) && near(r.to, a)))
      .map((r) => r.seconds);
    const crossing = median(secs);
    if (crossing === null) return t;
    return {
      ...t,
      crossing,
      confidence: 'measured',
      // The ends keep what they were: only the ride was measured.
      confidenceA: t.confidenceA ?? t.confidence,
      confidenceB: t.confidenceB ?? t.confidence,
    };
  });
}

/**
 * The flight detour factor recorded flights imply: per node pair (either direction) the median flight time, solved
 * for the factor in `flightSeconds` (seconds = yards × detour / FLIGHT_SPEED + FLIGHT_OVERHEAD), then the median over
 * pairs. Null without a usable flight.
 */
function fittedDetour(trips: TripRow[], nodes: TravelData['flightNodes']): number | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const byName = new Map(nodes.map((n) => [n.name, n]));
  const node = (v: unknown) => {
    const o = obj(v);
    const id = int(o?.nodeId);
    if (id !== null) return byId.get(id) ?? null;
    return typeof o?.name === 'string' ? (byName.get(o.name) ?? null) : null;
  };
  const pairs = new Map<string, { yards: number; seconds: number[] }>();
  for (const t of trips) {
    if (t.kind !== 'flight') continue;
    const a = node(t.fromNode);
    const b = node(t.toNode);
    if (!a || !b || a.id === b.id) continue;
    const pa = toWorld(a.spot);
    const pb = toWorld(b.spot);
    if (!pa || !pb) continue;
    const yards = distance(pa, pb);
    if (!Number.isFinite(yards) || yards <= 0) continue;
    const key = a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`;
    const p = pairs.get(key) ?? { yards, seconds: [] };
    p.seconds.push(t.seconds);
    pairs.set(key, p);
  }
  const factors = [...pairs.values()]
    .map((p) => ((median(p.seconds)! - FLIGHT_OVERHEAD) * FLIGHT_SPEED) / p.yards)
    .filter((k) => Number.isFinite(k) && k >= DETOUR_RANGE[0] && k <= DETOUR_RANGE[1]);
  return median(factors);
}

/**
 * One character as the planner sees it, plus the travel network and the build's XP curve. `now` (epoch seconds) is the
 * planner clock's zero: the hearthstone's `readyAt` counts from it. Null when the ledger has neither a character row
 * nor a stored state for the key.
 */
export async function loadCharacter(
  db: Db,
  charKey: string,
  now = Date.now() / 1000,
): Promise<LoadedCharacter | null> {
  const [char] = await rows<{
    class: string | null;
    race: string | null;
    faction: string | null;
    level: number | null;
  }>(db, sql`select class, race, faction, level from characters where key = ${charKey}`);
  const [st] = await rows<StateRow>(
    db,
    sql`select build, level, xp, completed, completed_truncated as "completedTruncated", log, pos, bind,
               extract(epoch from hearth_ready_at)::float8 as "hearthReadyAt", taxi, mount
          from character_state where char = ${charKey}`,
  );
  if (!char && !st) return null;
  const gaps: string[] = [];
  if (!st) gaps.push('no stored state for this character: upload once with addon 0.8.0');

  const race = char?.race ?? '';
  const className = (char?.class ?? '').toUpperCase();
  if (!className) gaps.push('class unknown: class quests are left out');
  let faction: 'Alliance' | 'Horde';
  if (char?.faction === 'Alliance' || char?.faction === 'Horde') faction = char.faction;
  else if (RACE_SIDE[race]) faction = RACE_SIDE[race]!;
  else {
    faction = 'Alliance';
    gaps.push('faction unknown: planned as Alliance');
  }

  if (st?.completedTruncated)
    gaps.push(`completed quests truncated: ${st.completedTruncated} not stored`);

  const log = new Map<number, number[]>();
  for (const q of Array.isArray(st?.log) ? st.log : []) {
    const id = int(obj(q)?.questId);
    const done = obj(q)?.done;
    if (id === null) continue;
    log.set(id, Array.isArray(done) ? done.map((d) => int(d) ?? 0) : []);
  }

  const flightPaths = new Set<number>();
  const taxi = st?.taxi;
  if (!Array.isArray(taxi) || !taxi.length)
    gaps.push('flight paths unknown: open a flight master once with 0.8.0');
  for (const m of Array.isArray(taxi) ? taxi : []) {
    const nodes = obj(m)?.nodes;
    for (const n of Array.isArray(nodes) ? nodes : []) {
      const id = int(obj(n)?.nodeId);
      const state = int(obj(n)?.state);
      if (id !== null && state !== null && LEARNED_STATES.has(state)) flightPaths.add(id);
    }
  }

  const bindSpot = spotOf(obj(st?.bind)?.spot);
  if (!bindSpot) gaps.push('bind spot unknown: set your hearth once with 0.8.0');
  const hearth = bindSpot
    ? { spot: bindSpot, readyAt: Math.max(0, (st?.hearthReadyAt ?? 0) - now) }
    : null;

  let position = spotOf(st?.pos);
  if (!position && bindSpot) {
    gaps.push('position unknown: log out once with 0.8.0');
    position = bindSpot;
  } else if (!position) {
    // Map 0 is no map: plan() stops at once instead of planning travel from nowhere.
    gaps.push('position unknown: log in once with 0.8.0');
    position = { mapId: 0, x: 0, y: 0 };
  }

  // Riding: seen mounted, or owns a mount (C_MountJournal count).
  const mount = obj(st?.mount);
  const mounted = mount?.mounted === true || (int(mount?.owned) ?? 0) > 0;

  const ch: CharacterState = {
    level: st?.level ?? char?.level ?? 1,
    xp: st?.xp ?? 0,
    className,
    race,
    faction,
    completed: new Set(st?.completed ?? []),
    log,
    position,
    flightPaths,
    hearth,
    mounted,
  };

  // Every character's taxi maps, newest state first (its node names win).
  const taxis = await rows<{ taxi: unknown }>(
    db,
    sql`select taxi from character_state where taxi is not null
         order by observed_at desc nulls last, char`,
  );
  const nodes = flightNodes(
    taxis.map((r) => r.taxi),
    gaps,
  );
  const trips = await rows<TripRow>(
    db,
    sql`select char, kind, extract(epoch from started_at)::float8 as "startedAt", seconds, "from", "to",
               from_node as "fromNode", to_node as "toNode"
          from trips where kind in ('flight', 'transport')`,
  );
  const travel: TravelData = { flightNodes: nodes, transports: measuredTransports(trips) };
  const detour = fittedDetour(trips, nodes);
  if (detour !== null) travel.flightDetour = detour;

  const xpCurve = new Map<number, number>();
  if (st) {
    const curve = await rows<{ level: number; xpMax: number }>(
      db,
      sql`select level, xp_max as "xpMax" from xp_curve where build = ${st.build}`,
    );
    for (const c of curve) xpCurve.set(c.level, c.xpMax);
  }
  return { ch, travel, gaps, xpCurve };
}
