// Uploaded jsonb (vendor items, trainer services, recipe reagents, node spots) is untrusted: a number out of int4
// range, a fraction where an int belongs, a string where a number belongs or a scalar where an array belongs must read
// as null / nothing, never make a read route fail. The rows are written straight to the tables: contracts would refuse
// these records at ingest.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashToken } from '../src/index.js';
import { createSession, csrfToken } from '../src/sessions.js';
import { batchFromFixture, startServer } from './helpers.js';

type Server = Awaited<ReturnType<typeof startServer>>;

const COOKIE_SECRET = 'test-cookie-secret-untrusted-jsonb-0123456789abcdef';
const SESSION = '__Host-fl_session';
const HUGE = 3_000_000_000;

describe('read routes over junk jsonb (real Postgres)', () => {
  let s: Server;
  let cookies: Record<string, string>;

  const get = (url: string) =>
    url.startsWith('/v1/')
      ? s.app.inject({ method: 'GET', url, headers: s.readerAuth })
      : s.app.inject({ method: 'GET', url, cookies });
  const json = async (url: string) => {
    const res = await get(url);
    expect(res.statusCode, `${url} ${res.body}`).toBe(200);
    return res.json();
  };
  const insert = (text: string, values: unknown[]) => s.database.pool.query(text, values);

  beforeAll(async () => {
    s = await startServer({ admin: { cookieSecret: COOKIE_SECRET, authPerMinute: 10_000 } });
    const { rows } = await s.database.pool.query(
      `insert into users (bnet_sub, battletag, role) values ('sub-a', 'Admin#1', 'admin') returning id`,
    );
    const value = await createSession(s.database.db, rows[0].id as number, {});
    csrfToken(COOKIE_SECRET, hashToken(value));
    cookies = { [SESSION]: s.app.signCookie(value) };

    const res = await s.app.inject({
      method: 'POST',
      url: '/v1/ingest',
      headers: s.auth,
      payload: batchFromFixture('session-v5.lua'),
    });
    expect(res.statusCode, res.body).toBe(200);

    const vendorItems = [
      { itemId: HUGE, price: 1e12 },
      {
        itemId: 2589,
        price: 1e12,
        stack: 1.5,
        numAvailable: 'lots',
        currencyId: HUGE,
        costs: [
          { itemId: HUGE, amount: 1e12 },
          { currencyId: -1.5, amount: 'x' },
        ],
      },
      { itemId: 2996, price: 10, stack: 1, costs: 'junk' },
      { itemId: 'abc' },
      { itemId: 2598.5 },
      7,
    ];
    await insert(
      `insert into vendors (npc_id, build, name, loc, seen_at, items)
       values (300001, 61582, 'Junk Vendor', $1, now(), $2), (300002, 61582, 'Scalar Vendor', '"x"', now(), $3)`,
      [
        JSON.stringify({ zone: 'Bayou', mapID: HUGE }),
        JSON.stringify(vendorItems),
        '{"not":"a list"}',
      ],
    );
    await insert(
      `insert into trainers (npc_id, build, name, seen_at, services)
       values (300003, 61582, 'Junk Trainer', now(), $1), (300004, 61582, 'Scalar Trainer', now(), '5')`,
      [
        JSON.stringify([
          { name: 'Bolt of Linen Cloth', itemId: HUGE, cost: 1e12, skillRank: -1.5, level: 'x' },
          { name: 'Other', itemId: 2996, cost: 1e12 },
          'junk',
        ]),
      ],
    );
    await insert(
      `insert into recipe_snapshots (recipe_id, build, output_item_id, reagents)
       values (2963, 1, 2996, $1), (2389, 1, 2996, '"junk"')`,
      [
        JSON.stringify([
          { itemId: 2589, qty: -1.5 },
          { itemId: HUGE, qty: 1e12 },
          { itemId: 2996, qty: 'x' },
          'junk',
        ]),
      ],
    );
    await insert(
      `insert into nodes (object_id, build, uploader_id, account, session, opened, name, spots)
       values (999, 61582, 'pc', 'A', 's1', 3, 'Junk Vein', $1), (998, 61582, 'pc', 'A', 's1', 1, 'Flat', '{}')`,
      [JSON.stringify([{ mapId: HUGE, points: [[1, 2]] }, { mapId: 1.5, points: 'x' }, 'junk'])],
    );
    await insert(
      `insert into recipes_learned (char, recipe_id, build, learned_at, via)
       values ('Junk-Realm', 2963, 61582, now(), 'item:99999999999'),
              ('Junk-Realm', 2389, 61582, now(), 'item:2147483648')`,
      [],
    );
  });
  afterAll(async () => {
    await s?.stop();
  });

  it('every read route over the junk rows answers 200', async () => {
    const urls = [
      '/admin/api/loot/items',
      '/admin/api/loot/items?search=Linen',
      '/admin/api/items/2589',
      '/admin/api/items/2996',
      '/admin/api/items/2598',
      '/v1/items/2589',
      '/v1/items/2996',
      '/v1/professions/recipes',
      '/v1/professions/recipes?build=1',
      '/v1/professions/sources?itemId=2589',
      '/v1/professions/sources?itemId=2996',
      '/v1/professions/sources?recipeId=2963',
      '/v1/professions/sources?recipeId=2389',
      '/v1/professions/gathering',
      '/admin/api/professions/overview',
      '/admin/api/professions/gathering-map',
      '/admin/api/professions/cost?recipeId=2963&build=1',
      '/admin/api/professions/cost?recipeId=2389&build=1',
      '/admin/api/vendors',
      '/admin/api/vendors/300001',
      '/admin/api/vendors/300002',
      '/admin/api/trainers',
      '/admin/api/trainers/300003',
      '/admin/api/trainers/300004',
    ];
    for (const url of urls) await json(url);
  });

  it('junk numbers read as null; well-typed ones next to them survive', async () => {
    const cloth = await json('/admin/api/items/2589');
    const junk = cloth.vendors.find((v: { npcId: number }) => v.npcId === 300001);
    expect(junk).toMatchObject({
      npcName: 'Junk Vendor',
      price: 1e12,
      stack: 1.5,
      numAvailable: null,
    });
    // Costs field by field: an id out of int4 or a string amount is left out.
    expect(junk.costs).toEqual([{ amount: 1e12 }, {}]);
    // The location keeps only well-typed, in-range fields.
    expect(junk.location).toEqual({ zone: 'Bayou', subzone: null, mapId: null, x: null, y: null });
    expect(junk).not.toHaveProperty('loc');

    const bolt = await json('/admin/api/items/2996');
    const reagents = bolt.recipes.produces.find(
      (r: { build: number; recipeId: number }) => r.build === 1 && r.recipeId === 2963,
    ).reagents;
    expect(reagents).toEqual([
      expect.objectContaining({ itemId: 2589, qty: -1.5 }),
      expect.objectContaining({ itemId: null, qty: 1e12 }),
      expect.objectContaining({ itemId: 2996, qty: null }),
      expect.objectContaining({ itemId: null, qty: null }),
    ]);
    const plain = bolt.vendors.find((v: { npcId: number }) => v.npcId === 300001);
    expect(plain).toMatchObject({ price: 10, stack: 1, costs: null });

    const items = await json('/admin/api/loot/items?search=2589');
    expect(items.items[0].sources.vendors).toBeGreaterThanOrEqual(1);

    const sources = await json('/v1/professions/sources?itemId=2996');
    const services = sources.trainers
      .filter((t: { npcId: number }) => t.npcId === 300003)
      .map((t: { service: string; itemId: number | null; cost: number | null }) => [
        t.service,
        t.itemId,
        t.cost,
      ]);
    expect(services).toEqual([
      ['Bolt of Linen Cloth', null, 1e12],
      ['Other', 2996, 1e12],
    ]);
  });
});
