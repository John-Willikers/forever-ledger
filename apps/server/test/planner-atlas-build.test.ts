// Planner atlas builder (planner/atlas-build.ts): wowhead@5 claims and our own observations → AtlasQuests. Pure; the
// claim rows are shaped like the stored wowhead@5 claims (2026-10-08, e.g. quest 97288's ends_at / series).
import { describe, expect, it } from 'vitest';
import {
  buildAtlas,
  classToken,
  parseObjective,
  raceToken,
  zoneMapId,
} from '../src/planner/atlas-build.js';
import type { AtlasRows, ClaimRow } from '../src/planner/atlas-build.js';

const claim = (
  questId: number,
  attribute: string,
  value: unknown,
  label = 'VERIFIED',
  tier = 3,
): ClaimRow => ({ questId, attribute, value, label, tier });
const rows = (r: Partial<AtlasRows>): AtlasRows => ({
  claims: [],
  seen: [],
  progress: [],
  turnIns: [],
  quests: [],
  ...r,
});

// Quest 788 "Cutting Teeth" (Durotar, Valley of Trials), as wowhead@5 claims.
const GORNEK = {
  id: 3143,
  kind: 'npc',
  name: 'Gornek',
  react: { horde: 1, alliance: -1 },
  coords: [[42.1, 68.3]],
  zoneName: 'Durotar',
  wowheadZone: 14,
};
const BOAR = {
  id: 3098,
  kind: 'npc',
  name: 'Mottled Boar',
  role: 'target',
  coords: [
    [44.2, 62.1],
    [45, 60],
  ],
  zoneName: 'Durotar',
  wowheadZone: 14,
};
const CUTTING_TEETH = [
  claim(788, 'name', 'Cutting Teeth'),
  claim(788, 'level', 2),
  claim(788, 'req_level', 1),
  claim(788, 'xp_reward', 170),
  claim(788, 'side', 'Horde'),
  claim(788, 'races', ['Orc', 'Undead', 'Troll']),
  claim(788, 'classes', ['Warlock', 'Shaman']),
  claim(788, 'starts_at', [GORNEK]),
  claim(788, 'ends_at', [GORNEK]),
  claim(788, 'objective_spots', [BOAR]),
];

