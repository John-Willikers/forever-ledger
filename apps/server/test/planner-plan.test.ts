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

  it('says Travel Form on a druid’s travel steps and gets there 40 % faster', () => {
    const A = npc(1, 'Gruk', BASE);
    const H2 = offset(BASE, -1500);
    const C = npc(3, 'Far Orc', H2);
    const qs = [
      quest(23, { level: 30, giver: A, ender: C, objectives: [collect([offset(BASE, 50)], 1)] }),
    ];
    const run = (over: Parameters<typeof character>[0]) =>
      plan(atlas(qs), character({ level: 30, ...over }), NO_TRAVEL, { toLevel: 40 });
    const walks = (steps: PlanStep[]) =>
      steps.filter((s) => s.action === 'travel' && s.how === 'walk');
    const druid = run({ className: 'DRUID' });
    expect(walks(druid.steps).length).toBeGreaterThan(0);
    for (const s of walks(druid.steps)) expect(s.note).toBe('Travel Form');
    const warrior = run({});
    for (const s of walks(warrior.steps)) expect(s.note).toBeUndefined();
    expect(druid.seconds).toBeLessThan(warrior.seconds);
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

    it('still takes a quest not worth the trip when the plan is at its hub anyway', () => {
      const qs = setup(4000, 50);
      // A follow-up at hub 2 that ends at hub 1 brings the character back.
      const back = quest(33, {
        level: 3,
        reqLevel: 3,
        xp: 1000,
        giver: npc(3, 'Far Orc', offset(BASE, -4000)),
        ender: A,
        prereqs: [32],
        objectives: [collect([offset(BASE, -4050)], 1)],
      });
      const r = plan(atlas([...qs, back]), lvl2, NO_TRAVEL, { toLevel: 30 });
      expect(indexOf(r.steps, 'accept', 31)).toBeGreaterThan(indexOf(r.steps, 'accept', 33));
      expect(indexOf(r.steps, 'turn_in', 31)).toBeGreaterThan(0);
      expect(r.gaps.join('\n')).not.toMatch(/Quest 31/);
    });

    it('takes a quest the level-up at the same hub unlocks in the same visit', () => {
      const qs = setup(700, 3000);
      // 30 alone takes the character to 3: 31 is accepted before leaving for hub 2.
      qs[0]!.xp = 1000;
      const r = plan(atlas(qs), lvl2, NO_TRAVEL, { toLevel: 30 });
      expect(brief(r.steps).slice(0, 4)).toEqual([
        'accept:30',
        'complete:30',
        'turn_in:30',
        'accept:31',
      ]);
      expect(
        r.steps.slice(0, indexOf(r.steps, 'accept', 31)).some((s) => s.action === 'travel'),
      ).toBe(false);
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
        races: ['Scourge'],
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
    // 60 goes out to hub 2, 61 comes back; `kills` mobs at hub 2 keep the character there a while.
    const run = (readyAt: number, kills = 0) =>
      plan(
        atlas([
          quest(60, { giver: A, ender: C }),
          quest(61, {
            giver: C,
            ender: A,
            objectives: kills ? [kill([offset(H2, -50)], kills)] : [],
          }),
        ]),
        character({ hearth: { spot: HEARTH, readyAt } }),
        NO_TRAVEL,
        { toLevel: 30 },
      ).steps.filter((s) => s.action === 'travel');

    it('walks back instead of hearthing while it is on cooldown', () => {
      const travel = run(3600);
      expect(travel.map((s) => s.how)).toEqual(['walk', 'walk']);
      expect(travel[1]!.at).toBeLessThan(3600);
    });

    it('hearths back once the plan clock passes the cooldown', () => {
      const travel = run(3600, 130);
      expect(travel.map((s) => s.how)).toEqual(['walk', 'hearth']);
      expect(travel[1]!.at - HEARTH_SECONDS).toBeGreaterThanOrEqual(3600);
      expect(travel[1]!.note).toBe('Hearthstone');
    });

    it('hearths back at once when it is ready', () => {
      expect(run(0).map((s) => s.how)).toEqual(['walk', 'hearth']);
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
      // Cut after accepting 81: it is still in the log.
      expect(r.gaps).toContain('left in the log at the end: 1 quest (Quest 81)');
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
    expect(r.gaps).toContain('no objective spots for 1 quest, done near the giver: Quest 90');
    expect(r.gaps).toContain(
      'estimates are optimistic for 1 quest with missing objective data: Quest 90',
    );
  });

  it('groups data-poor quests into one gap line each', () => {
    const A = npc(1, 'Gruk', BASE);
    const qs = [91, 92, 93].map((id) =>
      quest(id, { giver: A, ender: A, objectives: id === 93 ? [] : [kill([], 3)] }),
    );
    const r = plan(atlas(qs), character(), NO_TRAVEL, { toLevel: 30 });
    expect(r.gaps).toContain(
      'no objective spots for 2 quests, done near the giver: Quest 91, Quest 92',
    );
    expect(r.gaps).toContain(
      'estimates are optimistic for 3 quests with missing objective data: Quest 91, Quest 92, Quest 93',
    );
  });

  it('does not crash on a quest whose own giver copy has no spots', () => {
    const S = BASE;
    const r = plan(
      atlas([
        quest(3, { giver: npc(7, 'Bob', S), ender: npc(7, 'Bob', S) }),
        quest(2, { giver: { id: 7, name: 'Bob', spots: [] }, ender: npc(7, 'Bob', S) }),
      ]),
      character(),
      NO_TRAVEL,
      { toLevel: 10 },
    );
    expect(brief(r.steps)).toEqual(['accept:3', 'turn_in:3']);
  });

  it('does not crash on a log quest whose ender has no spots and no giver', () => {
    const r = plan(
      atlas([
        quest(1, { giver: npc(7, 'Bob', BASE), ender: npc(7, 'Bob', BASE) }),
        quest(2, { giver: null, ender: { id: 7, name: 'Bob', spots: [] } }),
      ]),
      character({ log: new Map([[2, []]]) }),
      NO_TRAVEL,
      { toLevel: 10 },
    );
    expect(brief(r.steps)).toEqual(['accept:1', 'turn_in:1']);
    expect(r.gaps).toContain('left in the log at the end: 1 quest (Quest 2)');
  });

  it('stays on the continent while it has work: a level-1 Orc in the Valley of Trials stays in Durotar', () => {
    const VOT: MapSpot = { mapId: 1411, x: 43.3, y: 68.5 };
    const DK: MapSpot = { mapId: 1420, x: 30.8, y: 66.2 };
    const gornek = npc(1, 'Gornek', { mapId: 1411, x: 42.1, y: 68.3 });
    const sarvis = npc(2, 'Shadow Priest Sarvis', DK);
    const qs = [
      // Poorly mapped at home: no objective spots (estimates doubled), little XP.
      quest(200, {
        level: 1,
        xp: 40,
        giver: gornek,
        ender: gornek,
        objectives: [kill([], 20, 'Mottled Boar slain')],
      }),
      // Well mapped across the zeppelin, worth far more per minute.
      quest(201, {
        level: 1,
        xp: 5000,
        side: 'both',
        giver: sarvis,
        ender: sarvis,
        objectives: [kill([offset(DK, 40)], 2)],
      }),
      // The Undead warrior's class quest there: an Orc warrior can't take it.
      quest(202, {
        level: 1,
        side: 'both',
        classes: ['WARRIOR'],
        races: ['Scourge'],
        giver: sarvis,
        ender: npc(3, 'Dannal Stern', offset(DK, 30)),
      }),
    ];
    const travel: TravelData = {
      flightNodes: [],
      transports: TRANSPORTS.filter((t) => t.name === 'Tirisfal Glades ↔ Durotar'),
    };
    const ch = character({ level: 1, position: VOT, hearth: { spot: VOT, readyAt: 0 } });
    const r = plan(atlas(qs), ch, travel, { toLevel: 30 });
    const boat = r.steps.findIndex((s) => s.how === 'boat');
    expect(indexOf(r.steps, 'accept', 200)).toBe(0);
    expect(indexOf(r.steps, 'turn_in', 200)).toBeGreaterThan(0);
    // Only once Durotar has nothing left does it cross.
    if (boat >= 0) expect(boat).toBeGreaterThan(indexOf(r.steps, 'turn_in', 200));
    expect(r.steps.some((s) => ids(s).includes(202))).toBe(false);
  });

  it('a class quest on another continent goes first only when the race is known to take it', () => {
    const VOT: MapSpot = { mapId: 1411, x: 43.3, y: 68.5 };
    const DK: MapSpot = { mapId: 1420, x: 30.8, y: 66.2 };
    const gornek = npc(1, 'Gornek', { mapId: 1411, x: 42.1, y: 68.3 });
    const trainer = npc(2, 'Trainer', DK);
    const home = quest(210, {
      level: 1,
      giver: gornek,
      ender: gornek,
      objectives: [kill([offset(VOT, 60)], 3)],
    });
    const cls = (races: string[] | null) =>
      quest(211, {
        level: 1,
        side: 'both',
        classes: ['WARRIOR'],
        races,
        giver: trainer,
        ender: trainer,
      });
    const travel: TravelData = {
      flightNodes: [],
      transports: TRANSPORTS.filter((t) => t.name === 'Tirisfal Glades ↔ Durotar'),
    };
    const ch = character({ level: 1, position: VOT });
    const known = plan(atlas([home, cls(['Orc'])]), ch, travel, { toLevel: 30 });
    expect(indexOf(known.steps, 'accept', 211)).toBeLessThan(indexOf(known.steps, 'accept', 210));
    const unknown = plan(atlas([home, cls(null)]), ch, travel, { toLevel: 30 });
    expect(indexOf(unknown.steps, 'turn_in', 210)).toBeLessThan(
      indexOf(unknown.steps, 'accept', 211),
    );
  });

  it('keeps the hearth and stays on the continent for a slightly better hub across the water', () => {
    const BRILL: MapSpot = { mapId: 1420, x: 61, y: 52 };
    const FAR: MapSpot = { mapId: 1411, x: 52, y: 40 };
    const qs = [
      quest(150, {
        level: 1,
        giver: npc(1, 'Home', BRILL),
        ender: npc(1, 'Home', BRILL),
        objectives: [kill([offset(BRILL, 50)], 1)],
      }),
      quest(151, {
        level: 1,
        xp: 500,
        giver: npc(2, 'Away', FAR),
        ender: npc(2, 'Away', FAR),
        objectives: [kill([offset(FAR, 50)], 1)],
      }),
    ];
    const travel: TravelData = {
      flightNodes: [],
      transports: TRANSPORTS.filter((t) => t.name === 'Tirisfal Glades ↔ Durotar'),
    };
    const ch = character({
      level: 1,
      race: 'Scourge',
      position: BRILL,
      hearth: { spot: FAR, readyAt: 0 },
    });
    const r = plan(atlas(qs), ch, travel, { toLevel: 30 });
    expect(work(r.steps)[0]!.quests[0]!.questId).toBe(150);
    expect(indexOf(r.steps, 'turn_in', 150)).toBeLessThan(indexOf(r.steps, 'accept', 151));
  });

  it('says so when the start position is on an unknown map', () => {
    const A = npc(1, 'Gruk', BASE);
    const r = plan(
      atlas([quest(100, { giver: A, ender: A })]),
      character({ position: { mapId: 999999, x: 50, y: 50 } }),
      NO_TRAVEL,
      { toLevel: 30 },
    );
    expect(r.gaps).toContain('start position is on an unknown map (999999)');
    // No travel is planned from nowhere.
    expect(r.steps).toEqual([]);
  });

  it('keeps objective progress already in the log', () => {
    const A = npc(1, 'Gruk', BASE);
    const qs = [
      quest(100, { giver: A, ender: A, objectives: [kill([offset(BASE, 100)], 5)] }),
      quest(101, { giver: A, ender: A, objectives: [kill([offset(BASE, -100)], 5)] }),
    ];
    const ch = character({
      log: new Map([
        [100, [5]],
        [101, [3]],
      ]),
    });
    const r = plan(atlas(qs), ch, NO_TRAVEL, { toLevel: 30 });
    // 100 is done: straight to the turn-in. 101 needs 2 more kills (60 s) plus the 200 yd walk there and back.
    expect(brief(r.steps)).toEqual(['turn_in:100', 'complete:101', 'turn_in:101']);
    expect(r.seconds).toBeCloseTo(60 + 200 / 7, 0);
  });

  it('never takes a quest whose objectives cannot be reached, and abandons a log quest that turns out so', () => {
    const A = npc(1, 'Gruk', BASE);
    // Tirisfal Glades is on another continent and there is no boat in NO_TRAVEL.
    const FAR: MapSpot = { mapId: 1420, x: 50, y: 50 };
    const qs = [
      quest(110, { giver: A, ender: A, objectives: [kill([FAR])] }),
      quest(111, { giver: A, ender: A, objectives: [kill([offset(BASE, 100)])] }),
      quest(112, { giver: A, ender: A, objectives: [kill([FAR])] }),
    ];
    const r = plan(atlas(qs), character({ log: new Map([[112, [0]]]) }), NO_TRAVEL, {
      toLevel: 30,
    });
    expect(r.steps.some((s) => ids(s).includes(110))).toBe(false);
    expect(r.steps.some((s) => ids(s).includes(112))).toBe(false);
    expect(indexOf(r.steps, 'turn_in', 111)).toBeGreaterThan(0);
    expect(r.gaps).toContain("can't reach objectives of Quest 112: abandoned");
  });

  it('falls back to the giver when the ender is on an unknown map', () => {
    const A = npc(1, 'Gruk', BASE);
    const B = npc(2, 'Mok', offset(BASE, 0, 30));
    const LOST = npc(3, 'Lost Orc', { mapId: 999999, x: 50, y: 50 });
    const qs = [
      quest(120, { giver: A, ender: LOST, objectives: [kill([offset(BASE, 100)])] }),
      quest(121, { giver: A, ender: B, objectives: [kill([offset(BASE, 100)])] }),
    ];
    const r = plan(atlas(qs), character(), NO_TRAVEL, { toLevel: 30 });
    const turnIns = r.steps.filter((s) => s.action === 'turn_in');
    expect(turnIns.map((s) => [s.npc, ids(s)])).toEqual(
      expect.arrayContaining([
        ['Gruk', [120]],
        ['Mok', [121]],
      ]),
    );
  });

  it('says so when a log quest is not in the atlas, or the character is already at the level', () => {
    const r = plan(atlas([]), character({ log: new Map([[999, [0]]]) }), NO_TRAVEL, {
      toLevel: 30,
    });
    expect(r.gaps).toContain('quest 999 in the log is not in the atlas: left out');
    const done = plan(atlas([]), character({ level: 10 }), NO_TRAVEL, { toLevel: 10 });
    expect(done.steps).toEqual([]);
    expect(done.gaps).toEqual(['already at level 10 (target 10)']);
  });

  it('names the hub once in the set-hearth gap line', () => {
    const A = npc(1, 'Gruk', BASE);
    // 141 waits for level 3 at Gruk: the plan comes back, so it would set the hearth there.
    const qs = [
      quest(140, { level: 2, xp: 100, giver: A, ender: A }),
      quest(141, { level: 3, reqLevel: 3, giver: A, ender: A }),
    ];
    const r = plan(atlas(qs), character({ level: 2 }), NO_TRAVEL, { toLevel: 30 });
    expect(r.gaps).toContain(
      'set hearth: no innkeeper in the atlas yet; the plan comes back to 1 hub: near Gruk',
    );
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
