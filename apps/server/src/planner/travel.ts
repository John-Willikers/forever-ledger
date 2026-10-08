// Planner travel network: the fastest way between two map spots for one character, by walking, learned flights,
// boats / zeppelins and the hearthstone. A small graph is built per call and searched with a plain O(n²) Dijkstra on
// seconds. Pure: every input is a plain object.
import { distance, toWorld } from './geo.js';
import type { Transport } from './transports.js';
import type { CharacterState, MapSpot, WorldPos } from './types.js';

export interface TravelData {
  /** Flight master nodes: id, name, faction ('Horde' | 'Alliance' | 'both'), spot on a client map. */
  flightNodes: { id: number; name: string; faction: string; spot: MapSpot }[];
  transports: Transport[];
  /** Flight path bend fitted from recorded flights (knowledge/character-state.ts); default FLIGHT_DETOUR. */
  flightDetour?: number;
}

export interface Leg {
  how: 'walk' | 'fly' | 'boat' | 'hearth';
  from: MapSpot;
  to: MapSpot;
  seconds: number;
  note?: string;
}

/** Yards per second on foot (probe 0.6.0, build 70245) and on a Classic riding-40 mount (+60 %). */
export const RUN_SPEED = 7;
export const MOUNT_SPEED = 11.2;
/**
 * Classic 1.12 travel forms, +40 %: Druid Travel Form (trained at 30) and Shaman Ghost Wolf (trained at 20). Forever
 * may differ (levels, speed); a speed measured in game can replace this later.
 */
export const FORM_SPEED = 9.8;
const FORMS: Record<string, { level: number; form: string }> = {
  DRUID: { level: 30, form: 'Travel Form' },
  SHAMAN: { level: 20, form: 'Ghost Wolf' },
};

/**
 * The best ground speed a character has: a mount (riding 40) beats a travel form, which beats running. `form` names
 * the travel form when it is the one used, for the guide to say.
 */
export function groundTravel(ch: Pick<CharacterState, 'mounted' | 'className' | 'level'>): {
  speed: number;
  form?: string;
} {
  if (ch.mounted) return { speed: MOUNT_SPEED };
  const f = FORMS[ch.className.toUpperCase()];
  if (f && ch.level >= f.level) return { speed: FORM_SPEED, form: f.form };
  return { speed: RUN_SPEED };
}
/** Taxi speed (probe 0.6.0, build 70245). */
export const FLIGHT_SPEED = 30.52;
/** Flight paths bend: straight distance × this, unless recorded flights say otherwise (TravelData.flightDetour). */
export const FLIGHT_DETOUR = 1.25;
/** Take-off and landing. */
export const FLIGHT_OVERHEAD = 15;
/** Hearthstone: 10 s cast + 10 s loading screen; cooldown 1 h. */
export const HEARTH_SECONDS = 20;
export const HEARTH_COOLDOWN = 3600;

/**
 * Flight time between two taxi nodes. Calibration: Orgrimmar → Splintertree Post is 1895 yd straight on map 1414,
 * estimated 92.6 s; the probe measured 89.7 s (TakeTaxiNode → PLAYER_CONTROL_GAINED), measured / estimate = 0.97.
 */
export const flightSeconds = (yards: number, detour = FLIGHT_DETOUR): number =>
  (yards * detour) / FLIGHT_SPEED + FLIGHT_OVERHEAD;

interface Node {
  spot: MapSpot;
  pos: WorldPos;
  flightId?: number;
}
interface Edge {
  to: number;
  seconds: number;
  how: Leg['how'];
  note?: string;
}

const sideOk = (f: string, faction: string) => f === faction || f === 'both';

/** Two spots this close to the two ends of one transport are across its water: no walk edge between them. */
export const DOCK_RADIUS = 150;

/**
 * Fastest way from one spot to another, starting at planner clock `now`. The hearthstone is used from the start
 * spot, waiting for `hearth.readyAt` if it is not ready yet (a 'hearth' leg noted 'wait N s'). After a route with a
 * 'hearth' leg the caller restarts the cooldown from the cast: `hearth.readyAt = clock at the end of the leg -
 * HEARTH_SECONDS + HEARTH_COOLDOWN`. Null when unreachable.
 */
