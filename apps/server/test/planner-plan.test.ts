// Planner loop (planner/plan.ts): hub batches, objective loops, class quests, level-gated pickups that pay, real travel.
import { describe, expect, it } from 'vitest';
import { distance, toWorld } from '../src/planner/geo.js';
import { plan } from '../src/planner/plan.js';
import { HEARTH_SECONDS, type TravelData } from '../src/planner/travel.js';
import { TRANSPORTS } from '../src/planner/transports.js';
import type { AtlasQuest, MapSpot, PlanStep } from '../src/planner/types.js';
import {
  NO_TRAVEL,
  atlas,
  character,
  collect,
  kill,
  npc,
  offset,
  quest,
} from './planner-fixtures.js';

// The Barrens (1413): room for spots thousands of yards apart on one map.
const BASE: MapSpot = { mapId: 1413, x: 50, y: 30 };
const yards = (a: MapSpot, b: MapSpot) => distance(toWorld(a)!, toWorld(b)!);

const ids = (s: PlanStep) => s.quests.map((q) => q.questId);
const work = (steps: PlanStep[]) => steps.filter((s) => s.action !== 'travel');
const brief = (steps: PlanStep[]) => work(steps).map((s) => `${s.action}:${ids(s).join(',')}`);
const indexOf = (steps: PlanStep[], action: PlanStep['action'], id: number) =>
  steps.findIndex((s) => s.action === action && ids(s).includes(id));

