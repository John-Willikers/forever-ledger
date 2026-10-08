// The planner loop's hub score (plan.ts): expected XP and seconds of a visit to a hub from where the character stands
// — the trip, accepting everything takeable, one objective loop and the turn-ins. Pure.
import type { Hub } from './hubs.js';
import type { AtlasQuest } from './types.js';
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
  const take = sim.takeable(hub, true);
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
  // Unreachable log quests are abandoned on the way: they earn nothing.
  const doable = loop.filter((q) => sim.reachable(q));
  for (const q of doable)
    for (const o of fresh.has(q.id) ? q.objectives : sim.open(q)) {
      const n = fresh.has(q.id) ? sim.need(o) : sim.left(q, o);
      seconds += n * (o.secondsEach ?? DEFAULT_SECONDS[o.kind]);
      if (o.kind === 'kill' && !isGrey(q.level, sim.level)) xp += n * mobXp(q.level);
    }
  // Quests this visit finishes: the loop's, fresh ones with nothing to do, finished ones ending here. Those ending at
  // another hub pay only with the trip there (once per hub) added, unless that hub has work of its own.
  const done = new Set([
    ...doable,
    ...take.filter((q) => !q.objectives.length),
    ...endsHere.filter((q) => sim.finished(q) && sim.reachable(q)),
  ]);
  const onward = new Map<Hub, number | null>();
  for (const q of done) {
    const end = sim.enderHub.get(q.id);
    if (!end) continue;
    if (end !== hub) {
      // A hub with work of its own gets visited anyway: no extra trip.
      if (!onward.has(end))
        onward.set(end, hasOwnWork(sim, end, done) ? 0 : sim.travelSeconds(hub.spot, end.spot));
      const t = onward.get(end)!;
      if (t === null) continue;
    }
    xp += questXp(q.xp, q.level, sim.level);
  }
  for (const t of onward.values()) seconds += t ?? 0;
  const classWork = [...take, ...endsHere].some((q) => sim.isMine(q));
  return { hub, seconds: trip + seconds, xp, classWork };
}

/** `hub` has quests to take or log quests (besides `besides`) to hand in. */
function hasOwnWork(sim: Sim, hub: Hub, besides: Set<AtlasQuest>): boolean {
  return (
    sim.takeable(hub, true).length > 0 ||
    sim.logQuests().some((q) => !besides.has(q) && sim.enderHub.get(q.id) === hub)
  );
}
