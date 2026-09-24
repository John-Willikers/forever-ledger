// Admin professions, vendors and trainers routes (/admin/api/professions/*, /admin/api/vendors, /admin/api/trainers)
// against a real Postgres: the real addon's schema 4/5 sessions, the hand-written professions fixture and a batch with
// Forever's "Classic" child skill lines, Forever-only vendors and a reagent cost setup.
import type { UploadBatch } from '@forever-ledger/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { locationOf, reagentCost, spreadSpots } from '../src/routes/adminProfessions.js';
import { FOREVER_ID_THRESHOLDS } from '../src/routes/shared.js';
import { createSession } from '../src/sessions.js';
import { chicagoIso } from '../src/time.js';
import { batchFromFixture, startServer } from './helpers.js';

type Server = Awaited<ReturnType<typeof startServer>>;

const COOKIE_SECRET = 'test-cookie-secret-admin-professions-0123456789';
const SESSION = '__Host-fl_session';
const build = 69977;
const F = 'Fontenot-Bayou';
const G = 'Guidry-Bayou';
const T = 'Thibodeaux-Bayou';
const seen = 1790200000;
const ts = (secs: number) => chicagoIso(secs * 1000);

/** Blacksmithing and Mining as Forever lists them (base line + "Classic" child), vendors, a Forever trainer. */
function foldBatch(): UploadBatch {
  const session = '1790200000-f01d';
  const b = batchFromFixture('professions-v4.lua', 'FOLD', 'pc-3');
  for (const kind of Object.keys(b.records) as (keyof typeof b.records)[])
    (b.records[kind] as unknown[]) = [];
  const skill = (char: string, skillLineId: number, name: string, rank: number, extra = {}) => ({
    char,
    skillLineId,
    name,
    rank,
    maxRank: 75,
    lastSeen: seen,
    ...extra,
  });
  const rise = (char: string, lines: number[], from: number, time: number) =>
    lines.map((skillLineId) => ({ char, skillLineId, from, to: from + 1, build, time }));
  const loc = (x: number, y: number) => ({
    zone: 'Dun Morogh',
    subzone: 'Kharanos',
    mapID: 1426,
    x,
    y,
  });
  return {
    ...b,
    meta: { ...b.meta, session },
    records: {
      ...b.records,
      items: [
        { itemId: 2835, name: 'Rough Stone', quality: 1, type: 'Trade Goods', classId: 7 },
        { itemId: 3239, name: 'Rough Weightstone', quality: 1, classId: 0 },
        { itemId: 2862, name: 'Rough Sharpening Stone', quality: 1, classId: 0 },
        {
          itemId: 250100,
          name: 'Plans: Rough Weightstone',
          quality: 2,
          type: 'Recipe',
          subtype: 'Blacksmithing',
          classId: 9,
          subclassId: 4,
        },
      ],
      itemSnapshots: [
        { itemId: 3239, build, sellPrice: 5, stats: {}, tooltip: [] },
        { itemId: 2862, build, sellPrice: 2, stats: {}, tooltip: [] },
      ],
      skills: [
        skill(F, 164, 'Blacksmithing', 60, { parentId: 0 }),
        skill(F, 2938, 'Blacksmithing', 60, { parentId: 164 }),
        skill(F, 186, 'Mining', 40),
        skill(F, 2946, 'Mining', 40, { parentId: 186, maxRank: 150 }),
        skill(G, 2938, 'Blacksmithing', 10, { parentId: 164 }),
      ],
      // Each rise is recorded on the base line and on its child.
      skillUps: [
        ...rise(F, [164, 2938], 58, 1790199800),
        ...rise(F, [164, 2938], 59, 1790199900),
        ...rise(F, [186, 2946], 39, 1790199700),
      ],
      recipes: [
        { recipeId: 2660, name: 'Rough Sharpening Stone', skillLineId: 164 },
        { recipeId: 3115, name: 'Rough Weightstone', skillLineId: 2938 },
      ],
      recipeSnapshots: [
        {
          recipeId: 3115,
          build,
          outputItemId: 3239,
          qtyMin: 1,
          qtyMax: 3,
          reagents: [
            { itemId: 2835, qty: 3 },
            { itemId: 2589, qty: 1 },
          ],
        },
        {
          recipeId: 2660,
          build,
          outputItemId: 2862,
          qtyMin: 1,
          reagents: [{ itemId: 2835, qty: 1 }],
        },
      ],
      recipeStatus: [
        { recipeId: 3115, build, char: F, learned: true, difficulty: 'optimal', seenAt: seen },
        { recipeId: 2660, build, char: F, learned: false, seenAt: seen },
      ],
      crafts: [{ recipeId: 3115, build, session, casts: 5, qty: 6, procs: 1, skillUps: 2 }],
      nodes: [
        {
          objectId: 1731,
          build,
          session,
          opened: 6,
          name: 'Copper Vein',
          rankMin: 1,
          skillLineId: 2946,
          // Three spots over two maps: the six opens spread 2 per spot.
          spots: [
            {
              mapId: 1426,
              points: [
                [10, 20],
                [30, 40],
              ],
            },
            { mapId: 1427, points: [[5, 5]] },
          ],
        },
      ],
      trainers: [
        {
          npcId: 1241,
          build,
          name: 'Brombar Higgleby',
          title: 'Blacksmithing Trainer',
          loc: loc(47, 52),
          skillLineId: 2938,
          seenAt: seen,
          complete: false,
          services: [
            {
              name: 'Rough Weightstone',
              type: 'available',
              cost: 10,
              skill: 'Blacksmithing',
              skillRank: 25,
              level: 5,
              itemId: 3239,
            },
          ],
        },
      ],
      vendors: [
        {
          npcId: 3001,
          build,
          name: 'Tharynn Bouden',
          loc: loc(49, 48),
          seenAt: seen,
          // 24 copper for a stack of 4: 6 each, the cheapest Rough Stone.
          items: [{ itemId: 2835, price: 24, stack: 4, numAvailable: -1, extendedCost: false }],
        },
        {
          npcId: 248200,
          build,
          name: 'Grimbold',
          title: 'Blacksmithing Supplies',
          loc: loc(50, 50),
          seenAt: seen,
          items: [
            { itemId: 2835, price: 10, stack: 1, numAvailable: -1, extendedCost: false },
            {
              itemId: 250100,
              price: 0,
              stack: 1,
              numAvailable: -1,
              extendedCost: true,
              costs: [{ amount: 3, itemId: 250001, name: 'Mark of the Barrens' }],
            },
          ],
        },
        {
          npcId: 248201,
          build,
          name: 'Ruk',
          title: 'Blacksmithing',
          loc: loc(51, 50),
          seenAt: seen,
          items: [
            // Cheaper in gold, but paid in honor too: never a reagent price.
            {
              itemId: 2835,
              price: 1,
              stack: 1,
              numAvailable: -1,
              extendedCost: true,
              costs: [{ amount: 25, currencyId: 1901, name: 'Honor Points' }],
            },
            {
              itemId: 2836,
              price: 0,
              stack: 1,
              numAvailable: 5,
              // A numeric flag without the costs read.
              extendedCost: 1,
            },
          ],
        },
      ],
    },
  };
}

