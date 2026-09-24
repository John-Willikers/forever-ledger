// Recipe details (/admin/api/professions/recipes/:recipeId) and the recipe links added to the vendor, trainer and item
// routes, against a real Postgres: a hand-built batch with a recipe item whose tooltip embeds its output's, trainers
// teaching recipes (one of another profession), vendors and drops of recipe items, and recipes with nothing known.
import type { UploadBatch } from '@forever-ledger/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession } from '../src/sessions.js';
import { batchFromFixture, startServer } from './helpers.js';

type Server = Awaited<ReturnType<typeof startServer>>;

const COOKIE_SECRET = 'test-cookie-secret-admin-recipes-0123456789abcdef';
const SESSION = '__Host-fl_session';
const OLD = 69977;
const NEW = 70100;
const F = 'Fontenot-Bayou';
const G = 'Guidry-Bayou';
const seen = 1790300000;
const session = '1790300000-beef';

const BOMBS_ITEM = [
  'Schematic: Satchel of Iron Bombs',
  'Binds when picked up',
  '\nSatchel of Iron Bombs',
  'Binds when picked up',
  'Thrown\tThrown',
  'Requires Level 41',
  'Requires Engineering (230)',
  'Use: Teaches you how to craft Satchel of Iron Bombs.',
  'Big Iron Bomb (20), Gyrochronatom',
  'Requires Engineering (235)',
  'Sell Price: 10|A:coin-silver:14:14:2:0|a',
];
const SAGEFISH_ITEM = [
  'Recipe: Smoked Sagefish',
  '\nSmoked Sagefish',
  'Use:  If you spend at least 10 seconds eating you will become well fed.',
  'Requires Level 10',
  'Use: Teaches you how to cook Smoked Sagefish.',
  'Raw Sagefish, Mild Spices',
  'Requires Cooking (80)',
];
const BAG_ITEM = [
  'Pattern: Runecloth Bag',
  'Requires Level 45',
  'Use: Teaches you how to sew a Runecloth Bag.',
  'Requires Tailoring (260)',
];

