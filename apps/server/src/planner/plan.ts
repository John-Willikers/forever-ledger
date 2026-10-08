// The planner loop: one character's leveling plan from a quest atlas. Simulates the character (clock, position, level,
// XP, quest log, hearthstone; plan-sim.ts) and repeatedly picks the hub that pays the most XP per minute, travel
// included (plan-estimate.ts): turn in what ends there, accept everything takeable, run one objective loop through
// every log quest done nearby (nearest first, smoothed), turn in, accept follow-ups, and stay while the hub has work
// (steps: plan-emit.ts). Class quests for the character's class go first wherever they are; level-gated pickups left
// behind earn a trip back only when it pays the run's XP per minute so far (then they compete in normal scoring),
// else they are taken only if the plan is at their hub anyway (plan-gated.ts). Unreachable objectives or turn-ins are
// never counted done: such quests are not taken, or abandoned. Deterministic (ties by hub id / quest id) and pure.
import { toWorld } from './geo.js';
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

/** Up to five examples, then how many more. */
function examples(names: string[]): string {
  const more = names.length - 5;
  return names.slice(0, 5).join(', ') + (more > 0 ? `, +${more} more` : '');
}
const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const titles = (sim: Sim, ids: Iterable<number>) =>
  [...ids].sort((a, b) => a - b).map((id) => sim.quest(id).title);

/** One grouped line per kind of shortcoming, the quests still in the log included. */
function closingGaps(sim: Sim): void {
  const spotless = titles(sim, sim.noSpots);
  if (spotless.length)
    sim.gap(
      `no objective spots for ${count(spotless.length, 'quest')}, done near the giver: ${examples(spotless)}`,
    );
  const poor = titles(
    sim,
    [...sim.taken].filter((id) => sim.dataPoor(sim.quest(id))),
  );
  if (poor.length)
    sim.gap(
      `estimates are optimistic for ${count(poor.length, 'quest')} with missing objective data: ${examples(poor)}`,
    );
  const binds = [...sim.hearthHubs].map((h) => h.name);
  if (binds.length)
    sim.gap(
      `set hearth: no innkeeper in the atlas yet; the plan comes back to ${count(binds.length, 'hub')}: ${examples(binds)}`,
    );
  for (const id of [...sim.noTrip].sort((a, b) => a - b))
    if (!sim.completed.has(id) && !sim.log.has(id))
      sim.gap(`skipped ${sim.quest(id).title}: not worth the trip`);
  const open = titles(sim, sim.log.keys());
  if (open.length)
    sim.gap(`left in the log at the end: ${count(open.length, 'quest')} (${examples(open)})`);
}

/** Work `hub` until it has nothing left: turn in, accept, loop, repeat (follow-ups). True when anything happened. */
function visit(sim: Sim, hub: Hub): boolean {
  let progress = false;
  for (let round = 0; round < 100; round++) {
    const before = sim.logState();
    const done = sim.logQuests().filter((q) => sim.finished(q) && sim.enderHub.get(q.id) === hub);
    if (done.length) {
      turnIn(sim, done);
    }
    const take = sim.takeable(hub);
    if (take.length) {
      accept(sim, take);
    }
    const loop = sim.loopQuests(hub, []);
    if (loop.length) {
      runLoop(sim, loop);
    }
    // Only a changed log counts as work: an unreachable NPC must not keep the round going.
    if (sim.logState() === before) break;
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
  if (sim.level >= sim.toLevel) {
    sim.gap(`already at level ${sim.level} (target ${sim.toLevel})`);
    return result();
  }
  // No travel is planned from nowhere (the Sim already said where the start is).
  if (!toWorld(ch.position)) return result();

  const cap = sim.maxSteps * 4 + 10;
  try {
    let decision = 0;
    for (; decision < cap; decision++) {
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
    if (decision >= cap) sim.gap(`plan stopped after ${cap} hub choices (decision cap)`);
    else sim.gap(`no more quests to plan at level ${sim.level} (target ${sim.toLevel})`);
  } catch (e) {
    if (e !== HALT) throw e;
    if (sim.level < sim.toLevel) sim.gap(`plan cut at maxSteps (${sim.maxSteps} steps)`);
  }
  closingGaps(sim);
  return result();
}
