// Run groups against a real Postgres: two characters of one party upload the same Wailing Caverns run with their own
// tokens (the live shape that showed up twice), ingest groups them, the reads count the group once and the run detail
// merges both perspectives. Also the startup backfill for runs stored before migration 0010, concurrent uploads, and
// the search's round cap.
import type { Run, UploadBatch } from '@forever-ledger/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mintToken } from '../src/index.js';
import { RUN_GROUPS_LOCK } from '../src/locks.js';
import { backfillRunGroups, regroupRuns } from '../src/runGroups.js';
import { createSession } from '../src/sessions.js';
import { batchFromFixture, startServer } from './helpers.js';

type Server = Awaited<ReturnType<typeof startServer>>;

const COOKIE_SECRET = 'test-cookie-secret-run-groups-0123456789abcdef';
const SESSION = '__Host-fl_session';
const BUILD = 69977;
const WC = 43;
const T0 = 1_790_500_000;
const SAM = 'Sam Willikers-Classic Beta PvE';
const VIC = 'Vic Vinny-Classic Beta PvE 2';
const SAM_RUN = `${SAM}-${WC}-${T0}`;
const VIC_RUN = `${VIC}-${WC}-${T0 + 1}`;
/** Vic entering one second before Sam: the group is then named after Vic's run. */
const VIC_EARLY = `${VIC}-${WC}-${T0 - 1}`;

const BOSSES = [
  'Lady Anacondra',
  'Lord Cobrahn',
  'Kresh',
  'Lord Pythas',
  'Skum',
  'Lord Serpentis',
  'Mutanus the Devourer',
].map((name, i) => ({ id: 580 + i, name, killed: true, atSecs: 300 * (i + 1) }));

/** 26 boss drops, the same for both members apart from who won from each one's point of view. */
function bossLoot(self: 'DRUID' | 'WARRIOR') {
  return Array.from({ length: 26 }, (_, i) => {
    const winnerClass = i % 3 === 0 ? 'DRUID' : i % 3 === 1 ? 'WARRIOR' : 'HUNTER';
    return {
      encounterId: BOSSES[i % BOSSES.length]!.id,
      lootListKey: i + 1,
      itemId: 6400 + i,
      qty: 1,
      winnerClass,
      winnerIsSelf: winnerClass === self,
      rolls: [
        { class: 'DRUID', roll: 10 + i, state: 'greed' },
        { class: 'WARRIOR', roll: 50 + i, state: 'greed' },
      ],
    };
  });
}

function run(who: 'sam' | 'vic', patch: Partial<Run> = {}): Run {
  const sam = who === 'sam';
  const party = [
    sam ? { class: 'WARRIOR', level: 20 } : { class: 'DRUID', level: 20 },
    { class: 'HUNTER', level: 20 },
    { class: 'SHAMAN', level: 20 },
    { class: 'WARLOCK', level: 18 },
  ];
  return {
    id: sam ? SAM_RUN : VIC_RUN,
    build: BUILD,
    char: sam ? SAM : VIC,
    charLevel: 20,
    instance: 'Wailing Caverns',
    instanceID: WC,
    difficulty: 1,
    maxPlayers: 5,
    start: sam ? T0 : T0 + 1,
    finish: sam ? T0 + 2400 : T0 + 2460,
    endReason: 'left',
    awaySecs: 0,
    activeSecs: sam ? 2400 : 2459,
    xpTotal: sam ? 9000 : 9100,
    questXP: 2000,
    mobXP: sam ? 7000 : 7100,
    deaths: sam ? 1 : 2,
    bosses: BOSSES.map((b) => ({ ...b, atSecs: b.atSecs + (sam ? 0 : 1) })),
    loot: [{ itemID: sam ? 5000 : 5001, npcID: 3636 }],
    party,
    lootMethod: 'group',
    bossLoot: bossLoot(sam ? 'DRUID' : 'WARRIOR'),
    groupLoot: [
      { itemId: 2589, qty: 2, by: 'self' },
      { itemId: 2589, qty: 1, by: 'party', class: sam ? 'WARRIOR' : 'DRUID' },
    ],
    ...patch,
  };
}

