// Schema 10: character state, the XP curve and timed trips (real Postgres).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { UploadBatch } from '@forever-ledger/contracts';
import { mergeCharacter } from '../src/characters.js';
import { batchFromFixture, startServer } from './helpers.js';

const CHAR = 'Thibodeaux Willikers-Bayou';

describe('character state ingest (real Postgres)', () => {
  let s: Awaited<ReturnType<typeof startServer>>;
  const ingest = async (batch: object) => {
    const res = await s.app.inject({
      method: 'POST',
      url: '/v1/ingest',
      headers: s.auth,
      payload: batch,
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as { acknowledged: { key: string; hash: string }[] };
  };
  const q = async (text: string) => (await s.database.pool.query(text)).rows;
  /** The fixture batch with its character state changed. */
  const withState = (patch: Partial<UploadBatch['records']['charState'][number]>) => {
    const b = batchFromFixture('session-v10.lua');
    b.records.charState = b.records.charState.map((c) => ({ ...c, ...patch }));
    return b;
  };
  const state = async () =>
    (
      await q(
        `select char, build, level, xp, xp_max, completed, log, pos, bind, hearth_ready_at, taxi, mount, observed_at
           from character_state order by char`,
      )
    ).filter((r) => r.char === CHAR)[0];

  beforeAll(async () => {
    s = await startServer();
  });
  afterAll(() => s?.stop());

  it('stores a v10 batch: state, xp curve and trips, and acks every record', async () => {
    const { acknowledged } = await ingest(batchFromFixture('session-v10.lua'));
    const keys = acknowledged.map((a) => a.key);
    expect(keys).toContain(`cstate:${CHAR}:61582`);
    expect(keys).toEqual(expect.arrayContaining(['xpc:61582:10', 'xpc:61582:11']));
    expect(keys).toEqual(
      expect.arrayContaining([`trip:${CHAR}:flight:1790001709`, `trip:${CHAR}:hearth:1790001811`]),
    );

    const st = await state();
    expect(st).toMatchObject({ build: 61582, level: 11, xp: 4350, xp_max: 8740 });
    expect(st.completed).toHaveLength(5);
    expect(st.log).toEqual([
      { questId: 1234, done: [0] },
      { questId: 364, done: [2] },
    ]);
    expect(st.pos).toMatchObject({ mapId: 1429, x: 0.4358, y: 0.6578, subzone: 'Goldshire' });
    expect(st.bind).toMatchObject({ zone: 'Goldshire', spot: { mapId: 1429 } });
    expect(st.taxi).toHaveLength(1);
    expect(st.mount).toEqual({ owned: 1, mounted: false });
    expect(st.observed_at).toEqual(new Date(1790001827 * 1000));
    expect(st.hearth_ready_at).toEqual(new Date(1790004827 * 1000));

    expect(await q(`select build, level, xp_max from xp_curve order by level`)).toEqual([
      { build: 61582, level: 10, xp_max: 7600 },
      { build: 61582, level: 11, xp_max: 8740 },
    ]);
    const trips = await q(
      `select char, kind, build, started_at, seconds, from_node, to_node, "to" from trips order by started_at`,
    );
    expect(trips).toHaveLength(2);
    expect(trips[0]).toMatchObject({
      char: CHAR,
      kind: 'flight',
      build: 61582,
      seconds: 72.4,
      from_node: { nodeId: 4, name: 'Sentinel Hill, Westfall' },
      to_node: { nodeId: 2 },
    });
    expect(trips[1]).toMatchObject({ kind: 'hearth', to: { subzone: 'Goldshire' } });
  });

  it('a re-upload changes nothing', async () => {
    const before = await state();
    await ingest(batchFromFixture('session-v10.lua'));
    expect(await state()).toEqual(before);
    expect(await s.count('character_state')).toBe(1);
    expect(await s.count('xp_curve')).toBe(2);
    expect(await s.count('trips')).toBe(2);
  });

  it('an older batch never overwrites newer state; a newer one does', async () => {
    await ingest(withState({ observedAt: 1790000000, level: 9, xp: 1 }));
    expect(await state()).toMatchObject({ level: 11, xp: 4350 });
    await ingest(withState({ observedAt: 1790009999, level: 12, xp: 10, log: [] }));
    expect(await state()).toMatchObject({ level: 12, xp: 10, log: [] });
    // A section the newer state lacks (dropped by normalize) keeps what was known.
    expect((await state()).completed).toHaveLength(5);
  });

  it('the xp curve is replaced in place by (build, level)', async () => {
    const b = batchFromFixture('session-v10.lua');
    b.records.xpCurve = [{ build: 61582, level: 11, xpMax: 8800 }];
    await ingest(b);
    expect(await q(`select level, xp_max from xp_curve order by level`)).toEqual([
      { level: 10, xp_max: 7600 },
      { level: 11, xp_max: 8800 },
    ]);
  });

  it('exports the new tables', async () => {
    const res = await s.app.inject({ method: 'GET', url: '/v1/export', headers: s.readerAuth });
    expect(res.statusCode, res.body).toBe(200);
    const { tables } = res.json() as { tables: Record<string, unknown[]> };
    expect(tables.character_state).toHaveLength(1);
    expect(tables.xp_curve).toHaveLength(2);
    expect(tables.trips).toHaveLength(2);
  });

  it('an alias merge moves state and trips; the newer state wins', async () => {
    await q(
      `insert into characters (key, name, realm) values ('Zed-Bayou', 'Zed', 'Bayou'), ('Zed Smith-Bayou', 'Zed Smith', 'Bayou')`,
    );
    await q(
      `insert into character_state (char, build, level, observed_at) values
         ('Zed-Bayou', 70245, 20, '2026-10-07T00:00:00-05:00'),
         ('Zed Smith-Bayou', 70009, 14, '2026-09-24T12:00:00-05:00')`,
    );
    await q(
      `insert into trips (char, kind, build, started_at, seconds) values
         ('Zed-Bayou', 'flight', 70245, '2026-10-06T20:00:00-05:00', 90),
         ('Zed-Bayou', 'hearth', 70245, '2026-10-06T21:00:00-05:00', 10),
         ('Zed Smith-Bayou', 'hearth', 70245, '2026-10-06T21:00:00-05:00', 10)`,
    );
    const r = await s.database.db.transaction((tx) =>
      mergeCharacter(tx, 'Zed-Bayou', 'Zed Smith-Bayou', 'merge', ['ACCOUNT_Z']),
    );
    expect(r.replaced.character_state).toBe(1);
    expect(r.moved.trips).toBe(1);
    expect(r.dropped.trips).toBe(1);
    expect(
      await q(`select char, build, level from character_state where char like 'Zed%'`),
    ).toEqual([{ char: 'Zed Smith-Bayou', build: 70245, level: 20 }]);
    expect(await q(`select char, kind from trips where char like 'Zed%' order by kind`)).toEqual([
      { char: 'Zed Smith-Bayou', kind: 'flight' },
      { char: 'Zed Smith-Bayou', kind: 'hearth' },
    ]);
  });

  it('an older state of the alias does not replace the canonical one', async () => {
    await q(
      `insert into characters (key, name, realm) values ('Ada-Bayou', 'Ada', 'Bayou'), ('Ada Smith-Bayou', 'Ada Smith', 'Bayou')`,
    );
    await q(
      `insert into character_state (char, build, level, observed_at) values
         ('Ada-Bayou', 70009, 10, '2026-09-24T12:00:00-05:00'),
         ('Ada Smith-Bayou', 70245, 18, '2026-10-07T00:00:00-05:00')`,
    );
    const r = await s.database.db.transaction((tx) =>
      mergeCharacter(tx, 'Ada-Bayou', 'Ada Smith-Bayou', 'merge', ['ACCOUNT_A']),
    );
    expect(r.replaced.character_state).toBe(0);
    expect(r.dropped.character_state).toBe(1);
    expect(await q(`select char, level from character_state where char like 'Ada%'`)).toEqual([
      { char: 'Ada Smith-Bayou', level: 18 },
    ]);
  });
});
