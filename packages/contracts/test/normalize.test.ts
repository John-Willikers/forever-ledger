import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseSavedVariables } from '@forever-ledger/lua-sv-parser';
import { describe, expect, it } from 'vitest';
import {
  contentHash,
  normalize,
  RECORD_KINDS,
  recordKey,
  UnsupportedSchemaError,
  UploadBatch,
} from '../src/index.js';

const load = (name: string) =>
  parseSavedVariables(
    readFileSync(fileURLToPath(new URL(`../../../fixtures/synthetic/${name}`, import.meta.url))),
  ).ForeverLedgerDB;

describe('normalize — synthetic fixtures from the Lua harness', () => {
  for (const [name, schemaVersion] of [
    ['session-v1.lua', 1],
    ['session-v2.lua', 2],
    ['session-migrated.lua', 2],
  ] as const) {
    it(`${name}: every record validates`, () => {
      const { meta, records, problems } = normalize(load(name));
      expect(problems).toEqual([]);
      expect(meta.schemaVersion).toBe(schemaVersion);
      expect(records.quests).toHaveLength(1);
      expect(records.questObservations.length).toBeGreaterThanOrEqual(3);
      expect(records.turnIns).toHaveLength(1);
      expect(records.items.length).toBeGreaterThanOrEqual(3);
      expect(records.runs.length).toBeGreaterThanOrEqual(1);
      expect(records.drops.length).toBeGreaterThanOrEqual(1);
    });
  }

  const { meta, records } = normalize(load('session-v1.lua'));

  it('reads meta from the newest build', () => {
    expect(meta).toMatchObject({ build: 61600, addonVersion: '0.2.2', interface: 11508 });
  });

  it('keeps one item snapshot per build', () => {
    const snaps = records.itemSnapshots.filter((s) => s.itemId === 872);
    expect(snaps.map((s) => [s.build, s.ilvl])).toEqual([
      [61582, 21],
      [61600, 22],
    ]);
    expect(snaps[0]?.tooltip[1]).toBe('Two-Hand\tAxe');
  });

  it('flattens drops to item + build + npc running totals', () => {
    const d = { itemId: 872, npcId: 644, session: '', count: 1 };
    expect(records.drops).toContainEqual({ ...d, build: 61582 });
    expect(records.drops).toContainEqual({ ...d, build: 61600 });
    expect(records.corpses).toEqual([]);
  });

  it('maps addon field names to contract names', () => {
    const t = records.turnIns[0]!;
    expect(t.questId).toBe(1234);
    expect(t.runId).toBe(records.runs[0]!.id);
    const obs = records.questObservations.find((o) => o.stage === 'detail')!;
    expect(obs.choices).toEqual([
      { itemID: 5555, count: 1 },
      { itemID: 5556, count: 1 },
    ]);
    expect(records.characters[0]).toMatchObject({
      key: 'Thibodeaux-Bayou',
      name: 'Thibodeaux',
      realm: 'Bayou',
    });
  });

  it('yields unique natural keys', () => {
    for (const kind of RECORD_KINDS) {
      const keys = (records[kind] as never[]).map((r) => recordKey(kind, r));
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('builds a valid upload batch', () => {
    const batch = UploadBatch.parse({
      schemaVersion: 1,
      uploaderId: 'pc-1',
      account: 'ACCOUNT1',
      meta,
      records,
    });
    expect(batch.records.runs).toHaveLength(2);
  });
});

describe('normalize — edge cases', () => {
  it('rejects un-migrated v0.1.0 files with a helpful error', () => {
    expect(() => normalize(load('session-v0.lua'))).toThrow(UnsupportedSchemaError);
    expect(() => normalize(load('session-v0.lua'))).toThrow(/log in once/);
  });

  it('rejects unknown schema majors', () => {
    expect(() => normalize({ meta: { schemaVersion: 4, addonVersion: 'x', build: 1 } })).toThrow(
      /schemaVersion 4 is not supported \(expected 1 or 2 or 3\)/,
    );
  });

  it('maps a schema 2 turn-in choice (itemID) to choice.itemId', () => {
    const { records, problems } = normalize({
      meta: { schemaVersion: 2, addonVersion: '0.2.3', build: 5 },
      turnIns: [
        {
          id: 'a-1-1',
          questID: 1,
          build: 5,
          char: 'A-R',
          time: 10,
          choice: { index: 2, itemID: 99 },
        },
        {
          id: 'a-2-1',
          questID: 2,
          build: 5,
          char: 'A-R',
          time: 11,
          choice: { index: 0, itemID: 9 },
        },
      ],
    });
    expect(records.turnIns).toEqual([
      {
        id: 'a-1-1',
        questId: 1,
        build: 5,
        char: 'A-R',
        time: 10,
        choice: { index: 2, itemId: 99 },
      },
    ]);
    expect(problems[0]).toMatchObject({ kind: 'turnIns', path: 'turnIns.2' });
  });

  it('reads id-keyed tables that the parser turned into arrays', () => {
    const db = {
      meta: { schemaVersion: 1, addonVersion: '0.2.0', build: 5 },
      quests: [
        { id: 1, obs: {} },
        { id: 2, title: 'Two', obs: {} },
      ],
      drops: [{ '5': [7] }],
    };
    const { records } = normalize(db);
    expect(records.quests.map((q) => q.questId)).toEqual([1, 2]);
    expect(records.drops).toEqual([{ itemId: 1, build: 5, npcId: 1, session: '', count: 7 }]);
  });

  it('reports bad records as problems without dropping good ones', () => {
    const db = {
      meta: { schemaVersion: 1, addonVersion: '0.2.0', build: 5 },
      turnIns: [
        { id: 'a-1-1', questID: 1, build: 5, char: 'A-R', time: 10 },
        { id: 'a-2-1', questID: 'nope', build: 5, char: 'A-R', time: 10 },
      ],
    };
    const { records, problems } = normalize(db);
    expect(records.turnIns).toHaveLength(1);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ kind: 'turnIns', path: 'turnIns.2' });
  });
});

describe('normalize — schema 2 (addon 0.2.3)', () => {
  const v1 = normalize(load('session-v1.lua'));
  const v2 = normalize(load('session-v2.lua'));

  it('records the chosen reward on the turn-in', () => {
    expect(v2.meta).toMatchObject({ schemaVersion: 2, addonVersion: '0.2.3' });
    expect(v2.records.turnIns[0]!.choice).toEqual({ index: 1, itemId: 5555 });
  });

  it('schema 1 turn-ins have no choice and keep their content hash', () => {
    const t = v1.records.turnIns[0]!;
    expect(t.choice).toBeUndefined();
    const { choice: _c, ...rest } = t;
    expect(contentHash(t)).toBe(contentHash(rest));
  });

  it('only the turn-in and meta differ between the 0.2.2 and 0.2.3 fixtures', () => {
    for (const kind of RECORD_KINDS) {
      if (kind === 'turnIns') continue;
      expect(v2.records[kind]).toEqual(v1.records[kind]);
    }
    const { choice: _c, ...t2 } = v2.records.turnIns[0]!;
    expect(t2).toEqual(v1.records.turnIns[0]);
  });

  it('accepts schema 1 and 2 upload batches, not 4', () => {
    const batch = { uploaderId: 'pc-1', account: 'A', meta: v2.meta, records: v2.records };
    expect(UploadBatch.safeParse({ ...batch, schemaVersion: 2 }).success).toBe(true);
    expect(
      UploadBatch.safeParse({ ...batch, schemaVersion: 1, meta: v1.meta, records: v1.records })
        .success,
    ).toBe(true);
    expect(UploadBatch.safeParse({ ...batch, schemaVersion: 4 }).success).toBe(false);
  });
});

describe('normalize — schema 3 (addon 0.2.4)', () => {
  const S = '1790000000-beef';
  const db = {
    meta: { schemaVersion: 3, addonVersion: '0.2.4', build: 69977, session: S },
    drops: { 2589: { 69977: { 1234: 3, 0: 1 } } },
    dropQty: { 2589: { 69977: { 1234: 5 } } },
    corpses: { 69977: { 1234: { n: 4, copper: 57 }, 99: { n: 1 } } },
    runs: [
      {
        id: 'A-R-36-10',
        build: 69977,
        char: 'A-R',
        instanceID: 36,
        start: 10,
        awaySecs: 0,
        xpTotal: 0,
        questXP: 0,
        deaths: 0,
        bosses: {},
        loot: {},
        party: {},
        lootMethod: 'group',
        bossLoot: [
          {
            encounterID: 1,
            lootListKey: 2,
            itemID: 872,
            winnerClass: 'WARRIOR',
            winnerIsSelf: false,
            rolls: [{ class: 'WARRIOR', roll: 88, state: 'needmainspec' }, { class: 'HUNTER' }],
          },
        ],
        groupLoot: [
          { itemID: 2589, qty: 2, by: 'party', class: 'PRIEST' },
          { itemID: 872, qty: 1, by: 'party', class: 'WARRIOR', won: true },
          { itemID: 5, qty: 1, by: 'someone' },
        ],
      },
    ],
  };
  const { meta, records, problems } = normalize(db);

  it('keeps the session in meta and on every drop and corpse', () => {
    expect(meta.session).toBe(S);
    expect(records.drops).toEqual([
      { itemId: 2589, build: 69977, npcId: 0, session: S, count: 1 },
      { itemId: 2589, build: 69977, npcId: 1234, session: S, count: 3, quantity: 5 },
    ]);
    expect(records.corpses).toEqual([
      { npcId: 99, build: 69977, session: S, count: 1, copper: 0 },
      { npcId: 1234, build: 69977, session: S, count: 4, copper: 57 },
    ]);
  });

  it('keys drops and corpses by session; schema 1/2 drops keep their old key', () => {
    expect(recordKey('drops', records.drops[1]!)).toBe(`drop:2589:69977:1234:${S}`);
    expect(recordKey('corpses', records.corpses[1]!)).toBe(`corpse:1234:69977:${S}`);
    const old = { itemId: 2589, build: 69977, npcId: 1234, session: '', count: 3 };
    expect(recordKey('drops', old)).toBe('drop:2589:69977:1234');
    // Two sessions with identical counts are two records, so neither hides behind the other's hash.
    const other = { ...records.drops[1]!, session: '1790000500-0001' };
    expect(recordKey('drops', other)).not.toBe(recordKey('drops', records.drops[1]!));
  });

  it('maps run loot to itemId / encounterId and rejects a bad group loot entry', () => {
    expect(records.runs).toHaveLength(0);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.issues.join()).toMatch(/groupLoot\.2\.by/);
    const fixed = structuredClone(db);
    fixed.runs[0]!.groupLoot.pop();
    const run = normalize(fixed).records.runs[0]!;
    expect(run.lootMethod).toBe('group');
    expect(run.bossLoot).toEqual([
      {
        encounterId: 1,
        lootListKey: 2,
        itemId: 872,
        winnerClass: 'WARRIOR',
        winnerIsSelf: false,
        rolls: [{ class: 'WARRIOR', roll: 88, state: 'needmainspec' }, { class: 'HUNTER' }],
      },
    ]);
    expect(run.groupLoot).toEqual([
      { itemId: 2589, qty: 2, by: 'party', class: 'PRIEST' },
      { itemId: 872, qty: 1, by: 'party', class: 'WARRIOR', won: true },
    ]);
  });

  it('accepts schema 3 upload batches and defaults a missing drop session to empty', () => {
    const batch = UploadBatch.parse({
      schemaVersion: 3,
      uploaderId: 'pc-1',
      account: 'A',
      meta,
      records: { drops: [{ itemId: 1, build: 2, npcId: 3, count: 4 }] },
    });
    expect(batch.records.drops[0]!.session).toBe('');
    expect(batch.records.corpses).toEqual([]);
  });
});

describe('contentHash', () => {
  it('ignores key order and undefined fields', () => {
    expect(contentHash({ a: 1, b: { c: 2, d: 3 } })).toBe(
      contentHash({ b: { d: 3, c: 2 }, a: 1, z: undefined }),
    );
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
  });
});
