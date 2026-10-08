// The planner loop's level-gated pickups (plan.ts): quests a hub had that only the character's level kept out are
// remembered when it leaves; once the level allows them and the character is elsewhere, a trip back is kept only if
// it pays the run's XP per minute so far, else they are dropped with a gap line. Pure.
import { canTake, isClassQuest, MAX_LEVELS_UP } from './available.js';
import { distance } from './geo.js';
import type { Hub } from './hubs.js';
import { estimate } from './plan-estimate.js';
import { AT_HUB, type Sim } from './plan-sim.js';
import type { AtlasQuest } from './types.js';

/** After a visit: remember the hub's quests that only the level keeps out; say when the hub will be revisited. */
export function leave(sim: Sim, hub: Hub): void {
  for (const id of hub.givers) {
    const q = sim.quest(id);
    if (sim.dropped.has(id) || isClassQuest(q) || canTake(q, sim.taker(), sim.level)) continue;
    const later = Math.max(q.reqLevel, q.level - MAX_LEVELS_UP, sim.level);
    if (canTake(q, sim.taker(), later)) sim.gated.set(id, hub);
  }
  const back =
    [...sim.gated.values()].includes(hub) ||
    sim.logQuests().some((q) => sim.enderHub.get(q.id) === hub);
  if (back)
    sim.gap(`set hearth near ${hub.name}: no innkeeper in the atlas yet (the plan comes back)`);
}

/** Level-gated pickups now takeable elsewhere: keep those whose trip pays the run's XP per minute, drop the rest. */
export function reviewGated(sim: Sim): void {
  const now = new Map<Hub, AtlasQuest[]>();
  for (const [id, hub] of [...sim.gated].sort((a, b) => a[0] - b[0])) {
    const q = sim.quest(id);
    if (!canTake(q, sim.taker(), sim.level)) continue;
    sim.gated.delete(id);
    if (distance(sim.here(), hub.pos) <= AT_HUB) continue;
    now.set(hub, [...(now.get(hub) ?? []), q]);
  }
  const rate = sim.clock > 0 ? sim.gained / sim.clock : 0;
  for (const [hub, qs] of now) {
    const e = estimate(sim, hub);
    const back = sim.travelSeconds(hub.spot, sim.pos);
    const pays = e !== null && back !== null && e.xp / Math.max(1, e.seconds + back) >= rate;
    if (pays) continue;
    for (const q of qs) {
      sim.dropped.add(q.id);
      sim.gap(`skipped ${q.title}: not worth the trip`);
    }
  }
}