describe('atlas builder', () => {
  it('builds a quest from Wowhead claims alone', () => {
    const { atlas, gaps } = buildAtlas(rows({ claims: CUTTING_TEETH }));
    expect(atlas.quests.get(788)).toEqual({
      id: 788,
      title: 'Cutting Teeth',
      level: 2,
      reqLevel: 1,
      side: 'Horde',
      classes: ['WARLOCK', 'SHAMAN'],
      races: ['Orc', 'Scourge', 'Troll'],
      giver: { id: 3143, name: 'Gornek', kind: 'npc', spots: [{ mapId: 1411, x: 42.1, y: 68.3 }] },
      ender: { id: 3143, name: 'Gornek', kind: 'npc', spots: [{ mapId: 1411, x: 42.1, y: 68.3 }] },
      prereqs: [],
      objectives: [
        {
          index: 0,
          kind: 'kill',
          text: 'Mottled Boar',
          count: 1,
          spots: [
            { mapId: 1411, x: 44.2, y: 62.1 },
            { mapId: 1411, x: 45, y: 60 },
          ],
        },
      ],
      xp: 170,
    });
    expect(gaps).toEqual([]);
  });

  it('takes objective counts from our quest log text and matches Wowhead spots by name', () => {
    const lostJournal = {
      id: 654925,
      kind: 'object',
      name: 'Lost Journal',
      role: 'target',
      coords: [[42.8, 69.1]],
      zoneName: 'Durotar',
      wowheadZone: 14,
    };
    const tusk = {
      id: 3099,
      kind: 'npc',
      name: 'Dire Mottled Boar',
      role: 'source',
      item: 'Boar Tusk',
      objective: 0,
      coords: [[50, 50]],
      zoneName: 'Durotar',
      wowheadZone: 14,
    };
    const { atlas } = buildAtlas(
      rows({
        claims: [
          ...CUTTING_TEETH.filter((c) => c.attribute !== 'objective_spots'),
          claim(788, 'objective_spots', [tusk, BOAR, lostJournal]),
        ],
        // Our client's objectives: Forever puts the count first.
        quests: [
          {
            questId: 788,
            title: 'Cutting Teeth',
            level: 2,
            objectives: ['0/10 Mottled Boar slain', '0/4 Boar Tusk', 'Lost Journal: 0/1', '0/1  '],
          },
        ],
      }),
    );
    const o = atlas.quests.get(788)!.objectives;
    expect(o.map((x) => [x.index, x.kind, x.text, x.count, x.spots.length])).toEqual([
      [0, 'kill', 'Mottled Boar slain', 10, 2],
      [1, 'collect', 'Boar Tusk', 4, 1],
      [2, 'object', 'Lost Journal', 1, 1],
      [3, 'other', '', 1, 0],
    ]);
  });

  it("puts our own observations before Wowhead's: giver, ender, objective spots, XP", () => {
    const { atlas } = buildAtlas(
      rows({
        claims: CUTTING_TEETH,
        seen: [
          {
            questId: 788,
            stage: 'detail',
            npcId: 3143,
            npcName: 'Gornek',
            mapId: 1411,
            x: 42,
            y: 68.4,
          },
          {
            questId: 788,
            stage: 'detail',
            npcId: 3143,
            npcName: 'Gornek',
            mapId: 1411,
            x: 42.2,
            y: 68.6,
          },
          {
            questId: 788,
            stage: 'complete',
            npcId: 9999,
            npcName: 'Someone Else',
            mapId: 1411,
            x: 50,
            y: 50,
          },
          // No spot: ignored.
          {
            questId: 788,
            stage: 'complete',
            npcId: 9999,
            npcName: 'Someone Else',
            mapId: null,
            x: null,
            y: null,
          },
        ],
        progress: [
          {
            questId: 788,
            idx: 1,
            mapId: 1411,
            x: 47,
            y: 61,
            n: 5,
            need: 10,
            text: '3/10 Mottled Boar slain',
          },
        ],
        // Turned in 8 levels over the quest: reduced XP, not the quest's own.
        turnIns: [
          { questId: 788, xp: 180, level: 3 },
          { questId: 788, xp: 60, level: 10 },
        ],
      }),
    );
    const q = atlas.quests.get(788)!;
    expect(q.giver).toEqual({
      id: 3143,
      name: 'Gornek',
      kind: 'npc',
      spots: [{ mapId: 1411, x: 42.1, y: 68.5 }],
    });
    expect(q.ender).toEqual({
      id: 9999,
      name: 'Someone Else',
      kind: 'npc',
      spots: [{ mapId: 1411, x: 50, y: 50 }],
    });
    expect(q.objectives).toEqual([
      {
        index: 0,
        kind: 'kill',
        text: 'Mottled Boar slain',
        count: 10,
        spots: [{ mapId: 1411, x: 47, y: 61 }],
      },
    ]);
    expect(q.xp).toBe(180);
  });

  it('builds a quest Wowhead has no page for from our observations', () => {
    const { atlas, gaps } = buildAtlas(
      rows({
        quests: [{ questId: 364, title: 'The Mindless Ones', level: 2, objectives: null }],
        seen: [
          {
            questId: 364,
            stage: 'detail',
            npcId: 1569,
            npcName: 'Shadow Priest Sarvis',
            mapId: 1420,
            x: 30.8,
            y: 66.2,
          },
        ],
        progress: [
          {
            questId: 364,
            idx: 2,
            mapId: 1420,
            x: 32,
            y: 63,
            n: 4,
            need: 8,
            text: '4/8 Wretched Zombie slain',
          },
          {
            questId: 364,
            idx: 1,
            mapId: 1420,
            x: 31,
            y: 64,
            n: 8,
            need: 8,
            text: '8/8 Mindless Zombie slain',
          },
        ],
      }),
    );
    const q = atlas.quests.get(364)!;
    expect(q).toMatchObject({
      title: 'The Mindless Ones',
      level: 2,
      reqLevel: 1,
      side: 'both',
      xp: 0,
      ender: null,
    });
    expect(q.objectives.map((o) => [o.index, o.kind, o.text, o.count])).toEqual([
      [0, 'kill', 'Mindless Zombie slain', 8],
      [1, 'kill', 'Wretched Zombie slain', 8],
    ]);
    expect(gaps).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^quest 364 .*no req_level/),
        expect.stringMatching(/^quest 364 .*no side/),
        expect.stringMatching(/^quest 364 .*no ender/),
      ]),
    );
  });

  it('makes the quest just before it in its series a prereq, per faction on a split step', () => {
    const series = [[{ id: 1, name: 'One' }], [{ id: 2, name: 'Two' }], [{ id: 3, name: 'Three' }]];
    const split = [
      [{ id: 10, name: 'Meal Appeal', side: 'Horde' }],
      [
        { id: 20, name: "Philmor's Favor", side: 'Alliance' },
        { id: 21, name: "Yelmak's Medley", side: 'Horde' },
      ],
      [{ id: 30, name: 'Gatehouse Goods', side: 'Alliance' }],
    ];
    const quest = (id: number, s: unknown) => [
      claim(id, 'name', `Q${id}`),
      claim(id, 'level', 5),
      claim(id, 'series', s),
    ];
    const { atlas } = buildAtlas(
      rows({
        claims: [
          ...quest(1, series),
          ...quest(2, series),
          // Quest 3 has no series claim of its own: quest 2's page names it.
          claim(3, 'name', 'Q3'),
          claim(3, 'level', 5),
          ...quest(20, split),
          ...quest(21, split),
          ...quest(30, split),
          // A step with no faction marks keeps all its quests.
          ...quest(40, [
            [
              { id: 41, name: 'A' },
              { id: 42, name: 'B' },
            ],
            [{ id: 40, name: 'C' }],
          ]),
        ],
      }),
    );
    const pre = (id: number) => atlas.quests.get(id)!.prereqs;
    expect([pre(1), pre(2), pre(3)]).toEqual([[], [1], [2]]);
    expect([pre(20), pre(21), pre(30)]).toEqual([[], [10], [20]]);
    expect(pre(40)).toEqual([41, 42]);
  });

  it('drops spots in zones the client has no map for, and says so in gaps', () => {
    const { atlas, gaps } = buildAtlas(
      rows({
        claims: [
          claim(97288, 'name', 'Unending Torment'),
          claim(97288, 'level', 21),
          claim(97288, 'req_level', 16),
          claim(97288, 'side', 'Horde'),
          claim(97288, 'starts_at', [
            {
              id: 1,
              kind: 'npc',
              name: 'Ghost',
              coords: [[1, 1]],
              zoneName: 'Ruins of Lordaeron',
              wowheadZone: 1497,
            },
          ]),
          claim(97288, 'ends_at', [
            {
              id: 2055,
              kind: 'npc',
              name: 'Master Apothecary Faranell',
              coords: [[48.4, 69.4]],
              zoneName: 'Undercity',
              wowheadZone: 1497,
            },
          ]),
        ],
      }),
    );
    const q = atlas.quests.get(97288)!;
    expect(q.giver).toEqual({ id: 1, name: 'Ghost', kind: 'npc', spots: [] });
    expect(q.ender!.spots).toEqual([{ mapId: 1458, x: 48.4, y: 69.4 }]);
    expect(gaps).toContain(
      'Wowhead zone "Ruins of Lordaeron" has no client map: 1 spot dropped (quest 97288)',
    );
  });

  it('prefers VERIFIED (Forever) over CLASSIC, and a better source tier first', () => {
    const { atlas } = buildAtlas(
      rows({
        claims: [
          claim(5, 'name', 'Old Name', 'CLASSIC'),
          claim(5, 'name', 'Forever Name', 'VERIFIED'),
          claim(5, 'level', 9, 'VERIFIED', 5),
          claim(5, 'level', 7, 'CLASSIC', 1),
          claim(5, 'xp_reward', 400, 'CLASSIC'),
          claim(5, 'xp_reward', 999, 'FALSE'),
        ],
      }),
    );
    expect(atlas.quests.get(5)).toMatchObject({ title: 'Forever Name', level: 7, xp: 400 });
  });

  it('keeps an item starter as the giver, with its kind', () => {
    const { atlas } = buildAtlas(
      rows({
        claims: [
          claim(6, 'name', 'A Strange Note'),
          claim(6, 'level', 4),
          claim(6, 'starts_at', [
            {
              id: 1972,
              kind: 'item',
              name: 'Strange Note',
              coords: [],
              zoneName: null,
              wowheadZone: null,
            },
          ]),
        ],
      }),
    );
    expect(atlas.quests.get(6)!.giver).toEqual({
      id: 1972,
      name: 'Strange Note',
      kind: 'item',
      spots: [],
    });
  });
});

