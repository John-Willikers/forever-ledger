// Admin panel builds routes (/admin/api/builds, /admin/api/build-diff) against a real Postgres: the synthetic session
// as build 61582, then a hand-built "patch" of the same records as build 70100 with known differences.
import type { UploadBatch } from '@forever-ledger/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession } from '../src/sessions.js';
import { FILLERS, NEW, OLD, oldBatch, patchBatch, STR7, STR9 } from './builds-fixtures.js';
import { batchFromFixture, startServer } from './helpers.js';

type Server = Awaited<ReturnType<typeof startServer>>;

const COOKIE_SECRET = 'test-cookie-secret-admin-builds-0123456789abcdef';
const SESSION = '__Host-fl_session';
const CHICAGO_ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d-0[56]:00$/;

describe('admin builds API (real Postgres)', () => {
  let s: Server;
  let admin: Record<string, string>;
  let member: Record<string, string>;

  async function sessionFor(battletag: string, role: 'admin' | 'member') {
    const { rows } = await s.database.pool.query(
      `insert into users (bnet_sub, battletag, role) values ($1, $2, $3) returning id`,
      [`sub-${battletag}`, battletag, role],
    );
    const value = await createSession(s.database.db, rows[0].id as number, {});
    return { [SESSION]: s.app.signCookie(value) };
  }

  const get = (url: string, cookies: Record<string, string> | null = admin) =>
    s.app.inject({ method: 'GET', url, cookies: cookies ?? {} });
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
  const diff = (q = `from=${OLD}&to=${NEW}`) => json(`/admin/api/build-diff?${q}`);

  beforeAll(async () => {
    s = await startServer({ admin: { cookieSecret: COOKIE_SECRET, authPerMinute: 10_000 } });
    admin = await sessionFor('JohnWilliker#1292', 'admin');
    member = await sessionFor('Friend#1111', 'member');
    // v1 adds build 61600 (a second Rockslicer snapshot and a run); then 61582 and the 70100 patch.
    await ingest(batchFromFixture('session-v1.lua'));
    await ingest(oldBatch());
    await ingest(patchBatch());
  });
  afterAll(async () => {
    await s?.stop();
  });

  describe('authorization', () => {
    it('needs an admin session: 401 anonymous or bearer, 403 member, 200 admin', async () => {
      for (const url of ['/admin/api/builds', `/admin/api/build-diff?from=${OLD}&to=${NEW}`]) {
        expect((await get(url, null)).statusCode, url).toBe(401);
        const bearer = await s.app.inject({ method: 'GET', url, headers: s.readerAuth });
        expect(bearer.statusCode, url).toBe(401);
        expect((await get(url, member)).statusCode, url).toBe(403);
        expect((await get(url, admin)).statusCode, url).toBe(200);
      }
    });
  });

  describe('GET /admin/api/builds', () => {
    it('lists builds newest first with uploads, characters and what each build observed', async () => {
      const body = await json('/admin/api/builds');
      expect(body.map((b: { build: number }) => b.build)).toEqual([NEW, 61600, OLD]);
      const [patch, v1, old] = body;
      expect(patch).toMatchObject({
        build: NEW,
        version: '1.60.2',
        interface: 16002,
        uploads: 1,
        characters: 1,
        counts: {
          items: 11 + 1 + FILLERS.length,
          quests: 2,
          recipes: 3,
          vendors: 3,
          trainers: 1,
          npcsLooted: 3,
        },
      });
      expect(patch.firstSeen).toMatch(CHICAGO_ISO);
      expect(patch.lastSeen).toMatch(CHICAGO_ISO);
      // The v1 file's upload counts for its client build; its records are mostly 61582's.
      expect(v1).toMatchObject({
        build: 61600,
        version: '1.15.8',
        uploads: 1,
        characters: 1,
        counts: { items: 1, quests: 0, recipes: 0, vendors: 0, trainers: 0, npcsLooted: 0 },
      });
      expect(old).toMatchObject({
        build: OLD,
        uploads: 1,
        characters: 1,
        counts: { items: 12, quests: 2, recipes: 3, vendors: 2, trainers: 1, npcsLooted: 3 },
      });
    });
  });

  describe('GET /admin/api/build-diff', () => {
    it('names both builds and the thresholds used', async () => {
      const body = await diff();
      expect(body.from).toMatchObject({ build: OLD, version: '1.15.7' });
      expect(body.to).toMatchObject({ build: NEW, version: '1.60.2' });
      expect(body).toMatchObject({ minCorpses: 5, limit: 500, sampleLimit: 50 });
    });

    it('diffs items seen in both builds: fields, stats and tooltip lines', async () => {
      const { items } = await diff();
      expect(items.total).toBe(2);
      expect(items.changes).toEqual([
        {
          itemId: 872,
          name: 'Rockslicer',
          quality: 3,
          fields: [
            { field: 'ilvl', from: 21, to: 23 },
            { field: 'sellPrice', from: 2600, to: 2800 },
          ],
          stats: [
            { stat: 'ITEM_MOD_STAMINA_SHORT', from: null, to: 3 },
            { stat: 'ITEM_MOD_STRENGTH_SHORT', from: 7, to: 9 },
          ],
          tooltip: { added: [STR9], removed: [STR7] },
        },
        {
          itemId: 2320,
          name: 'Coarse Thread',
          quality: 1,
          fields: [{ field: 'reqLevel', from: 0, to: 5 }],
          stats: [],
          tooltip: { added: [], removed: [] },
        },
      ]);
      // 5555/5556 came from the v1 file at 61582 too, Copper Ore only there.
      expect(items.onlyInFrom).toEqual({
        total: 1,
        sample: [{ id: 2770, name: 'Copper Ore' }],
      });
      expect(items.onlyInTo.total).toBe(1 + FILLERS.length);
      expect(items.onlyInTo.sample).toHaveLength(50);
      expect(items.onlyInTo.sample[0]).toEqual({ id: 250777, name: 'Bayou Relic' });
      expect(items.onlyInTo.sample[1]).toEqual({ id: 260000, name: 'Filler 260000' });
    });

    it('diffs quests: XP and money offered, reward options added, removed and changed', async () => {
      const { quests } = await diff();
      expect(quests.total).toBe(1);
      expect(quests.changes).toEqual([
        {
          questId: 1234,
          title: 'Red Silk Bandanas',
          level: 17,
          xp: { from: 850, to: 890 },
          money: { from: 500, to: 450 },
          rewards: {
            added: [{ itemId: 5557, name: null, quality: null, kind: 'choice', count: 1 }],
            removed: [{ itemId: 5556, name: 'Bayou Staff', quality: 2, kind: 'choice', count: 1 }],
            changed: [
              {
                itemId: 5555,
                name: "Swampwalker's Boots",
                quality: 2,
                kind: 'choice',
                from: 1,
                to: 2,
              },
            ],
          },
        },
      ]);
      expect(quests.onlyInFrom).toEqual({ total: 1, sample: [{ id: 4321, name: 'Old Errand' }] });
      expect(quests.onlyInTo).toEqual({ total: 1, sample: [{ id: 90001, name: 'Bayou Bounty' }] });
    });

    it('diffs recipes: reagents added, removed and re-counted; output quantity; max trivial', async () => {
      const { recipes } = await diff();
      expect(recipes.total).toBe(2);
      expect(recipes.changes).toEqual([
        {
          recipeId: 2389,
          name: 'Red Linen Robe',
          outputItemId: 2572,
          outputName: 'Red Linen Robe',
          fields: [{ field: 'maxTrivial', from: 90, to: 95 }],
          reagents: {
            added: [{ itemId: 2589, name: 'Linen Cloth', qty: 1 }],
            removed: [{ itemId: 2320, name: 'Coarse Thread', qty: 2 }],
            changed: [{ itemId: 2996, name: 'Bolt of Linen Cloth', from: 3, to: 4 }],
          },
        },
        {
          recipeId: 2963,
          name: 'Bolt of Linen Cloth',
          outputItemId: 2996,
          outputName: 'Bolt of Linen Cloth',
          fields: [{ field: 'qtyMax', from: 1, to: 2 }],
          reagents: { added: [], removed: [], changed: [] },
        },
      ]);
      expect(recipes.onlyInFrom).toEqual({
        total: 1,
        sample: [{ id: 2393, name: 'Brown Linen Vest' }],
      });
      expect(recipes.onlyInTo).toEqual({
        total: 1,
        sample: [{ id: 7629, name: 'Blue Linen Vest' }],
      });
    });

    it('diffs vendors: items added and removed, price changes', async () => {
      const { vendors } = await diff();
      expect(vendors.total).toBe(1);
      expect(vendors.changes).toEqual([
        {
          npcId: 1347,
          name: 'Alexandra Bolero',
          title: null,
          added: [{ itemId: 6270, name: null, quality: null, price: 200, stack: 1, costs: [] }],
          removed: [
            {
              itemId: 2598,
              name: 'Pattern: Red Linen Robe',
              quality: 1,
              price: 1200,
              stack: 1,
              costs: [],
            },
          ],
          changed: [
            {
              itemId: 2320,
              name: 'Coarse Thread',
              quality: 1,
              from: { price: 10, stack: 5, costs: [] },
              to: { price: 11, stack: 5, costs: [] },
            },
          ],
        },
      ]);
      expect(vendors.onlyInFrom).toEqual({ total: 0, sample: [] });
      expect(vendors.onlyInTo).toEqual({
        total: 1,
        sample: [{ id: 250500, name: 'Swamp Peddler' }],
      });
    });

    it('diffs trainers: services added and removed, cost and skill requirement changes', async () => {
      const { trainers } = await diff();
      expect(trainers.total).toBe(1);
      expect(trainers.changes).toEqual([
        {
          npcId: 1103,
          name: 'Eldrin',
          title: 'Tailoring Trainer',
          complete: { from: true, to: true },
          added: [
            {
              name: 'Blue Linen Vest',
              cost: 300,
              skill: null,
              skillRank: 70,
              level: null,
              itemId: null,
            },
          ],
          removed: [
            {
              name: 'Journeyman Tailoring',
              cost: 500,
              skill: null,
              skillRank: null,
              level: 10,
              itemId: null,
            },
          ],
          changed: [
            { name: 'Brown Linen Vest', fields: [{ field: 'cost', from: 100, to: 120 }] },
            { name: 'Red Linen Robe', fields: [{ field: 'skillRank', from: 40, to: 45 }] },
          ],
        },
      ]);
      expect(trainers.onlyInFrom).toEqual({ total: 0, sample: [] });
      expect(trainers.onlyInTo).toEqual({ total: 0, sample: [] });
    });

    it('diffs drop rates where both builds looted the npc at least minCorpses times', async () => {
      const { drops } = await diff();
      // 644: Rockslicer 2/10 → 2/20, Copper Ore 0/10 → 4/20; Linen Cloth 5/10 → 10/20 is unchanged.
      expect(drops.total).toBe(2);
      expect(drops.changes).toEqual([
        {
          npcId: 644,
          npcName: null,
          itemId: 872,
          name: 'Rockslicer',
          quality: 3,
          from: { corpses: 10, dropped: 2, rate: 0.2 },
          to: { corpses: 20, dropped: 2, rate: 0.1 },
        },
        {
          npcId: 644,
          npcName: null,
          itemId: 2770,
          name: 'Copper Ore',
          quality: 1,
          from: { corpses: 10, dropped: 0, rate: 0 },
          to: { corpses: 20, dropped: 4, rate: 0.2 },
        },
      ]);
      // 700: 3 corpses in 61582 (under 5); 702 only in 61582, 701 only in 70100.
      expect(drops.belowThreshold).toBe(1);
      expect(drops.onlyInFrom).toEqual({ total: 1, sample: [{ id: 702, name: null }] });
      expect(drops.onlyInTo).toEqual({ total: 1, sample: [{ id: 701, name: null }] });

      const strict = (await diff(`from=${OLD}&to=${NEW}&minCorpses=15`)).drops;
      expect(strict).toMatchObject({ total: 0, changes: [], belowThreshold: 2 });
      const loose = (await diff(`from=${OLD}&to=${NEW}&minCorpses=1`)).drops;
      // 700: Linen Cloth 1/3 → 0/30.
      expect(loose.total).toBe(3);
      expect(loose.belowThreshold).toBe(0);
    });

    it('reads the other direction as the reverse change', async () => {
      const body = await diff(`from=${NEW}&to=${OLD}`);
      expect(body.items.changes[0].fields[0]).toEqual({ field: 'ilvl', from: 23, to: 21 });
      expect(body.quests.changes[0].xp).toEqual({ from: 890, to: 850 });
      expect(body.items.onlyInFrom.total).toBe(1 + FILLERS.length);
      expect(body.items.onlyInTo.total).toBe(1);
    });

    it('caps every change list at ?limit= and keeps the totals', async () => {
      const body = await diff(`from=${OLD}&to=${NEW}&limit=1`);
      expect(body.limit).toBe(1);
      for (const cat of ['items', 'recipes', 'drops'] as const) {
        expect(body[cat].changes, cat).toHaveLength(1);
        expect(body[cat].total, cat).toBe(2);
      }
      expect(body.items.changes[0].itemId).toBe(872);
      expect((await diff(`from=${OLD}&to=${NEW}&limit=100000`)).limit).toBe(500);
    });

    it('defaults to the two newest builds, and fills in a missing side', async () => {
      const body = await diff('');
      expect(body.from.build).toBe(61600);
      expect(body.to.build).toBe(NEW);
      // Rockslicer at 61600: ilvl 22, Stamina 2, Strength 8.
      expect(body.items.changes).toHaveLength(1);
      expect(body.items.changes[0]).toMatchObject({
        itemId: 872,
        fields: [
          { field: 'ilvl', from: 22, to: 23 },
          { field: 'sellPrice', from: 2600, to: 2800 },
        ],
        stats: [
          { stat: 'ITEM_MOD_STAMINA_SHORT', from: 2, to: 3 },
          { stat: 'ITEM_MOD_STRENGTH_SHORT', from: 8, to: 9 },
        ],
      });
      const toOnly = await diff(`to=61600`);
      expect([toOnly.from.build, toOnly.to.build]).toEqual([OLD, 61600]);
      const fromOnly = await diff(`from=${OLD}`);
      expect([fromOnly.from.build, fromOnly.to.build]).toEqual([OLD, NEW]);
      // Nothing older than the oldest build: the newest other one.
      const oldest = await diff(`to=${OLD}`);
      expect([oldest.from.build, oldest.to.build]).toEqual([NEW, OLD]);
    });

    it('validates: 400 for junk or equal builds, 404 for a build never seen', async () => {
      for (const q of [
        `from=${OLD}&to=${OLD}`,
        'from=abc&to=70100',
        'from=0&to=70100',
        'from=-1&to=70100',
        'from=2147483648&to=70100',
        `from=${OLD}&to=${NEW}&minCorpses=0`,
        `from=${OLD}&to=${NEW}&minCorpses=x`,
        `from=${OLD}&to=${NEW}&limit=0`,
      ]) {
        const res = await get(`/admin/api/build-diff?${q}`);
        expect(res.statusCode, q).toBe(400);
        expect(res.json().error, q).toEqual(expect.any(String));
      }
      for (const q of [`from=1&to=${NEW}`, `from=${OLD}&to=99999`]) {
        const res = await get(`/admin/api/build-diff?${q}`);
        expect(res.statusCode, q).toBe(404);
      }
    });
  });

  // Last: these rows add to the builds' counts. Written straight to the tables (contracts would refuse them).
  describe('junk jsonb', () => {
    it('reads wrong types as absent, never a 500', async () => {
      const q = (text: string, values: unknown[]) => s.database.pool.query(text, values);
      await q(
        `insert into vendors (npc_id, build, name, seen_at, items)
         values (300001, $1, 'Junk Vendor', now(), $3), (300001, $2, 'Junk Vendor', now(), '{"not":"a list"}')`,
        [OLD, NEW, JSON.stringify([{ itemId: 3e9, price: 1e12 }, { itemId: 2589, price: 'x' }, 7])],
      );
      await q(
        `insert into trainers (npc_id, build, name, seen_at, services)
         values (300003, $1, 'Junk Trainer', now(), '5'), (300003, $2, 'Junk Trainer', now(), $3)`,
        [OLD, NEW, JSON.stringify([{ name: 'X', cost: 'free' }, { name: 7 }])],
      );
      await q(
        `insert into item_snapshots (item_id, build, stats, tooltip)
         values (299999, $1, '[1, 2]', '"x"'), (299999, $2, $3, '[1, "line"]')`,
        [OLD, NEW, JSON.stringify({ junk: 'b', ITEM_MOD_STRENGTH_SHORT: 3 })],
      );
      await q(
        `insert into recipe_snapshots (recipe_id, build, reagents)
         values (99999, $1, '"x"'), (99999, $2, $3)`,
        [OLD, NEW, JSON.stringify([{ itemId: 2589, qty: '2' }, { itemId: -1 }, { itemId: 1.5 }])],
      );
      const body = await diff();
      expect(body.vendors.changes.find((v: { npcId: number }) => v.npcId === 300001)).toEqual({
        npcId: 300001,
        name: 'Junk Vendor',
        title: null,
        added: [],
        removed: [
          { itemId: 2589, name: 'Linen Cloth', quality: 1, price: null, stack: null, costs: [] },
        ],
        changed: [],
      });
      expect(
        body.trainers.changes.find((t: { npcId: number }) => t.npcId === 300003),
      ).toMatchObject({
        added: [{ name: 'X', cost: null, skill: null, skillRank: null, level: null, itemId: null }],
        removed: [],
        changed: [],
      });
      expect(body.items.changes.find((i: { itemId: number }) => i.itemId === 299999)).toEqual({
        itemId: 299999,
        name: null,
        quality: null,
        fields: [],
        stats: [{ stat: 'ITEM_MOD_STRENGTH_SHORT', from: null, to: 3 }],
        tooltip: { added: ['line'], removed: [] },
      });
      expect(body.recipes.changes.find((r: { recipeId: number }) => r.recipeId === 99999)).toEqual({
        recipeId: 99999,
        name: null,
        outputItemId: null,
        outputName: null,
        fields: [],
        reagents: {
          added: [{ itemId: 2589, name: 'Linen Cloth', qty: null }],
          removed: [],
          changed: [],
        },
      });
    });
  });
});