function batch(who: 'sam' | 'vic', patch: Partial<Run> = {}): UploadBatch {
  const b = batchFromFixture('session-v5.lua', who === 'sam' ? 'SAMACCT' : 'VICACCT', `pc-${who}`);
  const [name, realm] =
    who === 'sam' ? ['Sam Willikers', 'Classic Beta PvE'] : ['Vic Vinny', 'Classic Beta PvE 2'];
  return {
    ...b,
    records: {
      ...b.records,
      characters: [
        {
          key: `${name}-${realm}`,
          name: name!,
          realm: realm!,
          class: who === 'sam' ? 'DRUID' : 'WARRIOR',
          level: 20,
        },
      ],
      runs: [run(who, patch)],
    },
  };
}

/** Only the character and the run: a batch that shares no rows with another member's (not even a build row). */
function minimalBatch(who: 'sam' | 'vic', patch: Partial<Run> = {}): UploadBatch {
  const b = batch(who, patch);
  const run = b.records.runs[0]!;
  const empty = Object.fromEntries(Object.keys(b.records).map((k) => [k, []]));
  return {
    ...b,
    meta: { ...b.meta, build: run.build },
    records: { ...empty, characters: b.records.characters, runs: [run] } as UploadBatch['records'],
  };
}

describe('run groups (real Postgres)', () => {
  let s: Server;
  let samAuth: { authorization: string };
  let vicAuth: { authorization: string };
  let cookies: Record<string, string>;

  const post = (b: UploadBatch, headers: { authorization: string }) =>
    s.app.inject({ method: 'POST', url: '/v1/ingest', headers, payload: b });
  const ingest = async (b: UploadBatch, headers: { authorization: string }) => {
    const res = await post(b, headers);
    expect(res.statusCode, res.body).toBe(200);
  };
  /** Waits until `n` backends are queued on the run-group advisory lock. */
  const waitForLockWaiters = async (n: number) => {
    for (let i = 0; i < 200; i++) {
      const { rows } = await s.database.pool.query(
        `select count(*)::int as n from pg_locks
         where locktype = 'advisory' and not granted and objid::bigint = $1`,
        [RUN_GROUPS_LOCK],
      );
      if (rows[0].n >= n) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`fewer than ${n} ingests waited on the run-group lock`);
  };
  /** Holds the run-group lock on its own connection until the returned release is called. */
  const holdRunGroupLock = async () => {
    const client = await s.database.pool.connect();
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock($1)', [RUN_GROUPS_LOCK]);
    return async () => {
      await client.query('commit');
      client.release();
    };
  };
  const json = async (url: string) => {
    const res = await s.app.inject({ method: 'GET', url, cookies });
    expect(res.statusCode, `${url} ${res.body}`).toBe(200);
    return res.json();
  };
  const groupIds = async () =>
    (await s.database.pool.query('select id, group_id from runs order by id')).rows as {
      id: string;
      group_id: string | null;
    }[];

  beforeAll(async () => {
    s = await startServer({ admin: { cookieSecret: COOKIE_SECRET, authPerMinute: 10_000 } });
    samAuth = s.auth;
    const friend = await mintToken(s.database.db, 'friend');
    vicAuth = { authorization: `Bearer ${friend.token}` };
    const { rows } = await s.database.pool.query(
      `insert into users (bnet_sub, battletag, role) values ('sub-admin', 'Admin#1', 'admin') returning id`,
    );
    const value = await createSession(s.database.db, rows[0].id as number, {});
    cookies = { [SESSION]: s.app.signCookie(value) };
  });
  afterAll(async () => {
    await s?.stop();
  });
  beforeEach(async () => {
    await s.database.pool.query('truncate runs cascade');
  });

  it('groups Sam then Vic (two tokens) into one group named after the earliest run', async () => {
    await ingest(batch('sam'), samAuth);
    expect(await groupIds()).toEqual([{ id: SAM_RUN, group_id: SAM_RUN }]);
    await ingest(batch('vic'), vicAuth);
    expect(await groupIds()).toEqual([
      { id: SAM_RUN, group_id: SAM_RUN },
      { id: VIC_RUN, group_id: SAM_RUN },
    ]);
  });

  it('groups Vic then Sam the same way', async () => {
    await ingest(batch('vic'), vicAuth);
    expect(await groupIds()).toEqual([{ id: VIC_RUN, group_id: VIC_RUN }]);
    await ingest(batch('sam'), samAuth);
    expect(await groupIds()).toEqual([
      { id: SAM_RUN, group_id: SAM_RUN },
      { id: VIC_RUN, group_id: SAM_RUN },
    ]);
  });

  it('keeps the group stable and idempotent across re-uploads; a changed run can leave it', async () => {
    await ingest(batch('sam'), samAuth);
    await ingest(batch('vic'), vicAuth);
    // Same batches again, then a resumed Vic run (more deaths, later finish).
    await ingest(batch('sam'), samAuth);
    await ingest(batch('vic', { deaths: 3, finish: T0 + 3000 }), vicAuth);
    expect((await groupIds()).map((r) => r.group_id)).toEqual([SAM_RUN, SAM_RUN]);
    // Vic's run re-uploaded with another party: no longer the same run, both are their own group again.
    await ingest(batch('vic', { party: [{ class: 'MAGE', level: 40 }] }), vicAuth);
    expect(await groupIds()).toEqual([
      { id: SAM_RUN, group_id: SAM_RUN },
      { id: VIC_RUN, group_id: VIC_RUN },
    ]);
  });

  it('the summary, clear times and runs list count the group once, with its members', async () => {
    await ingest(batch('sam'), samAuth);
    await ingest(batch('vic'), vicAuth);
    const [wc] = await json(`/v1/runs/summary?build=${BUILD}`);
    expect(wc).toMatchObject({
      instanceId: WC,
      runs: 1,
      finishedRuns: 1,
      members: 2,
      // The group's clear time is the median of its members' active times: (2400 + 2459) / 2.
      medianActiveSecs: 2430,
      bestActiveSecs: 2430,
      // Per-character rates and averages still count every member.
      avgDeaths: 1.5,
      avgCharLevel: 20,
    });
    expect(wc.bosses).toHaveLength(7);
    expect(wc.bosses[0]).toEqual({ name: 'Lady Anacondra', kills: 1, medianAtSecs: 300 });

    expect(await json(`/admin/api/dungeons/clear-times?build=${BUILD}`)).toEqual([
      {
        instanceId: WC,
        instance: 'Wailing Caverns',
        runs: [{ id: SAM_RUN, build: BUILD, activeSecs: 2430, members: 2 }],
      },
    ]);

    const list = await json(`/admin/api/runs?build=${BUILD}`);
    expect(list).toMatchObject({ total: 1 });
    expect(list.instances).toEqual([{ instanceId: WC, instance: 'Wailing Caverns', runs: 1 }]);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      id: SAM_RUN,
      instanceId: WC,
      activeSecs: 2430,
      deaths: 3,
      bosses: { killed: 7, total: 7 },
      loot: 2,
      members: [
        { id: SAM_RUN, char: SAM, charClass: 'DRUID', charLevel: 20 },
        { id: VIC_RUN, char: VIC, charClass: 'WARRIOR', charLevel: 20 },
      ],
    });
  });

  it('run detail resolves any member to the group: merged bosses and boss loot, both perspectives', async () => {
    await ingest(batch('sam'), samAuth);
    await ingest(batch('vic'), vicAuth);
    const bySam = await json(`/admin/api/runs/${encodeURIComponent(SAM_RUN)}`);
    const byVic = await json(`/admin/api/runs/${encodeURIComponent(VIC_RUN)}`);
    expect(byVic).toEqual(bySam);
    expect(bySam).toMatchObject({
      id: SAM_RUN,
      instanceId: WC,
      members: 2,
      activeSecs: 2430,
      spanSecs: 2460,
      deaths: 3,
    });
    // 7 + 7 boss kills → 7, earliest time kept.
    expect(bySam.bosses).toHaveLength(7);
    expect(bySam.bosses[0]).toEqual({
      ord: 1,
      encounterId: 580,
      name: 'Lady Anacondra',
      killed: true,
      atSecs: 300,
    });
    // 26 + 26 identical drops → 26; the winner's character is known from the member who won it.
    expect(bySam.bossLoot).toHaveLength(26);
    expect(bySam.bossLoot[0]).toMatchObject({
      encounterId: 580,
      bossName: 'Lady Anacondra',
      itemId: 6400,
      winnerClass: 'DRUID',
      winnerChar: SAM,
    });
    expect(bySam.bossLoot[1]).toMatchObject({ winnerClass: 'WARRIOR', winnerChar: VIC });
    expect(bySam.bossLoot[2]).toMatchObject({ winnerClass: 'HUNTER', winnerChar: null });
    // Both members' own loot, attributed.
    expect(bySam.loot.map((l: { itemId: number; char: string }) => [l.itemId, l.char])).toEqual([
      [5000, SAM],
      [5001, VIC],
    ]);
    expect(bySam.perspectives).toHaveLength(2);
    const [samView, vicView] = bySam.perspectives;
    expect(samView).toMatchObject({
      id: SAM_RUN,
      char: SAM,
      charClass: 'DRUID',
      charLevel: 20,
      activeSecs: 2400,
      xpTotal: 9000,
      deaths: 1,
      endReason: 'left',
    });
    expect(samView.loot).toHaveLength(1);
    expect(samView.bossLoot).toHaveLength(26);
    expect(samView.groupLoot).toHaveLength(2);
    expect(samView.party).toHaveLength(4);
    expect(vicView).toMatchObject({ id: VIC_RUN, char: VIC, charClass: 'WARRIOR', deaths: 2 });
  });

  it('backfills runs stored without a group id (before migration 0010)', async () => {
    await ingest(batch('vic'), vicAuth);
    await ingest(batch('sam'), samAuth);
    const solo = {
      ...run('sam'),
      id: `${SAM}-${WC}-${T0 + 7200}`,
      start: T0 + 7200,
      finish: T0 + 9600,
      party: [],
    };
    await ingest({ ...batch('sam'), records: { ...batch('sam').records, runs: [solo] } }, samAuth);
    await s.database.pool.query('update runs set group_id = null');
    // The reads fall back to one group per run until the backfill ran.
    expect((await json(`/admin/api/runs?build=${BUILD}`)).total).toBe(3);
    expect(await backfillRunGroups(s.database.db)).toBe(3);
    expect(await groupIds()).toEqual([
      { id: SAM_RUN, group_id: SAM_RUN },
      { id: solo.id, group_id: solo.id },
      { id: VIC_RUN, group_id: SAM_RUN },
    ]);
    expect((await json(`/admin/api/runs?build=${BUILD}`)).total).toBe(2);
    // Nothing left to do: a second backfill changes nothing.
    expect(await backfillRunGroups(s.database.db)).toBe(0);
  });

  it('never groups a solo run (empty party) with a party that lists its class and level', async () => {
    await ingest(batch('sam'), samAuth);
    await ingest(batch('vic', { party: [] }), vicAuth);
    expect(await groupIds()).toEqual([
      { id: SAM_RUN, group_id: SAM_RUN },
      { id: VIC_RUN, group_id: VIC_RUN },
    ]);
  });

  it('two members uploading at once (one a re-upload) both succeed and end up in one group', async () => {
    await ingest(batch('sam'), samAuth);
    const vicEarly = batch('vic', { id: VIC_EARLY, start: T0 - 1 });
    const [a, b] = await Promise.all([post(batch('sam'), samAuth), post(vicEarly, vicAuth)]);
    expect([a.statusCode, b.statusCode], `${a.body} ${b.body}`).toEqual([200, 200]);
    expect(await groupIds()).toEqual([
      { id: SAM_RUN, group_id: VIC_EARLY },
      { id: VIC_EARLY, group_id: VIC_EARLY },
    ]);
  });

  it('takes the run-group lock before writing runs, so interleaved ingests cannot deadlock', async () => {
    // Stored: Vic (earlier) and Sam in one group named after Vic's run.
    await ingest(minimalBatch('vic', { id: VIC_EARLY, start: T0 - 1 }), vicAuth);
    await ingest(minimalBatch('sam'), samAuth);
    expect((await groupIds()).map((r) => r.group_id)).toEqual([VIC_EARLY, VIC_EARLY]);
    // B re-uploads Vic's run under another build (it leaves the group, so B must rewrite Sam's group id) and A
    // re-uploads Sam's run. The batches share no rows, so only the run-group lock orders them. B queues on the lock
    // first; before the fix A then upserted Sam's run (row lock) and queued, B got the lock and waited on Sam's row:
    // a deadlock (40P01, a 500 for one of them).
    const release = await holdRunGroupLock();
    const pb = post(
      minimalBatch('vic', { id: VIC_EARLY, start: T0 - 1, build: BUILD + 1 }),
      vicAuth,
    );
    await waitForLockWaiters(1);
    const pa = post(minimalBatch('sam'), samAuth);
    await waitForLockWaiters(2);
    await release();
    const [a, b] = await Promise.all([pa, pb]);
    expect([a.statusCode, b.statusCode], `${a.body} ${b.body}`).toEqual([200, 200]);
    expect(await groupIds()).toEqual([
      { id: SAM_RUN, group_id: SAM_RUN },
      { id: VIC_EARLY, group_id: VIC_EARLY },
    ]);
  });

  it('at the round cap, groups the explored runs with their partners but leaves the unexplored ones', async () => {
    await ingest(batch('vic', { id: VIC_EARLY, start: T0 - 1 }), vicAuth);
    await ingest(batch('sam'), samAuth);
    await s.database.pool.query('update runs set group_id = null');
    const warn = vi.fn();
    // One round: Sam is explored, Vic (found in that round) is context only.
    const changed = await s.database.db.transaction((tx) =>
      regroupRuns(tx, [SAM_RUN], { maxRounds: 1, log: { warn } }),
    );
    expect(changed).toBe(1);
    expect(await groupIds()).toEqual([
      { id: SAM_RUN, group_id: VIC_EARLY },
      { id: VIC_EARLY, group_id: null },
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatchObject({ maxRounds: 1, runs: 1, unexplored: 1 });
    // Without the cap the rest is filled in, and nothing is logged.
    await s.database.db.transaction((tx) => regroupRuns(tx, [SAM_RUN], { log: { warn } }));
    expect((await groupIds()).map((r) => r.group_id)).toEqual([VIC_EARLY, VIC_EARLY]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('run detail answers 404 when a regroup moves the whole group between its reads', async () => {
    await ingest(batch('sam'), samAuth);
    const db = s.database.db;
    const execute = db.execute.bind(db);
    const spy = vi.spyOn(db, 'execute').mockImplementation((async (
      query: Parameters<typeof execute>[0],
    ) => {
      const res = await execute(query);
      // Right after the group lookup, another transaction moves the run to another group.
      const row = res.rows[0];
      if (row !== undefined && 'gid' in row)
        await s.database.pool.query(`update runs set group_id = 'elsewhere' where id = $1`, [
          SAM_RUN,
        ]);
      return res;
    }) as typeof db.execute);
    try {
      const res = await s.app.inject({
        method: 'GET',
        url: `/admin/api/runs/${encodeURIComponent(SAM_RUN)}`,
        cookies,
      });
      expect(res.statusCode, res.body).toBe(404);
    } finally {
      spy.mockRestore();
    }
  });
});
