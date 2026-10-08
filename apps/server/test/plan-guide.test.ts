// The planner's steps as in-game guide steps (knowledge/plan-guide.ts guideSteps): pure, no database.
import { GuideStep } from '@forever-ledger/contracts';
import { describe, expect, it } from 'vitest';
import { guideSteps } from '../src/knowledge/plan-guide.js';
import { TRANSPORTS } from '../src/planner/transports.js';
import type { TravelData } from '../src/planner/travel.js';
import type { Atlas, AtlasQuest, PlanStep } from '../src/planner/types.js';

const quest = (id: number, reqLevel: number): AtlasQuest => ({
  id,
  title: `Quest ${id}`,
  level: reqLevel + 1,
  reqLevel,
  side: 'Horde',
  classes: null,
  races: null,
  giver: null,
  ender: null,
  prereqs: [],
  objectives: [],
  xp: 100,
});
const atlas: Atlas = {
  quests: new Map([
    [840, quest(840, 10)],
    [841, quest(841, 0)],
    [
      842,
      {
        ...quest(842, 1),
        objectives: [
          { index: 0, kind: 'kill' as const, text: 'Mottled Boar slain', count: 10, spots: [] },
          { index: 1, kind: 'object' as const, text: '6 × Wayward Weapon', count: 6, spots: [] },
        ],
      },
    ],
  ]),
};
const crossroads = { mapId: 1414, x: 51.123456, y: 30.3 };
const travel: TravelData = {
  flightNodes: [
    {
      id: 23,
      name: 'Orgrimmar, Durotar',
      faction: 'Horde',
      spot: { mapId: 1414, x: 58.1, y: 45.3 },
    },
    { id: 25, name: 'Crossroads, The Barrens', faction: 'Horde', spot: crossroads },
  ],
  transports: [...TRANSPORTS],
};
const zep = TRANSPORTS.find((t) => t.name === 'Tirisfal Glades ↔ Durotar')!;
const step = (s: Partial<PlanStep> & Pick<PlanStep, 'action'>): PlanStep => ({
  npc: null,
  zone: null,
  spot: null,
  quests: [],
  at: 0,
  level: 10,
  ...s,
});

