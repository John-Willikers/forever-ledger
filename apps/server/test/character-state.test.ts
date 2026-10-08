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

  it('an older state of the alias does not replace the canonical one, but fills its missing sections', async () => {
    await q(
      `insert into characters (key, name, realm) values ('Ada-Bayou', 'Ada', 'Bayou'), ('Ada Smith-Bayou', 'Ada Smith', 'Bayou')`,
    );
    await q(
      `insert into character_state (char, build, level, completed, mount, observed_at) values
         ('Ada-Bayou', 70009, 10, '{1,2,3}', '{"owned": 1}', '2026-09-24T12:00:00-05:00'),
         ('Ada Smith-Bayou', 70245, 18, null, '{"owned": 2}', '2026-10-07T00:00:00-05:00')`,
    );
    const r = await s.database.db.transaction((tx) =>
      mergeCharacter(tx, 'Ada-Bayou', 'Ada Smith-Bayou', 'merge', ['ACCOUNT_A']),
    );
    expect(r.replaced.character_state).toBe(0);
    expect(r.dropped.character_state).toBe(1);
    expect(
      await q(
        `select char, build, level, completed, mount from character_state where char like 'Ada%'`,
      ),
    ).toEqual([
      {
        char: 'Ada Smith-Bayou',
        build: 70245,
        level: 18,
        completed: [1, 2, 3],
        mount: { owned: 2 },
      },
    ]);
  });

  it('a state with no time is the older one in a merge', async () => {
    await q(
      `insert into characters (key, name, realm) values ('Eve-Bayou', 'Eve', 'Bayou'), ('Eve Smith-Bayou', 'Eve Smith', 'Bayou')`,
    );
    await q(
      `insert into character_state (char, build, level, pos, observed_at) values
         ('Eve-Bayou', 70245, 20, null, '2026-10-07T00:00:00-05:00'),
         ('Eve Smith-Bayou', 70009, 12, '{"mapId": 1429}', null)`,
    );
    const r = await s.database.db.transaction((tx) =>
      mergeCharacter(tx, 'Eve-Bayou', 'Eve Smith-Bayou', 'merge', ['ACCOUNT_E']),
    );
    expect(r.replaced.character_state).toBe(1);
    expect(await q(`select char, level, pos from character_state where char like 'Eve%'`)).toEqual([
      { char: 'Eve Smith-Bayou', level: 20, pos: { mapId: 1429 } },
    ]);
  });
});

