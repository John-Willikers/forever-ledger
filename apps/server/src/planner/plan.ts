// The planner loop: one character's leveling plan from a quest atlas. Simulates the character (clock, position, level,
// XP, quest log, hearthstone; plan-sim.ts) and repeatedly picks the hub that pays the most XP per minute, travel
// included (plan-estimate.ts): turn in what ends there, accept everything takeable, run one objective loop through
// every log quest done nearby (nearest first, smoothed), turn in, accept follow-ups, and stay while the hub has work
// (steps: plan-emit.ts). Class quests for the character's class go first wherever they are; level-gated pickups left
// behind are fetched only when the trip pays the run's XP per minute so far, else dropped with a gap line
// (plan-gated.ts). Deterministic (ties by hub id / quest id) and pure.
import type { Hub } from './hubs.js';
import { accept, HALT, runLoop, turnIn } from './plan-emit.js';
import { estimate, type Estimate } from './plan-estimate.js';
import { leave, reviewGated } from './plan-gated.js';
import { Sim, type PlanOptions } from './plan-sim.js';
import type { Atlas, CharacterState, PlanStep } from './types.js';
import type { TravelData } from './travel.js';

export {
  DEFAULT_SECONDS,
  FOLD_WALK,
  LOOP_RADIUS,
  MAX_STEPS,
  type PlanOptions,
} from './plan-sim.js';

export interface PlanResult {
  steps: PlanStep[];
  /** What the plan could not do or know, in plain words. */
  gaps: string[];
  /** Planned clock at the end (seconds) and XP gained on the way. */
  seconds: number;
  xp: number;
}

/** Work `hub` until it has nothing left: turn in, accept, loop, repeat (follow-ups). True when anything happened. */
function visit(sim: Sim, hub: Hub): boolean {
  let progress = false;
  for (let round = 0; round < 100; round++) {
    let did = false;
    const done = sim.logQuests().filter((q) => sim.finished(q) && sim.enderHub.get(q.id) === hub);
    if (done.length) {
      turnIn(sim, done);
      did = true;
    }
    const take = sim.takeable(hub);
    if (take.length) {
      accept(sim, take);
      did = true;
    }
    const loop = sim.loopQuests(hub, []);
    if (loop.length) {
      runLoop(sim, loop);
      did = true;
    }
    if (!did) break;
    progress = true;
  }
  return progress;
}

export function plan(
  atlas: Atlas,
  ch: CharacterState,
  travel: TravelData,
  opts: PlanOptions,
): PlanResult {
  const sim = new Sim(atlas, ch, travel, opts);
  const result = (): PlanResult => ({
    steps: sim.steps,
    gaps: sim.gaps,
    seconds: sim.clock,
    xp: sim.gained,
  });
  if (sim.level >= sim.toLevel) return result();

  try {
    for (let decision = 0; decision < sim.maxSteps * 4 + 10; decision++) {
      reviewGated(sim);
      const options = sim.hubs
        .filter((h) => !sim.stuck.has(h.id))
        .map((h) => estimate(sim, h))
        .filter((e): e is Estimate => e !== null);
      const mine = options.filter((e) => e.classWork);
      const pool = mine.length ? mine : options;
      if (!pool.length) break;
      // Best XP per second; ties by hub id (hubs are sorted by id, the sort is stable).
      const score = (e: Estimate) => e.xp / Math.max(1, e.seconds);
      const best = pool.reduce((a, b) => (score(b) > score(a) ? b : a));
      if (!visit(sim, best.hub)) {
        sim.stuck.add(best.hub.id);
        sim.gap(`no progress at ${best.hub.name}: left out`);
        continue;
      }
      leave(sim, best.hub);
    }
    sim.gap(`no more quests to plan at level ${sim.level} (target ${sim.toLevel})`);
  } catch (e) {
    if (e !== HALT) throw e;
    if (sim.level < sim.toLevel) sim.gap(`plan cut at maxSteps (${sim.maxSteps} steps)`);
  }
  return result();
}
