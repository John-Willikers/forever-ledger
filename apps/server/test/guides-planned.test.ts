// Planned guides (route planner, phase 5): a character with stored state gets a guide planned for it, travel steps
// included; old trays get the same guide without travel steps. Real Postgres.
import { GuideDoc } from '@forever-ledger/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGuide, GuideError } from '../src/knowledge/guides.js';
import { forgetAtlas, levelingAnswer } from '../src/knowledge/plan-guide.js';
import { batchFromFixture, startServer } from './helpers.js';

const NAME = 'Thibodeaux Willikers';

/** Format-1 step rules (tray v0.3.2): no travel, a quest on every step. */
const v1Step = (s: { action: string; quests: unknown[] }) =>
  ['accept', 'complete', 'turn_in'].includes(s.action) && s.quests.length > 0;

describe('planned guides (real Postgres)', () => {
  let s: Awaited<ReturnType<typeof startServer>>;
  const q = async (text: string, params: unknown[] = []) =>
    (await s.database.pool.query(text, params)).rows;
  const tray = (url: string) => s.app.inject({ method: 'GET', url, headers: s.auth });

  beforeAll(async () => {
    s = await startServer();
    // Thibodeaux: a level 11 Human Hunter in Goldshire (Elwynn 43.6, 65.8) with stored state (schema 10), mounted.
    const res = await s.app.inject({
      method: 'POST',
      url: '/v1/ingest',
      headers: s.auth,
      payload: batchFromFixture('session-v10.lua'),
    });
    expect(res.statusCode, res.body).toBe(200);
    // One quest in Eastvale (Elwynn 80, 60): far enough for a travel step, worth a level.
    await q(`insert into sources (key, kind, url, site, tier, game_version)
             values ('wowhead:quest=90001', 'web', 'https://www.wowhead.com/forever/quest=90001', 'wowhead', 3, 'forever')`);
    const marshal = [
      {
        id: 900,
        kind: 'npc',
        name: 'Marshal |cffTest',
        coords: [[80, 60]],
        zoneName: 'Elwynn Forest',
        wowheadZone: 12,
      },
    ];
    const claims: [string, unknown][] = [
      ['name', 'Wolves of Eastvale'],
      ['level', 11],
      ['req_level', 10],
      ['xp_reward', 6000],
      ['side', 'Alliance'],
      ['starts_at', marshal],
      ['ends_at', marshal],
      [
        'objective_spots',
        [
          {
            id: 901,
            kind: 'npc',
            name: 'Eastvale Wolf',
            role: 'target',
            coords: [[81, 61]],
            zoneName: 'Elwynn Forest',
            wowheadZone: 12,
          },
        ],
      ],
    ];
    for (const [i, [attribute, value]] of claims.entries()) {
      await q(
        `insert into claims (source_id, entity_type, entity_key, entity_id, attribute, value, value_hash, label, parser)
         select id, 'quest', '90001', 90001, $1, $2, $3, 'VERIFIED', 'wowhead@5' from sources where key = 'wowhead:quest=90001'`,
        [attribute, JSON.stringify(value), `p${i}`],
      );
    }
    await q(
      `insert into quests (quest_id, title, level, objectives) values (90001, 'Wolves of Eastvale', 11, $1)`,
      [JSON.stringify(['0/5 Eastvale Wolf slain'])],
    );
    forgetAtlas(s.database.db);
  });
  afterAll(() => s?.stop());

  it('a character with stored state gets a guide planned for it, travel steps included', async () => {
    const made = await createGuide(s.database.db, {
      character: NAME,
      toLevel: 12,
      requestedBy: 'discord:1',
    });
    expect(made).toMatchObject({
      character: NAME,
      basedOn: 'the route planner',
      planned: true,
      title: 'Planned: Elwynn Forest 11–12',
      reachedTarget: true,
      tray: true,
    });
    expect(Array.isArray(made.gaps)).toBe(true);
    const doc = GuideDoc.parse(made.doc);
    expect(doc).toMatchObject({ planned: true, fromLevel: 11, toLevel: 12 });
    const actions = doc.steps.map((x) => x.action);
    expect(actions[0]).toBe('travel');
    expect(actions.slice(1)).toEqual(['accept', 'complete', 'turn_in']);
    expect(doc.steps[0]).toMatchObject({
      action: 'travel',
      how: 'walk',
      // Walks name where they end: the quest giver there.
      npc: 'Marshal cffTest',
      zone: 'Elwynn Forest',
      mapId: 1429,
      x: 80,
      y: 60,
      quests: [],
    });
    expect(doc.steps[1]).toMatchObject({ npc: 'Marshal cffTest' });
    expect(doc.steps[1]!.quests[0]).toEqual({
      questId: 90001,
      title: 'Wolves of Eastvale',
      minLevel: 10,
      minLevelFrom: 'wowhead',
    });
    expect(doc.steps[2]!.quests[0]!.objectives).toEqual(['Eastvale Wolf slain: 5']);
    expect(doc.steps[3]).toMatchObject({ action: 'turn_in', levelAfter: 12 });
    const [row] = await q(`select request, title from guides where id = $1`, [made.id]);
    expect(row).toMatchObject({ title: made.title, request: { planned: true, toLevel: 12 } });
  });

  it('GET /v1/guides: format 2 has the travel steps; an old tray gets format 1 without them', async () => {
    const v2 = (await tray('/v1/guides?format=2')).json().guides;
    expect(v2).toHaveLength(1);
    expect(GuideDoc.parse(v2[0])).toMatchObject({ planned: true });
    expect(v2[0].steps.some((x: { action: string }) => x.action === 'travel')).toBe(true);

    const old = await tray('/v1/guides');
    expect(old.statusCode).toBe(200);
    const [g] = old.json().guides;
    expect(g).not.toHaveProperty('planned');
    expect(g.steps.map((x: { action: string }) => x.action)).toEqual([
      'accept',
      'complete',
      'turn_in',
    ]);
    for (const step of g.steps) {
      expect(v1Step(step)).toBe(true);
      expect(step).not.toHaveProperty('how');
      expect(step).not.toHaveProperty('note');
    }
    expect((await tray('/v1/guides?format=1')).json()).toEqual(old.json());
  });

  it('asking for a run to follow still follows a run', async () => {
    await expect(
      createGuide(s.database.db, {
        character: NAME,
        basedOn: 'Nobody At All',
        toLevel: 12,
        requestedBy: 'discord:1',
        preview: true,
      }),
    ).rejects.toThrow(/no guide to build/);
  });

  it('plans from where the character is and says so when the request asked otherwise', async () => {
    const made = await createGuide(s.database.db, {
      character: NAME,
      start: 'Durotar',
      fromLevel: 13,
      toLevel: 14,
      requestedBy: 'x',
      preview: true,
    });
    expect(made).toMatchObject({ planned: true, title: 'Planned: Elwynn Forest 11–14' });
    expect(made.gaps).toContain(`planned from where ${NAME} is: Elwynn Forest`);
    expect(made.gaps).toContain(`planned from ${NAME}'s level 11, not 13`);
    // Asked for where it is (zone or race), at or below its level: nothing to say.
    for (const start of ['elwynn forest', 'human']) {
      const same = await createGuide(s.database.db, {
        character: NAME,
        start,
        fromLevel: 5,
        toLevel: 12,
        requestedBy: 'x',
        preview: true,
      });
      expect(same.gaps.filter((g) => g.startsWith('planned from'))).toEqual([]);
    }
  });

  it('already at the level: says so', async () => {
    await expect(
      createGuide(s.database.db, { character: NAME, toLevel: 11, requestedBy: 'x', preview: true }),
    ).rejects.toThrow(new GuideError(`${NAME} is already level 11`));
  });

  it('leveling_route plans for the asking character when it has stored state', async () => {
    const a = await levelingAnswer(s.database.db, { forCharacter: NAME, toLevel: 12 });
    expect('planned' in a && a.planned).toMatchObject({
      character: NAME,
      title: 'Planned: Elwynn Forest 11–12',
      fromLevel: 11,
      reachedTarget: true,
      stepCount: 4,
      questSteps: 3,
      travelSteps: 1,
    });
    // Without an asking character (or when following a named run): no plan.
    expect(await levelingAnswer(s.database.db, { start: 'human', toLevel: 12 })).not.toHaveProperty(
      'planned',
    );
    expect(
      await levelingAnswer(s.database.db, { forCharacter: NAME, character: 'Rot', toLevel: 12 }),
    ).not.toHaveProperty('planned');
  });

  it('leveling_route plans for an exact name or key match first', async () => {
    // A newer character whose name merely contains the asker's key sorts first in a loose search.
    await q(`insert into characters (key, name, realm, last_seen)
             values ('Thibodeaux Willikers-Bayou Jr-Other', 'Thibodeaux Willikers-Bayou Jr', 'Other', now())`);
    const a = await levelingAnswer(s.database.db, {
      forCharacter: 'Thibodeaux Willikers-Bayou',
      toLevel: 12,
    });
    expect('planned' in a && a.planned).toMatchObject({ character: NAME });
  });
});