describe('admin professions, vendors and trainers (real Postgres)', () => {
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
    // session-v5 is session-v4 plus titles, costs and a Forever vendor: same session, so it replaces v4's counters.
    for (const batch of [
      batchFromFixture('session-v4.lua', 'ACCOUNT1', 'pc-1'),
      batchFromFixture('session-v5.lua', 'ACCOUNT1', 'pc-1'),
      batchFromFixture('professions-v4.lua', 'ACCOUNT1', 'pc-1'),
      foldBatch(),
    ]) {
      const res = await s.app.inject({
        method: 'POST',
        url: '/v1/ingest',
        headers: s.auth,
        payload: batch,
      });
      expect(res.statusCode, res.body).toBe(200);
    }
  });
  afterAll(async () => {
    await s?.stop();
  });

  const GETS = [
    '/admin/api/professions/overview',
    '/admin/api/professions/skill-history',
    '/admin/api/professions/crafts',
    '/admin/api/professions/gathering-map',
    '/admin/api/professions/cost?recipeId=3115',
    '/admin/api/vendors',
    '/admin/api/vendors/1347',
    '/admin/api/trainers',
    '/admin/api/trainers/1103',
  ];

  it('every route needs an admin session: 401 without, 401 with a bearer token, 403 for a member', async () => {
    for (const url of GETS) {
      expect((await get(url, null)).statusCode, url).toBe(401);
      for (const headers of [s.auth, s.readerAuth])
        expect((await s.app.inject({ method: 'GET', url, headers })).statusCode, url).toBe(401);
      expect((await get(url, member)).statusCode, url).toBe(403);
      const ok = await get(url);
      expect(ok.statusCode, `${url} ${ok.body}`).toBe(200);
      expect(ok.headers['cache-control'], url).toBe('no-store');
    }
  });

  describe('professions overview', () => {
    it('lists base professions (child lines folded) with characters, recipes, crafts, gathering, NPCs', async () => {
      const { professions } = await json('/admin/api/professions/overview');
      expect(professions.map((p: { name: string }) => p.name)).toEqual([
        'Blacksmithing',
        'First Aid',
        'Fishing',
        'Herbalism',
        'Mining',
        'Tailoring',
      ]);
      const by = (name: string) => professions.find((p: { name: string }) => p.name === name);
      expect(by('Blacksmithing')).toEqual({
        skillLineId: 164,
        name: 'Blacksmithing',
        skillLineIds: [164, 2938],
        characters: [
          { char: F, rank: 60, maxRank: 75, lastSeen: ts(seen), recipesKnown: 1 },
          { char: G, rank: 10, maxRank: 75, lastSeen: ts(seen), recipesKnown: 0 },
        ],
        recipes: { known: 1, seen: 2 },
        crafts: { casts: 5, qty: 6, procs: 1, skillUps: 2 },
        gathering: { opens: 0, nodes: 0 },
        trainers: 1,
        vendors: 1,
      });
      expect(by('Mining')).toMatchObject({
        skillLineId: 186,
        skillLineIds: [186, 2946],
        characters: [
          { char: F, rank: 40, maxRank: 150 },
          { char: T, rank: 31, maxRank: 75 },
        ],
        recipes: { known: 0, seen: 0 },
        crafts: { casts: 0, qty: 0, procs: 0, skillUps: 0 },
        // Copper Vein: v5 session 2 + professions-v4 3 + the fold batch 6 (on the child line).
        gathering: { opens: 11, nodes: 1 },
        trainers: 0,
        vendors: 0,
      });
      expect(by('Tailoring')).toMatchObject({
        skillLineId: 197,
        characters: [{ char: T, rank: 12, maxRank: 75, recipesKnown: 4 }],
        recipes: { known: 4, seen: 4 },
        // v5: Brown Linen Vest 1 cast, Bolt 1 cast (3 made, 1 proc, 1 skill-up); professions-v4: Bolt ×4 (2 ups).
        crafts: { casts: 6, qty: 8, procs: 1, skillUps: 3 },
        trainers: 2,
        // Alexandra Bolero sells both patterns, Beneris (Forever) the Red Linen Robe pattern.
        vendors: 2,
      });
      expect(by('Fishing')).toMatchObject({ gathering: { opens: 3, nodes: 1 } });
    });
  });

  describe('skill history', () => {
    it('gives rank over time per base profession, ascending, one point per rise', async () => {
      const { items } = await json(`/admin/api/professions/skill-history?char=${F}`);
      expect(items).toEqual([
        {
          char: F,
          professions: [
            {
              skillLineId: 164,
              name: 'Blacksmithing',
              rank: 60,
              maxRank: 75,
              points: [
                {
                  observedAt: ts(1790199800),
                  fromRank: 58,
                  rank: 59,
                  build,
                  recipeId: null,
                  recipeName: null,
                },
                {
                  observedAt: ts(1790199900),
                  fromRank: 59,
                  rank: 60,
                  build,
                  recipeId: null,
                  recipeName: null,
                },
              ],
            },
            {
              skillLineId: 186,
              name: 'Mining',
              rank: 40,
              maxRank: 150,
              points: [
                {
                  observedAt: ts(1790199700),
                  fromRank: 39,
                  rank: 40,
                  build,
                  recipeId: null,
                  recipeName: null,
                },
              ],
            },
          ],
        },
      ]);
    });

    it('lists every character without ?char=, and nothing for an unknown one', async () => {
      const { items } = await json('/admin/api/professions/skill-history');
      expect(items.map((c: { char: string }) => c.char)).toEqual([F, G, T]);
      const thib = items[2];
      const tailoring = thib.professions.find((p: { name: string }) => p.name === 'Tailoring');
      expect(tailoring.points.map((p: { rank: number; recipeName: string }) => p.rank)).toEqual([
        51, 12,
      ]);
      expect(tailoring.points[0].recipeName).toBe('Bolt of Linen Cloth');
      // Guidry has a rank but no rises.
      expect(items[1].professions).toEqual([
        { skillLineId: 164, name: 'Blacksmithing', rank: 10, maxRank: 75, points: [] },
      ]);
      expect((await json('/admin/api/professions/skill-history?char=Nobody-Bayou')).items).toEqual(
        [],
      );
    });

    it('matches ?char= exactly: a key up to 128 chars, 400 above (never silently cut)', async () => {
      const at128 = `${'É'.repeat(120)}-Bayouuu`;
      expect(at128).toHaveLength(128);
      const ok = await json(
        `/admin/api/professions/skill-history?char=${encodeURIComponent(at128)}`,
      );
      expect(ok.items).toEqual([]);
      const res = await get(
        `/admin/api/professions/skill-history?char=${encodeURIComponent(`${at128}x`)}`,
      );
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/char/);
    });
  });

  describe('crafts', () => {
    it('sums craft counters per recipe and build over sessions; ?skillLine= folds child lines', async () => {
      const { items } = await json('/admin/api/professions/crafts?skillLine=197');
      expect(items).toEqual([
        {
          recipeId: 2963,
          name: 'Bolt of Linen Cloth',
          build,
          profession: { skillLineId: 197, name: 'Tailoring' },
          outputItemId: 2996,
          outputItemName: 'Bolt of Linen Cloth',
          casts: 4,
          qty: 4,
          procs: 0,
          skillUps: 2,
          sessions: 1,
        },
        expect.objectContaining({ recipeId: 2963, build: 61582, casts: 1, qty: 3, procs: 1 }),
        expect.objectContaining({ recipeId: 2393, build: 61582, casts: 1, qty: 1, procs: 0 }),
      ]);
      for (const line of [164, 2938]) {
        const bs = (await json(`/admin/api/professions/crafts?skillLine=${line}`)).items;
        expect(bs).toEqual([
          expect.objectContaining({
            recipeId: 3115,
            name: 'Rough Weightstone',
            profession: { skillLineId: 164, name: 'Blacksmithing' },
            casts: 5,
            qty: 6,
            procs: 1,
          }),
        ]);
      }
      expect((await json(`/admin/api/professions/crafts?build=61582`)).items).toHaveLength(2);
    });
  });

  describe('gathering map', () => {
    it('lists node spots per map with opens spread over each session’s spots', async () => {
      const res = await json(`/admin/api/professions/gathering-map?build=${build}`);
      expect(res.builds).toEqual([69977, 61582]);
      expect(res.maps.map((m: { mapId: number }) => m.mapId)).toEqual([1429, 1426, 1427]);
      const [elwynn, dunMorogh, other] = res.maps;
      // The map name comes from an NPC seen on it, else from the client's UiMap table.
      expect(elwynn.zone).toBe('Elwynn Forest');
      expect(dunMorogh.zone).toBe('Dun Morogh');
      expect(other.zone).toBe('Searing Gorge');
      expect(elwynn.nodes).toEqual([
        {
          objectId: 1731,
          name: 'Copper Vein',
          skillLineId: 186,
          skillLineName: 'Mining',
          opens: 3,
          rankMin: 29,
          spots: [
            { x: 45.1, y: 33.2, opens: 1.5 },
            { x: 46, y: 34.5, opens: 1.5 },
          ],
        },
        {
          objectId: 0,
          name: null,
          skillLineId: 356,
          skillLineName: 'Fishing',
          opens: 2,
          rankMin: null,
          spots: [{ x: 50, y: 60, opens: 2 }],
        },
      ]);
      expect(dunMorogh.nodes).toEqual([
        expect.objectContaining({
          objectId: 1731,
          skillLineId: 186,
          opens: 4,
          rankMin: 1,
          spots: [
            { x: 10, y: 20, opens: 2 },
            { x: 30, y: 40, opens: 2 },
          ],
        }),
      ]);
      expect(other.nodes[0]).toMatchObject({ opens: 2, spots: [{ x: 5, y: 5, opens: 2 }] });
    });

    it('merges builds without ?build=: the same spot from two sessions adds up', async () => {
      const res = await json('/admin/api/professions/gathering-map');
      const elwynn = res.maps.find((m: { mapId: number }) => m.mapId === 1429);
      const vein = elwynn.nodes.find((n: { objectId: number }) => n.objectId === 1731);
      // v5 (build 61582): 2 opens over 42.1,65.9 and 50,70; professions-v4: 3 opens over two other spots.
      expect(vein.opens).toBe(5);
      expect(vein.rankMin).toBe(29);
      expect(vein.spots).toEqual([
        { x: 42.1, y: 65.9, opens: 1 },
        { x: 45.1, y: 33.2, opens: 1.5 },
        { x: 46, y: 34.5, opens: 1.5 },
        { x: 50, y: 70, opens: 1 },
      ]);
    });
  });

  describe('cost calculator', () => {
    it('prices reagents at the cheapest vendor gold price, ignoring extended costs; unknown stays unknown', async () => {
      const res = await json('/admin/api/professions/cost?recipeId=3115');
      expect(res).toEqual({
        recipeId: 3115,
        name: 'Rough Weightstone',
        build,
        builds: [build],
        reagents: [
          {
            itemId: 2835,
            name: 'Rough Stone',
            qty: 3,
            unitPrice: 6,
            cost: 18,
            vendor: {
              npcId: 3001,
              name: 'Tharynn Bouden',
              title: null,
              build,
              price: 24,
              stack: 4,
            },
            extendedOnly: false,
          },
          {
            itemId: 2589,
            name: 'Linen Cloth',
            qty: 1,
            unitPrice: null,
            cost: null,
            vendor: null,
            extendedOnly: false,
          },
        ],
        total: { known: 18, complete: false, unknownItemIds: [2589] },
        output: {
          itemId: 3239,
          name: 'Rough Weightstone',
          qtyMin: 1,
          qtyMax: 3,
          unitSellPrice: 5,
          value: 10,
        },
        profit: null,
      });
    });

    it('gives a profit when every price is known', async () => {
      const res = await json('/admin/api/professions/cost?recipeId=2660');
      expect(res.total).toEqual({ known: 6, complete: true, unknownItemIds: [] });
      expect(res.output).toEqual({
        itemId: 2862,
        name: 'Rough Sharpening Stone',
        qtyMin: 1,
        qtyMax: null,
        unitSellPrice: 2,
        value: 2,
      });
      expect(res.profit).toBe(-4);
    });

    it('marks a reagent sold only for extended costs', async () => {
      // Bolt of Linen Cloth (build 61582) needs Linen Cloth; Red Linen Robe needs Bolts, sold only for honor.
      const robe = await json('/admin/api/professions/cost?recipeId=2389');
      expect(robe.build).toBe(61582);
      expect(robe.reagents).toEqual([
        expect.objectContaining({ itemId: 2996, unitPrice: null, extendedOnly: true }),
        // Coarse Thread: 10 copper for 5.
        expect.objectContaining({ itemId: 2320, qty: 2, unitPrice: 2, cost: 4 }),
      ]);
      expect(robe.total).toEqual({ known: 4, complete: false, unknownItemIds: [2996] });
    });

    it('validates its parameters', async () => {
      expect((await get('/admin/api/professions/cost')).statusCode).toBe(400);
      expect((await get('/admin/api/professions/cost?recipeId=abc')).statusCode).toBe(400);
      expect((await get('/admin/api/professions/cost?recipeId=2147483648')).statusCode).toBe(400);
      expect((await get('/admin/api/professions/cost?recipeId=999999')).statusCode).toBe(404);
      // A build without a schematic: reagents unknown, nothing to price.
      const none = await json('/admin/api/professions/cost?recipeId=3115&build=61582');
      expect(none).toMatchObject({ build: null, reagents: [], output: null, profit: null });
    });
  });

  describe('vendors', () => {
    it('lists one row per NPC (newest build) with counts, title and location', async () => {
      const res = await json('/admin/api/vendors');
      expect(res.total).toBe(5);
      expect(res.foreverNpcMin).toBe(FOREVER_ID_THRESHOLDS.npc);
      expect(res.items.map((v: { name: string }) => v.name)).toEqual([
        'Alexandra Bolero',
        'Beneris',
        'Grimbold',
        'Ruk',
        'Tharynn Bouden',
      ]);
      expect(res.items[0]).toEqual({
        npcId: 1347,
        name: 'Alexandra Bolero',
        title: null,
        forever: false,
        build,
        builds: [build, 61582],
        location: { zone: 'Stormwind City', subzone: 'The Canals', mapId: 1453, x: 43.2, y: 74.1 },
        itemCount: 2,
        recipeItemCount: 1,
        extendedCostCount: 0,
        seenAt: ts(1790100160),
      });
      expect(res.items[1]).toMatchObject({
        npcId: 248196,
        title: 'Tailoring',
        forever: true,
        build: 61582,
        itemCount: 2,
        recipeItemCount: 1,
        extendedCostCount: 1,
      });
      // extendedCost as a number counts too.
      expect(res.items[3]).toMatchObject({ npcId: 248201, extendedCostCount: 2 });
      expect(res.titles).toEqual([
        { title: 'Blacksmithing', count: 1 },
        { title: 'Blacksmithing Supplies', count: 1 },
        { title: 'Tailoring', count: 1 },
      ]);
    });

    it('filters: Forever-only, search (name, title, npc id; wildcards are literal), title, paging', async () => {
      const ids = async (q: string) =>
        (await json(`/admin/api/vendors?${q}`)).items.map((v: { npcId: number }) => v.npcId);
      expect(await ids('foreverOnly=true')).toEqual([248196, 248200, 248201]);
      expect(await ids('foreverOnly=1')).toEqual([248196, 248200, 248201]);
      expect(await ids('foreverOnly=false')).toHaveLength(5);
      expect(await ids('search=bolero')).toEqual([1347]);
      expect(await ids('search=supplies')).toEqual([248200]);
      expect(await ids('search=3001')).toEqual([3001]);
      expect(await ids('search=%25')).toEqual([]);
      expect(await ids('search=_')).toEqual([]);
      expect(await ids('title=blacksmithing')).toEqual([248201]);
      expect(await ids('title=Blacksmithing&foreverOnly=true&search=ruk')).toEqual([248201]);
      const page = await json('/admin/api/vendors?limit=2&offset=1');
      expect(page).toMatchObject({ total: 5, limit: 2, offset: 1 });
      expect(page.items.map((v: { npcId: number }) => v.npcId)).toEqual([248196, 248200]);
      expect((await json('/admin/api/vendors?limit=0&offset=-3')).items).toHaveLength(5);
      // Text filters are trimmed and refused above their cap (search 100, title 200), not cut.
      expect(await ids(`search=${encodeURIComponent('  bolero  ')}`)).toEqual([1347]);
      expect(await ids(`search=${'z'.repeat(100)}`)).toEqual([]);
      for (const q of [`search=${'z'.repeat(101)}`, `title=${'z'.repeat(201)}`]) {
        expect((await get(`/admin/api/vendors?${q}`)).statusCode, q).toBe(400);
        expect((await get(`/admin/api/trainers?${q}`)).statusCode, q).toBe(400);
      }
    });

    it('shows a vendor’s items with prices and extended costs (cost items named from items)', async () => {
      const res = await json('/admin/api/vendors/248196');
      expect(res).toEqual({
        npcId: 248196,
        name: 'Beneris',
        title: 'Tailoring',
        forever: true,
        build: 61582,
        builds: [61582],
        location: { zone: 'Elwynn Forest', subzone: 'Goldshire', mapId: 1429, x: 50, y: 70 },
        seenAt: ts(1790001513),
        items: [
          {
            itemId: 2598,
            name: 'Pattern: Red Linen Robe',
            quality: 1,
            classId: 9,
            type: 'Recipe',
            subtype: expect.any(String),
            price: 0,
            stack: 1,
            numAvailable: -1,
            currencyId: null,
            extendedCost: true,
            costs: [
              { amount: 3, itemId: 250001, name: 'Mark of the Barrens' },
              { amount: 25, currencyId: 1901, name: 'Honor Points' },
            ],
            // Learned from it (recipes_learned via item:2598), and named "Pattern: Red Linen Robe".
            teaches: { recipeId: 2389, name: 'Red Linen Robe' },
          },
          expect.objectContaining({
            itemId: 2320,
            name: 'Coarse Thread',
            price: 10,
            stack: 5,
            extendedCost: false,
            costs: null,
            teaches: null,
          }),
        ],
      });
    });

    it('picks a build with ?build=, else the newest; 404 and 400 as expected', async () => {
      const newest = await json('/admin/api/vendors/1347');
      expect(newest.build).toBe(build);
      expect(newest.items.map((i: { itemId: number }) => i.itemId)).toEqual([2320, 6270]);
      const old = await json('/admin/api/vendors/1347?build=61582');
      expect(old.items.map((i: { itemId: number }) => i.itemId)).toEqual([2320, 2598, 2996]);
      expect(old.items[2]).toMatchObject({ currencyId: 1901, extendedCost: true, costs: null });
      expect((await get('/admin/api/vendors/1347?build=1')).statusCode).toBe(404);
      expect((await get('/admin/api/vendors/999999')).statusCode).toBe(404);
      for (const id of ['abc', '0', '-1', '2147483648', '1.5'])
        expect((await get(`/admin/api/vendors/${id}`)).statusCode, id).toBe(400);
    });
  });

  describe('trainers', () => {
    it('lists trainers with the folded profession, title, completeness and service count', async () => {
      const res = await json('/admin/api/trainers');
      expect(res.total).toBe(3);
      expect(res.items).toEqual([
        {
          npcId: 1241,
          name: 'Brombar Higgleby',
          title: 'Blacksmithing Trainer',
          forever: false,
          build,
          builds: [build],
          location: { zone: 'Dun Morogh', subzone: 'Kharanos', mapId: 1426, x: 47, y: 52 },
          skillLineId: 164,
          skillLineName: 'Blacksmithing',
          complete: false,
          serviceCount: 1,
          seenAt: ts(seen),
        },
        expect.objectContaining({
          npcId: 1103,
          name: 'Eldrin',
          title: 'Tailoring Trainer',
          skillLineId: 197,
          skillLineName: 'Tailoring',
          complete: true,
          serviceCount: 3,
        }),
        expect.objectContaining({ npcId: 1346, name: 'Georgio Bolero', title: null }),
      ]);
      const ids = async (q: string) =>
        (await json(`/admin/api/trainers?${q}`)).items.map((t: { npcId: number }) => t.npcId);
      expect(await ids('search=trainer')).toEqual([1241, 1103]);
      expect(await ids('search=bolero')).toEqual([1346]);
      expect(await ids('foreverOnly=true')).toEqual([]);
    });

    it('shows a trainer’s services with the item they make', async () => {
      const res = await json('/admin/api/trainers/1103');
      expect(res).toMatchObject({
        npcId: 1103,
        name: 'Eldrin',
        title: 'Tailoring Trainer',
        build: 61582,
        complete: true,
        skillLineId: 197,
        skillLineName: 'Tailoring',
        location: { zone: 'Elwynn Forest', mapId: 1429 },
      });
      expect(res.services).toEqual([
        {
          name: 'Brown Linen Vest',
          type: 'available',
          cost: 100,
          skill: 'Tailoring',
          skillRank: 10,
          level: 5,
          itemId: 2568,
          itemName: 'Brown Linen Vest',
          recipeId: 2393,
        },
        expect.objectContaining({
          name: 'Red Linen Robe',
          type: 'unavailable',
          itemId: 2572,
          recipeId: 2389,
        }),
        {
          name: 'Journeyman Tailoring',
          type: 'used',
          cost: 500,
          skill: null,
          skillRank: null,
          level: 10,
          itemId: null,
          itemName: null,
          recipeId: null,
        },
      ]);
      expect((await json('/admin/api/trainers/1241')).complete).toBe(false);
      expect((await get('/admin/api/trainers/424242')).statusCode).toBe(404);
      expect((await get('/admin/api/trainers/x')).statusCode).toBe(400);
    });
  });
});

