import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { GUIDE_FORMAT, GuideDoc, GuideStep, GuidesResponse, toFormat1 } from '../src/index.js';

/** GET /v1/guides as tray v0.3.2 parses it (guide format 1): an old tray rejects the whole response on one bad step. */
const text = (max: number) => z.string().max(max);
const coord = z.number().min(0).max(100);
const V1Step = z.object({
  action: z.enum(['accept', 'complete', 'turn_in']),
  npc: text(120).nullable(),
  zone: text(120).nullable(),
  subzone: text(120).nullable(),
  mapId: z.number().int().positive().nullable(),
  x: coord.nullable(),
  y: coord.nullable(),
  quests: z
    .array(
      z.object({
        questId: z.number().int().positive(),
        title: text(200).nullable(),
        objectives: z.array(text(200)).max(12).optional(),
        minLevel: z.number().int().min(1).max(80).optional(),
        minLevelFrom: z.enum(['wowhead', 'seen']).optional(),
      }),
    )
    .min(1)
    .max(20),
  levelAfter: z.number().int().min(1).max(80).nullable().optional(),
});
const V1Response = z.object({
  guides: z.array(
    z.object({
      id: z.number().int().positive(),
      char: text(128),
      title: text(120),
      createdAt: text(40),
      fromLevel: z.number().int().min(1).max(80),
      toLevel: z.number().int().min(1).max(80),
      basedOn: text(128),
      steps: z.array(V1Step).min(1).max(400),
    }),
  ),
});

const place = { zone: 'Durotar', subzone: null, mapId: 1411, x: 52.1, y: 43.3 };
const accept = {
  action: 'accept',
  npc: 'Gornek',
  ...place,
  quests: [
    { questId: 4641, title: 'Your Place In The World', minLevel: 1, minLevelFrom: 'wowhead' },
  ],
  note: 'class quest',
};
const travel = {
  action: 'travel',
  how: 'fly',
  note: 'Orgrimmar → Crossroads',
  npc: 'Crossroads',
  zone: 'The Barrens',
  subzone: null,
  mapId: 1413,
  x: 51.5,
  y: 30.3,
  quests: [],
};
const turnIn = {
  action: 'turn_in',
  npc: 'Sergra Darkthorn',
  ...place,
  quests: [{ questId: 840, title: 'Conscript of the Horde' }],
  levelAfter: 12,
};
const doc = {
  id: 7,
  char: 'Sam Willikers-Bayou',
  title: 'Planned: Durotar 10–12',
  createdAt: '2026-10-08T01:00:00-05:00',
  fromLevel: 10,
  toLevel: 12,
  basedOn: 'the route planner',
  planned: true,
  steps: [accept, travel, turnIn],
};

describe('guide format 2', () => {
  it('is format 2', () => {
    expect(GUIDE_FORMAT).toBe(2);
  });

  it('a planned doc with travel steps parses', () => {
    const d = GuideDoc.parse(doc);
    expect(d.planned).toBe(true);
    expect(d.steps[1]).toMatchObject({ action: 'travel', how: 'fly', quests: [] });
  });

  it('every way of travelling parses, with or without a note', () => {
    for (const how of ['walk', 'fly', 'boat', 'hearth'] as const)
      expect(GuideStep.safeParse({ ...travel, how }).success).toBe(true);
    const { note: _n, ...bare } = travel;
    expect(GuideStep.safeParse(bare).success).toBe(true);
    expect(GuideStep.safeParse({ ...travel, how: 'teleport' }).success).toBe(false);
  });

  it('a travel step may carry quests', () => {
    expect(
      GuideStep.safeParse({
        ...travel,
        quests: [{ questId: 840, title: 'Conscript of the Horde' }],
      }).success,
    ).toBe(true);
  });

  it('accept, complete and turn-in steps still need a quest', () => {
    for (const action of ['accept', 'complete', 'turn_in'])
      expect(GuideStep.safeParse({ ...accept, action, quests: [] }).success).toBe(false);
  });

  it('only travel steps say how', () => {
    expect(GuideStep.safeParse({ ...accept, how: 'walk' }).success).toBe(false);
  });

  it('notes are short', () => {
    expect(GuideStep.safeParse({ ...travel, note: 'x'.repeat(121) }).success).toBe(false);
  });
});

describe('toFormat1', () => {
  it('drops travel steps, how and note: an old tray can read the result', () => {
    const v1 = toFormat1(GuideDoc.parse(doc))!;
    expect(v1.steps.map((s) => s.action)).toEqual(['accept', 'turn_in']);
    expect(v1.steps[0]).not.toHaveProperty('note');
    expect(v1).not.toHaveProperty('planned');
    expect(v1.title).toBe(doc.title);
    expect(V1Response.safeParse({ guides: [v1] }).success).toBe(true);
    // And the current schema still reads it.
    expect(GuidesResponse.safeParse({ guides: [v1] }).success).toBe(true);
  });

  it('a run-based guide passes through unchanged', () => {
    const { planned: _p, ...run } = doc;
    const old = { ...run, basedOn: 'Rot', steps: [{ ...accept, note: undefined }, turnIn] };
    const parsed = GuideDoc.parse(JSON.parse(JSON.stringify(old)));
    expect(toFormat1(parsed)).toEqual(parsed);
  });

  it('a guide with only travel steps left is dropped', () => {
    expect(toFormat1(GuideDoc.parse({ ...doc, steps: [travel] }))).toBeNull();
  });
});
