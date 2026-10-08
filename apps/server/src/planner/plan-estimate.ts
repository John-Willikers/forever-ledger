// The planner loop's hub score (plan.ts): expected XP and seconds of a visit to a hub from where the character stands
// — the trip, accepting everything takeable, one objective loop and the turn-ins. Pure.
import type { Hub } from './hubs.js';
import { DEFAULT_SECONDS, type Sim } from './plan-sim.js';
import { orderStops, pathLength } from './tour.js';
import { isGrey, mobXp, questXp } from './xp.js';

export interface Estimate {
  hub: Hub;
  seconds: number;
  xp: number;
  /** The hub has a class quest of the character's class to take or hand in: it goes first. */
  classWork: boolean;
}

/** Null when the hub has no work or no route. */
export function estimate(sim: Sim, hub: Hub): Estimate | null {
  const take = sim.takeable(hub);
  const endsHere = sim.logQuests().filter((q) => sim.enderHub.get(q.id) === hub);
  if (!take.length && !endsHere.length) return null;
  const trip = sim.travelSeconds(sim.pos, hub.spot);
  if (trip === null) return null;
  const fresh = new Set(take.map((q) => q.id));
  const loop = sim.loopQuests(hub, take);
  const stops = sim.stopsOf(loop, fresh);
  const order = orderStops(hub.pos, stops, hub.pos);
  let seconds = pathLength(hub.pos, order, hub.pos) / sim.speed;
  let xp = 0;
  for (const q of loop)
    for (const o of fresh.has(q.id) ? q.objectives : sim.open(q)) {
      const n = fresh.has(q.id) ? sim.need(o) : sim.left(q, o);
      seconds += n * (o.secondsEach ?? DEFAULT_SECONDS[o.kind]);
      if (o.kind === 'kill' && !isGrey(q.level, sim.level)) xp += n * mobXp(q.level);
    }
  // Quests finished by this visit: the loop's, fresh ones with nothing to do, and finished ones ending here.
  const done = new Set([
    ...loop,
    ...take.filter((q) => !q.objectives.length),
    ...endsHere.filter((q) => sim.finished(q)),
  ]);
  for (const q of done) xp += questXp(q.xp, q.level, sim.level);
  const classWork = [...take, ...endsHere].some((q) => sim.isMine(q));
  return { hub, seconds: trip + seconds, xp, classWork };
}