describe('planner loop', () => {
  it('has the test spots where the test thinks they are', () => {
    expect(yards(BASE, offset(BASE, 300))).toBeCloseTo(300, 3);
    expect(yards(BASE, offset(BASE, -4000))).toBeCloseTo(4000, 3);
    expect(offset(BASE, -4000).y).toBeLessThan(100);
  });

  it('batches a hub of 3: accept per NPC, one objective loop nearest first, turn in per NPC', () => {
    const A = npc(1, 'Gruk', BASE);
    const B = npc(2, 'Mok', offset(BASE, 0, 30));
    const qs = [
      quest(1, { giver: A, ender: A, objectives: [kill([offset(BASE, 300, 0)])] }),
      quest(2, { giver: A, ender: A, objectives: [collect([offset(BASE, 320, 40)])] }),
      quest(3, { giver: B, ender: B, objectives: [kill([offset(BASE, 280, -40)])] }),
    ];
    const r = plan(atlas(qs), character(), NO_TRAVEL, { toLevel: 30 });
    expect(brief(r.steps)).toEqual([
      'accept:1,2',
      'accept:3',
      'complete:3',
      'complete:1',
      'complete:2',
      expect.stringMatching(/^turn_in:/),
      expect.stringMatching(/^turn_in:/),
    ]);
    const turnIns = work(r.steps).slice(-2);
    expect(turnIns.map((s) => s.npc).sort()).toEqual(['Gruk', 'Mok']);
    expect(turnIns.flatMap(ids).sort()).toEqual([1, 2, 3]);
    // Exactly one trip out (300 yd) and one back; the short hops between objectives fold into the next step.
    const travel = r.steps.filter((s) => s.action === 'travel');
    expect(travel.map((s) => s.how)).toEqual(['walk', 'walk']);
    expect(indexOf(r.steps, 'complete', 3)).toBe(r.steps.indexOf(travel[0]!) + 1);
    // Every step is timed and levelled; the clock never goes back.
    for (let i = 1; i < r.steps.length; i++)
      expect(r.steps[i]!.at).toBeGreaterThanOrEqual(r.steps[i - 1]!.at);
    expect(r.steps.every((s) => s.level >= 5)).toBe(true);
    expect(r.xp).toBeGreaterThanOrEqual(900);
    expect(r.seconds).toBe(r.steps[r.steps.length - 1]!.at);
  });

  it('does a chain in one visit: A done and turned in, then B accepted', () => {
    const A = npc(1, 'Gruk', BASE);
    const qs = [
      quest(10, { giver: A, ender: A, objectives: [kill([offset(BASE, 100)])] }),
      quest(11, { giver: A, ender: A, prereqs: [10], objectives: [kill([offset(BASE, 100)])] }),
    ];
    const r = plan(atlas(qs), character(), NO_TRAVEL, { toLevel: 30 });
    expect(brief(r.steps)).toEqual([
      'accept:10',
      'complete:10',
      'turn_in:10',
      'accept:11',
      'complete:11',
      'turn_in:11',
    ]);
    expect(r.steps.filter((s) => s.action === 'travel')).toEqual([]);
  });

  it('finishes hub 1 before moving and turns in at hub 2 on arrival', () => {
    const A = npc(1, 'Gruk', BASE);
    const H2 = offset(BASE, -1500);
    const C = npc(3, 'Far Orc', H2);
    const qs = [
      quest(20, { giver: A, ender: A, objectives: [kill([offset(BASE, 200)])] }),
      quest(21, { giver: A, ender: C, objectives: [collect([offset(BASE, 250, 20)])] }),
      quest(22, { giver: C, ender: C, objectives: [kill([offset(H2, -200)])] }),
    ];
    const r = plan(atlas(qs), character(), NO_TRAVEL, { toLevel: 30 });
    expect(brief(r.steps)).toEqual([
      'accept:20,21',
      expect.stringMatching(/^complete:/),
      expect.stringMatching(/^complete:/),
      'turn_in:20',
      'turn_in:21',
      'accept:22',
      'complete:22',
      'turn_in:22',
    ]);
    const lastAtA = Math.max(...r.steps.flatMap((s, i) => (s.npc === 'Gruk' ? [i] : [])));
    const firstAtC = r.steps.findIndex((s) => s.npc === 'Far Orc');
    expect(lastAtA).toBeLessThan(firstAtC);
    expect(r.steps.slice(lastAtA + 1, firstAtC).some((s) => s.action === 'travel')).toBe(true);
  });

  describe('level-gated pickups', () => {
    const A = npc(1, 'Gruk', BASE);
    const setup = (south: number, gatedXp: number): AtlasQuest[] => {
      const H2 = offset(BASE, -south);
      const C = npc(3, 'Far Orc', H2);
      return [
        quest(30, {
          level: 2,
          xp: 500,
          giver: A,
          ender: A,
          objectives: [collect([offset(BASE, 50)], 1)],
        }),
        quest(31, {
          level: 3,
          reqLevel: 3,
          xp: gatedXp,
          giver: A,
          ender: A,
          objectives: [collect([offset(BASE, 50)], 1)],
        }),
        quest(32, {
          level: 2,
          xp: 1000,
          giver: C,
          ender: C,
          objectives: [collect([offset(H2, -50)], 1)],
        }),
      ];
    };
    const lvl2 = character({ level: 2 });

    it('goes back for a level-gated quest when the trip pays', () => {
      const r = plan(atlas(setup(700, 3000)), lvl2, NO_TRAVEL, { toLevel: 30 });
      expect(brief(r.steps)).toEqual([
        'accept:30',
        'complete:30',
        'turn_in:30',
        'accept:32',
        'complete:32',
        'turn_in:32',
        'accept:31',
        'complete:31',
        'turn_in:31',
      ]);
      expect(r.gaps.join('\n')).not.toMatch(/Quest 31/);
    });

    it('drops it with a gap line when the trip does not pay', () => {
      const r = plan(atlas(setup(4000, 50)), lvl2, NO_TRAVEL, { toLevel: 30 });
      expect(indexOf(r.steps, 'accept', 31)).toBe(-1);
      expect(indexOf(r.steps, 'turn_in', 32)).toBeGreaterThan(0);
      expect(r.gaps).toContain('skipped Quest 31: not worth the trip');
    });
  });

  it('crosses the sea for a class quest of the character class only', () => {
    const BRILL: MapSpot = { mapId: 1420, x: 61, y: 52 };
    const TRAINER = npc(9, 'Warlock Trainer', { mapId: 1411, x: 52, y: 40 });
    const LOCAL = npc(8, 'Brill Guard', BRILL);
    const qs = [
      quest(40, {
        level: 10,
        reqLevel: 10,
        classes: ['WARLOCK'],
        giver: TRAINER,
        ender: TRAINER,
      }),
      quest(41, {
        level: 10,
        giver: LOCAL,
        ender: LOCAL,
        objectives: [kill([offset(BRILL, 100)])],
      }),
    ];
    const travel: TravelData = {
      flightNodes: [],
      transports: TRANSPORTS.filter((t) => t.name === 'Tirisfal Glades ↔ Durotar'),
    };
    const base = { level: 10, race: 'Scourge', position: BRILL };
    const lock = plan(atlas(qs), character({ ...base, className: 'WARLOCK' }), travel, {
      toLevel: 30,
    });
    // Taken in the next decision, ahead of the quest next door.
    expect(indexOf(lock.steps, 'accept', 40)).toBeLessThan(indexOf(lock.steps, 'accept', 41));
    expect(lock.steps.some((s) => s.action === 'travel' && s.how === 'boat')).toBe(true);
    const classSteps = lock.steps.filter((s) => s.action !== 'travel' && ids(s).includes(40));
    expect(classSteps.map((s) => s.action)).toEqual(['accept', 'turn_in']);
    expect(classSteps.every((s) => s.note === 'class quest')).toBe(true);
    expect(lock.steps.find((s) => ids(s).includes(41))!.note).toBeUndefined();

    const warrior = plan(atlas(qs), character({ ...base, className: 'WARRIOR' }), travel, {
      toLevel: 30,
    });
    expect(warrior.steps.some((s) => ids(s).includes(40))).toBe(false);
    expect(warrior.steps.some((s) => s.how === 'boat')).toBe(false);
    expect(indexOf(warrior.steps, 'turn_in', 41)).toBeGreaterThan(0);
  });

  it('flies between two hubs 5,000 yd apart with learned flight nodes next to both', () => {
    const H1: MapSpot = { mapId: 1413, x: 50, y: 20 };
    const H2 = offset(H1, -5000);
    const qs = [
      quest(50, { giver: npc(1, 'Gruk', H1), ender: npc(1, 'Gruk', H1) }),
      quest(51, { giver: npc(2, 'Far Orc', H2), ender: npc(2, 'Far Orc', H2) }),
    ];
    const travel: TravelData = {
      flightNodes: [
        { id: 1, name: 'North Post', faction: 'Horde', spot: offset(H1, 0, 20) },
        { id: 2, name: 'South Post', faction: 'Horde', spot: offset(H2, 0, 20) },
      ],
      transports: [],
    };
    const r = plan(atlas(qs), character({ position: H1, flightPaths: new Set([1, 2]) }), travel, {
      toLevel: 30,
    });
    expect(brief(r.steps)).toEqual(['accept:50', 'turn_in:50', 'accept:51', 'turn_in:51']);
    const fly = r.steps.find((s) => s.how === 'fly');
    expect(fly).toBeDefined();
    expect(fly!.note).toBe('North Post → South Post');
    // Well under the 714 s walk.
    expect(r.seconds).toBeLessThan(5000 / 7 / 2);
  });

  describe('hearthstone', () => {
    const HEARTH = offset(BASE, 0, 10);
    const H2 = offset(BASE, -3000);
    const A = npc(1, 'Gruk', BASE);
    const C = npc(3, 'Far Orc', H2);
    const qs = [quest(60, { giver: A, ender: C }), quest(61, { giver: C, ender: A })];
    const hearthSteps = (readyAt: number) =>
      plan(atlas(qs), character({ hearth: { spot: HEARTH, readyAt } }), NO_TRAVEL, {
        toLevel: 30,
      }).steps.filter((s) => s.how === 'hearth');

    it('uses no hearth leg within the first hour when it is on cooldown', () => {
      for (const s of hearthSteps(3600)) expect(s.at - HEARTH_SECONDS).toBeGreaterThanOrEqual(3600);
    });

    it('hearths back when it is ready', () => {
      expect(hearthSteps(0)).toHaveLength(1);
    });
  });

  describe('limits', () => {
    const A = npc(1, 'Gruk', BASE);
    const five = [70, 71, 72, 73, 74].map((id) =>
      quest(id, {
        level: 2,
        xp: 400,
        giver: A,
        ender: A,
        objectives: [collect([offset(BASE, 50)], 1)],
      }),
    );
    const chain = [80, 81, 82, 83, 84, 85].map((id, i) =>
      quest(id, {
        level: 1,
        xp: 50,
        giver: A,
        ender: A,
        prereqs: i ? [id - 1] : [],
        objectives: [collect([offset(BASE, 50)], 1)],
      }),
    );

    it('stops at toLevel', () => {
      const r = plan(atlas([...five, ...chain]), character({ level: 1 }), NO_TRAVEL, {
        toLevel: 2,
      });
      const last = r.steps[r.steps.length - 1]!;
      expect(last.action).toBe('turn_in');
      expect(last.level).toBeGreaterThanOrEqual(2);
      expect(r.steps.slice(0, -1).every((s) => s.level < 2)).toBe(true);
    });

    it('respects maxSteps', () => {
      const r = plan(atlas(chain), character({ level: 1 }), NO_TRAVEL, {
        toLevel: 30,
        maxSteps: 4,
      });
      expect(r.steps).toHaveLength(4);
      expect(r.gaps.some((g) => g.includes('maxSteps'))).toBe(true);
    });

    it('plans nothing from an empty atlas, with a gap line', () => {
      const r = plan(atlas([]), character(), NO_TRAVEL, { toLevel: 10 });
      expect(r.steps).toEqual([]);
      expect(r.gaps.length).toBeGreaterThan(0);
      expect(r.seconds).toBe(0);
      expect(r.xp).toBe(0);
    });
  });

  it('notes quests without objective spots and does them near the giver', () => {
    const A = npc(1, 'Gruk', BASE);
    const r = plan(
      atlas([quest(90, { giver: A, ender: A, objectives: [kill([], 3)] })]),
      character(),
      NO_TRAVEL,
      { toLevel: 30 },
    );
    expect(brief(r.steps)).toEqual(['accept:90', 'complete:90', 'turn_in:90']);
    expect(r.gaps).toContain('no objective spots for Quest 90: done near the giver');
  });

  it('is deterministic and fast on a large atlas', () => {
    const big = synthetic(1500);
    const ch = character({ level: 1, position: { mapId: 1413, x: 10, y: 10 } });
    const t0 = performance.now();
    const a = plan(big, ch, NO_TRAVEL, { toLevel: 30 });
    const ms = performance.now() - t0;
    const b = plan(big, ch, NO_TRAVEL, { toLevel: 30 });
    expect(a).toEqual(b);
    expect(a.steps.length).toBeGreaterThan(100);
    expect(a.steps.length).toBeLessThanOrEqual(300);
    expect(ms).toBeLessThan(3000);
  });
});

/** `n` quests in hubs of 10 on a grid over The Barrens, levels rising across the grid, chains of 3. */
function synthetic(n: number) {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const qs: AtlasQuest[] = [];
  const hubs = Math.ceil(n / 10);
  for (let h = 0; h < hubs; h++) {
    const spot: MapSpot = { mapId: 1413, x: 5 + (h % 15) * 6, y: 5 + Math.floor(h / 15) * 9 };
    const giver = npc(h + 1, `Npc ${h + 1}`, spot);
    const level = 1 + Math.floor((h / hubs) * 30);
    for (let k = 0; k < 10 && qs.length < n; k++) {
      const id = 1000 + h * 10 + k;
      qs.push(
        quest(id, {
          level,
          reqLevel: Math.max(1, level - 2),
          xp: 100 + level * 60,
          giver,
          ender: giver,
          prereqs: k % 3 ? [id - 1] : [],
          objectives: [
            kill([offset(spot, 150 + rnd() * 350, (rnd() - 0.5) * 600)], 1 + Math.floor(rnd() * 8)),
          ],
        }),
      );
    }
  }
  return atlas(qs);
}
