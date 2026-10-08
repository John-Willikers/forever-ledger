// The planner loop: one character's leveling plan from a quest atlas. Simulates the character (clock, position, level,
// XP, quest log, hearthstone) and repeatedly picks the hub that pays the most XP per minute, travel included:
// turn in what ends there, accept everything takeable, run one objective loop through every log quest done nearby
// (nearest first, smoothed), turn in, accept follow-ups, and stay while the hub has work. Class quests for the
// character's class go first wherever they are; level-gated pickups left behind are fetched only when the trip pays
// the run's XP per minute so far, else dropped with a gap line. Deterministic (ties by hub id / quest id) and pure.
import { canTake, isClassQuest, MAX_LEVELS_UP, type Taker } from './available.js';
import { distance, mapInfo, toWorld } from './geo.js';
import { buildHubs, type Hub } from './hubs.js';
import { orderStops, pathLength } from './tour.js';
import {
  HEARTH_COOLDOWN,
  MOUNT_SPEED,
  route,
  RUN_SPEED,
  type Leg,
  type TravelData,
} from './travel.js';
import type {
  Atlas,
  AtlasObjective,
  AtlasQuest,
  CharacterState,
  MapSpot,
  ObjectiveKind,
  PlanStep,
  QuestPoint,
  WorldPos,
} from './types.js';
import { gain, isGrey, mobXp, questXp } from './xp.js';

export interface PlanOptions {
  toLevel: number;
  /** Stop after this many steps (default MAX_STEPS). */
  maxSteps?: number;
}

export interface PlanResult {
  steps: PlanStep[];
  /** What the plan could not do or know, in plain words. */
  gaps: string[];
  /** Planned clock at the end (seconds) and XP gained on the way. */
  seconds: number;
  xp: number;
}

export const MAX_STEPS = 300;
/** Seconds per unit of an objective when our players' timestamps don't say. */
export const DEFAULT_SECONDS: Record<ObjectiveKind, number> = {
  kill: 30,
  collect: 40,
  object: 20,
  explore: 0,
  talk: 0,
  other: 30,
};
/** Log quests whose remaining objectives all lie this close (yards) to a hub join its objective loop. */
export const LOOP_RADIUS = 600;
/** A walk on one map shorter than this (yards) is no step of its own: its time folds into the next step. */
export const FOLD_WALK = 200;
/** Objective spots this close (yards) are one stop. */
const STOP_MERGE = 40;
/** Within this many yards of a hub the character is there, not "elsewhere" (level-gated pickups). */
const AT_HUB = 300;

interface Part {
  q: AtlasQuest;
  obj: AtlasObjective;
}
interface Stop {
  pos: WorldPos;
  spot: MapSpot;
  parts: Part[];
}
interface Placed {
  spot: MapSpot;
  pos: WorldPos;
}
interface Estimate {
  hub: Hub;
  seconds: number;
  xp: number;
  classWork: boolean;
}

/** Thrown by `push` when the plan is full or the level is reached; caught by `plan`. */
const HALT = Symbol('halt');

const byId = (a: { id: number }, b: { id: number }) => a.id - b.id;
const pointKey = (p: QuestPoint) => `${p.kind ?? 'npc'}:${p.id}`;
const spotKey = (s: MapSpot) => `${s.mapId}:${s.x.toFixed(2)}:${s.y.toFixed(2)}`;
const zoneOf = (s: MapSpot) => mapInfo(s.mapId)?.name ?? null;
const isContinentMap = (id: number) => mapInfo(id)?.parent === 947;

