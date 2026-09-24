import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toCsv } from '../src/routes/export.js';
import { chicagoIso } from '../src/time.js';
import { batchFromFixture, schema4Batch, startServer } from './helpers.js';

type Server = Awaited<ReturnType<typeof startServer>>;

describe('analysis and export routes', () => {
  let s: Server;
  const get = (url: string, headers: Record<string, string> = s.readerAuth) =>
    s.app.inject({ method: 'GET', url, headers });

  beforeAll(async () => {
    s = await startServer();
    const res = await s.app.inject({
      method: 'POST',
      url: '/v1/ingest',
      headers: s.auth,
      payload: batchFromFixture('session-v1.lua'),
    });
    expect(res.statusCode).toBe(200);
  });
  afterAll(async () => {
    await s?.stop();
  });

  it('requires a token', async () => {
    expect((await get('/v1/runs/summary', {})).statusCode).toBe(401);
    expect((await get('/v1/export', {})).statusCode).toBe(401);
  });

  it('returns XP per minute per dungeon with boss splits', async () => {
    const res = await get('/v1/runs/summary?build=61582');
    expect(res.statusCode).toBe(200);
    const [deadmines] = res.json();
    // 1200 + 2300 mob XP + 850 quest XP over 930 active seconds
    expect(deadmines).toMatchObject({
      instanceId: 36,
      instance: 'The Deadmines',
      build: 61582,
      runs: 1,
      bestActiveSecs: 930,
      xpPerMinute: 280.6,
      mobXpPerMinute: 225.8,
      questXpPerMinute: 54.8,
      avgDeaths: 1,
    });
    expect(deadmines.bosses.map((b: { name: string }) => b.name)).toEqual([
      "Rhahk'Zor",
      'Edwin VanCleef',
    ]);
    const all = (await get('/v1/runs/summary')).json();
    expect(all).toHaveLength(2);
  });

  it('returns drop rates from schema 3 sessions, summed over sessions and accounts', async () => {
    const build = 69977;
    const post = async (session: string, account: string, drops: object[], corpses: object[]) => {
      const b = batchFromFixture('session-v2.lua', account);
      const res = await s.app.inject({
        method: 'POST',
        url: '/v1/ingest',
        headers: s.auth,
        payload: {
          ...b,
          schemaVersion: 3,
          meta: { ...b.meta, schemaVersion: 3, session },
          records: { drops, corpses },
        },
      });
      expect(res.statusCode).toBe(200);
    };
    const drop = (
      session: string,
      itemId: number,
      npcId: number,
      count: number,
      quantity: number,
    ) => ({
      itemId,
      build,
      npcId,
      session,
      count,
      quantity,
    });
    // Two sessions on one account with identical counts, and one on another account.
    for (const [session, account] of [
      ['1790000000-aaaa', 'RATES1'],
      ['1790000900-bbbb', 'RATES1'],
    ] as const) {
      await post(
        session,
        account,
        [drop(session, 2589, 1234, 3, 4), drop(session, 5555, 1234, 1, 1)],
        [{ npcId: 1234, build, session, count: 10, copper: 100 }],
      );
    }
    await post(
      '1790001800-cccc',
      'RATES2',
      [drop('1790001800-cccc', 2589, 1234, 2, 2), drop('1790001800-cccc', 2589, 99, 1, 1)],
      [{ npcId: 1234, build, session: '1790001800-cccc', count: 5, copper: 95 }],
    );
    // Legacy running totals (session '') have no corpses and must not inflate the rate.
    await post('', 'RATES3', [drop('', 2589, 1234, 50, 50)], []);
    // Nor when a legacy-session table also recorded corpses (a table from before 0.2.4 that Forever did load back).
    await post(
      '',
      'RATES4',
      [drop('', 2589, 1234, 55, 55)],
      [{ npcId: 1234, build, session: '', count: 19, copper: 5 }],
    );

    const res = await get(`/v1/drops/rates?build=${build}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        build,
        npcId: 1234,
        itemId: 2589,
        itemName: null,
        corpses: 25,
        dropped: 8,
        rate: 0.32,
        quantity: 10,
        avgCopper: 11.8,
      },
      {
        build,
        npcId: 1234,
        itemId: 5555,
        itemName: "Swampwalker's Boots",
        corpses: 25,
        dropped: 2,
        rate: 0.08,
        quantity: 2,
        avgCopper: 11.8,
      },
    ]);
    expect((await get('/v1/drops/rates?build=1')).json()).toEqual([]);
    expect((await get('/v1/drops/rates', {})).statusCode).toBe(401);
  });

  it('returns offered vs paid quest XP', async () => {
    const res = await get('/v1/quests/xp');
    expect(res.json()).toEqual([
      expect.objectContaining({
        questId: 1234,
        build: 61582,
        title: 'Red Silk Bandanas',
        xpOffered: 850,
        turnIns: 1,
        avgXpPaid: 850,
        suggestedGroup: 5,
      }),
    ]);
  });

  it('returns an item across builds with drop sources and spec fits', async () => {
    const res = await get('/v1/items/872');
    expect(res.statusCode).toBe(200);
    const item = res.json();
    expect(item.snapshots.map((x: { build: number }) => x.build)).toEqual([61600, 61582]);
    expect(item.dropSources[0]).toMatchObject({ npcId: 644, count: 1 });
    expect(item.specs.fits[0]).toMatchObject({ cls: 'WARRIOR', score: expect.any(Number) });
    expect((await get('/v1/items/5556')).json().questRewards[0]).toMatchObject({
      questId: 1234,
      kind: 'choice',
    });
    expect((await get('/v1/items/1')).statusCode).toBe(404);
  });

  it('exports JSON with Chicago timestamps and CSV per table', async () => {
    const json = (await get('/v1/export')).json();
    expect(json.timeZone).toBe('America/Chicago');
    expect(json.tables.runs).toHaveLength(2);
    expect(json.tables.runs[0].startedAt).toMatch(/^2026-.*-0[56]:00$/);
    expect(json.tables).not.toHaveProperty('api_tokens');
    const csv = await get('/v1/export?format=csv&table=turn_ins');
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.body.split('\n')[0]).toBe(
      'id,questId,build,char,xp,money,level,turnedInAt,runId,choiceIndex,choiceItemId,updatedAt',
    );
    expect((await get('/v1/export?format=csv&table=crafts')).body.split('\n')[0]).toBe(
      'recipeId,build,uploaderId,account,session,casts,qty,procs,skillUps,updatedAt',
    );
    expect((await get('/v1/export?format=csv&table=trainers')).body.split('\n')[0]).toBe(
      'npcId,build,name,title,loc,skillLineId,seenAt,complete,services,updatedAt',
    );
    expect((await get('/v1/export?format=csv&table=recipe_difficulty')).statusCode).toBe(200);
    expect(json.tables).toHaveProperty('api_samples');
    expect((await get('/v1/export?format=csv')).statusCode).toBe(400);
    expect((await get('/v1/export?table=api_tokens')).statusCode).toBe(400);
  });
});

describe('profession routes', () => {
  let s: Server;
  const get = (url: string, headers: Record<string, string> = s.readerAuth) =>
    s.app.inject({ method: 'GET', url, headers });
  const build = 69977;
  const S1 = '1790100000-c0de';
  const S2 = '1790100900-d00d';
  const other = 'Boudreaux-Bayou';

  beforeAll(async () => {
    s = await startServer();
    // The fixture twice (two sessions of one account, identical counts), with the recipe item dropping once per
    // session; then a second character's recipe scan with its own difficulty ranges.
    for (const session of [S1, S2]) {
      const b = schema4Batch(session, 'PROF1');
      b.records.drops = [{ itemId: 6270, build, npcId: 1234, session, count: 1, quantity: 1 }];
      const res = await s.app.inject({
        method: 'POST',
        url: '/v1/ingest',
        headers: s.auth,
        payload: b,
      });
      expect(res.statusCode).toBe(200);
    }
    const b = schema4Batch('1790101800-beef', 'PROF2');
    b.records = {
      ...b.records,
      recipeStatus: [
        {
          recipeId: 2963,
          build,
          char: other,
          learned: true,
          difficulty: 'medium',
          rank: 40,
          seenAt: 1790101900,
        },
      ],
      recipeDifficulty: [
        { recipeId: 2963, build, char: other, difficulty: 'optimal', minRank: 5, maxRank: 20 },
        { recipeId: 2963, build, char: other, difficulty: 'medium', minRank: 26, maxRank: 40 },
      ],
      recipesLearned: [],
      crafts: [],
      nodes: [],
      nodeLoot: [],
    };
    const res = await s.app.inject({
      method: 'POST',
      url: '/v1/ingest',
      headers: s.auth,
      payload: b,
    });
    expect(res.statusCode).toBe(200);
  });
  afterAll(async () => {
    await s?.stop();
  });

  it('require a token', async () => {
    for (const url of [
      '/v1/professions/recipes',
      '/v1/professions/sources?recipeId=2963',
      '/v1/professions/gathering',
      '/v1/professions/skills',
    ])
      expect((await get(url, {})).statusCode).toBe(401);
  });

  it('lists recipes with schematics, difficulty thresholds and how they were learned', async () => {
    const res = await get(`/v1/professions/recipes?skillLine=197&build=${build}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        recipeId: 7629,
        name: 'Blue Linen Vest',
        skillLineId: 197,
        categoryId: null,
        profession: { skillLineId: 197, name: 'Tailoring' },
        learnedBy: 1,
        learnedVia: [{ via: 'item:6270', count: 1 }],
        builds: [
          {
            build,
            outputItemId: 6240,
            outputItemName: null,
            qtyMin: 1,
            qtyMax: 1,
            reagents: [
              { itemId: 2996, name: 'Bolt of Linen Cloth', qty: 3 },
              { itemId: 2320, name: null, qty: 1 },
            ],
            maxTrivial: null,
            sourceText: 'Pattern: Blue Linen Vest',
            difficulty: [],
          },
        ],
      },
      {
        recipeId: 2963,
        name: 'Bolt of Linen Cloth',
        skillLineId: 197,
        categoryId: 1001,
        profession: { skillLineId: 197, name: 'Tailoring' },
        learnedBy: 2,
        learnedVia: [{ via: 'trainer:1346', count: 1 }],
        builds: [
          {
            build,
            outputItemId: 2996,
            outputItemName: 'Bolt of Linen Cloth',
            qtyMin: 1,
            qtyMax: 1,
            reagents: [{ itemId: 2589, name: 'Linen Cloth', qty: 2 }],
            maxTrivial: 25,
            sourceText: null,
            difficulty: [
              { difficulty: 'optimal', minRank: 1, maxRank: 20, chars: 2 },
              { difficulty: 'medium', minRank: 26, maxRank: 40, chars: 1 },
            ],
          },
        ],
      },
    ]);
    expect((await get('/v1/professions/recipes')).json()).toHaveLength(2);
    expect((await get('/v1/professions/recipes?skillLine=186')).json()).toEqual([]);
    expect((await get('/v1/professions/recipes?build=1')).json()).toEqual([]);
  });

  it('finds recipe sources: vendors and drops of the recipe item', async () => {
    const res = await get('/v1/professions/sources?recipeId=7629');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      recipeId: 7629,
      recipes: [{ recipeId: 7629, name: 'Blue Linen Vest' }],
      recipeItems: [{ itemId: 6270, name: 'Pattern: Blue Linen Vest' }],
      trainers: [],
      vendors: [
        {
          npcId: 1347,
          npcName: 'Alexandra Bolero',
          npcTitle: null,
          build,
          loc: { zone: 'Stormwind City', subzone: 'The Canals', mapID: 1453, x: 43.2, y: 74.1 },
          seenAt: expect.stringMatching(/^2026-.*-0[56]:00$/),
          itemId: 6270,
          itemName: 'Pattern: Blue Linen Vest',
          price: 200,
          stack: 1,
          numAvailable: 1,
          currencyId: null,
          extendedCost: false,
          costs: null,
        },
      ],
      drops: [
        {
          itemId: 6270,
          itemName: 'Pattern: Blue Linen Vest',
          build,
          npcId: 1234,
          objectId: null,
          count: 2,
          quantity: 2,
          contributors: 2,
        },
      ],
    });
  });

  it('finds trainers by recipe name or created item', async () => {
    const byRecipe = (await get('/v1/professions/sources?recipeId=2963')).json();
    expect(byRecipe.trainers).toEqual([
      {
        npcId: 1346,
        npcName: 'Georgio Bolero',
        npcTitle: null,
        build,
        loc: { zone: 'Stormwind City', subzone: 'The Canals', mapID: 1453, x: 43.4, y: 73.8 },
        skillLineId: 197,
        skillLineName: 'Tailoring',
        seenAt: expect.stringMatching(/-0[56]:00$/),
        service: 'Bolt of Linen Cloth',
        type: 'used',
        cost: 0,
        skill: 'Tailoring',
        skillRank: 0,
        level: 0,
        itemId: 2996,
      },
    ]);
    expect(byRecipe).toMatchObject({ recipeItems: [], vendors: [], drops: [] });

    // An item stands for the recipes creating it: the trainer's shirt service and the thread vendor.
    const shirt = (await get('/v1/professions/sources?itemId=4344')).json();
    expect(shirt.trainers).toEqual([
      expect.objectContaining({
        npcId: 1346,
        service: 'Brown Linen Shirt',
        cost: 50,
        skillRank: 10,
        level: 5,
      }),
    ]);
    const thread = (await get('/v1/professions/sources?itemId=2320')).json();
    expect(thread).toMatchObject({ itemId: 2320, recipes: [], trainers: [], drops: [] });
    expect(thread.vendors).toEqual([
      expect.objectContaining({ npcId: 1347, itemId: 2320, price: 10, numAvailable: -1 }),
    ]);
    // The recipe item itself leads to the recipe it teaches.
    const pattern = (await get('/v1/professions/sources?itemId=6270')).json();
    expect(pattern.recipes).toEqual([{ recipeId: 7629, name: 'Blue Linen Vest' }]);
    expect(pattern.drops).toHaveLength(1);
  });

  it('finds a recipe item by name, chests that held it, and node loot on the item page', async () => {
    const other = 70002;
    const b = schema4Batch('1790103600-bbbb', 'PROF4');
    for (const kind of Object.keys(b.records) as (keyof typeof b.records)[])
      (b.records[kind] as unknown[]) = [];
    const session = '1790103600-bbbb';
    b.records = {
      ...b.records,
      recipes: [{ recipeId: 2661, name: 'Copper Chain Belt', skillLineId: 164 }],
      items: [{ itemId: 2881, name: 'Plans: Copper Chain Belt', classId: 9, subclassId: 4 }],
      nodes: [
        { objectId: 2843, build: other, session, opened: 3, name: 'Battered Chest', spots: [] },
      ],
      nodeLoot: [{ itemId: 2881, objectId: 2843, build: other, session, count: 1, quantity: 1 }],
    };
    const res = await s.app.inject({
      method: 'POST',
      url: '/v1/ingest',
      headers: s.auth,
      payload: b,
    });
    expect(res.statusCode).toBe(200);

    // No one learned it from the plans yet: "Plans: Copper Chain Belt" still names the recipe.
    const plans = (await get('/v1/professions/sources?itemId=2881')).json();
    expect(plans.recipes).toEqual([{ recipeId: 2661, name: 'Copper Chain Belt' }]);
    expect(plans.recipeItems).toEqual([{ itemId: 2881, name: 'Plans: Copper Chain Belt' }]);
    expect(plans.drops).toEqual([
      {
        itemId: 2881,
        itemName: 'Plans: Copper Chain Belt',
        build: other,
        npcId: null,
        objectId: 2843,
        count: 1,
        quantity: 1,
        contributors: 1,
      },
    ]);
    const byRecipe = (await get('/v1/professions/sources?recipeId=2661')).json();
    expect(byRecipe.drops).toEqual(plans.drops);

    const item = (await get('/v1/items/2881')).json();
    expect(item.nodeSources).toEqual([
      { build: other, objectId: 2843, name: 'Battered Chest', opens: 3, count: 1, quantity: 1 },
    ]);
  });

  it('validates sources parameters', async () => {
    expect((await get('/v1/professions/sources')).statusCode).toBe(400);
    expect((await get('/v1/professions/sources?itemId=1&recipeId=2')).statusCode).toBe(400);
    expect((await get('/v1/professions/sources?recipeId=abc')).statusCode).toBe(400);
    expect((await get('/v1/professions/sources?recipeId=99999')).statusCode).toBe(404);
  });

  it('summarises gathering per node: opens over sessions, rank, zones and loot per open', async () => {
    const res = await get(`/v1/professions/gathering?build=${build}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        build,
        objectId: 1731,
        name: 'Copper Vein',
        skillLineId: 186,
        skillLineName: 'Mining',
        opens: 6,
        rankMin: 29,
        zones: [{ mapId: 1429, spots: 2 }],
        loot: [
          { itemId: 2770, name: null, count: 6, quantity: 10, perOpen: 1, qtyPerOpen: 1.6667 },
          { itemId: 2835, name: null, count: 2, quantity: 2, perOpen: 0.3333, qtyPerOpen: 0.3333 },
        ],
      },
      {
        build,
        objectId: 0,
        name: null,
        skillLineId: 356,
        skillLineName: null,
        opens: 4,
        rankMin: null,
        zones: [{ mapId: 1429, spots: 1 }],
        loot: [{ itemId: 6303, name: null, count: 4, quantity: 4, perOpen: 1, qtyPerOpen: 1 }],
      },
    ]);
    expect((await get('/v1/professions/gathering?build=1')).json()).toEqual([]);
  });

  it('names a node by the name most sessions saw, not the greatest string', async () => {
    const other = 70001;
    const b = schema4Batch('1790102700-aaaa', 'PROF3');
    const node = (session: string, name: string) => ({
      objectId: 1731,
      build: other,
      session,
      opened: 1,
      name,
      spots: [],
    });
    b.records = {
      ...b.records,
      nodes: [node('S-a', 'Copper Vein'), node('S-b', 'Tin Vein'), node('S-c', 'Copper Vein')],
    };
    for (const kind of Object.keys(b.records) as (keyof typeof b.records)[])
      if (kind !== 'nodes') (b.records[kind] as unknown[]) = [];
    const res = await s.app.inject({
      method: 'POST',
      url: '/v1/ingest',
      headers: s.auth,
      payload: b,
    });
    expect(res.statusCode).toBe(200);
    const nodes = (await get(`/v1/professions/gathering?build=${other}`)).json();
    expect(nodes).toMatchObject([{ objectId: 1731, name: 'Copper Vein', opens: 3 }]);
  });
});

describe("the real addon's schema 4 session (session-v4.lua)", () => {
  let s: Server;
  const get = (url: string) => s.app.inject({ method: 'GET', url, headers: s.readerAuth });
  const build = 61582;
  const batch = batchFromFixture('session-v4.lua', 'ADDON-V4');
  const loc = { zone: 'Elwynn Forest', subzone: 'Goldshire', mapID: 1429, x: 42.1, y: 65.9 };

  beforeAll(async () => {
    s = await startServer();
  });
  afterAll(async () => {
    await s?.stop();
  });

  it('ingests with 200 and every professions table gets rows', async () => {
    expect(batch.schemaVersion).toBe(4);
    const res = await s.app.inject({
      method: 'POST',
      url: '/v1/ingest',
      headers: s.auth,
      payload: batch,
    });
    expect(res.statusCode).toBe(200);
    const tables = {
      skills: 5,
      skill_ups: 1,
      recipes: 3,
      recipe_snapshots: 3,
      recipe_status: 3,
      recipe_difficulty: 4,
      recipes_learned: 2,
      crafts: 2,
      nodes: 2,
      node_loot: 2,
      trainers: 1,
      vendors: 1,
      api_samples: 16,
    };
    const counts = Object.fromEntries(
      await Promise.all(Object.keys(tables).map(async (t) => [t, await s.count(t)])),
    );
    expect(counts).toEqual(tables);
    const errors = await s.database.pool.query(
      `select sample from api_samples where api = 'ForeverLedger.errors'`,
    );
    expect(errors.rows[0].sample).toEqual({
      'blocked:UseAction()': { msg: 'UseAction()', count: 1, last: expect.any(Number) },
    });
    const { rows } = await s.database.pool.query(
      `select sample from api_samples where api = 'NEW_RECIPE_LEARNED'`,
    );
    expect(rows[0].sample).toEqual({ 1: 2393, 3: 2393 });
  });

  it('/v1/professions/recipes: schematics, observed difficulty and how each recipe was learned', async () => {
    const res = await get(`/v1/professions/recipes?skillLine=197&build=${build}`);
    expect(res.statusCode).toBe(200);
    const recipes = res.json() as { recipeId: number }[];
    expect(recipes.map((r) => r.recipeId).sort()).toEqual([2389, 2393, 2963]);
    const byId = new Map(recipes.map((r) => [r.recipeId, r]));
    expect(byId.get(2393)).toMatchObject({
      name: 'Brown Linen Vest',
      learnedVia: [{ via: 'trainer:1103', count: 1 }],
      builds: [
        {
          build,
          outputItemId: 2568,
          outputItemName: 'Brown Linen Vest',
          reagents: [
            { itemId: 2996, name: 'Bolt of Linen Cloth', qty: 1 },
            { itemId: 2320, name: 'Coarse Thread', qty: 1 },
          ],
          difficulty: [
            { difficulty: 'optimal', minRank: 50, maxRank: 50, chars: 1 },
            { difficulty: 'medium', minRank: 51, maxRank: 51, chars: 1 },
          ],
        },
      ],
    });
    expect(byId.get(2389)).toMatchObject({
      learnedVia: [{ via: 'item:2598', count: 1 }],
      builds: [{ qtyMin: 1, qtyMax: null, sourceText: '|cffffd100Vendor: |rMisensi' }],
    });
  });

  it('/v1/professions/sources: the trainer, the vendor and the pattern of a recipe', async () => {
    const robe = await get('/v1/professions/sources?recipeId=2389');
    expect(robe.statusCode).toBe(200);
    expect(robe.json()).toMatchObject({
      recipes: [{ recipeId: 2389, name: 'Red Linen Robe' }],
      recipeItems: [{ itemId: 2598, name: 'Pattern: Red Linen Robe' }],
      trainers: [{ npcId: 1103, npcName: 'Eldrin', loc, service: 'Red Linen Robe', cost: 250 }],
      vendors: [{ npcId: 1347, npcName: 'Alexandra Bolero', loc, itemId: 2598, price: 1200 }],
      drops: [],
    });
    const thread = (await get('/v1/professions/sources?itemId=2320')).json();
    expect(thread.vendors).toEqual([
      expect.objectContaining({ npcId: 1347, itemId: 2320, price: 10, stack: 5, numAvailable: -1 }),
    ]);
  });

  it('/v1/professions/skills: every profession with its skill-up', async () => {
    const res = await get('/v1/professions/skills');
    expect(res.statusCode).toBe(200);
    const [char] = res.json();
    expect(
      char.professions.map((p: { name: string; skillLineIds: number[] }) => [
        p.name,
        p.skillLineIds,
      ]),
    ).toEqual([
      ['First Aid', [129]],
      ['Fishing', [356]],
      ['Herbalism', [182]],
      ['Mining', [186]],
      ['Tailoring', [197]],
    ]);
    expect(char.professions.flatMap((p: { skillUps: unknown[] }) => p.skillUps)).toHaveLength(1);
  });

  it('/v1/professions/gathering: the mined vein and fishing', async () => {
    const res = await get(`/v1/professions/gathering?build=${build}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        build,
        objectId: 1731,
        name: 'Copper Vein',
        skillLineId: 186,
        skillLineName: 'Mining',
        opens: 2,
        rankMin: 70,
        zones: [{ mapId: 1429, spots: 2 }],
        loot: [
          { itemId: 2770, name: 'Copper Ore', count: 2, quantity: 4, perOpen: 1, qtyPerOpen: 2 },
        ],
      },
      {
        build,
        objectId: 0,
        name: null,
        skillLineId: 356,
        skillLineName: 'Fishing',
        opens: 1,
        rankMin: 25,
        zones: [{ mapId: 1429, spots: 1 }],
        loot: [
          {
            itemId: 6303,
            name: 'Raw Slitherskin Mackerel',
            count: 1,
            quantity: 1,
            perOpen: 1,
            qtyPerOpen: 1,
          },
        ],
      },
    ]);
  });
});