export function route(
  from: MapSpot,
  to: MapSpot,
  ch: Pick<
    CharacterState,
    'faction' | 'flightPaths' | 'hearth' | 'mounted' | 'className' | 'level'
  >,
  data: TravelData,
  now: number,
): { seconds: number; legs: Leg[] } | null {
  const start = toWorld(from);
  const goal = toWorld(to);
  if (!start || !goal) return null;

  const nodes: Node[] = [
    { spot: from, pos: start },
    { spot: to, pos: goal },
  ];
  const edges: Edge[][] = [[], []];
  const add = (spot: MapSpot, flightId?: number): number => {
    const pos = toWorld(spot);
    if (!pos) return -1;
    nodes.push({ spot, pos, flightId });
    edges.push([]);
    return nodes.length - 1;
  };
  const link = (a: number, b: number, e: Omit<Edge, 'to'>) => edges[a]!.push({ to: b, ...e });

  const names = new Map<number, string>();
  for (const f of data.flightNodes) {
    if (!sideOk(f.faction, ch.faction) || !ch.flightPaths.has(f.id)) continue;
    if (add(f.spot, f.id) >= 0) names.set(f.id, f.name);
  }
  for (const t of data.transports) {
    if (!sideOk(t.faction, ch.faction)) continue;
    const a = add(t.a);
    const b = add(t.b);
    if (a < 0 || b < 0) continue;
    const e = { seconds: t.wait + t.crossing, how: 'boat' as const, note: t.name };
    link(a, b, e);
    link(b, a, e);
  }
  if (ch.hearth) {
    const h = add(ch.hearth.spot);
    const wait = Math.max(0, ch.hearth.readyAt - now);
    const note = wait > 0 ? `wait ${Math.round(wait)} s` : 'Hearthstone';
    if (h >= 0) link(0, h, { seconds: wait + HEARTH_SECONDS, how: 'hearth', note });
  }
  // Transport ends in world yards, to keep walks from crossing the water a transport crosses.
  const docks = data.transports
    .filter((t) => sideOk(t.faction, ch.faction))
    .map((t) => [toWorld(t.a), toWorld(t.b)] as const)
    .filter((d): d is readonly [WorldPos, WorldPos] => d[0] !== null && d[1] !== null);
  const near = (p: WorldPos, q: WorldPos) => distance(p, q) <= DOCK_RADIUS;
  const acrossWater = (p: WorldPos, q: WorldPos) =>
    docks.some(([a, b]) => (near(p, a) && near(q, b)) || (near(p, b) && near(q, a)));

  const { speed, form } = groundTravel(ch);
  const walk = form ? { how: 'walk' as const, note: form } : { how: 'walk' as const };
  for (let i = 0; i < nodes.length; i++) {
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const a = nodes[i]!;
      const b = nodes[j]!;
      const d = distance(a.pos, b.pos);
      if (!Number.isFinite(d) || acrossWater(a.pos, b.pos)) continue;
      link(i, j, { seconds: d / speed, ...walk });
      if (a.flightId !== undefined && b.flightId !== undefined) {
        link(i, j, {
          seconds: flightSeconds(d, data.flightDetour),
          how: 'fly',
          note: `${names.get(a.flightId)} → ${names.get(b.flightId)}`,
        });
      }
    }
  }

  // Dijkstra, O(n²).
  const dist = nodes.map(() => Infinity);
  const prev: ({ from: number; edge: Edge } | null)[] = nodes.map(() => null);
  const done = nodes.map(() => false);
  dist[0] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < nodes.length; i++)
      if (!done[i] && dist[i]! < Infinity && (u < 0 || dist[i]! < dist[u]!)) u = i;
    if (u < 0 || u === 1) break;
    done[u] = true;
    for (const e of edges[u]!) {
      const alt = dist[u]! + e.seconds;
      if (alt < dist[e.to]!) {
        dist[e.to] = alt;
        prev[e.to] = { from: u, edge: e };
      }
    }
  }
  if (dist[1] === Infinity) return null;

  const legs: Leg[] = [];
  for (let v = 1; prev[v]; v = prev[v]!.from) {
    const { from: u, edge } = prev[v]!;
    const leg: Leg = {
      how: edge.how,
      from: nodes[u]!.spot,
      to: nodes[v]!.spot,
      seconds: edge.seconds,
    };
    if (edge.note) leg.note = edge.note;
    legs.unshift(leg);
  }
  // Merge consecutive walks and drop zero-length ones.
  const merged: Leg[] = [];
  for (const l of legs) {
    const last = merged[merged.length - 1];
    if (l.how === 'walk' && last?.how === 'walk') {
      last.to = l.to;
      last.seconds += l.seconds;
    } else merged.push({ ...l });
  }
  const out = merged.filter((l) => !(l.how === 'walk' && l.seconds === 0));
  return { seconds: dist[1]!, legs: out };
}
