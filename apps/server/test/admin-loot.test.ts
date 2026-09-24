// Admin panel loot + dungeon routes (/admin/api/loot/*, /admin/api/items/:id, /admin/api/runs*) against a real
// Postgres, with fixture ingests and sessions seeded directly.
import type { UploadBatch } from '@forever-ledger/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashToken } from '../src/index.js';
import { statDiffs } from '../src/routes/adminLoot.js';
import { FOREVER_ID_THRESHOLDS } from '../src/routes/shared.js';
import { createSession, csrfToken } from '../src/sessions.js';
import { batchFromFixture, startServer } from './helpers.js';

type Server = Awaited<ReturnType<typeof startServer>>;

const COOKIE_SECRET = 'test-cookie-secret-admin-loot-0123456789abcdef';
const SESSION = '__Host-fl_session';
const CHICAGO_ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d-0[56]:00$/;
const RUN_ID = 'Thibodeaux-Bayou-36-1790000060';

interface TestSession {
  cookies: Record<string, string>;
}

/**
 * A second SavedVariables session on another PC: 3 more Defias corpses (600 copper) with Rockslicer once and Linen
 * Cloth twice (3 in stacks), a Forever-only mob, and a quest giver that names npc 644.
 */
function secondSession(): UploadBatch {
  const b = batchFromFixture('session-v5.lua', 'ACCOUNT2', 'pc-2');
  const session = '1790200000-beef';
  const obs = b.records.questObservations[0]!;
  return {
    ...b,
    meta: { ...b.meta, session },
    records: {
      ...b.records,
      questObservations: [
        { ...obs, stage: 'detail', npc: { id: 644, name: 'Defias Miner' } },
        ...b.records.questObservations.filter((o) => o.stage !== 'detail'),
      ],
      corpses: [
        { npcId: 644, build: 61582, session, count: 3, copper: 600 },
        { npcId: 250123, build: 61582, session, count: 2, copper: 10 },
      ],
      drops: [
        { itemId: 872, build: 61582, npcId: 644, session, count: 1, quantity: 1 },
        { itemId: 2589, build: 61582, npcId: 644, session, count: 2, quantity: 3 },
        { itemId: 250001, build: 61582, npcId: 250123, session, count: 1, quantity: 1 },
      ],
      runs: [],
    },
  };
}