describe("the real addon's schema 5 session (session-v5.lua): vendor costs and NPC titles", () => {
  let s: Server;
  const get = (url: string) => s.app.inject({ method: 'GET', url, headers: s.readerAuth });
  const batch = batchFromFixture('session-v5.lua', 'ADDON-V5');

  beforeAll(async () => {
    s = await startServer();
  });
  afterAll(async () => {
    await s?.stop();
  });

  it('ingests with 200: two vendors, a titled trainer and the new API samples', async () => {
    expect(batch.schemaVersion).toBe(5);
    const res = await s.app.inject({
      method: 'POST',
      url: '/v1/ingest',
      headers: s.auth,
      payload: batch,
    });
    expect(res.statusCode).toBe(200);
    expect(await s.count('vendors')).toBe(2);
    expect(await s.count('trainers')).toBe(1);
    const { rows } = await s.database.pool.query(`select api from api_samples order by api`);
    expect(rows.map((r) => r.api)).toEqual(
      expect.arrayContaining([
        'C_TooltipInfo.GetUnit',
        'C_TooltipInfo.GetUnit:line',
        'GetMerchantCurrencies',
        'GetMerchantItemCostInfo',
        'GetMerchantItemCostItem',
        'GetMerchantItemCostItem:currency',
      ]),
    );
  });

  it('/v1/professions/sources: vendor title and costs (cost item names from items), trainer title', async () => {
    const robe = await get('/v1/professions/sources?recipeId=2389');
    expect(robe.statusCode).toBe(200);
    const body = robe.json();
    expect(body.trainers).toEqual([
      expect.objectContaining({
        npcId: 1103,
        npcName: 'Eldrin',
        npcTitle: 'Tailoring Trainer',
        service: 'Red Linen Robe',
      }),
    ]);
    expect(body.vendors).toEqual([
      expect.objectContaining({
        npcId: 1347,
        npcName: 'Alexandra Bolero',
        npcTitle: null,
        itemId: 2598,
        price: 1200,
        costs: null,
      }),
      expect.objectContaining({
        npcId: 248196,
        npcName: 'Beneris',
        npcTitle: 'Tailoring',
        itemId: 2598,
        itemName: 'Pattern: Red Linen Robe',
        price: 0,
        extendedCost: true,
        costs: [
          { amount: 3, itemId: 250001, name: 'Mark of the Barrens' },
          { amount: 25, currencyId: 1901, name: 'Honor Points' },
        ],
      }),
    ]);
  });

  it('cost item names come from the items table when the record has none', async () => {
    await s.database.pool.query(
      `update vendors set items = jsonb_set(items, '{0,costs,0}', '{"amount": 3, "itemId": 250001}')
       where npc_id = 248196`,
    );
    const body = (await get('/v1/professions/sources?itemId=2598')).json();
    const beneris = body.vendors.find((v: { npcId: number }) => v.npcId === 248196);
    expect(beneris.costs[0]).toEqual({ amount: 3, itemId: 250001, name: 'Mark of the Barrens' });
  });
});

