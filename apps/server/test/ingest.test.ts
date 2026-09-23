import { contentHash, recordKey, RECORD_KINDS } from '@forever-ledger/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { revokeToken, mintToken } from '../src/index.js';
import { batchFromFixture, startServer } from './helpers.js';

type Server = Awaited<ReturnType<typeof startServer>>;

const TABLES = [
  'builds',
  'characters',
  'quests',
  'quest_observations',
  'quest_reward_options',
  'turn_ins',
  'items',
  'item_snapshots',
  'drops',
  'runs',
  'run_bosses',
  'run_party',
];

describe('ingest API (real Postgres)', () => {
  let s: Server;
  beforeAll(async () => {
    s = await startServer();
  });
  afterAll(async () => {
    await s?.stop();
  });

  const post = (body: unknown, headers: Record<string, string> = s.auth) =>
    s.app.inject({ method: 'POST', url: '/v1/ingest', headers, payload: body as object });

  const counts = async () =>
    Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, await s.count(t)])));

  it('reports health', async () => {
    const res = await s.app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
    expect(res.json().time).toMatch(/-0[56]:00$/); // America/Chicago offset
  });

  it('rejects missing, unknown and revoked tokens', async () => {
    const batch = batchFromFixture('session-v1.lua');
    expect((await post(batch, {})).statusCode).toBe(401);
    expect((await post(batch, { authorization: 'Bearer flt_nope' })).statusCode).toBe(401);
    const { id, token } = await mintToken(s.database.db, 'friend');
    expect((await post({}, { authorization: `Bearer ${token}` })).statusCode).toBe(409);
    await revokeToken(s.database.db, id);
    expect((await post(batch, { authorization: `Bearer ${token}` })).statusCode).toBe(401);
  });

  it('ingests a batch and acknowledges every record with its content hash', async () => {
    const batch = batchFromFixture('session-v1.lua');
    const res = await post(batch);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const expected = RECORD_KINDS.flatMap((k) =>
      (batch.records[k] as never[]).map((r) => ({ key: recordKey(k, r), hash: contentHash(r) })),
    );
    expect(body.acknowledged).toEqual(expected);
    const c = await counts();
    expect(c).toMatchObject({
      builds: 2,
      characters: 1,
      quests: 1,
      turn_ins: 1,
      items: 3,
      item_snapshots: 4,
      drops: 2,
      runs: 2,
      run_bosses: 2,
      run_party: 2,
    });
    expect(c.quest_reward_options).toBe(2);
  });

  it('is idempotent: the same batch twice creates no duplicates', async () => {
    const before = await counts();
    const res = await post(batchFromFixture('session-v1.lua'));
    expect(res.statusCode).toBe(200);
    expect(await counts()).toEqual(before);
    expect(await s.count('raw_uploads')).toBeGreaterThanOrEqual(2);
  });

  it('updates a changed run in place and replaces its bosses', async () => {
    const batch = batchFromFixture('session-v1.lua');
    const run = batch.records.runs[1]!;
    run.deaths = 4;
    run.bosses.push({ id: 3, name: 'Mr. Smite', killed: true, atSecs: 600 });
    expect((await post(batch)).statusCode).toBe(200);
    const { rows } = await s.database.pool.query('select deaths from runs where id = $1', [run.id]);
    expect(rows[0].deaths).toBe(4);
    expect(await s.count('runs')).toBe(2);
    expect(await s.count('run_bosses')).toBe(3);
  });

  it('sets drop counts (running totals) instead of adding, per account', async () => {
    const batch = batchFromFixture('session-v1.lua');
    batch.records.drops[0]!.count = 3;
    await post(batch);
    await post(batch);
    const q = 'select sum(count)::int as n from drops where item_id = 872 and build = 61582';
    expect((await s.database.pool.query(q)).rows[0].n).toBe(3);
    await post(batchFromFixture('session-v1.lua', 'ACCOUNT2', 'pc-2'));
    expect((await s.database.pool.query(q)).rows[0].n).toBe(4);
  });

  it('tolerates duplicate keys inside one batch (last wins)', async () => {
    const batch = batchFromFixture('session-v1.lua');
    const dup = structuredClone(batch.records.turnIns[0]!);
    dup.xp = 999;
    batch.records.turnIns.push(dup);
    const res = await post(batch);
    expect(res.statusCode).toBe(200);
    const { rows } = await s.database.pool.query('select xp from turn_ins');
    expect(rows).toEqual([{ xp: 999 }]);
  });

  it('keeps known quest and item fields when a later upload leaves them blank', async () => {
    // Forever doesn't load SavedVariables back, so after a /reload the addon rebuilds a quest from the turn-in
    // window alone (no level/category). Blanks must not erase what we knew.
    const base = batchFromFixture('session-v1.lua', 'ACCOUNT-KEEP');
    const quest = base.records.quests[0]!;
    const item = base.records.items[0]!;
    expect(quest.level).toBeDefined();
    expect(item.quality).toBeDefined();
    expect((await post({ ...base })).statusCode).toBe(200);

    const blank = structuredClone(base);
    blank.records = {
      ...blank.records,
      quests: [{ questId: quest.questId, title: quest.title }],
      items: [{ itemId: item.itemId, name: item.name }],
    };
    expect((await post(blank)).statusCode).toBe(200);

    const q = await s.database.pool.query(
      'select title, level, category from quests where quest_id = $1',
      [quest.questId],
    );
    expect(q.rows[0]).toMatchObject({ title: quest.title, level: quest.level });
    const i = await s.database.pool.query('select name, quality from items where item_id = $1', [
      item.itemId,
    ]);
    expect(i.rows[0]).toMatchObject({ name: item.name, quality: item.quality });
  });

  it('accepts schema 1 and 2 batches and stores the chosen reward from schema 2', async () => {
    const v1 = batchFromFixture('session-v1.lua');
    const v2 = batchFromFixture('session-v2.lua');
    expect([v1.schemaVersion, v2.schemaVersion]).toEqual([1, 2]);
    const id = v2.records.turnIns[0]!.id;
    expect(v1.records.turnIns[0]!.id).toBe(id);
    const choiceOf = async () =>
      (
        await s.database.pool.query(
          'select choice_index, choice_item_id from turn_ins where id = $1',
          [id],
        )
      ).rows[0];

    expect((await post(v1)).statusCode).toBe(200);
    expect(await choiceOf()).toEqual({ choice_index: null, choice_item_id: null });

    const res = await post(v2);
    expect(res.statusCode).toBe(200);
    expect(res.json().acknowledged).toContainEqual({
      key: `turnin:${id}`,
      hash: contentHash(v2.records.turnIns[0]),
    });
    expect(await choiceOf()).toEqual({ choice_index: 1, choice_item_id: 5555 });
    expect(await s.count('turn_ins')).toBe(1);
  });

  it('rejects unknown schema versions with 409 and malformed batches with 400', async () => {
    const batch = batchFromFixture('session-v1.lua');
    const res409 = await post({ ...batch, schemaVersion: 3 });
    expect(res409.statusCode).toBe(409);
    expect(res409.json().error).toMatch(/accepts 1, 2/);
    const bad = structuredClone(batch) as unknown as { records: { runs: { start: unknown }[] } };
    bad.records.runs[0]!.start = 'yesterday';
    const res = await post(bad);
    expect(res.statusCode).toBe(400);
    expect(res.json().issues[0].path).toBe('records.runs.0.start');
  });
});

describe('ingest API limits', () => {
  let s: Server;
  beforeAll(async () => {
    s = await startServer({ bodyLimit: 2048, ingestPerMinute: 3 });
  });
  afterAll(async () => {
    await s?.stop();
  });

  it('rejects oversized payloads with 413', async () => {
    const res = await s.app.inject({
      method: 'POST',
      url: '/v1/ingest',
      headers: { ...s.auth, 'content-type': 'application/json' },
      payload: JSON.stringify(batchFromFixture('session-v1.lua')),
    });
    expect(res.statusCode).toBe(413);
  });

  it('rate-limits ingest per token', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await s.app.inject({
        method: 'POST',
        url: '/v1/ingest',
        headers: s.auth,
        payload: {},
      });
      codes.push(res.statusCode);
    }
    // The limit is 3/minute per token and the 413 test above already used one.
    expect(codes[0]).toBe(409);
    expect(codes.filter((c) => c !== 429).length).toBeLessThanOrEqual(3);
    expect(codes[4]).toBe(429);
  });
});
