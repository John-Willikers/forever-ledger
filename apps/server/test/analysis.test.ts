import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toCsv } from '../src/routes/export.js';
import { batchFromFixture, startServer } from './helpers.js';

type Server = Awaited<ReturnType<typeof startServer>>;

describe('analysis and export routes', () => {
  let s: Server;
  const get = (url: string, headers: Record<string, string> = s.auth) =>
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
    expect((await get('/v1/export?format=csv')).statusCode).toBe(400);
    expect((await get('/v1/export?table=api_tokens')).statusCode).toBe(400);
  });
});

describe('toCsv', () => {
  it('quotes commas, quotes and newlines and JSON-encodes objects', () => {
    expect(toCsv([{ a: 'x,y', b: 'say "hi"', c: { k: 1 }, d: null }], ['a', 'b', 'c', 'd'])).toBe(
      'a,b,c,d\n"x,y","say ""hi""","{""k"":1}",\n',
    );
  });
});