// Forever loads SavedVariables empty at every login (bug #34): each session uploads only what it saw, so sections merge.
describe('character state across sessions (real Postgres)', () => {
  let s: Awaited<ReturnType<typeof startServer>>;
  const q = async (text: string) => (await s.database.pool.query(text)).rows;
  const ingest = async (batch: object) => {
    const res = await s.app.inject({
      method: 'POST',
      url: '/v1/ingest',
      headers: s.auth,
      payload: batch,
    });
    expect(res.statusCode, res.body).toBe(200);
  };
  type State = UploadBatch['records']['charState'][number];
  /** A later session of the fixture character: `hours` after it, with these sections only. */
  const session = (hours: number, patch: Partial<State>) => {
    const b = batchFromFixture('session-v10.lua');
    const st = b.records.charState[0]!;
    const at = st.observedAt! + hours * 3600;
    b.records.charState = [{ char: st.char, build: st.build, observedAt: at, ...patch }];
    b.records.trips = [];
    b.records.xpCurve = [];
    return b;
  };
  const state = async () =>
    (
      await q(
        `select level, completed, completed_truncated, bind, taxi, pos from character_state where char = '${CHAR}'`,
      )
    )[0];
  const at0 = 1790001827;

  beforeAll(async () => {
    s = await startServer();
    await ingest(batchFromFixture('session-v10.lua'));
  });
  afterAll(() => s?.stop());

  it('a login-only bind in the same zone keeps the stored spot; taxi maps merge by map; completed grows', async () => {
    await ingest(
      session(1, {
        level: 12,
        bind: { zone: 'Goldshire', at: at0 + 3600 },
        taxi: [
          {
            taxiMapId: 1464,
            at: at0 + 3600,
            nodes: [{ nodeId: 26, name: 'Auberdine', x: 0.4, y: 0.3, state: 1 }],
          },
        ],
        completed: [7, 9001],
      }),
    );
    const st = await state();
    expect(st.level).toBe(12);
    expect(st.bind).toEqual({
      zone: 'Goldshire',
      at: at0 + 3600,
      spot: { mapId: 1429, x: 0.5, y: 0.7 },
    });
    expect(st.taxi.map((m: { taxiMapId: number }) => m.taxiMapId).sort()).toHaveLength(2);
    expect(st.taxi.find((m: { taxiMapId: number }) => m.taxiMapId === 1464).nodes).toHaveLength(1);
    expect(st.completed).toEqual([7, 15, 33, 783, 5261, 9001]);
  });

  it('per taxi map the newest read wins; an older read of a map never replaces it', async () => {
    const before = (await state()).taxi;
    const ek = before.find((m: { taxiMapId: number }) => m.taxiMapId !== 1464);
    await ingest(
      session(2, {
        taxi: [{ ...ek, at: (ek.at ?? 0) - 10, nodes: [] }],
      }),
    );
    expect((await state()).taxi).toEqual(before);
    await ingest(session(3, { taxi: [{ taxiMapId: 1464, at: at0 + 3 * 3600, nodes: [] }] }));
    const after = (await state()).taxi;
    expect(after.find((m: { taxiMapId: number }) => m.taxiMapId === 1464).nodes).toEqual([]);
    expect(after.find((m: { taxiMapId: number }) => m.taxiMapId !== 1464)).toEqual(ek);
  });

  it('a bind in another zone drops the old spot', async () => {
    await ingest(session(4, { bind: { zone: 'Lakeshire', at: at0 + 4 * 3600 } }));
    expect((await state()).bind).toEqual({ zone: 'Lakeshire', at: at0 + 4 * 3600 });
  });

  it('stores completedTruncated with the list it came with; the union keeps the highest 10000 ids', async () => {
    const many = Array.from({ length: 10_000 }, (_, i) => 20_001 + i);
    await ingest(session(5, { completed: many, completedTruncated: 2000 }));
    const st = await state();
    expect(st.completed_truncated).toBe(2000);
    expect(st.completed).toHaveLength(10_000);
    expect(st.completed[0]).toBe(20_001);
    await ingest(session(6, { completed: [1] }));
    const st2 = await state();
    expect(st2.completed_truncated).toBeNull();
    expect(st2.completed[0]).toBe(20_001);
  });

  it('an alias merge merges the sections the same way', async () => {
    await q(
      `insert into characters (key, name, realm) values ('Lu-Bayou', 'Lu', 'Bayou'), ('Lu Smith-Bayou', 'Lu Smith', 'Bayou')`,
    );
    await q(
      `insert into character_state (char, build, level, completed, bind, taxi, observed_at) values
         ('Lu-Bayou', 70245, 20, '{5,6}', '{"zone": "Goldshire", "at": 2}',
          '[{"taxiMapId": 1464, "at": 2, "nodes": []}]', '2026-10-07T00:00:00-05:00'),
         ('Lu Smith-Bayou', 70009, 14, '{1,5}', '{"zone": "Goldshire", "at": 1, "spot": {"mapId": 1429, "x": 0.5, "y": 0.7}}',
          '[{"taxiMapId": 1463, "at": 1, "nodes": []}, {"taxiMapId": 1464, "at": 1, "nodes": [{"nodeId": 26}]}]',
          '2026-09-24T12:00:00-05:00')`,
    );
    await s.database.db.transaction((tx) =>
      mergeCharacter(tx, 'Lu-Bayou', 'Lu Smith-Bayou', 'merge', ['ACCOUNT_L']),
    );
    const [st] = await q(
      `select level, completed, bind, taxi from character_state where char like 'Lu%'`,
    );
    expect(st).toEqual({
      level: 20,
      completed: [1, 5, 6],
      bind: { zone: 'Goldshire', at: 2, spot: { mapId: 1429, x: 0.5, y: 0.7 } },
      taxi: [
        { taxiMapId: 1463, at: 1, nodes: [] },
        { taxiMapId: 1464, at: 2, nodes: [] },
      ],
    });
  });
});