describe('admin loot + dungeon API (real Postgres)', () => {
  let s: Server;
  let admin: TestSession;
  let member: TestSession;

  async function sessionFor(battletag: string, role: 'admin' | 'member'): Promise<TestSession> {
    const { rows } = await s.database.pool.query(
      `insert into users (bnet_sub, battletag, role) values ($1, $2, $3) returning id`,
      [`sub-${battletag}`, battletag, role],
    );
    const value = await createSession(s.database.db, rows[0].id as number, {});
    // Reads never need the CSRF token; computed only to prove the secret matches the app's.
    csrfToken(COOKIE_SECRET, hashToken(value));
    return { cookies: { [SESSION]: s.app.signCookie(value) } };
  }

  /** GET as `who` (admin by default; null = no session). */
  const get = (url: string, who: TestSession | null = admin) =>
    s.app.inject({ method: 'GET', url, cookies: who?.cookies ?? {} });
  const json = async (url: string) => {
    const res = await get(url);
    expect(res.statusCode, `${url} ${res.body}`).toBe(200);
    return res.json();
  };

  const ingest = async (batch: UploadBatch) => {
    const res = await s.app.inject({
      method: 'POST',
      url: '/v1/ingest',
      headers: s.auth,
      payload: batch,
    });
    expect(res.statusCode, res.body).toBe(200);
  };

  beforeAll(async () => {
    s = await startServer({ admin: { cookieSecret: COOKIE_SECRET, authPerMinute: 10_000 } });
    admin = await sessionFor('JohnWilliker#1292', 'admin');
    member = await sessionFor('Friend#1111', 'member');
    // v1 first: two builds of Rockslicer (stats change) and legacy '' drop totals; v5 then brings corpses, the run's
    // boss/group loot, vendors (one with extended costs) and recipes; v4 professions add build 69977.
    await ingest(batchFromFixture('session-v1.lua'));
    await ingest(batchFromFixture('session-v5.lua'));
    await ingest(batchFromFixture('professions-v4.lua'));
    await ingest(secondSession());
  });
  afterAll(async () => {
    await s?.stop();
  });

  describe('authorization', () => {
    const URLS = [
      '/admin/api/loot/mobs',
      '/admin/api/loot/mobs/644',
      '/admin/api/loot/items',
      '/admin/api/items/872',
      '/admin/api/runs',
      `/admin/api/runs/${RUN_ID}`,
      '/admin/api/dungeons/clear-times',
    ];
    it('needs an admin session: 401 anonymous or bearer, 403 member, 200 admin', async () => {
      for (const url of URLS) {
        expect((await get(url, null)).statusCode, url).toBe(401);
        const bearer = await s.app.inject({ method: 'GET', url, headers: s.readerAuth });
        expect(bearer.statusCode, url).toBe(401);
        expect((await get(url, member)).statusCode, url).toBe(403);
        expect((await get(url, admin)).statusCode, url).toBe(200);
      }
    });
  });

  describe('GET /admin/api/loot/mobs', () => {
    it('lists mobs per build with corpses, avg copper, item count and top drops by rate', async () => {
      const body = await json('/admin/api/loot/mobs');
      expect(body).toMatchObject({ total: 2, limit: 50, offset: 0 });
      const [defias, forever] = body.items;
      // 1 corpse (245 copper) in the v5 session + 3 (600) in the second: 845 / 4.
      expect(defias).toEqual({
        build: 61582,
        npcId: 644,
        name: 'Defias Miner',
        foreverOnly: false,
        corpses: 4,
        avgCopper: 211.3,
        items: 2,
        topItems: [
          { itemId: 872, name: 'Rockslicer', quality: 3, dropped: 2, quantity: 2, rate: 0.5 },
          { itemId: 2589, name: 'Linen Cloth', quality: 1, dropped: 2, quantity: 3, rate: 0.5 },
        ],
      });
      expect(forever).toMatchObject({
        npcId: 250123,
        name: null,
        foreverOnly: true,
        corpses: 2,
        avgCopper: 5,
        items: 1,
      });
    });

    it('agrees with /v1/drops/rates (the legacy session never counts)', async () => {
      const rates = (
        await s.app.inject({ method: 'GET', url: '/v1/drops/rates', headers: s.readerAuth })
      ).json() as { npcId: number; itemId: number; rate: number; corpses: number }[];
      const mobs = (await json('/admin/api/loot/mobs')).items as {
        npcId: number;
        corpses: number;
        topItems: { itemId: number; rate: number }[];
      }[];
      for (const r of rates) {
        const m = mobs.find((x) => x.npcId === r.npcId)!;
        expect(m.corpses).toBe(r.corpses);
        expect(m.topItems.find((i) => i.itemId === r.itemId)?.rate).toBe(r.rate);
      }
    });

    it('filters by ?build= and ?search= (name or id), and pages', async () => {
      expect((await json('/admin/api/loot/mobs?build=61600')).items).toEqual([]);
      expect((await json('/admin/api/loot/mobs?search=defias')).items.map(npc)).toEqual([644]);
      expect((await json('/admin/api/loot/mobs?search=250123')).items.map(npc)).toEqual([250123]);
      // LIKE wildcards are literal.
      expect((await json('/admin/api/loot/mobs?search=%25')).items).toEqual([]);
      const page = await json('/admin/api/loot/mobs?limit=1&offset=1');
      expect(page).toMatchObject({ total: 2, limit: 1, offset: 1 });
      expect(page.items.map(npc)).toEqual([250123]);
      // Past the end: no rows, the total still counts.
      expect(await json('/admin/api/loot/mobs?offset=10')).toMatchObject({ total: 2, items: [] });
      // Caps: limit at most 200; junk falls back to the defaults.
      expect(await json('/admin/api/loot/mobs?limit=100000')).toMatchObject({ limit: 200 });
      expect(await json('/admin/api/loot/mobs?limit=abc&offset=-3')).toMatchObject({
        limit: 50,
        offset: 0,
      });
      expect((await get('/admin/api/loot/mobs?build=2147483648')).statusCode).toBe(400);
    });

    it('answers one mob with every drop per build', async () => {
      const body = await json('/admin/api/loot/mobs/644');
      expect(body).toMatchObject({ npcId: 644, name: 'Defias Miner', foreverOnly: false });
      expect(body.builds).toHaveLength(1);
      expect(body.builds[0]).toMatchObject({ build: 61582, corpses: 4, avgCopper: 211.3 });
      expect(body.builds[0].items.map((i: { itemId: number }) => i.itemId)).toEqual([872, 2589]);
      expect((await get('/admin/api/loot/mobs/999')).statusCode).toBe(404);
      expect((await get('/admin/api/loot/mobs/abc')).statusCode).toBe(400);
      expect((await get('/admin/api/loot/mobs/2147483648')).statusCode).toBe(400);
    });
  });

  describe('GET /admin/api/loot/items', () => {
    it('lists items with the latest snapshot, source counts and the Forever-only flag', async () => {
      const body = await json('/admin/api/loot/items?limit=200');
      const rock = body.items.find((i: { itemId: number }) => i.itemId === 872);
      expect(rock).toMatchObject({
        name: 'Rockslicer',
        quality: 3,
        type: 'Weapon',
        subtype: 'Two-Handed Axes',
        build: 61600,
        foreverOnly: false,
        sources: { drops: 1, nodes: 0, vendors: 0, quests: 0, recipes: 0 },
      });
      const thread = body.items.find((i: { itemId: number }) => i.itemId === 2320);
      // Sold by Alexandra Bolero and Beneris.
      expect(thread.sources.vendors).toBe(2);
      const bolt = body.items.find((i: { itemId: number }) => i.itemId === 2996);
      expect(bolt.sources.recipes).toBe(1);
      const mark = body.items.find((i: { itemId: number }) => i.itemId === 250001);
      expect(mark.foreverOnly).toBe(true);
      expect(FOREVER_ID_THRESHOLDS.item).toBe(200000);
      expect(body.total).toBe(body.items.length);
      expect(body.classes).toContainEqual({ name: 'Weapon', count: 2 });
    });

    it('filters by search, quality and class; pages with caps', async () => {
      const names = async (q: string) =>
        (await json(`/admin/api/loot/items?${q}`)).items.map((i: { name: string }) => i.name);
      expect(await names('search=linen')).toEqual([
        'Bolt of Linen Cloth',
        'Brown Linen Vest',
        'Linen Cloth',
        'Pattern: Blue Linen Vest',
        'Pattern: Red Linen Robe',
        'Red Linen Robe',
      ]);
      expect(await names('search=872')).toEqual(['Rockslicer']);
      expect(await names('quality=3')).toEqual(['Rockslicer']);
      expect(await names('quality=2&class=weapon')).toEqual(['Bayou Staff']);
      expect(await names('class=9')).toEqual([
        'Pattern: Blue Linen Vest',
        'Pattern: Red Linen Robe',
      ]);
      expect((await get('/admin/api/loot/items?quality=x')).statusCode).toBe(400);
      // Search and class are trimmed and refused above 100 chars (never silently cut).
      expect(await names(`search=${encodeURIComponent('  872 ')}`)).toEqual(['Rockslicer']);
      expect(await names(`search=${'z'.repeat(100)}`)).toEqual([]);
      for (const q of [`search=${'z'.repeat(101)}`, `class=${'z'.repeat(101)}`]) {
        expect((await get(`/admin/api/loot/items?${q}`)).statusCode, q).toBe(400);
      }
      expect((await get(`/admin/api/loot/mobs?search=${'z'.repeat(101)}`)).statusCode).toBe(400);
      const page = await json('/admin/api/loot/items?limit=2&offset=2');
      expect(page).toMatchObject({ limit: 2, offset: 2 });
      expect(page.items).toHaveLength(2);
      expect(page.total).toBeGreaterThan(4);
      expect(await json('/admin/api/loot/items?limit=5000')).toMatchObject({ limit: 200 });
    });
  });

  describe('GET /admin/api/items/:id', () => {
    it('diffs stats and fields between consecutive builds', async () => {
      const body = await json('/admin/api/items/872');
      expect(body.itemId).toBe(872);
      expect(body.statDiffs).toEqual([
        {
          fromBuild: 61582,
          toBuild: 61600,
          stats: [
            { stat: 'ITEM_MOD_STAMINA_SHORT', from: null, to: 2 },
            { stat: 'ITEM_MOD_STRENGTH_SHORT', from: 7, to: 8 },
          ],
          fields: expect.any(Array),
        },
      ]);
    });

    it('lists drop rates with mob names, vendors with costs and recipes', async () => {
      const rock = await json('/admin/api/items/872');
      expect(rock.dropRates).toEqual([
        {
          build: 61582,
          npcId: 644,
          npcName: 'Defias Miner',
          corpses: 4,
          dropped: 2,
          quantity: 2,
          rate: 0.5,
        },
      ]);
      const pattern = await json('/admin/api/items/2598');
      const beneris = pattern.vendors.find((v: { npcId: number }) => v.npcId === 248196);
      expect(beneris).toMatchObject({
        npcName: 'Beneris',
        npcTitle: 'Tailoring',
        build: 61582,
        price: 0,
        costs: [
          { amount: 3, itemId: 250001, name: 'Mark of the Barrens' },
          { amount: 25, currencyId: 1901, name: 'Honor Points' },
        ],
      });
      expect(beneris.seenAt).toMatch(CHICAGO_ISO);
      const bolt = await json('/admin/api/items/2996');
      expect(
        bolt.recipes.produces.map((r: { recipeId: number; build: number }) => [
          r.recipeId,
          r.build,
        ]),
      ).toEqual([
        [2963, 69977],
        [2963, 61582],
      ]);
      expect(
        bolt.recipes.reagentIn.map((r: { recipeId: number; qty: number }) => [r.recipeId, r.qty]),
      ).toEqual(expect.arrayContaining([[2389, 3]]));
      expect(bolt.recipes.reagentIn[0]).toHaveProperty('outputItemName');
      expect((await get('/admin/api/items/0')).statusCode).toBe(400);
      expect((await get('/admin/api/items/2147483648')).statusCode).toBe(400);
      expect((await get('/admin/api/items/424242')).statusCode).toBe(404);
    });
  });

  describe('runs', () => {
    it('lists runs newest first with totals and facets, filtered and paged', async () => {
      const body = await json('/admin/api/runs');
      expect(body).toMatchObject({ total: 2, limit: 50, offset: 0 });
      expect(body.instances).toEqual([{ instanceId: 36, instance: 'The Deadmines', runs: 2 }]);
      const [newer, older] = body.items;
      expect(newer.startedAt > older.startedAt).toBe(true);
      // One row per run group; a run nobody else uploaded is a group of one.
      expect(older).toMatchObject({
        id: RUN_ID,
        build: 61582,
        members: [{ id: RUN_ID, char: 'Thibodeaux-Bayou', charClass: 'HUNTER', charLevel: 10 }],
        instance: 'The Deadmines',
        instanceId: 36,
        activeSecs: 930,
        awaySecs: 120,
        xpTotal: 4350,
        questXp: 850,
        mobXp: 3500,
        deaths: 1,
        bosses: { killed: 2, total: 2 },
        loot: 1,
        party: 2,
        lootMethod: 'group',
      });
      expect(older.startedAt).toMatch(CHICAGO_ISO);
      expect((await json('/admin/api/runs?build=61600')).items).toHaveLength(1);
      expect((await json('/admin/api/runs?instance=34')).items).toHaveLength(0);
      expect(await json('/admin/api/runs?limit=1&offset=1')).toMatchObject({
        total: 2,
        items: [{ id: RUN_ID }],
      });
      expect(await json('/admin/api/runs?limit=999')).toMatchObject({ limit: 200 });
      expect((await get('/admin/api/runs?instance=2147483648')).statusCode).toBe(400);
    });

    it('answers one run with bosses, loot with names, boss loot rolls, group loot and party', async () => {
      const group = await json(`/admin/api/runs/${encodeURIComponent(RUN_ID)}`);
      // A group of one: the group view is the run itself, its only perspective the full run.
      expect(group).toMatchObject({
        id: RUN_ID,
        members: 1,
        activeSecs: 930,
        deaths: 1,
        lootMethod: 'group',
      });
      expect(group.perspectives).toHaveLength(1);
      const run = group.perspectives[0];
      expect(group.bosses).toEqual(run.bosses);
      expect(group.bossLoot).toEqual(
        run.bossLoot.map(({ winnerIsSelf: _, ...b }: { winnerIsSelf: boolean }) => ({
          ...b,
          winnerChar: null,
        })),
      );
      expect(group.loot).toEqual(run.loot.map((l: object) => ({ ...l, char: 'Thibodeaux-Bayou' })));
      expect(run).toMatchObject({
        id: RUN_ID,
        charClass: 'HUNTER',
        difficulty: 1,
        maxPlayers: 5,
        endReason: 'left',
        lootMethod: 'group',
        xpTotal: 4350,
        questXp: 850,
        mobXp: 3500,
      });
      expect(run.startedAt).toMatch(CHICAGO_ISO);
      expect(run.finishedAt).toMatch(CHICAGO_ISO);
      expect(run.bosses).toEqual([
        { ord: 1, encounterId: 1, name: "Rhahk'Zor", killed: true, atSecs: 300 },
        { ord: 2, encounterId: 2, name: 'Edwin VanCleef', killed: true, atSecs: 900 },
      ]);
      expect(run.loot).toEqual([
        { itemId: 872, name: 'Rockslicer', quality: 3, npcId: 644, npcName: 'Defias Miner' },
      ]);
      expect(run.bossLoot).toEqual([
        {
          encounterId: 1,
          bossName: "Rhahk'Zor",
          lootListKey: 1,
          itemId: 872,
          name: 'Rockslicer',
          quality: 3,
          qty: null,
          winnerClass: 'WARRIOR',
          winnerIsSelf: false,
          allPassed: null,
          rolls: [
            { class: 'WARRIOR', roll: 91, state: 'needmainspec' },
            { class: 'HUNTER', roll: 45, state: 'greed' },
          ],
        },
      ]);
      expect(run.groupLoot).toEqual([
        {
          itemId: 872,
          name: 'Rockslicer',
          quality: 3,
          qty: 1,
          by: 'party',
          class: 'WARRIOR',
          won: true,
        },
        {
          itemId: 2589,
          name: 'Linen Cloth',
          quality: 1,
          qty: 2,
          by: 'party',
          class: 'PRIEST',
          won: null,
        },
        {
          itemId: 2589,
          name: 'Linen Cloth',
          quality: 1,
          qty: 3,
          by: 'self',
          class: null,
          won: null,
        },
      ]);
      expect(run.party).toEqual([
        { slot: 1, class: 'WARRIOR', level: 18 },
        { slot: 2, class: 'PRIEST', level: 17 },
      ]);
      expect((await get('/admin/api/runs/nope')).statusCode).toBe(404);
      // Long run ids route (Fastify matches params up to 512 chars); the route caps them at 256.
      expect((await get(`/admin/api/runs/${encodeURIComponent('é'.repeat(256))}`)).statusCode).toBe(
        404,
      );
      const long = await get(`/admin/api/runs/${'x'.repeat(300)}`);
      expect(long.statusCode).toBe(400);
      expect(long.json()).toEqual({ error: 'bad run id' });
    });

    it('lists clear times of finished runs per instance', async () => {
      expect(await json('/admin/api/dungeons/clear-times')).toEqual([
        {
          instanceId: 36,
          instance: 'The Deadmines',
          runs: [
            { id: RUN_ID, build: 61582, activeSecs: 930, members: 1 },
            { id: 'Thibodeaux-Bayou-36-1790087510', build: 61600, activeSecs: 1200, members: 1 },
          ],
        },
      ]);
      expect(
        (await json('/admin/api/dungeons/clear-times?build=61600'))[0].runs.map(
          (r: { activeSecs: number }) => r.activeSecs,
        ),
      ).toEqual([1200]);
    });
  });

  // Last: the container items (a Schematic among them) would change the item list assertions above.
  describe('GET /admin/api/items/:id — container loot (schema 6)', () => {
    beforeAll(async () => {
      // session-v6.lua's items and container records only (its drops, runs etc. would repeat v5's), then a second
      // session that opened the clam stack twice more, and loot of a session with no opens (never counted).
      const v6 = batchFromFixture('session-v6.lua', 'ACCOUNT3', 'pc-3');
      const only = (b: UploadBatch, records: Partial<UploadBatch['records']>): UploadBatch => ({
        ...b,
        records: {
          ...Object.fromEntries(Object.keys(b.records).map((k) => [k, []])),
          ...records,
        } as UploadBatch['records'],
      });
      await ingest(
        only(v6, {
          items: v6.records.items,
          itemSnapshots: v6.records.itemSnapshots,
          containerOpens: v6.records.containerOpens,
          containerLoot: v6.records.containerLoot,
        }),
      );
      const b = { build: 61582, session: '1790300000-c1a2' };
      await ingest(
        only(
          { ...v6, meta: { ...v6.meta, session: b.session } },
          {
            containerOpens: [{ containerId: 5523, ...b, opened: 2, copper: 15 }],
            containerLoot: [{ itemId: 5503, containerId: 5523, ...b, count: 1, quantity: 1 }],
          },
        ),
      );
      const orphan = { build: 61582, session: '1790300500-dead' };
      await ingest(
        only(
          { ...v6, meta: { ...v6.meta, session: orphan.session } },
          {
            containerLoot: [{ itemId: 5503, containerId: 5523, ...orphan, count: 5, quantity: 5 }],
          },
        ),
      );
    });

    it('a container lists its opens, copper per open and each item with its chance per open', async () => {
      const clam = await json('/admin/api/items/5523');
      expect(clam.contents).toEqual({
        opens: [{ build: 61582, opened: 4, copper: 50, avgCopper: 12.5 }],
        items: [
          {
            build: 61582,
            itemId: 5503,
            name: 'Clam Meat',
            quality: 1,
            count: 3,
            quantity: 4,
            chance: 0.75,
            avgQuantity: 1.33,
          },
          {
            build: 61582,
            itemId: 5498,
            name: 'Small Lustrous Pearl',
            quality: 1,
            count: 1,
            quantity: 1,
            chance: 0.25,
            avgQuantity: 1,
          },
        ],
      });
      expect(clam.openedFrom).toEqual([]);
      const bottle = await json('/admin/api/items/6307');
      expect(bottle.contents.opens).toEqual([{ build: 61582, opened: 1, copper: 0, avgCopper: 0 }]);
      expect(bottle.contents.items).toEqual([
        expect.objectContaining({
          itemId: 4409,
          name: 'Schematic: Small Seaforium Charge',
          count: 1,
          chance: 1,
        }),
      ]);
    });

    it('an item lists the containers it came out of; container 0 is unnamed', async () => {
      const meat = await json('/admin/api/items/5503');
      expect(meat.openedFrom).toEqual([
        {
          build: 61582,
          containerId: 0,
          containerName: null,
          containerQuality: null,
          opened: 1,
          count: 1,
          quantity: 1,
          chance: 1,
        },
        {
          build: 61582,
          containerId: 5523,
          containerName: 'Small Barnacled Clam',
          containerQuality: 1,
          opened: 4,
          count: 3,
          quantity: 4,
          chance: 0.75,
        },
      ]);
      expect(meat.contents).toEqual({ opens: [], items: [] });
      expect(meat.dropRates).toEqual([]);
      const schematic = await json('/admin/api/items/4409');
      expect(schematic.openedFrom).toEqual([
        expect.objectContaining({
          containerId: 6307,
          containerName: 'Message in a Bottle',
          chance: 1,
        }),
      ]);
    });

    it('items without container loot answer empty lists', async () => {
      const rock = await json('/admin/api/items/872');
      expect(rock.contents).toEqual({ opens: [], items: [] });
      expect(rock.openedFrom).toEqual([]);
    });
  });
});

describe('statDiffs', () => {
  it('compares consecutive builds (ascending), stats and fields, only when something changed', () => {
    const snap = (build: number, stats: Record<string, number>, ilvl: number | null = 20) => ({
      build,
      ilvl,
      reqLevel: 15,
      sellPrice: 100,
      stats,
    });
    expect(
      statDiffs([snap(3, { STR: 8, AGI: 1 }, 22), snap(1, { STR: 7 }), snap(2, { STR: 7 })]),
    ).toEqual([
      {
        fromBuild: 2,
        toBuild: 3,
        stats: [
          { stat: 'AGI', from: null, to: 1 },
          { stat: 'STR', from: 7, to: 8 },
        ],
        fields: [{ field: 'ilvl', from: 20, to: 22 }],
      },
    ]);
    expect(statDiffs([snap(1, { STR: 1 }), snap(2, {})])[0]!.stats).toEqual([
      { stat: 'STR', from: 1, to: null },
    ]);
    expect(statDiffs([snap(1, { STR: 1 })])).toEqual([]);
    expect(statDiffs([])).toEqual([]);
  });
});

const npc = (m: { npcId: number }) => m.npcId;
