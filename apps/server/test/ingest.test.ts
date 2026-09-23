import { contentHash, recordKey, RECORD_KINDS } from '@forever-ledger/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { revokeToken, mintToken } from '../src/index.js';
import { batchFromFixture, schema4Batch, startServer } from './helpers.js';

type Server = Awaited<ReturnType<typeof startServer>>;

/** A schema 3 batch: the schema 2 fixture plus one session's drops, corpses and run loot. */
function schema3Batch(session: string, account: string) {
  const b = batchFromFixture('session-v2.lua', account);
  const build = 69977;
  return {
    ...b,
    schemaVersion: 3 as const,
    meta: { ...b.meta, schemaVersion: 3 as const, session },
    records: {
      ...b.records,
      drops: [
        { itemId: 2589, build, npcId: 1234, session, count: 3, quantity: 7 },
        { itemId: 872, build, npcId: 1234, session, count: 1, quantity: 1 },
        { itemId: 2589, build, npcId: 0, session, count: 1, quantity: 1 },
      ],
      corpses: [{ npcId: 1234, build, session, count: 4, copper: 120 }],
      runs: b.records.runs.map((r, i) =>
        i === 0
          ? {
              ...r,
              lootMethod: 'group',
              bossLoot: [
                {
                  encounterId: 1,
                  lootListKey: 1,
                  itemId: 872,
                  winnerClass: 'WARRIOR',
                  winnerIsSelf: false,
                  rolls: [{ class: 'WARRIOR', roll: 91, state: 'needmainspec' }],
                },
              ],
              groupLoot: [{ itemId: 2589, qty: 2, by: 'party' as const, class: 'PRIEST' }],
            }
          : r,
      ),
    },
  };
}