function recipeBatch(): UploadBatch {
  const b = batchFromFixture('professions-v4.lua', 'RECIPES', 'pc-9');
  for (const kind of Object.keys(b.records) as (keyof typeof b.records)[])
    (b.records[kind] as unknown[]) = [];
  const skill = (skillLineId: number, name: string, parentId = 0) => ({
    char: F,
    skillLineId,
    name,
    rank: 100,
    maxRank: 300,
    parentId,
    lastSeen: seen,
  });
  const service = (name: string, skillRank: number, extra = {}) => ({
    name,
    type: 'available',
    cost: 500,
    skill: 'Engineering',
    skillRank,
    level: 0,
    ...extra,
  });
  return {
    ...b,
    meta: { ...b.meta, session },
    records: {
      ...b.records,
      items: [
        {
          itemId: 9001,
          name: 'Satchel of Iron Bombs',
          quality: 2,
          type: 'Weapon',
          subtype: 'Thrown',
          equipLoc: 'INVTYPE_THROWN',
          classId: 2,
          subclassId: 16,
        },
        { itemId: 9002, name: 'Big Iron Bomb', quality: 1, classId: 0 },
        {
          itemId: 285287,
          name: 'Schematic: Satchel of Iron Bombs',
          quality: 2,
          type: 'Recipe',
          subtype: 'Engineering',
          classId: 9,
          subclassId: 3,
        },
        { itemId: 787, name: 'Smoked Sagefish', quality: 1, classId: 0 },
        { itemId: 21099, name: 'Recipe: Smoked Sagefish', quality: 1, classId: 9 },
        { itemId: 14046, name: 'Runecloth Bag', quality: 2, classId: 1 },
        { itemId: 14468, name: 'Pattern: Runecloth Bag', quality: 2, classId: 9 },
        { itemId: 250001, name: 'Mark of the Bayou', quality: 1, classId: 12 },
      ],
      itemSnapshots: [
        {
          itemId: 9001,
          build: OLD,
          ilvl: 46,
          reqLevel: 41,
          sellPrice: 1500,
          stats: { ITEM_MOD_STAMINA_SHORT: 6 },
          tooltip: [
            'Satchel of Iron Bombs',
            '|cff1eff00Binds when picked up|r',
            'Thrown\tThrown',
            'Requires Level 41',
            'Sell Price: 15|A:coin-silver:14:14:2:0|a',
          ],
        },
        { itemId: 285287, build: OLD, reqLevel: 1, stats: {}, tooltip: BOMBS_ITEM },
        {
          itemId: 787,
          build: OLD,
          reqLevel: 0,
          stats: {},
          tooltip: ['Smoked Sagefish', 'Requires Level 10'],
        },
        { itemId: 21099, build: OLD, reqLevel: 0, stats: {}, tooltip: SAGEFISH_ITEM },
        { itemId: 14468, build: OLD, reqLevel: 45, stats: {}, tooltip: BAG_ITEM },
      ],
      skills: [
        skill(202, 'Engineering'),
        skill(2937, 'Engineering', 202),
        skill(185, 'Cooking'),
        skill(197, 'Tailoring'),
      ],
      recipes: [
        { recipeId: 3000, name: 'Satchel of Iron Bombs', skillLineId: 2937 },
        { recipeId: 3001, name: 'Smoked Sagefish', skillLineId: 185 },
        { recipeId: 3002, name: 'Mystery Brew', skillLineId: 185 },
        { recipeId: 3003, name: 'Runecloth Bag', skillLineId: 197 },
      ],
      recipeSnapshots: [
        {
          recipeId: 3000,
          build: OLD,
          outputItemId: 9001,
          qtyMin: 1,
          qtyMax: 1,
          reagents: [
            { itemId: 9002, qty: 20 },
            { itemId: 9999, qty: 1 },
          ],
          maxTrivial: 270,
          sourceText: '|cffffd100Trainer:|r Gnome Engineer',
        },
        {
          recipeId: 3000,
          build: NEW,
          outputItemId: 9001,
          qtyMin: 1,
          qtyMax: 2,
          reagents: [{ itemId: 9002, qty: 18 }],
          maxTrivial: 275,
        },
        { recipeId: 3001, build: OLD, outputItemId: 787, qtyMin: 1, reagents: [] },
        { recipeId: 3003, build: OLD, outputItemId: 14046, qtyMin: 1, reagents: [] },
      ],
      recipeDifficulty: [
        { recipeId: 3000, build: OLD, char: F, difficulty: 'optimal', minRank: 230, maxRank: 239 },
        { recipeId: 3000, build: OLD, char: G, difficulty: 'optimal', minRank: 231, maxRank: 235 },
        { recipeId: 3000, build: OLD, char: F, difficulty: 'medium', minRank: 240, maxRank: 250 },
        { recipeId: 3000, build: NEW, char: F, difficulty: 'easy', minRank: 255, maxRank: 260 },
      ],
      recipesLearned: [
        { char: F, recipeId: 3000, build: OLD, time: seen - 100, via: 'item:285287' },
        { char: G, recipeId: 3000, build: OLD, time: seen - 50, via: 'trainer:5001' },
      ],
      trainers: [
        {
          npcId: 5001,
          build: OLD,
          name: 'Gnome Engineer',
          title: 'Engineering Trainer',
          skillLineId: 202,
          seenAt: seen,
          complete: true,
          services: [
            service('Satchel of Iron Bombs', 230, { itemId: 9001 }),
            service('Unknown Gizmo', 50),
          ],
        },
        {
          // Another profession teaching a same-named service: never the Engineering recipe's source.
          npcId: 5003,
          build: NEW,
          name: 'Cook',
          title: 'Cooking Trainer',
          skillLineId: 185,
          seenAt: seen,
          services: [service('Satchel of Iron Bombs', 999, { skill: 'Cooking' })],
        },
      ],
      vendors: [
        {
          npcId: 6001,
          build: OLD,
          name: 'Bayou Trader',
          title: 'Engineering Supplies',
          seenAt: seen,
          items: [
            {
              itemId: 285287,
              price: 5000,
              stack: 1,
              numAvailable: 1,
              extendedCost: true,
              costs: [{ amount: 3, itemId: 250001 }],
            },
            { itemId: 9002, price: 100, stack: 1, numAvailable: -1 },
            { itemId: 21099, price: 125, stack: 1, numAvailable: -1 },
            { itemId: 14468, price: 9000, stack: 1, numAvailable: -1 },
            // Never seen as an item: no name, no recipe.
            { itemId: 77777, price: 1, stack: 1, numAvailable: -1 },
          ],
        },
      ],
      drops: [{ itemId: 285287, build: OLD, npcId: 7001, session, count: 2, quantity: 2 }],
      nodeLoot: [{ itemId: 285287, objectId: 8001, build: OLD, session, count: 1, quantity: 1 }],
      nodes: [
        {
          objectId: 8001,
          build: OLD,
          session,
          opened: 1,
          name: 'Dark Iron Chest',
          spots: [],
        },
      ],
    },
  };
}