export function plan(
  atlas: Atlas,
  ch: CharacterState,
  travel: TravelData,
  opts: PlanOptions,
): PlanResult {
  const maxSteps = opts.maxSteps ?? MAX_STEPS;
  const steps: PlanStep[] = [];
  const gaps: string[] = [];
  const gap = (line: string) => {
    if (!gaps.includes(line)) gaps.push(line);
  };

  // Simulation state.
  const s = {
    clock: 0,
    pos: ch.position,
    level: ch.level,
    xp: ch.xp,
    gained: 0,
    completed: new Set(ch.completed),
    log: new Map<number, number[]>(),
    hearth: ch.hearth ? { spot: ch.hearth.spot, readyAt: ch.hearth.readyAt } : null,
  };
  for (const [id, counts] of ch.log) if (atlas.quests.has(id)) s.log.set(id, [...counts]);
  const taker = (): Taker => ({
    level: s.level,
    className: ch.className,
    race: ch.race,
    faction: ch.faction,
    completed: s.completed,
    log: s.log,
  });
  const traveller = () => ({
    faction: ch.faction,
    flightPaths: ch.flightPaths,
    hearth: s.hearth,
    mounted: ch.mounted,
  });
  const speed = ch.mounted ? MOUNT_SPEED : RUN_SPEED;
  const here = (): WorldPos => toWorld(s.pos) ?? { continent: -1, x: 0, y: 0 };

  if (s.level >= opts.toLevel) return { steps, gaps, seconds: 0, xp: 0 };

  // Hubs and which hub gives / ends each quest (no ender: turned in at the giver).
  const hubs = buildHubs(atlas).sort(byId);
  const giverHub = new Map<number, Hub>();
  const enderHub = new Map<number, Hub>();
  for (const h of hubs) {
    for (const id of h.givers) giverHub.set(id, h);
    for (const id of h.enders) enderHub.set(id, h);
  }
  for (const [id, h] of giverHub) if (!enderHub.has(id)) enderHub.set(id, h);
  const quest = (id: number) => atlas.quests.get(id)!;
  const enderOf = (q: AtlasQuest): QuestPoint | null =>
    q.ender && q.ender.spots.length ? q.ender : q.giver;
  const isMine = (q: AtlasQuest) => isClassQuest(q) && q.classes!.includes(ch.className);

  // Objectives: one spot each, the one nearest the quest's turn-in hub; none known → the giver's spot.
  const placed = new Map<string, Placed | null>();
  const place = (q: AtlasQuest, obj: AtlasObjective): Placed | null => {
    const key = `${q.id}:${obj.index}`;
    if (placed.has(key)) return placed.get(key)!;
    const anchor = (enderHub.get(q.id) ?? giverHub.get(q.id))?.pos ?? here();
    let best: Placed | null = null;
    let bestD = Infinity;
    for (const spot of obj.spots) {
      const pos = toWorld(spot);
      if (!pos) continue;
      const d = distance(anchor, pos);
      if (!best || d < bestD) {
        best = { spot, pos };
        bestD = d;
      }
    }
    if (!best) {
      gap(`no objective spots for ${q.title}: done near the giver`);
      const spot = (q.giver ?? q.ender)?.spots[0];
      const pos = spot ? toWorld(spot) : null;
      best = spot && pos ? { spot, pos } : null;
    }
    placed.set(key, best);
    return best;
  };

  const need = (o: AtlasObjective) => Math.max(1, o.count);
  const left = (q: AtlasQuest, o: AtlasObjective) =>
    Math.max(0, need(o) - (s.log.get(q.id)?.[o.index] ?? 0));
  const open = (q: AtlasQuest) => q.objectives.filter((o) => left(q, o) > 0);
  const finished = (q: AtlasQuest) => s.log.has(q.id) && open(q).length === 0;
  const objSeconds = (q: AtlasQuest, o: AtlasObjective) =>
    left(q, o) * (o.secondsEach ?? DEFAULT_SECONDS[o.kind]);
  const killXp = (q: AtlasQuest, o: AtlasObjective, level: number) =>
    o.kind === 'kill' && !isGrey(q.level, level) ? left(q, o) * mobXp(q.level) : 0;

  const logQuests = () => [...s.log.keys()].sort((a, b) => a - b).map(quest);
  const dropped = new Set<number>();
  /** Level-gated quests left behind: quest id → its giver hub. */
  const gated = new Map<number, Hub>();
  const stuck = new Set<number>();

  const takeable = (hub: Hub): AtlasQuest[] =>
    hub.givers
      .filter((id) => !dropped.has(id))
      .map(quest)
      .filter((q) => canTake(q, taker(), s.level));

  /** Quests of `pool` (log quests plus `extra`) that one objective loop from `hub` does. */
  const loopQuests = (hub: Hub, extra: AtlasQuest[]): AtlasQuest[] => {
    const pool = [...logQuests(), ...extra].sort(byId);
    return pool.filter((q) => {
      const todo = s.log.has(q.id) ? open(q) : q.objectives;
      if (!todo.length) return false;
      if (enderHub.get(q.id) === hub) return true;
      return todo.every((o) => {
        const p = place(q, o);
        return p !== null && distance(p.pos, hub.pos) <= LOOP_RADIUS;
      });
    });
  };

  const stopsOf = (qs: AtlasQuest[], fresh: Set<number>): Stop[] => {
    const stops: Stop[] = [];
    for (const q of qs)
      for (const o of q.objectives) {
        if (!fresh.has(q.id) && left(q, o) === 0) continue;
        const p = place(q, o);
        if (!p) continue;
        const near = stops.find(
          (st) => st.spot.mapId === p.spot.mapId && distance(st.pos, p.pos) <= STOP_MERGE,
        );
        if (near) near.parts.push({ q, obj: o });
        else stops.push({ pos: p.pos, spot: p.spot, parts: [{ q, obj: o }] });
      }
    return stops;
  };

  // Route seconds for scoring, cached per (from, to, hearth readiness bucket of 5 min).
  const cache = new Map<string, number | null>();
  const travelSeconds = (from: MapSpot, to: MapSpot): number | null => {
    const h = s.hearth;
    const wait = h ? Math.max(0, h.readyAt - s.clock) : -1;
    const bucket = wait < 0 ? 'n' : wait === 0 ? 'r' : `w${Math.ceil(wait / 300)}`;
    const key = `${spotKey(from)}>${spotKey(to)}|${bucket}`;
    if (!cache.has(key))
      cache.set(key, route(from, to, traveller(), travel, s.clock)?.seconds ?? null);
    return cache.get(key)!;
  };

  /** Expected XP and seconds of a visit to `hub` from where the character is; null when it has no work or no route. */
  const estimate = (hub: Hub): Estimate | null => {
    const take = takeable(hub);
    const endsHere = logQuests().filter((q) => enderHub.get(q.id) === hub);
    if (!take.length && !endsHere.length) return null;
    const trip = travelSeconds(s.pos, hub.spot);
    if (trip === null) return null;
    const fresh = new Set(take.map((q) => q.id));
    const loop = loopQuests(hub, take);
    const stops = stopsOf(loop, fresh);
    const order = orderStops(hub.pos, stops, hub.pos);
    let seconds = pathLength(hub.pos, order, hub.pos) / speed;
    let xp = 0;
    for (const q of loop)
      for (const o of fresh.has(q.id) ? q.objectives : open(q)) {
        const n = fresh.has(q.id) ? need(o) : left(q, o);
        seconds += n * (o.secondsEach ?? DEFAULT_SECONDS[o.kind]);
        if (o.kind === 'kill' && !isGrey(q.level, s.level)) xp += n * mobXp(q.level);
      }
    // Quests finished by this visit: the loop's, fresh ones with nothing to do, and finished ones ending here.
    const done = new Set([
      ...loop,
      ...take.filter((q) => !q.objectives.length),
      ...endsHere.filter(finished),
    ]);
    for (const q of done) xp += questXp(q.xp, q.level, s.level);
    const classWork = [...take, ...endsHere].some(isMine);
    return { hub, seconds: trip + seconds, xp, classWork };
  };

  // Emitting steps.
  const push = (step: Omit<PlanStep, 'at' | 'level'>) => {
    steps.push({ ...step, at: s.clock, level: s.level });
    if (steps.length >= maxSteps || s.level >= opts.toLevel) throw HALT;
  };
  const showLeg = (l: Leg) =>
    l.how !== 'walk' ||
    distance(toWorld(l.from)!, toWorld(l.to)!) > FOLD_WALK ||
    (l.from.mapId !== l.to.mapId && !isContinentMap(l.from.mapId) && !isContinentMap(l.to.mapId));

  /** Travel to `spot`, one step per shown leg. False (and a gap line) when there is no route: the character skips it. */
  const goTo = (spot: MapSpot): boolean => {
    const from = toWorld(s.pos);
    const to = toWorld(spot);
    if (from && to && distance(from, to) < 1) return true;
    const r = route(s.pos, spot, traveller(), travel, s.clock);
    if (!r) {
      gap(
        `no route from ${zoneOf(s.pos) ?? `map ${s.pos.mapId}`} to ${zoneOf(spot) ?? `map ${spot.mapId}`}`,
      );
      return false;
    }
    for (const l of r.legs) {
      s.clock += l.seconds;
      if (l.how === 'hearth' && s.hearth) s.hearth.readyAt = s.clock + HEARTH_COOLDOWN;
      s.pos = l.to;
      if (showLeg(l)) {
        const step: Omit<PlanStep, 'at' | 'level'> = {
          action: 'travel',
          how: l.how,
          npc: null,
          zone: zoneOf(l.to),
          spot: l.to,
          quests: [],
        };
        if (l.note) step.note = l.note;
        push(step);
      }
    }
    s.pos = spot;
    return true;
  };

  const classNote = (qs: AtlasQuest[]) => (qs.some(isMine) ? { note: 'class quest' } : {});

  /** Visit the NPCs of `who(q)` nearest first, one step per NPC. */
  const atNpcs = (
    qs: AtlasQuest[],
    who: (q: AtlasQuest) => QuestPoint,
    act: (group: AtlasQuest[], npc: QuestPoint) => void,
  ) => {
    const groups = new Map<string, { npc: QuestPoint; pos: WorldPos; qs: AtlasQuest[] }>();
    for (const q of [...qs].sort(byId)) {
      const npc = who(q);
      const key = pointKey(npc);
      const g = groups.get(key);
      if (g) g.qs.push(q);
      else groups.set(key, { npc, pos: toWorld(npc.spots[0]!)!, qs: [q] });
    }
    const left = [...groups.values()];
    while (left.length) {
      const at = here();
      let best = 0;
      for (let i = 1; i < left.length; i++)
        if (distance(at, left[i]!.pos) < distance(at, left[best]!.pos)) best = i;
      const [g] = left.splice(best, 1);
      act(g!.qs, g!.npc);
    }
  };

  const accept = (qs: AtlasQuest[]) =>
    atNpcs(
      qs,
      (q) => q.giver!,
      (group, npc) => {
        if (!goTo(npc.spots[0]!)) return;
        for (const q of group)
          s.log.set(
            q.id,
            q.objectives.map(() => 0),
          );
        push({
          action: 'accept',
          npc: npc.name,
          zone: zoneOf(npc.spots[0]!),
          spot: npc.spots[0]!,
          quests: group.map((q) => ({ questId: q.id, title: q.title })),
          ...classNote(group),
        });
      },
    );

  const turnIn = (qs: AtlasQuest[]) =>
    atNpcs(
      qs,
      (q) => enderOf(q)!,
      (group, npc) => {
        if (!goTo(npc.spots[0]!)) return;
        for (const q of group) {
          const got = questXp(q.xp, q.level, s.level);
          const next = gain(s, got);
          s.gained += got;
          s.level = next.level;
          s.xp = next.xp;
          s.log.delete(q.id);
          s.completed.add(q.id);
        }
        push({
          action: 'turn_in',
          npc: npc.name,
          zone: zoneOf(npc.spots[0]!),
          spot: npc.spots[0]!,
          quests: group.map((q) => ({ questId: q.id, title: q.title })),
          ...classNote(group),
        });
      },
    );

  /** One objective loop from `hub` back towards it, nearest first then smoothed. */
  const runLoop = (hub: Hub, qs: AtlasQuest[]) => {
    // Start and end where the character stands (at the hub): a closed loop, so the nearest-first direction is kept.
    const stops = orderStops(here(), stopsOf(qs, new Set()), here());
    for (const st of stops) {
      const reached = goTo(st.spot);
      const parts = st.parts.filter((p) => left(p.q, p.obj) > 0);
      if (!parts.length) continue;
      const kills = parts.reduce((sum, p) => sum + killXp(p.q, p.obj, s.level), 0);
      if (reached) {
        s.clock += parts.reduce((sum, p) => sum + objSeconds(p.q, p.obj), 0);
        const next = gain(s, kills);
        s.gained += kills;
        s.level = next.level;
        s.xp = next.xp;
      }
      // Unreachable stops count as done (with the route gap line) so the quest can still be handed in.
      for (const p of parts) s.log.get(p.q.id)![p.obj.index] = need(p.obj);
      if (!reached) continue;
      const byQuest = new Map<AtlasQuest, string[]>();
      for (const p of parts) byQuest.set(p.q, [...(byQuest.get(p.q) ?? []), p.obj.text]);
      const done = [...byQuest.keys()];
      push({
        action: 'complete',
        npc: null,
        zone: zoneOf(st.spot),
        spot: st.spot,
        quests: done.map((q) => ({ questId: q.id, title: q.title, objectives: byQuest.get(q)! })),
        ...classNote(done),
      });
    }
  };

  /** Work `hub` until it has nothing left: turn in, accept, loop, repeat (follow-ups). True when anything happened. */
  const visit = (hub: Hub): boolean => {
    let progress = false;
    for (let round = 0; round < 100; round++) {
      let did = false;
      const done = logQuests().filter((q) => finished(q) && enderHub.get(q.id) === hub);
      if (done.length) {
        turnIn(done);
        did = true;
      }
      const take = takeable(hub);
      if (take.length) {
        accept(take);
        did = true;
      }
      const loop = loopQuests(hub, []);
      if (loop.length) {
        runLoop(hub, loop);
        did = true;
      }
      if (!did) break;
      progress = true;
    }
    return progress;
  };

  /** After a visit: remember the hub's quests that only the level keeps out; say when the hub will be revisited. */
  const leave = (hub: Hub) => {
    for (const id of hub.givers) {
      const q = quest(id);
      if (dropped.has(id) || isClassQuest(q) || canTake(q, taker(), s.level)) continue;
      const later = Math.max(q.reqLevel, q.level - MAX_LEVELS_UP, s.level);
      if (canTake(q, taker(), later)) gated.set(id, hub);
    }
    const back =
      [...gated.values()].includes(hub) || logQuests().some((q) => enderHub.get(q.id) === hub);
    if (back)
      gap(`set hearth near ${hub.name}: no innkeeper in the atlas yet (the plan comes back)`);
  };

  /** Level-gated pickups now takeable elsewhere: keep those whose trip pays the run's XP per minute, drop the rest. */
  const reviewGated = () => {
    const now = new Map<Hub, AtlasQuest[]>();
    for (const [id, hub] of [...gated].sort((a, b) => a[0] - b[0])) {
      const q = quest(id);
      if (!canTake(q, taker(), s.level)) continue;
      gated.delete(id);
      if (distance(here(), hub.pos) <= AT_HUB) continue;
      now.set(hub, [...(now.get(hub) ?? []), q]);
    }
    const rate = s.clock > 0 ? s.gained / s.clock : 0;
    for (const [hub, qs] of now) {
      const e = estimate(hub);
      const back = travelSeconds(hub.spot, s.pos);
      const pays = e !== null && back !== null && e.xp / Math.max(1, e.seconds + back) >= rate;
      if (pays) continue;
      for (const q of qs) {
        dropped.add(q.id);
        gap(`skipped ${q.title}: not worth the trip`);
      }
    }
  };

  try {
    for (let decision = 0; decision < maxSteps * 4 + 10; decision++) {
      reviewGated();
      const options = hubs
        .filter((h) => !stuck.has(h.id))
        .map(estimate)
        .filter((e): e is Estimate => e !== null);
      const mine = options.filter((e) => e.classWork);
      const pool = mine.length ? mine : options;
      if (!pool.length) break;
      // Best XP per second; ties by hub id (hubs are sorted by id, the sort is stable).
      const score = (e: Estimate) => e.xp / Math.max(1, e.seconds);
      const best = pool.reduce((a, b) => (score(b) > score(a) ? b : a));
      if (!visit(best.hub)) {
        stuck.add(best.hub.id);
        gap(`no progress at ${best.hub.name}: left out`);
        continue;
      }
      leave(best.hub);
    }
    gap(`no more quests to plan at level ${s.level} (target ${opts.toLevel})`);
  } catch (e) {
    if (e !== HALT) throw e;
    if (s.level < opts.toLevel) gap(`plan cut at maxSteps (${maxSteps} steps)`);
  }
  return { steps, gaps, seconds: s.clock, xp: s.gained };
}