const PROFESSION_TABLES = [
  'skills',
  'skill_ups',
  'recipes',
  'recipe_snapshots',
  'recipe_status',
  'recipe_difficulty',
  'recipes_learned',
  'crafts',
  'nodes',
  'node_loot',
  'trainers',
  'vendors',
  'api_samples',
];

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
  'corpses',
  'runs',
  'run_bosses',
  'run_party',
  ...PROFESSION_TABLES,
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

  it('stores schema 3 sessions, corpses and run loot; equal counts from two sessions both count', async () => {
    const acct = 'ACCOUNT-S3';
    const s1 = schema3Batch('1790000000-aaaa', acct);
    const s2 = schema3Batch('1790000900-bbbb', acct);
    // Identical content apart from the session: the old per-file key would have hidden the second one.
    expect(s2.records.drops).toEqual(
      s1.records.drops.map((d) => ({ ...d, session: s2.meta.session })),
    );
    for (const b of [s1, s2, s1]) expect((await post(b)).statusCode).toBe(200);

    const q = (sql: string) => s.database.pool.query(sql, [acct]).then((r) => r.rows);
    expect(
      await q(
        `select session, count, quantity from drops where account = $1 and item_id = 2589 and npc_id = 1234 order by session`,
      ),
    ).toEqual([
      { session: '1790000000-aaaa', count: 3, quantity: 7 },
      { session: '1790000900-bbbb', count: 3, quantity: 7 },
    ]);
    expect(
      await q(
        `select sum(count)::int as n from drops where account = $1 and item_id = 2589 and npc_id = 1234`,
      ),
    ).toEqual([{ n: 6 }]);
    expect(
      await q(
        `select npc_id, session, count, copper from corpses where account = $1 order by session`,
      ),
    ).toEqual([
      { npc_id: 1234, session: '1790000000-aaaa', count: 4, copper: 120 },
      { npc_id: 1234, session: '1790000900-bbbb', count: 4, copper: 120 },
    ]);
    const run = s1.records.runs[0]!;
    const { rows } = await s.database.pool.query(
      'select loot_method, boss_loot, group_loot from runs where id = $1',
      [run.id],
    );
    expect(rows[0]).toEqual({
      loot_method: 'group',
      boss_loot: run.bossLoot,
      group_loot: run.groupLoot,
    });
  });

  it('ingests the schema 3 fixture written by the 0.2.4 addon', async () => {
    const batch = batchFromFixture('session-v3.lua', 'ACCOUNT-V3');
    expect(batch.schemaVersion).toBe(3);
    const res = await post(batch);
    expect(res.statusCode).toBe(200);
    const { rows } = await s.database.pool.query(
      `select npc_id, build, count, copper from corpses where account = 'ACCOUNT-V3' order by build`,
    );
    expect(rows).toEqual([
      { npc_id: 644, build: 61582, count: 1, copper: 245 },
      { npc_id: 644, build: 61600, count: 1, copper: 0 },
    ]);
    const run = await s.database.pool.query('select loot_method from runs where id = $1', [
      batch.records.runs[0]!.id,
    ]);
    expect(run.rows[0].loot_method).toBe('group');
  });

  it('schema 1/2 drops keep session "" next to schema 3 sessions of the same file', async () => {
    const acct = 'ACCOUNT-MIX';
    expect((await post(batchFromFixture('session-v2.lua', acct))).statusCode).toBe(200);
    expect((await post(schema3Batch('1790000000-cccc', acct))).statusCode).toBe(200);
    const { rows } = await s.database.pool.query(
      `select session, count(*)::int as n from drops where account = $1 group by session order by session`,
      [acct],
    );
    expect(rows).toEqual([
      { session: '', n: 2 },
      { session: '1790000000-cccc', n: 3 },
    ]);
  });

  describe('schema 4 professions', () => {
    const S1 = '1790100000-c0de';
    const S2 = '1790100900-d00d';
    const acct = 'ACCOUNT-V4';
    const q = (text: string, params: unknown[] = []) =>
      s.database.pool.query(text, params).then((res) => res.rows);

    it('stores every professions kind', async () => {
      const batch = schema4Batch(S1, acct);
      expect(batch.schemaVersion).toBe(4);
      const res = await post(batch);
      expect(res.statusCode).toBe(200);
      expect(res.json().acknowledged).toContainEqual({
        key: `craft:2963:69977:${S1}`,
        hash: contentHash(batch.records.crafts[0]),
      });
      const c = await counts();
      expect(Object.fromEntries(PROFESSION_TABLES.map((t) => [t, c[t]]))).toEqual({
        skills: 2,
        skill_ups: 2,
        recipes: 2,
        recipe_snapshots: 2,
        recipe_status: 2,
        recipe_difficulty: 1,
        recipes_learned: 2,
        crafts: 1,
        nodes: 2,
        node_loot: 3,
        trainers: 1,
        vendors: 1,
        api_samples: 2,
      });

      expect(
        await q(
          `select char, skill_line_id, name, rank, max_rank, modifier, parent_id,
                  extract(epoch from last_seen)::int as last_seen
           from skills where skill_line_id = 197`,
        ),
      ).toEqual([
        {
          char: 'Thibodeaux-Bayou',
          skill_line_id: 197,
          name: 'Tailoring',
          rank: 12,
          max_rank: 75,
          modifier: 0,
          parent_id: 0,
          last_seen: 1790100900,
        },
      ]);
      expect(
        await q(
          `select skill_line_id, from_rank, to_rank, build, recipe_id from skill_ups order by skill_line_id`,
        ),
      ).toEqual([
        { skill_line_id: 186, from_rank: 30, to_rank: 31, build: 69977, recipe_id: null },
        { skill_line_id: 197, from_rank: 11, to_rank: 12, build: 69977, recipe_id: 2963 },
      ]);
      expect(await q(`select * from recipes where recipe_id = 2963`)).toEqual([
        expect.objectContaining({
          recipe_id: 2963,
          name: 'Bolt of Linen Cloth',
          skill_line_id: 197,
          category_id: 1001,
        }),
      ]);
      expect(
        await q(
          `select output_item_id, qty_min, qty_max, reagents, max_trivial, source_text
           from recipe_snapshots where recipe_id = 7629 and build = 69977`,
        ),
      ).toEqual([
        {
          output_item_id: 6240,
          qty_min: 1,
          qty_max: 1,
          reagents: [
            { itemId: 2996, qty: 3 },
            { itemId: 2320, qty: 1 },
          ],
          max_trivial: null,
          source_text: 'Pattern: Blue Linen Vest',
        },
      ]);
      expect(
        await q(
          `select recipe_id, learned, difficulty, rank from recipe_status order by recipe_id`,
        ),
      ).toEqual([
        { recipe_id: 2963, learned: true, difficulty: 'optimal', rank: 12 },
        { recipe_id: 7629, learned: false, difficulty: null, rank: null },
      ]);
      expect(await q(`select difficulty, min_rank, max_rank from recipe_difficulty`)).toEqual([
        { difficulty: 'optimal', min_rank: 1, max_rank: 12 },
      ]);
      expect(await q(`select recipe_id, via from recipes_learned order by recipe_id`)).toEqual([
        { recipe_id: 2963, via: 'trainer:1346' },
        { recipe_id: 7629, via: 'item:6270' },
      ]);
      expect(
        await q(
          `select recipe_id, session, casts, qty, procs, skill_ups from crafts where account = $1`,
          [acct],
        ),
      ).toEqual([{ recipe_id: 2963, session: S1, casts: 4, qty: 4, procs: 0, skill_ups: 2 }]);
      expect(
        await q(
          `select object_id, opened, name, rank_min, skill_line_id, spots from nodes
           where account = $1 order by object_id`,
          [acct],
        ),
      ).toEqual([
        {
          object_id: 0,
          opened: 2,
          name: null,
          rank_min: null,
          skill_line_id: 356,
          spots: [{ mapId: 1429, points: [[50, 60]] }],
        },
        {
          object_id: 1731,
          opened: 3,
          name: 'Copper Vein',
          rank_min: 29,
          skill_line_id: 186,
          spots: [
            {
              mapId: 1429,
              points: [
                [45.1, 33.2],
                [46, 34.5],
              ],
            },
          ],
        },
      ]);
      expect(
        await q(
          `select item_id, object_id, count, quantity from node_loot where account = $1 order by item_id`,
          [acct],
        ),
      ).toEqual([
        { item_id: 2770, object_id: 1731, count: 3, quantity: 5 },
        { item_id: 2835, object_id: 1731, count: 1, quantity: 1 },
        { item_id: 6303, object_id: 0, count: 2, quantity: 2 },
      ]);
      const [trainer] = await q(`select * from trainers`);
      expect(trainer).toMatchObject({
        npc_id: 1346,
        build: 69977,
        name: 'Georgio Bolero',
        skill_line_id: 197,
        loc: batch.records.trainers[0]!.loc,
        services: batch.records.trainers[0]!.services,
      });
      const [vendor] = await q(`select * from vendors`);
      expect(vendor).toMatchObject({
        npc_id: 1347,
        name: 'Alexandra Bolero',
        items: batch.records.vendors[0]!.items,
      });
      expect(await q(`select api, build, sample from api_samples order by api`)).toEqual(
        batch.records.apiSamples.map((a) => ({ api: a.api, build: a.build, sample: a.sample })),
      );
      expect(
        await q(`select item_id, class_id, subclass_id from items where item_id = 6270`),
      ).toEqual([{ item_id: 6270, class_id: 9, subclass_id: 2 }]);
      expect(await q(`select build from builds where build = 69977`)).toHaveLength(1);
    });

    it('is idempotent for professions', async () => {
      const before = await counts();
      expect((await post(schema4Batch(S1, acct))).statusCode).toBe(200);
      expect(await counts()).toEqual(before);
    });

    it('two sessions with identical craft and gathering counts are both kept', async () => {
      expect((await post(schema4Batch(S2, acct))).statusCode).toBe(200);
      expect(
        await q(
          `select session, casts, qty from crafts where account = $1 and recipe_id = 2963 order by session`,
          [acct],
        ),
      ).toEqual([
        { session: S1, casts: 4, qty: 4 },
        { session: S2, casts: 4, qty: 4 },
      ]);
      expect(
        await q(
          `select sum(opened)::int as opened from nodes where account = $1 and object_id = 1731`,
          [acct],
        ),
      ).toEqual([{ opened: 6 }]);
      expect(
        await q(
          `select sum(count)::int as n, sum(quantity)::int as qty from node_loot
           where account = $1 and item_id = 2770`,
          [acct],
        ),
      ).toEqual([{ n: 6, qty: 10 }]);
    });

    it('widens difficulty ranges across sessions and never rolls skills or status back', async () => {
      const b = schema4Batch('1790200000-0001', acct);
      const later = {
        ...b,
        records: {
          ...b.records,
          skills: b.records.skills.map((sk) => ({
            ...sk,
            rank: sk.rank + 5,
            lastSeen: 1790200000,
          })),
          recipeStatus: b.records.recipeStatus.map((st) => ({
            ...st,
            difficulty: 'medium',
            rank: 30,
            seenAt: 1790200000,
          })),
          recipeDifficulty: [
            { ...b.records.recipeDifficulty[0]!, minRank: 5, maxRank: 25 },
            { ...b.records.recipeDifficulty[0]!, difficulty: 'medium', minRank: 26, maxRank: 30 },
          ],
        },
      };
      expect((await post(later)).statusCode).toBe(200);
      // The first session again (older lastSeen / seenAt): ranks stay, ranges stay wide.
      expect((await post(schema4Batch(S1, 'ACCOUNT-V4-OLD'))).statusCode).toBe(200);

      expect(await q(`select skill_line_id, rank from skills order by skill_line_id`)).toEqual([
        { skill_line_id: 186, rank: 36 },
        { skill_line_id: 197, rank: 17 },
      ]);
      expect(await q(`select difficulty, rank from recipe_status where recipe_id = 2963`)).toEqual([
        { difficulty: 'medium', rank: 30 },
      ]);
      expect(
        await q(
          `select difficulty, min_rank, max_rank from recipe_difficulty where recipe_id = 2963
           order by difficulty`,
        ),
      ).toEqual([
        { difficulty: 'medium', min_rank: 26, max_rank: 30 },
        { difficulty: 'optimal', min_rank: 1, max_rank: 25 },
      ]);
    });

    it('keeps known recipe and item class fields; replaces trainer and vendor lists', async () => {
      const b = schema4Batch('1790300000-0002', acct);
      const next = {
        ...b,
        records: {
          ...b.records,
          recipes: [{ recipeId: 2963, name: 'Bolt of Linen Cloth' }],
          items: [{ itemId: 6270, name: 'Pattern: Blue Linen Vest' }],
          trainers: [
            { ...b.records.trainers[0]!, services: b.records.trainers[0]!.services.slice(1) },
          ],
          vendors: [{ ...b.records.vendors[0]!, name: undefined, items: [{ itemId: 2320 }] }],
        },
      };
      expect((await post(next)).statusCode).toBe(200);
      expect(
        await q(`select skill_line_id, category_id from recipes where recipe_id = 2963`),
      ).toEqual([{ skill_line_id: 197, category_id: 1001 }]);
      expect(await q(`select class_id from items where item_id = 6270`)).toEqual([{ class_id: 9 }]);
      expect(await q(`select services from trainers`)).toEqual([
        { services: b.records.trainers[0]!.services.slice(1) },
      ]);
      expect(await q(`select name, items from vendors`)).toEqual([
        { name: null, items: [{ itemId: 2320 }] },
      ]);
    });

    it('merges an incomplete trainer scan by name; never lets an older scan overwrite a trainer or vendor', async () => {
      const b = schema4Batch('1790300000-0003', acct);
      const [bolt, shirt] = b.records.trainers[0]!.services;
      const trainer = (seenAt: number, complete: boolean | undefined, services: unknown[]) => ({
        ...b.records,
        trainers: [{ ...b.records.trainers[0]!, seenAt, complete, services }],
      });
      const send = (records: unknown) => post({ ...b, records });
      // Full list first, then a filtered scan: the shirt was bought, a belt is new, the bolt is only hidden.
      expect((await send(trainer(1790300000, true, [bolt, shirt]))).statusCode).toBe(200);
      const belt = { name: 'Linen Belt', type: 'available', cost: 80 };
      expect(
        (await send(trainer(1790300100, false, [{ ...shirt, type: 'used' }, belt]))).statusCode,
      ).toBe(200);
      expect(await q(`select complete, services from trainers`)).toEqual([
        { complete: true, services: [bolt, { ...shirt, type: 'used' }, belt] },
      ]);
      // A scan without the flag (older addon data) merges too.
      expect((await send(trainer(1790300200, undefined, [belt]))).statusCode).toBe(200);
      expect((await q(`select services from trainers`))[0]!.services).toHaveLength(3);
      // An older upload arriving late changes nothing; a newer complete scan replaces the list.
      expect((await send(trainer(1790200000, true, [belt]))).statusCode).toBe(200);
      expect((await q(`select services from trainers`))[0]!.services).toHaveLength(3);
      expect((await send(trainer(1790300300, true, [belt]))).statusCode).toBe(200);
      expect(await q(`select complete, services from trainers`)).toEqual([
        { complete: true, services: [belt] },
      ]);

      const vendor = (seenAt: number, items: unknown[]) => ({
        ...b.records,
        vendors: [{ ...b.records.vendors[0]!, seenAt, items }],
      });
      expect((await send(vendor(1790300000, [{ itemId: 2321 }]))).statusCode).toBe(200);
      expect((await send(vendor(1790100000, [{ itemId: 9999 }]))).statusCode).toBe(200);
      expect(await q(`select items from vendors`)).toEqual([{ items: [{ itemId: 2321 }] }]);
    });
  });

  it('rejects unknown schema versions with 409 and malformed batches with 400', async () => {
    const batch = batchFromFixture('session-v1.lua');
    const res409 = await post({ ...batch, schemaVersion: 5 });
    expect(res409.statusCode).toBe(409);
    expect(res409.json().error).toMatch(
      /unsupported schemaVersion 5; this server accepts 1, 2, 3, 4$/,
    );
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
