// The planner loop's steps (plan.ts): travel legs, accepts and turn-ins per NPC, objective loops. Each moves the
// simulation (clock, position, XP, log) and writes its step; `push` throws HALT when the plan is full or the level is
// reached, which plan.ts catches.
import { distance, mapInfo, toWorld } from './geo.js';
import { byId, FOLD_WALK, pointKey, zoneOf, type Sim } from './plan-sim.js';
import { orderStops } from './tour.js';
import { HEARTH_COOLDOWN, route, type Leg } from './travel.js';
import type { AtlasQuest, MapSpot, PlanStep, QuestPoint, WorldPos } from './types.js';
import { questXp } from './xp.js';

export const HALT = Symbol('halt');

const isContinentMap = (id: number) => mapInfo(id)?.parent === 947;

export function push(sim: Sim, step: Omit<PlanStep, 'at' | 'level'>): void {
  sim.steps.push({ ...step, at: sim.clock, level: sim.level });
  if (sim.steps.length >= sim.maxSteps || sim.level >= sim.toLevel) throw HALT;
}

const showLeg = (l: Leg) =>
  l.how !== 'walk' ||
  distance(toWorld(l.from)!, toWorld(l.to)!) > FOLD_WALK ||
  (l.from.mapId !== l.to.mapId && !isContinentMap(l.from.mapId) && !isContinentMap(l.to.mapId));

/** Travel to `spot`, one step per shown leg. False (and a gap line) when there is no route: the character skips it. */
export function goTo(sim: Sim, spot: MapSpot): boolean {
  const from = toWorld(sim.pos);
  const to = toWorld(spot);
  if (from && to && distance(from, to) < 1) return true;
  const r = route(sim.pos, spot, sim.traveller(), sim.travel, sim.clock);
  if (!r) {
    sim.gap(
      `no route from ${zoneOf(sim.pos) ?? `map ${sim.pos.mapId}`} to ${zoneOf(spot) ?? `map ${spot.mapId}`}`,
    );
    return false;
  }
  for (const l of r.legs) {
    sim.clock += l.seconds;
    if (l.how === 'hearth' && sim.hearth) sim.hearth.readyAt = sim.clock + HEARTH_COOLDOWN;
    sim.pos = l.to;
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
      push(sim, step);
    }
  }
  sim.pos = spot;
  return true;
}

const classNote = (sim: Sim, qs: AtlasQuest[]) =>
  qs.some((q) => sim.isMine(q)) ? { note: 'class quest' } : {};

/** Visit the NPCs of `who(q)` nearest first, one call of `act` per NPC. */
function atNpcs(
  sim: Sim,
  qs: AtlasQuest[],
  who: (q: AtlasQuest) => QuestPoint,
  act: (group: AtlasQuest[], npc: QuestPoint) => void,
): void {
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
    const at = sim.here();
    let best = 0;
    for (let i = 1; i < left.length; i++)
      if (distance(at, left[i]!.pos) < distance(at, left[best]!.pos)) best = i;
    const [g] = left.splice(best, 1);
    act(g!.qs, g!.npc);
  }
}

export function accept(sim: Sim, qs: AtlasQuest[]): void {
  atNpcs(
    sim,
    qs,
    (q) => q.giver!,
    (group, npc) => {
      if (!goTo(sim, npc.spots[0]!)) return;
      for (const q of group)
        sim.log.set(
          q.id,
          q.objectives.map(() => 0),
        );
      push(sim, {
        action: 'accept',
        npc: npc.name,
        zone: zoneOf(npc.spots[0]!),
        spot: npc.spots[0]!,
        quests: group.map((q) => ({ questId: q.id, title: q.title })),
        ...classNote(sim, group),
      });
    },
  );
}

export function turnIn(sim: Sim, qs: AtlasQuest[]): void {
  atNpcs(
    sim,
    qs,
    (q) => sim.enderOf(q)!,
    (group, npc) => {
      if (!goTo(sim, npc.spots[0]!)) return;
      for (const q of group) {
        sim.addXp(questXp(q.xp, q.level, sim.level));
        sim.log.delete(q.id);
        sim.completed.add(q.id);
      }
      push(sim, {
        action: 'turn_in',
        npc: npc.name,
        zone: zoneOf(npc.spots[0]!),
        spot: npc.spots[0]!,
        quests: group.map((q) => ({ questId: q.id, title: q.title })),
        ...classNote(sim, group),
      });
    },
  );
}

/** One objective loop through the stops of `qs`, nearest first then smoothed. */
export function runLoop(sim: Sim, qs: AtlasQuest[]): void {
  // Start and end where the character stands (at the hub): a closed loop, so the nearest-first direction is kept.
  const stops = orderStops(sim.here(), sim.stopsOf(qs, new Set()), sim.here());
  for (const st of stops) {
    const reached = goTo(sim, st.spot);
    const parts = st.parts.filter((p) => sim.left(p.q, p.obj) > 0);
    if (!parts.length) continue;
    const kills = parts.reduce((sum, p) => sum + sim.killXp(p.q, p.obj), 0);
    if (reached) {
      sim.clock += parts.reduce((sum, p) => sum + sim.objSeconds(p.q, p.obj), 0);
      sim.addXp(kills);
    }
    // Unreachable stops count as done (with the route gap line) so the quest can still be handed in.
    for (const p of parts) sim.log.get(p.q.id)![p.obj.index] = sim.need(p.obj);
    if (!reached) continue;
    const byQuest = new Map<AtlasQuest, string[]>();
    for (const p of parts) byQuest.set(p.q, [...(byQuest.get(p.q) ?? []), p.obj.text]);
    const done = [...byQuest.keys()];
    push(sim, {
      action: 'complete',
      npc: null,
      zone: zoneOf(st.spot),
      spot: st.spot,
      quests: done.map((q) => ({ questId: q.id, title: q.title, objectives: byQuest.get(q)! })),
      ...classNote(sim, done),
    });
  }
}