describe('admin recipe details (real Postgres)', () => {
  let s: Server;
  let admin: { cookies: Record<string, string> };
  let member: { cookies: Record<string, string> };

  async function sessionFor(battletag: string, role: 'admin' | 'member') {
    const { rows } = await s.database.pool.query(
      `insert into users (bnet_sub, battletag, role) values ($1, $2, $3) returning id`,
      [`sub-${battletag}`, battletag, role],
    );
    const value = await createSession(s.database.db, rows[0].id as number, {});
    return { cookies: { [SESSION]: s.app.signCookie(value) } };
  }
  const get = (url: string, who: { cookies: Record<string, string> } | null = admin) =>
    s.app.inject({ method: 'GET', url, cookies: who?.cookies ?? {} });
  const json = async (url: string) => {
    const res = await get(url);
    expect(res.statusCode, `${url} ${res.body}`).toBe(200);
    return res.json();
  };

  beforeAll(async () => {
    s = await startServer({ admin: { cookieSecret: COOKIE_SECRET, authPerMinute: 10_000 } });
    admin = await sessionFor('JohnWilliker#1292', 'admin');
    member = await sessionFor('Friend#1111', 'member');
    const res = await s.app.inject({
      method: 'POST',
      url: '/v1/ingest',
      headers: s.auth,
      payload: recipeBatch(),
    });
    expect(res.statusCode, res.body).toBe(200);
  });
  afterAll(async () => {
    await s?.stop();
  });

  it('needs an admin session: 401 without, 401 with a bearer token, 403 for a member', async () => {
    const url = '/admin/api/professions/recipes/3000';
    expect((await get(url, null)).statusCode).toBe(401);
    for (const headers of [s.auth, s.readerAuth])
      expect((await s.app.inject({ method: 'GET', url, headers })).statusCode).toBe(401);
    expect((await get(url, member)).statusCode).toBe(403);
    const ok = await get(url);
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['cache-control']).toBe('no-store');
  });

  it('400 for a bad id or build, 404 for a recipe never seen', async () => {
    expect((await get('/admin/api/professions/recipes/abc')).statusCode).toBe(400);
    expect((await get('/admin/api/professions/recipes/0')).statusCode).toBe(400);
    expect((await get('/admin/api/professions/recipes/99999999999')).statusCode).toBe(400);
    expect((await get('/admin/api/professions/recipes/3000?build=99999999999')).statusCode).toBe(
      400,
    );
    const res = await get('/admin/api/professions/recipes/4242');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'recipe not seen yet' });
  });

  it('a trainer-taught recipe with a recipe item: everything, trainer rank first', async () => {
    const r = await json('/admin/api/professions/recipes/3000?build=69977');
    expect(r).toMatchObject({
      recipeId: 3000,
      name: 'Satchel of Iron Bombs',
      skillLineId: 2937,
      // The "Classic" child line folds into its base.
      profession: { skillLineId: 202, name: 'Engineering' },
      build: OLD,
      builds: [NEW, OLD],
      learnedBy: 2,
      learnedVia: [
        { via: 'item:285287', count: 1 },
        { via: 'trainer:5001', count: 1 },
      ],
      sourceText: 'Trainer: Gnome Engineer',
    });
    expect(r.requirements).toEqual({
      skillRank: { rank: 230, source: 'trainer', npcId: 5001, npcName: 'Gnome Engineer' },
      // The recipe item's "Requires Level 41" is its output's (embedded): not a level to learn it.
      charLevel: null,
      useLevel: { level: 41, source: 'reqLevel' },
      maxTrivial: 270,
      difficulty: [
        { difficulty: 'optimal', minRank: 230, maxRank: 239, chars: 2 },
        { difficulty: 'medium', minRank: 240, maxRank: 250, chars: 1 },
      ],
    });
    expect(r.output).toEqual({
      itemId: 9001,
      name: 'Satchel of Iron Bombs',
      quality: 2,
      classId: 2,
      subclassId: 16,
      type: 'Weapon',
      subtype: 'Thrown',
      equipLoc: 'INVTYPE_THROWN',
      qtyMin: 1,
      qtyMax: 1,
      build: OLD,
      ilvl: 46,
      reqLevel: 41,
      sellPrice: 1500,
      stats: { ITEM_MOD_STAMINA_SHORT: 6 },
      tooltip: [
        'Satchel of Iron Bombs',
        'Binds when picked up',
        'Thrown\tThrown',
        'Requires Level 41',
        'Sell Price: 15s',
      ],
    });
    expect(r.reagents).toEqual([
      { itemId: 9002, name: 'Big Iron Bomb', quality: 1, qty: 20 },
      { itemId: 9999, name: null, quality: null, qty: 1 },
    ]);
    expect(r.recipeItems).toEqual([
      {
        itemId: 285287,
        name: 'Schematic: Satchel of Iron Bombs',
        quality: 2,
        build: OLD,
        reqLevel: 1,
        skillRank: 235,
        charLevel: null,
        tooltip: BOMBS_ITEM.map((l) => l.replace('\n', '')).map((l) =>
          l.replace('|A:coin-silver:14:14:2:0|a', 's'),
        ),
      },
    ]);
    expect(r.sources.trainers).toEqual([
      {
        npcId: 5001,
        npcName: 'Gnome Engineer',
        npcTitle: 'Engineering Trainer',
        build: OLD,
        skillLineId: 202,
        skillLineName: 'Engineering',
        cost: 500,
        skill: 'Engineering',
        skillRank: 230,
        level: 0,
      },
    ]);
    expect(r.sources.vendors).toEqual([
      {
        npcId: 6001,
        npcName: 'Bayou Trader',
        npcTitle: 'Engineering Supplies',
        build: OLD,
        itemId: 285287,
        itemName: 'Schematic: Satchel of Iron Bombs',
        quality: 2,
        price: 5000,
        stack: 1,
        numAvailable: 1,
        costs: [{ amount: 3, itemId: 250001, name: 'Mark of the Bayou' }],
      },
    ]);
    expect(r.sources.drops).toEqual([
      {
        itemId: 285287,
        itemName: 'Schematic: Satchel of Iron Bombs',
        build: OLD,
        npcId: 7001,
        npcName: null,
        objectId: null,
        objectName: null,
        count: 2,
        contributors: 1,
      },
      {
        itemId: 285287,
        itemName: 'Schematic: Satchel of Iron Bombs',
        build: OLD,
        npcId: null,
        npcName: null,
        objectId: 8001,
        objectName: 'Dark Iron Chest',
        count: 1,
        contributors: 1,
      },
    ]);
  });

  it('defaults to the newest build; the output snapshot falls back to its newest build', async () => {
    const r = await json('/admin/api/professions/recipes/3000');
    expect(r.build).toBe(NEW);
    expect(r.requirements.maxTrivial).toBe(275);
    expect(r.requirements.difficulty).toEqual([
      { difficulty: 'easy', minRank: 255, maxRank: 260, chars: 1 },
    ]);
    expect(r.output).toMatchObject({ itemId: 9001, qtyMin: 1, qtyMax: 2, build: OLD, ilvl: 46 });
    expect(r.reagents).toEqual([{ itemId: 9002, name: 'Big Iron Bomb', quality: 1, qty: 18 }]);
    expect(r.sourceText).toBeNull();
    // A build without a schematic: requirements from trainers still, no output.
    const other = await json('/admin/api/professions/recipes/3000?build=12345');
    expect(other).toMatchObject({ build: null, output: null, reagents: [] });
    expect(other.requirements.skillRank).toMatchObject({ rank: 230, source: 'trainer' });
  });

  it('no trainer: the recipe item tooltip gives the rank; the embedded level is not a character level', async () => {
    const r = await json('/admin/api/professions/recipes/3001');
    expect(r.profession).toEqual({ skillLineId: 185, name: 'Cooking' });
    expect(r.requirements).toMatchObject({
      skillRank: {
        rank: 80,
        source: 'recipeItem',
        itemId: 21099,
        itemName: 'Recipe: Smoked Sagefish',
      },
      charLevel: null,
      // req_level 0 on the snapshot: the tooltip's line.
      useLevel: { level: 10, source: 'tooltip' },
      maxTrivial: null,
      difficulty: [],
    });
    expect(r.sources.vendors.map((v: { itemId: number }) => v.itemId)).toEqual([21099]);
    expect(r.sources.trainers).toEqual([]);
  });

  it("a recipe item's own level line is the character level", async () => {
    const r = await json('/admin/api/professions/recipes/3003');
    expect(r.requirements.skillRank).toMatchObject({ rank: 260, source: 'recipeItem' });
    expect(r.requirements.charLevel).toEqual({
      level: 45,
      source: 'recipeItem',
      itemId: 14468,
      itemName: 'Pattern: Runecloth Bag',
    });
    // Output item without a snapshot: known item facts, no stats or tooltip.
    expect(r.output).toMatchObject({
      itemId: 14046,
      name: 'Runecloth Bag',
      build: null,
      stats: {},
      tooltip: [],
    });
    expect(r.requirements.useLevel).toBeNull();
  });

  it('a recipe with nothing known answers nulls and empty lists', async () => {
    const r = await json('/admin/api/professions/recipes/3002');
    expect(r).toEqual({
      recipeId: 3002,
      name: 'Mystery Brew',
      skillLineId: 185,
      profession: { skillLineId: 185, name: 'Cooking' },
      build: null,
      builds: [],
      learnedBy: 0,
      learnedVia: [],
      sourceText: null,
      requirements: {
        skillRank: null,
        charLevel: null,
        useLevel: null,
        maxTrivial: null,
        difficulty: [],
      },
      output: null,
      reagents: [],
      recipeItems: [],
      sources: { trainers: [], vendors: [], drops: [] },
    });
  });

  it('never trusts stored jsonb: junk services, tooltips and stats read as nothing', async () => {
    const pool = s.database.pool;
    await pool.query(
      `insert into trainers (npc_id, build, name, skill_line_id, seen_at, services)
       values (4999, ${OLD}, 'Junk', 202, now(),
               '[{"name": "Satchel of Iron Bombs", "skillRank": "12", "level": 1e400}, 7, "x"]')`,
    );
    await pool.query(
      `update item_snapshots set tooltip = '{"a": 1}', stats = '{"x": "7", "y": 2}'
       where item_id = 9001`,
    );
    try {
      const r = await json('/admin/api/professions/recipes/3000?build=69977');
      // The junk trainer sorts first but has no usable rank: the real one still answers.
      expect(r.sources.trainers.map((t: { npcId: number }) => t.npcId)).toEqual([4999, 5001]);
      expect(r.sources.trainers[0]).toMatchObject({ skillRank: null, level: null });
      expect(r.requirements.skillRank).toMatchObject({ rank: 230, npcId: 5001 });
      expect(r.output).toMatchObject({ tooltip: [], stats: { y: 2 } });
    } finally {
      await pool.query(`delete from trainers where npc_id = 4999`);
      await pool.query(
        `update item_snapshots set tooltip = $1::jsonb, stats = '{"ITEM_MOD_STAMINA_SHORT": 6}'
         where item_id = 9001`,
        [JSON.stringify(['Satchel of Iron Bombs'])],
      );
    }
  });

  describe('links from the vendor, trainer and item routes', () => {
    it('vendor listings say which recipe a recipe item teaches (learned from it, else by name)', async () => {
      const v = await json('/admin/api/vendors/6001');
      const teaches = Object.fromEntries(
        v.items.map((i: { itemId: number; teaches: unknown }) => [i.itemId, i.teaches]),
      );
      expect(teaches).toEqual({
        285287: { recipeId: 3000, name: 'Satchel of Iron Bombs' },
        9002: null,
        21099: { recipeId: 3001, name: 'Smoked Sagefish' },
        14468: { recipeId: 3003, name: 'Runecloth Bag' },
        77777: null,
      });
    });

    it('trainer services name their recipe in the trainer’s profession', async () => {
      const t = await json('/admin/api/trainers/5001');
      expect(
        t.services.map((x: { name: string; recipeId: number | null }) => [x.name, x.recipeId]),
      ).toEqual([
        ['Satchel of Iron Bombs', 3000],
        ['Unknown Gizmo', null],
      ]);
      // A Cooking trainer's same-named service is not the Engineering recipe.
      const cook = await json('/admin/api/trainers/5003');
      expect(cook.services[0].recipeId).toBeNull();
    });

    it('the item route lists the recipe an item teaches and the profession rank of its makers', async () => {
      const recipeItem = await json('/admin/api/items/285287');
      expect(recipeItem.recipes.teaches).toEqual([
        {
          recipeId: 3000,
          name: 'Satchel of Iron Bombs',
          profession: { skillLineId: 202, name: 'Engineering' },
        },
      ]);
      const output = await json('/admin/api/items/9001');
      expect(output.recipes.teaches).toEqual([]);
      expect(
        output.recipes.produces.map((p: Record<string, unknown>) => [
          p.recipeId,
          p.build,
          p.profession,
          p.skillRank,
        ]),
      ).toEqual([
        [3000, NEW, { skillLineId: 202, name: 'Engineering' }, 230],
        [3000, OLD, { skillLineId: 202, name: 'Engineering' }, 230],
      ]);
      const bag = await json('/admin/api/items/14046');
      expect(bag.recipes.produces[0]).toMatchObject({ recipeId: 3003, skillRank: 260 });
    });
  });
});