describe('pure helpers', () => {
  it('locationOf keeps only well-typed fields of an untrusted loc', () => {
    expect(
      locationOf({ zone: 'Elwynn Forest', subzone: 'Goldshire', mapID: 1429, x: 1, y: 2 }),
    ).toEqual({ zone: 'Elwynn Forest', subzone: 'Goldshire', mapId: 1429, x: 1, y: 2 });
    expect(locationOf({ zone: 5, mapID: '1429', x: 'a', extra: true })).toEqual({
      zone: null,
      subzone: null,
      mapId: null,
      x: null,
      y: null,
    });
    expect(locationOf(null)).toBeNull();
    expect(locationOf([1, 2])).toBeNull();
    expect(locationOf('Elwynn')).toBeNull();
  });

  it('spreadSpots spreads a session’s opens over its spots and merges equal spots', () => {
    expect(
      spreadSpots([
        {
          opened: 6,
          spots: [
            {
              mapId: 1,
              points: [
                [10, 20],
                [30, 40],
              ],
            },
            { mapId: 2, points: [[5, 5]] },
          ],
        },
        { opened: 1, spots: [{ mapId: 1, points: [[10.04, 19.96]] }] },
        { opened: 3, spots: [] },
        // Junk is skipped: a non-array, a bad map id, points out of range or not numbers.
        { opened: 2, spots: 'x' as unknown as [] },
        {
          opened: 2,
          spots: [
            { mapId: 'a' as unknown as number, points: [[1, 1]] },
            {
              mapId: 3,
              points: [
                [-1, 5],
                ['a' as unknown as number, 1],
                [101, 1],
                [7, 7],
              ],
            },
          ],
        },
      ]),
    ).toEqual(
      new Map([
        [
          1,
          [
            { x: 10, y: 20, opens: 3 },
            { x: 30, y: 40, opens: 2 },
          ],
        ],
        [2, [{ x: 5, y: 5, opens: 2 }]],
        [3, [{ x: 7, y: 7, opens: 2 }]],
      ]),
    );
  });

  it('reagentCost: cheapest gold price per unit, extended costs ignored, unknowns listed', () => {
    const offer = (itemId: number, npcId: number, price: number, stack = 1, extended = false) => ({
      itemId,
      npcId,
      name: `npc ${npcId}`,
      title: null,
      build: 1,
      price,
      stack,
      extended,
    });
    const res = reagentCost(
      [
        { itemId: 1, name: 'A', qty: 3 },
        { itemId: 2, name: 'B', qty: 2 },
        { itemId: 3, name: null, qty: 1 },
      ],
      [
        offer(1, 10, 10),
        offer(1, 11, 25, 5), // 5 each: cheapest
        offer(1, 12, 1, 1, true), // extended: ignored
        offer(1, 13, 0), // free in gold without an extended cost: not a price
        offer(2, 20, 7, 0), // stack 0 reads as 1
        offer(3, 30, 1, 1, true),
      ],
      { itemId: 9, name: 'Out', qtyMin: 2, qtyMax: 4, sellPrice: 10 },
    );
    expect(
      res.reagents.map((r) => [r.itemId, r.unitPrice, r.cost, r.vendor?.npcId ?? null]),
    ).toEqual([
      [1, 5, 15, 11],
      [2, 7, 14, 20],
      [3, null, null, null],
    ]);
    expect(res.reagents[2]!.extendedOnly).toBe(true);
    expect(res.total).toEqual({ known: 29, complete: false, unknownItemIds: [3] });
    expect(res.output).toEqual({
      itemId: 9,
      name: 'Out',
      qtyMin: 2,
      qtyMax: 4,
      unitSellPrice: 10,
      value: 30,
    });
    expect(res.profit).toBeNull();

    const done = reagentCost([{ itemId: 1, name: 'A', qty: 1 }], [offer(1, 10, 10)], {
      itemId: 9,
      name: null,
      qtyMin: null,
      qtyMax: null,
      sellPrice: null,
    });
    expect(done.total).toEqual({ known: 10, complete: true, unknownItemIds: [] });
    expect(done.output).toMatchObject({ unitSellPrice: null, value: null });
    expect(done.profit).toBeNull();
    expect(reagentCost([], [], null)).toEqual({
      reagents: [],
      total: { known: 0, complete: true, unknownItemIds: [] },
      output: null,
      profit: null,
    });
  });
});
