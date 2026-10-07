// Schema 7 against a real Postgres: fishing casts stored and searchable, characters keyed by full name, old short
// keys merged (characters-cli) and renames merged by GUID at ingest.
import type { UploadBatch } from '@forever-ledger/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MergeRefused, mergeCharacter, suggestMerges } from '../src/characters.js';
import { batchFromFixture, startServer } from './helpers.js';

const FULL = 'Thibodeaux Willikers-Bayou';
const SHORT = 'Thibodeaux-Bayou';
const GUID = 'Player-4618-00A9A08A';

describe('fishing casts and character identity (schema 7)', () => {
  let s: Awaited<ReturnType<typeof startServer>>;
  const q = async (text: string, params: unknown[] = []) =>
    (await s.database.pool.query(text, params)).rows;
  const ingest = async (batch: UploadBatch) => {
    const res = await s.app.inject({
      method: 'POST',
      url: '/v1/ingest',
      headers: s.auth,
      payload: batch,
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  };
  const read = async (url: string) => {
    const res = await s.app.inject({ method: 'GET', url, headers: s.readerAuth });
    expect(res.statusCode, `${url} ${res.body}`).toBe(200);
    return res.json();
  };

  beforeAll(async () => {
    s = await startServer();
    // An old 0.3.4 tray first (short key), then the 0.4.0 session (full name, GUID, fishing casts).
    await ingest(batchFromFixture('session-v6.lua'));
    await ingest(batchFromFixture('session-v7.lua'));
  });
  afterAll(() => s?.stop());

  it('stores one row per fishing cast, and a re-upload changes nothing', async () => {
    const rows = await q(
      `select char, outcome, lure, skill, modifier, loot, zone, uploader_id from fishing_casts order by cast_at`,
    );
    expect(rows.map((r) => r.outcome)).toEqual(['loot', 'escaped', 'none']);
    expect(rows[0]).toMatchObject({
      char: FULL,
      lure: 265,
      skill: 25,
      modifier: 75,
      loot: [{ itemId: 6303, qty: 1 }],
      uploader_id: 'pc-1',
    });
    const ack = await ingest(batchFromFixture('session-v7.lua'));
    expect(ack.acknowledged.some((a: { key: string }) => a.key.startsWith('fish:'))).toBe(true);
    expect(await s.count('fishing_casts')).toBe(3);
  });

  it('keys the character by full name with its GUID and first name', async () => {
    const [me] = await q(`select name, first_name, guid from characters where key = $1`, [FULL]);
    expect(me).toEqual({ name: 'Thibodeaux Willikers', first_name: 'Thibodeaux', guid: GUID });
  });

  it('searches yield per zone and where an item is caught', async () => {
    const { groups } = await read('/v1/fishing/yield');
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      casts: 3,
      outcomes: { loot: 1, escaped: 1, notHooked: 0, none: 1 },
      luredCasts: 1,
      catches: [{ itemId: 6303, times: 1, qty: 1, perCast: 0.3333 }],
    });
    const zone = groups[0].zone as string;
    expect(
      (await read(`/v1/fishing/yield?zone=${encodeURIComponent(zone)}&lure=yes`)).groups[0],
    ).toMatchObject({
      casts: 1,
    });
    expect((await read('/v1/fishing/yield?zone=Nowhere')).groups).toEqual([]);
    const where = await read('/v1/fishing/where?item=6303');
    expect(where.zones).toEqual([
      expect.objectContaining({ zone, casts: 3, times: 1, qty: 1, perCast: 0.3333 }),
    ]);
    const casts = await read('/v1/fishing/casts?limit=2');
    expect(casts.items).toHaveLength(2);
    expect(casts.items[0].castAt).toMatch(/-0[56]:00$/);
    const bad = await s.app.inject({
      method: 'GET',
      url: '/v1/fishing/yield?lure=maybe',
      headers: s.readerAuth,
    });
    expect(bad.statusCode).toBe(400);
    const upload = await s.app.inject({ method: 'GET', url: '/v1/fishing/yield', headers: s.auth });
    expect(upload.statusCode).toBe(403);
  });

  it('suggests and merges the 0.3.4 short key into the full name; later short uploads follow the alias', async () => {
    expect(await suggestMerges(s.database.db)).toEqual([
      expect.objectContaining({ from: SHORT, into: FULL }),
    ]);
    const shortTurnIns = (
      await q(`select count(*)::int as n from turn_ins where char = $1`, [SHORT])
    )[0].n;
    expect(shortTurnIns).toBeGreaterThan(0);
    const r = await s.database.db.transaction((tx) =>
      mergeCharacter(tx, SHORT, FULL, 'merge', ['ACCOUNT1']),
    );
    expect(r.moved.turn_ins! + r.dropped.turn_ins!).toBe(shortTurnIns);
    expect(await q(`select key from characters where key = $1`, [SHORT])).toEqual([]);
    expect((await q(`select count(*)::int as n from turn_ins where char = $1`, [SHORT]))[0].n).toBe(
      0,
    );
    expect(await suggestMerges(s.database.db)).toEqual([]);
    // A tray still on 0.3.4 uploads the short key again: it lands on the full name.
    await ingest(batchFromFixture('session-v6.lua'));
    expect(await q(`select key from characters where key = $1`, [SHORT])).toEqual([]);
    expect((await q(`select count(*)::int as n from turn_ins where char = $1`, [SHORT]))[0].n).toBe(
      0,
    );
    const [me] = await q(`select guid from characters where key = $1`, [FULL]);
    expect(me.guid).toBe(GUID);
  });

  it('merges a renamed character by GUID at ingest', async () => {
    const renamed = batchFromFixture('session-v7.lua');
    const NEW = 'Thibodeaux Boudreaux-Bayou';
    const swap = (k: string) => (k === FULL ? NEW : k);
    renamed.records.characters = renamed.records.characters.map((c) =>
      c.key === FULL ? { ...c, key: NEW, name: 'Thibodeaux Boudreaux' } : c,
    );
    renamed.records.fishingCasts = renamed.records.fishingCasts.map((c) => ({
      ...c,
      id: `${c.id}-renamed`,
      char: swap(c.char),
    }));
    await ingest(renamed);
    expect(await q(`select key from characters where guid = $1`, [GUID])).toEqual([{ key: NEW }]);
    const aliases = await q(
      `select account, alias_key, canonical_key, reason from character_aliases order by 2`,
    );
    expect(aliases).toEqual([
      { account: 'ACCOUNT1', alias_key: FULL, canonical_key: NEW, reason: 'guid' },
      { account: 'ACCOUNT1', alias_key: SHORT, canonical_key: NEW, reason: 'merge' },
    ]);
    expect((await q(`select count(distinct char)::int as n from fishing_casts`))[0].n).toBe(1);
  });

  it("never lets another account's upload take a character over by its GUID", async () => {
    const NEW = 'Thibodeaux Boudreaux-Bayou';
    const thief = batchFromFixture('session-v7.lua', 'ACCOUNT2', 'pc-evil');
    thief.records.characters = thief.records.characters.map((c) =>
      c.guid ? { ...c, key: 'Mallory Thief-Bayou', name: 'Mallory Thief' } : c,
    );
    thief.records.fishingCasts = [];
    await ingest(thief);
    expect(await q(`select key from characters where guid = $1`, [GUID])).toEqual([{ key: NEW }]);
    const [mallory] = await q(`select guid from characters where key = 'Mallory Thief-Bayou'`);
    expect(mallory).toEqual({ guid: null });
    expect(
      (await q(`select count(*)::int as n from character_aliases where account = 'ACCOUNT2'`))[0].n,
    ).toBe(0);
  });

  it('never merges a full name into a key without a surname, and refuses an alias as the target', async () => {
    const NEW = 'Thibodeaux Boudreaux-Bayou';
    const noSurname = batchFromFixture('session-v7.lua');
    noSurname.records.characters = noSurname.records.characters.map((c) =>
      c.guid ? { ...c, key: 'Thibodeaux-Elsewhere', name: 'Thibodeaux', realm: 'Elsewhere' } : c,
    );
    noSurname.records.fishingCasts = [];
    await ingest(noSurname);
    expect(await q(`select key from characters where guid = $1`, [GUID])).toEqual([{ key: NEW }]);
    await expect(
      s.database.db.transaction((tx) => mergeCharacter(tx, NEW, FULL, 'merge', ['ACCOUNT1'])),
    ).rejects.toBeInstanceOf(MergeRefused);
  });
});