describe('skill line folding (Forever lists each profession twice: a base line and a "Classic" child)', () => {
  let s: Server;
  const get = (url: string, headers: Record<string, string> = s.readerAuth) =>
    s.app.inject({ method: 'GET', url, headers });
  const build = 69977;
  const F = 'Fontenot-Bayou';
  const G = 'Guidry-Bayou';
  const seen = 1790200000;
  const session = '1790200000-f01d';
  const skill = (char: string, skillLineId: number, name: string, rank: number, extra = {}) => ({
    char,
    skillLineId,
    name,
    rank,
    maxRank: 75,
    lastSeen: seen,
    ...extra,
  });
  /** The live shape: one rise recorded once per line, on the base and on its child. */
  const rise = (
    char: string,
    lines: number[],
    from: number,
    time: number,
    recipeIds: (number | undefined)[] = [],
    b = build,
  ) =>
    lines.map((skillLineId, i) => ({
      char,
      skillLineId,
      from,
      to: from + 1,
      build: b,
      time,
      ...(recipeIds[i] === undefined ? {} : { recipeId: recipeIds[i] }),
    }));
  const ts = (secs: number) => chicagoIso(secs * 1000);

  beforeAll(async () => {
    s = await startServer();
    const b = schema4Batch(session, 'FOLD1');
    for (const kind of Object.keys(b.records) as (keyof typeof b.records)[])
      (b.records[kind] as unknown[]) = [];
    b.records = {
      ...b.records,
      skills: [
        skill(F, 164, 'Blacksmithing', 60, { parentId: 0 }),
        skill(F, 2938, 'Blacksmithing', 60, { parentId: 164 }),
        skill(F, 186, 'Mining', 40),
        skill(F, 2946, 'Mining', 40, { parentId: 186, maxRank: 150 }),
        // Alchemy's base line (171) was never seen: the child stands for itself.
        skill(F, 2937, 'Alchemy', 5, { parentId: 171 }),
        // G only has the child line; the base is known from F.
        skill(G, 2938, 'Blacksmithing', 10, { parentId: 164 }),
      ],
      skillUps: [
        ...rise(F, [164, 2938], 59, 1790199900, [3115, 3115]),
        ...rise(F, [164, 2938], 58, 1790199800, [undefined, 2662]),
        ...rise(F, [164, 2938], 57, 1790190000, [], 70000),
        ...rise(F, [186, 2946], 39, 1790199700, [2657, 2657]),
        ...rise(G, [2938], 9, 1790199600),
      ],
      recipes: [
        { recipeId: 2660, name: 'Rough Sharpening Stone', skillLineId: 164 },
        { recipeId: 2662, name: 'Copper Chain Pants', skillLineId: 2938 },
        { recipeId: 3115, name: 'Rough Weightstone', skillLineId: 2938 },
        { recipeId: 2330, name: 'Minor Healing Potion', skillLineId: 2937 },
        { recipeId: 2657, name: 'Smelt Copper', skillLineId: 2946 },
      ],
      nodes: [
        {
          objectId: 1731,
          build,
          session,
          opened: 2,
          name: 'Copper Vein',
          skillLineId: 2946,
          spots: [],
        },
      ],
      trainers: [
        {
          npcId: 1241,
          build,
          name: 'Brombar Higgleby',
          skillLineId: 2938,
          seenAt: seen,
          services: [{ name: 'Rough Weightstone', type: 'available', cost: 10, skillRank: 25 }],
        },
      ],
    };
    const res = await s.app.inject({
      method: 'POST',
      url: '/v1/ingest',
      headers: s.auth,
      payload: b,
    });
    expect(res.statusCode).toBe(200);
  });
  afterAll(async () => {
    await s?.stop();
  });

  it('/v1/professions/recipes: a base or child id lists the recipes of the base and all its children', async () => {
    const blacksmithing = { skillLineId: 164, name: 'Blacksmithing' };
    const expected = [
      { recipeId: 2662, name: 'Copper Chain Pants', skillLineId: 2938, profession: blacksmithing },
      {
        recipeId: 2660,
        name: 'Rough Sharpening Stone',
        skillLineId: 164,
        profession: blacksmithing,
      },
      { recipeId: 3115, name: 'Rough Weightstone', skillLineId: 2938, profession: blacksmithing },
    ];
    for (const line of [164, 2938]) {
      const res = await get(`/v1/professions/recipes?skillLine=${line}`);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(expected.map((r) => expect.objectContaining(r)));
    }
    expect((await get('/v1/professions/recipes?skillLine=186')).json()).toEqual([
      expect.objectContaining({
        recipeId: 2657,
        skillLineId: 2946,
        profession: { skillLineId: 186, name: 'Mining' },
      }),
    ]);
    // A child whose base was never seen is its own base.
    for (const line of [2937, 171])
      expect((await get(`/v1/professions/recipes?skillLine=${line}`)).json()).toEqual(
        line === 171
          ? []
          : [
              expect.objectContaining({
                recipeId: 2330,
                profession: { skillLineId: 2937, name: 'Alchemy' },
              }),
            ],
      );
    expect((await get('/v1/professions/recipes')).json()).toHaveLength(5);
  });

  it('/v1/professions/gathering and /sources: skill lines fold to the base', async () => {
    expect((await get(`/v1/professions/gathering?build=${build}`)).json()).toEqual([
      expect.objectContaining({ objectId: 1731, skillLineId: 186, skillLineName: 'Mining' }),
    ]);
    const src = (await get('/v1/professions/sources?recipeId=3115')).json();
    expect(src.trainers).toEqual([
      expect.objectContaining({
        npcId: 1241,
        skillLineId: 164,
        skillLineName: 'Blacksmithing',
        service: 'Rough Weightstone',
      }),
    ]);
  });

  it('/v1/professions/skills: base professions per character with folded skill-up history', async () => {
    expect((await get('/v1/professions/skills', {})).statusCode).toBe(401);
    const res = await get(`/v1/professions/skills?char=${F}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        char: F,
        professions: [
          {
            skillLineId: 2937,
            name: 'Alchemy',
            skillLineIds: [2937],
            rank: 5,
            maxRank: 75,
            lastSeen: ts(seen),
            skillUps: [],
          },
          {
            skillLineId: 164,
            name: 'Blacksmithing',
            skillLineIds: [164, 2938],
            rank: 60,
            maxRank: 75,
            lastSeen: ts(seen),
            skillUps: [
              {
                build,
                fromRank: 59,
                toRank: 60,
                observedAt: ts(1790199900),
                recipeId: 3115,
                recipeName: 'Rough Weightstone',
              },
              {
                build,
                fromRank: 58,
                toRank: 59,
                observedAt: ts(1790199800),
                recipeId: 2662,
                recipeName: 'Copper Chain Pants',
              },
              {
                build: 70000,
                fromRank: 57,
                toRank: 58,
                observedAt: ts(1790190000),
                recipeId: null,
                recipeName: null,
              },
            ],
          },
          {
            skillLineId: 186,
            name: 'Mining',
            skillLineIds: [186, 2946],
            rank: 40,
            maxRank: 150,
            lastSeen: ts(seen),
            skillUps: [
              {
                build,
                fromRank: 39,
                toRank: 40,
                observedAt: ts(1790199700),
                recipeId: 2657,
                recipeName: 'Smelt Copper',
              },
            ],
          },
        ],
      },
    ]);

    const inBuild = (await get(`/v1/professions/skills?char=${F}&build=${build}`)).json();
    expect(inBuild[0].professions[1].skillUps.map((u: { toRank: number }) => u.toRank)).toEqual([
      60, 59,
    ]);

    const all = (await get('/v1/professions/skills')).json();
    expect(all.map((c: { char: string }) => c.char)).toEqual([F, G]);
    expect(all[1].professions).toEqual([
      {
        skillLineId: 164,
        name: 'Blacksmithing',
        skillLineIds: [2938],
        rank: 10,
        maxRank: 75,
        lastSeen: ts(seen),
        skillUps: [
          {
            build,
            fromRank: 9,
            toRank: 10,
            observedAt: ts(1790199600),
            recipeId: null,
            recipeName: null,
          },
        ],
      },
    ]);
    expect((await get('/v1/professions/skills?char=Nobody-Bayou')).json()).toEqual([]);
  });
});

describe('toCsv', () => {
  it('quotes commas, quotes and newlines and JSON-encodes objects', () => {
    expect(toCsv([{ a: 'x,y', b: 'say "hi"', c: { k: 1 }, d: null }], ['a', 'b', 'c', 'd'])).toBe(
      'a,b,c,d\n"x,y","say ""hi""","{""k"":1}",\n',
    );
  });
});
