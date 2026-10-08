// The atlas loader (knowledge/atlas-load.ts): claims and our own observations read from real Postgres.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadAtlas } from '../src/knowledge/atlas-load.js';
import { startServer } from './helpers.js';

describe('atlas loader', () => {
  let s: Awaited<ReturnType<typeof startServer>>;
  const q = (text: string, params: unknown[] = []) => s.database.pool.query(text, params);
  beforeAll(async () => {
    s = await startServer();
  }, 120_000);
  afterAll(async () => {
    await s?.stop();
  });

  it('merges Wowhead claims with our observations', async () => {
    await q(`insert into sources (key, kind, url, site, tier, game_version)
             values ('wowhead:quest=788', 'web', 'https://www.wowhead.com/forever/quest=788', 'wowhead', 3, 'forever')`);
    const claims: [string, unknown, string][] = [
      ['name', 'Cutting Teeth', 'VERIFIED'],
      ['level', 2, 'VERIFIED'],
      ['req_level', 1, 'VERIFIED'],
      ['xp_reward', 170, 'VERIFIED'],
      ['xp_reward', 999, 'FALSE'],
      ['side', 'Horde', 'VERIFIED'],
      ['races', ['Orc', 'Undead'], 'VERIFIED'],
      [
        'starts_at',
        [
          {
            id: 3143,
            kind: 'npc',
            name: 'Gornek',
            coords: [[42.1, 68.3]],
            zoneName: 'Durotar',
            wowheadZone: 14,
          },
        ],
        'VERIFIED',
      ],
      [
        'ends_at',
        [
          {
            id: 3143,
            kind: 'npc',
            name: 'Gornek',
            coords: [[42.1, 68.3]],
            zoneName: 'Durotar',
            wowheadZone: 14,
          },
        ],
        'VERIFIED',
      ],
      [
        'objective_spots',
        [
          {
            id: 3098,
            kind: 'npc',
            name: 'Mottled Boar',
            role: 'target',
            coords: [[44, 62]],
            zoneName: 'Durotar',
            wowheadZone: 14,
          },
        ],
        'VERIFIED',
      ],
    ];
    for (const [i, [attribute, value, label]] of claims.entries()) {
      await q(
        `insert into claims (source_id, entity_type, entity_key, entity_id, attribute, value, value_hash, label, parser)
         select id, 'quest', '788', 788, $1, $2, $3, $4, 'wowhead@5' from sources where key = 'wowhead:quest=788'`,
        [attribute, JSON.stringify(value), `h${i}`, label],
      );
    }
    await q(
      `insert into quests (quest_id, title, level, objectives) values (788, 'Cutting Teeth', 2, $1)`,
      [JSON.stringify(['0/10 Mottled Boar slain'])],
    );
    await q(
      `insert into quest_observations (quest_id, build, stage, char, level, npc_id, npc_name, npc_loc) values
       (788, 70245, 'complete', 'Grunt-Bayou', 2, 3143, 'Gornek', $1)`,
      [JSON.stringify({ mapID: 1411, x: 42, y: 68.4, zone: 'Durotar', subzone: 'The Den' })],
    );
    for (const [have, x] of [
      [1, 47.2],
      [2, 46.9],
      [3, 52],
      [4, 47.1],
    ] as const) {
      await q(
        `insert into quest_objective_progress (char, quest_id, idx, have, at, need, build, map_id, zone, x, y, uploader_id, account)
         values ('Grunt-Bayou', 788, 1, $1::int, now() + $1::int * interval '20 seconds', 10, 70245, 1411, 'Durotar', $2, 61.2, 'pc-1', 'A')`,
        [have, x],
      );
    }
    await q(`insert into turn_ins (id, quest_id, build, char, level, xp, turned_in_at)
             values ('t1', 788, 70245, 'Grunt-Bayou', 3, 175, now())`);

    const { atlas, gaps } = await loadAtlas(s.database.db);
    expect(gaps).toEqual([]);
    expect(atlas.quests.get(788)).toEqual({
      id: 788,
      title: 'Cutting Teeth',
      level: 2,
      reqLevel: 1,
      side: 'Horde',
      classes: null,
      races: ['Orc', 'Scourge'],
      giver: { id: 3143, name: 'Gornek', kind: 'npc', spots: [{ mapId: 1411, x: 42.1, y: 68.3 }] },
      ender: { id: 3143, name: 'Gornek', kind: 'npc', spots: [{ mapId: 1411, x: 42, y: 68.4 }] },
      prereqs: [],
      objectives: [
        {
          index: 0,
          kind: 'kill',
          text: 'Mottled Boar slain',
          count: 10,
          // One increment every 20 seconds.
          secondsEach: 20,
          // Whole-percent cells, the busiest first.
          spots: [
            { mapId: 1411, x: 47, y: 61 },
            { mapId: 1411, x: 52, y: 61 },
          ],
        },
      ],
      xp: 175,
    });
  });

  // Claims and uploads are untrusted jsonb: a scalar where an array belongs, a location that is a string, a fractional
  // map id or objectives that are not strings must read as nothing, never fail the build.
  it('reads junk jsonb as nothing, and takes the side from the faction of our players', async () => {
    await q(`insert into sources (key, kind, site, tier, game_version)
             values ('wowhead:quest=900', 'web', 'wowhead', 3, 'forever')`);
    const junk: [string, unknown][] = [
      ['name', 'Junk Quest'],
      ['level', 'high'],
      ['starts_at', 5],
      ['ends_at', { id: 1, name: 'Not a list' }],
      ['objective_spots', 'everywhere'],
      ['series', [[{ id: 'x' }], 7, [null]]],
      ['races', 'Orc'],
      ['classes', [1, 2]],
      ['xp_reward', '1000'],
    ];
    for (const [i, [attribute, value]] of junk.entries()) {
      await q(
        `insert into claims (source_id, entity_type, entity_key, entity_id, attribute, value, value_hash, label, parser)
         select id, 'quest', '900', 900, $1, $2, $3, 'VERIFIED', 'wowhead@5' from sources where key = 'wowhead:quest=900'`,
        [attribute, JSON.stringify(value), `j${i}`],
      );
    }
    await q(
      `insert into quests (quest_id, title, level, objectives) values (900, 'Junk Quest', 4, $1)`,
      [JSON.stringify([1, null, { text: 'x' }, '0/3 Boar'])],
    );
    await q(
      `insert into characters (key, name, realm, faction) values ('Grunt-Bayou', 'Grunt', 'Bayou', 'Horde')`,
    );
    await q(
      `insert into quest_observations (quest_id, build, stage, char, level, npc_id, npc_name, npc_loc) values
       (900, 70245, 'detail', 'Grunt-Bayou', 4, 3143, 'Gornek', $1),
       (900, 70245, 'complete', 'Grunt-Bayou', 4, 3143, 'Gornek', $2)`,
      [JSON.stringify('Durotar 42,68'), JSON.stringify({ mapID: 1411.5, x: 42, y: 68 })],
    );
    const { atlas } = await loadAtlas(s.database.db);
    expect(atlas.quests.get(900)).toEqual({
      id: 900,
      title: 'Junk Quest',
      level: 4,
      reqLevel: 1,
      side: 'Horde',
      classes: null,
      races: null,
      giver: null,
      ender: null,
      prereqs: [],
      objectives: [{ index: 3, kind: 'other', text: 'Boar', count: 3, spots: [] }],
      xp: 0,
    });
  });
});