describe('atlas builder calibration', () => {
  // A quest with Wowhead's XP and (optionally) a full-XP turn-in of ours.
  const pair = (id: number, wowhead: number, ours?: number) => ({
    claims: [claim(id, 'name', `Q${id}`), claim(id, 'level', 10), claim(id, 'xp_reward', wowhead)],
    turnIns: ours === undefined ? [] : [{ questId: id, xp: ours, level: 10 }],
  });
  const build = (parts: ReturnType<typeof pair>[]) =>
    buildAtlas(
      rows({ claims: parts.flatMap((p) => p.claims), turnIns: parts.flatMap((p) => p.turnIns) }),
    );

  it("scales Wowhead-only XP by the median ratio of ours to Wowhead's, from 5 pairs on", () => {
    const { atlas, gaps, calibration } = build([
      pair(1, 100, 200),
      pair(2, 100, 300),
      pair(3, 100, 250),
      pair(4, 100, 220),
      pair(5, 100, 900),
      pair(6, 1000),
    ]);
    expect(calibration).toEqual({ xpRatio: 2.5, pairs: 5 });
    expect(atlas.quests.get(6)!.xp).toBe(2500);
    // Ours stay ours.
    expect(atlas.quests.get(5)!.xp).toBe(900);
    expect(gaps).toContainEqual(
      expect.stringMatching(/^quest XP: Wowhead's xp_reward × 2\.5.*5 quests.*1 quest/),
    );
  });

  it("leaves Wowhead's XP alone under 5 pairs", () => {
    const { atlas, gaps, calibration } = build([
      pair(1, 100, 200),
      pair(2, 100, 300),
      pair(3, 100, 250),
      pair(4, 100, 220),
      pair(6, 1000),
    ]);
    expect(calibration).toEqual({ xpRatio: null, pairs: 4 });
    expect(atlas.quests.get(6)!.xp).toBe(1000);
    expect(gaps.some((g) => g.startsWith('quest XP'))).toBe(false);
  });
});

describe('atlas builder objective timing', () => {
  const t0 = 1_760_000_000;
  const tick = (char: string, idx: number, have: number, at: number) => ({
    questId: 364,
    idx,
    char,
    at: t0 + at,
    have,
  });
  const base = rows({
    quests: [
      {
        questId: 364,
        title: 'The Mindless Ones',
        level: 2,
        objectives: ['0/8 Mindless Zombie slain', '0/8 Wretched Zombie slain'],
      },
    ],
  });

  it('times an objective from 3 increments on: median seconds per unit, breaks and restarts left out', () => {
    const { atlas } = buildAtlas({
      ...base,
      ticks: [
        // Lee: 30 s, 40 s, then a 2-unit jump in 100 s (50 s each), then a 20-minute break.
        tick('Lee', 1, 1, 0),
        tick('Lee', 1, 2, 30),
        tick('Lee', 1, 3, 70),
        tick('Lee', 1, 5, 170),
        tick('Lee', 1, 6, 1370),
        // Sam abandoned and started over: the restart is not a step.
        tick('Sam', 1, 1, 0),
        tick('Sam', 1, 2, 60),
        tick('Sam', 1, 1, 500),
        tick('Sam', 1, 2, 540),
        // Objective 2: only 2 increments.
        tick('Lee', 2, 1, 0),
        tick('Lee', 2, 2, 20),
      ],
    });
    const [o1, o2] = atlas.quests.get(364)!.objectives;
    // Steps: Lee 30, 40, 50, 50; Sam 60, 40 → median 45.
    expect(o1!.secondsEach).toBe(45);
    expect(o2).not.toHaveProperty('secondsEach');
  });
});

describe('atlas builder names', () => {
  it('maps Wowhead zone names to client maps, ignoring case and punctuation', () => {
    expect(zoneMapId('Durotar')).toBe(1411);
    expect(zoneMapId('the barrens')).toBe(1413);
    expect(zoneMapId("Zephra's Isle")).toBe(zoneMapId('Zephras Isle'));
    expect(zoneMapId('Zephras Isle')).not.toBeNull();
    expect(zoneMapId('Ruins of Lordaeron')).toBeNull();
  });

  it('reads objective counts either way round, without colour codes', () => {
    expect(parseObjective('0/8 Mindless Zombie slain')).toEqual({
      name: 'Mindless Zombie slain',
      count: 8,
    });
    expect(parseObjective('Mindless Zombie slain: 3/8')).toEqual({
      name: 'Mindless Zombie slain',
      count: 8,
    });
    expect(parseObjective('0/6 Scavenger |cffff0000Paw|r')).toEqual({
      name: 'Scavenger Paw',
      count: 6,
    });
    expect(parseObjective('Speak to Shikrik in the Valley of Trials.')).toBeNull();
  });

  it("names classes and races the client's way", () => {
    expect(classToken('Warlock')).toBe('WARLOCK');
    expect(raceToken('Undead')).toBe('Scourge');
    expect(raceToken('Night Elf')).toBe('NightElf');
    expect(raceToken('High Order Skyborne')).toBe('Skyborne');
    expect(raceToken('Troll')).toBe('Troll');
  });
});