describe('guideSteps', () => {
  const steps = guideSteps(
    [
      step({
        action: 'accept',
        npc: 'Sergra Darkthorn',
        zone: 'The Barrens',
        spot: { mapId: 1413, x: 52.25, y: 31.0 },
        quests: [
          { questId: 840, title: 'Conscript of the Horde' },
          { questId: 841, title: 'No |cffLevel' },
        ],
        note: 'class quest',
      }),
      step({
        action: 'travel',
        how: 'fly',
        zone: 'Kalimdor',
        spot: crossroads,
        note: 'Orgrimmar, Durotar → Crossroads, The Barrens',
      }),
      step({ action: 'travel', how: 'boat', zone: 'Tirisfal Glades', spot: zep.a, note: zep.name }),
      step({ action: 'travel', how: 'boat', zone: 'Durotar', spot: zep.b, note: zep.name }),
      step({
        action: 'travel',
        how: 'hearth',
        zone: 'Durotar',
        spot: { mapId: 1411, x: 51.9, y: 41.6 },
        note: 'Hearthstone',
      }),
      step({
        action: 'travel',
        how: 'walk',
        zone: 'Durotar',
        spot: { mapId: 1411, x: 40, y: 20 },
        note: 'Ghost Wolf',
      }),
      step({
        action: 'complete',
        zone: 'Durotar',
        spot: { mapId: 1411, x: 44, y: 62 },
        quests: [{ questId: 841, title: 'Q', objectives: ['Mottled Boar slain: 10'] }],
      }),
      step({
        action: 'turn_in',
        npc: 'Gornek',
        zone: 'Durotar',
        spot: { mapId: 1411, x: 42.1, y: 68.3 },
        quests: [{ questId: 841, title: 'Q' }],
        level: 11,
      }),
    ],
    { atlas, travel, bindName: 'Razor Hill' },
  );

  it('every step parses as a format-2 guide step', () => {
    for (const s of steps) expect(GuideStep.safeParse(s).success, JSON.stringify(s)).toBe(true);
  });

  it('accepts carry the required level from the atlas and the class-quest note', () => {
    expect(steps[0]).toMatchObject({
      action: 'accept',
      npc: 'Sergra Darkthorn',
      zone: 'The Barrens',
      subzone: null,
      mapId: 1413,
      x: 52.25,
      y: 31,
      note: 'class quest',
    });
    expect(steps[0]!.quests[0]).toEqual({
      questId: 840,
      title: 'Conscript of the Horde',
      minLevel: 10,
      minLevelFrom: 'wowhead',
    });
    // No required level known (0): none given; "|" is stripped.
    expect(steps[0]!.quests[1]).toEqual({ questId: 841, title: 'No cffLevel' });
  });

  it('a flight names the flight master it lands at', () => {
    expect(steps[1]).toEqual({
      action: 'travel',
      how: 'fly',
      note: 'Orgrimmar, Durotar -> Crossroads, The Barrens',
      npc: 'Crossroads, The Barrens',
      zone: 'Kalimdor',
      subzone: null,
      mapId: 1414,
      x: 51.12,
      y: 30.3,
      quests: [],
    });
  });

  it('a boat names the end it lands at; the hearth the bind location; a walk the zone', () => {
    // "<kind>: <route>": the addon says "Take the zeppelin to Durotar".
    const note = 'zeppelin: Tirisfal Glades to Durotar';
    expect(steps[2]).toMatchObject({ how: 'boat', npc: 'Tirisfal Glades', note });
    expect(steps[3]).toMatchObject({ how: 'boat', npc: 'Durotar', note });
    expect(steps[4]).toMatchObject({ how: 'hearth', npc: 'Razor Hill', note: 'Hearthstone' });
    expect(steps[5]).toMatchObject({ how: 'walk', npc: 'Durotar', note: 'Ghost Wolf' });
  });

  it('objective steps keep the objectives; turn-ins say the level after', () => {
    expect(steps[6]!.quests[0]!.objectives).toEqual(['Mottled Boar slain: 10']);
    expect(steps[7]).toMatchObject({ action: 'turn_in', levelAfter: 11 });
    expect(steps[6]).not.toHaveProperty('levelAfter');
  });

  it('objective texts get their count once', () => {
    const [c] = guideSteps(
      [
        step({
          action: 'complete',
          quests: [
            {
              questId: 842,
              title: 'Q',
              objectives: ['Mottled Boar slain', '6 × Wayward Weapon'],
            },
          ],
        }),
      ],
      { atlas, travel, bindName: null },
    );
    expect(c!.quests[0]!.objectives).toEqual(['Mottled Boar slain: 10', '6 × Wayward Weapon']);
  });

  it('a walk names the NPC it ends at', () => {
    const at = { mapId: 1429, x: 80, y: 60 };
    const [walk] = guideSteps(
      [
        step({ action: 'travel', how: 'walk', zone: 'Elwynn Forest', spot: at }),
        step({
          action: 'accept',
          npc: 'Marshal Haggard',
          zone: 'Elwynn Forest',
          spot: at,
          quests: [{ questId: 840, title: 'Q' }],
        }),
      ],
      { atlas, travel, bindName: null },
    );
    expect(walk).toMatchObject({ how: 'walk', npc: 'Marshal Haggard' });
  });

  it('game text is ASCII-safe: arrows become words, accented letters stay', () => {
    const [s] = guideSteps(
      [
        step({
          action: 'accept',
          npc: 'Zul’Jin ⇒ Café',
          zone: 'A ↔ B',
          spot: null,
          quests: [{ questId: 840, title: 'Q' }],
          note: 'x → y',
        }),
      ],
      { atlas, travel, bindName: null },
    );
    expect(s).toMatchObject({ npc: 'Zul’Jin -> Café', zone: 'A to B', note: 'x -> y' });
    expect(JSON.stringify(steps)).not.toMatch(/[→↔⇒⇔]/);
  });

  it('a hearth without a known bind location names the zone', () => {
    const [h] = guideSteps(
      [
        step({
          action: 'travel',
          how: 'hearth',
          zone: 'Durotar',
          spot: { mapId: 1411, x: 1, y: 2 },
        }),
      ],
      { atlas, travel, bindName: null },
    );
    expect(h).toMatchObject({ npc: 'Durotar' });
    expect(h).not.toHaveProperty('note');
  });
});
