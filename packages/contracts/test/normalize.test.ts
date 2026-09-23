import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseSavedVariables } from '@forever-ledger/lua-sv-parser';
import { describe, expect, it } from 'vitest';
import {
  contentHash,
  isSupportedSchemaVersion,
  normalize,
  RECORD_KINDS,
  recordKey,
  SCHEMA_VERSION,
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
    ['session-v3.lua', 3],
    ['session-migrated.lua', 3],
    ['session-v4.lua', 4],
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
    expect(() => normalize({ meta: { schemaVersion: 5, addonVersion: 'x', build: 1 } })).toThrow(
      /schemaVersion 5 is not supported \(expected 1 or 2 or 3 or 4\)/,
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

  it('accepts schema 1 and 2 upload batches, not 5', () => {
    const batch = { uploaderId: 'pc-1', account: 'A', meta: v2.meta, records: v2.records };
    expect(UploadBatch.safeParse({ ...batch, schemaVersion: 2 }).success).toBe(true);
    expect(
      UploadBatch.safeParse({ ...batch, schemaVersion: 1, meta: v1.meta, records: v1.records })
        .success,
    ).toBe(true);
    expect(UploadBatch.safeParse({ ...batch, schemaVersion: 5 }).success).toBe(false);
  });
});

describe('normalize — schema 3 fixture from the 0.2.4 addon', () => {
  const { meta, records } = normalize(load('session-v3.lua'));
  const session = meta.session!;

  it('has a session id and stamps it on drops and corpses', () => {
    expect(meta).toMatchObject({ schemaVersion: 3, addonVersion: '0.2.4' });
    expect(session).toMatch(/^\d+-[0-9a-f]{4}$/);
    expect(records.drops).toContainEqual({
      itemId: 872,
      build: 61582,
      npcId: 644,
      session,
      count: 1,
      quantity: 1,
    });
    expect(records.corpses).toContainEqual({
      npcId: 644,
      build: 61582,
      session,
      count: 1,
      copper: 245,
    });
  });

  it('carries loot method, boss loot and group loot on the run, by class only', () => {
    const run = records.runs[0]!;
    expect(run.lootMethod).toBe('group');
    expect(run.bossLoot).toEqual([
      {
        encounterId: 1,
        lootListKey: 1,
        itemId: 872,
        winnerClass: 'WARRIOR',
        winnerIsSelf: false,
        rolls: [
          { class: 'WARRIOR', roll: 91, state: 'needmainspec' },
          { class: 'HUNTER', roll: 45, state: 'greed' },
        ],
      },
    ]);
    expect(run.groupLoot).toEqual([
      { itemId: 872, qty: 1, by: 'party', class: 'WARRIOR', won: true },
      { itemId: 2589, qty: 2, by: 'party', class: 'PRIEST' },
      { itemId: 2589, qty: 3, by: 'self' },
    ]);
    expect(JSON.stringify(records)).not.toMatch(/Boudreaux|Fontenot/);
  });

  it('the migrated v0 file keeps session "" (its drops are running totals)', () => {
    const migrated = normalize(load('session-migrated.lua'));
    expect(migrated.meta.session).toBe('');
    expect(migrated.records.drops.every((d) => d.session === '')).toBe(true);
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

describe('normalize — schema 4 professions (hand-written professions-v4.lua)', () => {
  const { meta, records, problems } = normalize(load('professions-v4.lua'));
  const S = '1790100000-c0de';
  const build = 69977;
  const char = 'Thibodeaux-Bayou';

  it('reads every professions table without problems', () => {
    expect(problems).toEqual([]);
    expect(meta).toMatchObject({ schemaVersion: 4, addonVersion: '0.3.0', session: S });
    expect(SCHEMA_VERSION).toBe(4);
    expect(isSupportedSchemaVersion(4)).toBe(true);
  });

  it('skills and skill-ups', () => {
    expect(records.skills).toEqual([
      { char, skillLineId: 186, name: 'Mining', rank: 31, maxRank: 75, lastSeen: 1790100900 },
      {
        char,
        skillLineId: 197,
        name: 'Tailoring',
        rank: 12,
        maxRank: 75,
        modifier: 0,
        parentId: 0,
        lastSeen: 1790100900,
      },
    ]);
    expect(records.skillUps).toEqual([
      { char, skillLineId: 197, from: 11, to: 12, build, time: 1790100420, recipeId: 2963 },
      { char, skillLineId: 186, from: 30, to: 31, build, time: 1790100700 },
    ]);
  });

  it('recipes, per-build snapshots with reagents, status, difficulty ranges and learn events', () => {
    expect(records.recipes).toEqual([
      { recipeId: 2963, name: 'Bolt of Linen Cloth', skillLineId: 197, categoryId: 1001 },
      { recipeId: 7629, name: 'Blue Linen Vest', skillLineId: 197 },
    ]);
    expect(records.recipeSnapshots).toEqual([
      {
        recipeId: 2963,
        build,
        outputItemId: 2996,
        qtyMin: 1,
        qtyMax: 1,
        reagents: [{ itemId: 2589, qty: 2 }],
        maxTrivial: 25,
      },
      {
        recipeId: 7629,
        build,
        outputItemId: 6240,
        qtyMin: 1,
        qtyMax: 1,
        reagents: [
          { itemId: 2996, qty: 3 },
          { itemId: 2320, qty: 1 },
        ],
        sourceText: 'Pattern: Blue Linen Vest',
      },
    ]);
    expect(records.recipeStatus).toEqual([
      {
        recipeId: 2963,
        build,
        char,
        learned: true,
        difficulty: 'optimal',
        rank: 12,
        seenAt: 1790100420,
      },
      { recipeId: 7629, build, char, learned: false, seenAt: 1790100420 },
    ]);
    expect(records.recipeDifficulty).toEqual([
      { recipeId: 2963, build, char, difficulty: 'optimal', minRank: 1, maxRank: 12 },
    ]);
    expect(records.recipesLearned).toEqual([
      { char, recipeId: 2963, build, time: 1790100200, via: 'trainer:1346' },
      { char, recipeId: 7629, build, time: 1790100500, via: 'item:6270' },
    ]);
  });

  it('per-session crafts, nodes (fishing = object 0) and node loot', () => {
    expect(records.crafts).toEqual([
      { recipeId: 2963, build, session: S, casts: 4, qty: 4, procs: 0, skillUps: 2 },
    ]);
    expect(records.nodes).toEqual([
      {
        objectId: 0,
        build,
        session: S,
        opened: 2,
        skillLineId: 356,
        spots: [{ mapId: 1429, points: [[50, 60]] }],
      },
      {
        objectId: 1731,
        build,
        session: S,
        opened: 3,
        name: 'Copper Vein',
        rankMin: 29,
        skillLineId: 186,
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
    expect(records.nodeLoot).toEqual([
      { itemId: 2770, objectId: 1731, build, session: S, count: 3, quantity: 5 },
      { itemId: 2835, objectId: 1731, build, session: S, count: 1, quantity: 1 },
      { itemId: 6303, objectId: 0, build, session: S, count: 2, quantity: 2 },
    ]);
  });

  it('trainers and vendors with their lists, loc kept as the addon wrote it', () => {
    const loc = { zone: 'Stormwind City', subzone: 'The Canals', mapID: 1453 };
    expect(records.trainers).toEqual([
      {
        npcId: 1346,
        build,
        name: 'Georgio Bolero',
        loc: { ...loc, x: 43.4, y: 73.8 },
        skillLineId: 197,
        seenAt: 1790100150,
        complete: true,
        services: [
          {
            name: 'Bolt of Linen Cloth',
            type: 'used',
            cost: 0,
            skill: 'Tailoring',
            skillRank: 0,
            level: 0,
            itemId: 2996,
          },
          {
            name: 'Brown Linen Shirt',
            type: 'available',
            cost: 50,
            skill: 'Tailoring',
            skillRank: 10,
            level: 5,
            itemId: 4344,
          },
        ],
      },
    ]);
    expect(records.vendors).toEqual([
      {
        npcId: 1347,
        build,
        name: 'Alexandra Bolero',
        loc: { ...loc, x: 43.2, y: 74.1 },
        seenAt: 1790100160,
        items: [
          { itemId: 2320, price: 10, stack: 1, numAvailable: -1 },
          { itemId: 6270, price: 200, stack: 1, numAvailable: 1, extendedCost: false },
        ],
      },
    ]);
  });

  it('items gain classId / subclassId; API samples keep the raw table', () => {
    expect(records.items.find((i) => i.itemId === 6270)).toMatchObject({
      name: 'Pattern: Blue Linen Vest',
      classId: 9,
      subclassId: 2,
    });
    expect(records.itemSnapshots).toHaveLength(1);
    expect(records.apiSamples).toEqual([
      {
        api: 'C_TradeSkillUI.GetRecipeInfo',
        build,
        time: 1790100400,
        sample: {
          recipeID: 2963,
          name: 'Bolt of Linen Cloth',
          learned: true,
          relativeDifficulty: 0,
          categoryID: 1001,
        },
      },
      {
        api: 'TRADE_SKILL_ITEM_CRAFTED_RESULT',
        build,
        time: 1790100420,
        sample: [{ itemID: 2996, quantity: 1, multicraft: 0 }],
      },
    ]);
  });

  it('keys every record per the appendix; crafts, nodes and node loot carry the session', () => {
    const keys = Object.fromEntries(
      RECORD_KINDS.map((k) => [k, (records[k] as never[]).map((r) => recordKey(k, r))]),
    );
    expect(keys).toMatchObject({
      skills: [`skill:${char}:186`, `skill:${char}:197`],
      skillUps: [`skillup:${char}:197:1790100420:12`, `skillup:${char}:186:1790100700:31`],
      recipes: ['recipe:2963', 'recipe:7629'],
      recipeSnapshots: ['rsnap:2963:69977', 'rsnap:7629:69977'],
      recipeStatus: [`rstat:2963:69977:${char}`, `rstat:7629:69977:${char}`],
      recipeDifficulty: [`rdiff:2963:69977:${char}:optimal`],
      recipesLearned: [`rlearn:${char}:2963:1790100200`, `rlearn:${char}:7629:1790100500`],
      crafts: [`craft:2963:69977:${S}`],
      nodes: [`node:0:69977:${S}`, `node:1731:69977:${S}`],
      nodeLoot: [
        `nloot:2770:1731:69977:${S}`,
        `nloot:2835:1731:69977:${S}`,
        `nloot:6303:0:69977:${S}`,
      ],
      trainers: ['trainer:1346:69977'],
      vendors: ['vendor:1347:69977'],
      apiSamples: [
        'api:C_TradeSkillUI.GetRecipeInfo:69977',
        'api:TRADE_SKILL_ITEM_CRAFTED_RESULT:69977',
      ],
    });
    for (const kind of RECORD_KINDS) expect(new Set(keys[kind]).size).toBe(keys[kind]!.length);
  });

  it('builds a valid schema 4 upload batch; defaults and bad entries', () => {
    const batch = UploadBatch.parse({
      schemaVersion: 4,
      uploaderId: 'pc-1',
      account: 'A',
      meta,
      records,
    });
    expect(batch.records.vendors).toHaveLength(1);

    const { records: r, problems: p } = normalize({
      meta: { schemaVersion: 4, addonVersion: '0.3.0', build, session: S },
      crafts: { [build]: { 1: { casts: 2 } } },
      nodes: { [build]: { 5: { spots: { 1: ['1,2', 'junk', ...Array(60).fill('3,4')] } } } },
      nodeLoot: { 9: { [build]: { 5: { n: 1 } } } },
    });
    expect(r.crafts).toEqual([
      { recipeId: 1, build, session: S, casts: 2, qty: 0, procs: 0, skillUps: 0 },
    ]);
    expect(r.nodes[0]!.opened).toBe(0);
    expect(r.nodes[0]!.spots[0]!.points).toHaveLength(50);
    expect(r.nodes[0]!.spots[0]!.points[0]).toEqual([1, 2]);
    expect(p).toEqual([
      expect.objectContaining({ kind: 'nodeLoot', path: `nodeLoot.9.${build}.5` }),
    ]);
  });

  it('drops an API sample over 16 KB of JSON, keeping the others', () => {
    const { records: r, problems: p } = normalize({
      meta: { schemaVersion: 4, addonVersion: '0.3.0', build, session: S },
      apiSamples: {
        small: { build, time: 1790100000, sample: { a: 1 } },
        huge: { build, time: 1790100000, sample: { text: 'x'.repeat(16 * 1024) } },
      },
    });
    expect(r.apiSamples.map((a) => a.api)).toEqual(['small']);
    expect(p).toEqual([expect.objectContaining({ kind: 'apiSamples', path: 'apiSamples.huge' })]);
  });

  it('schema 3 files have no professions records', () => {
    const v3 = normalize(load('session-v3.lua'));
    for (const kind of ['skills', 'recipes', 'crafts', 'nodes', 'trainers', 'apiSamples'] as const)
      expect(v3.records[kind]).toEqual([]);
  });
});

describe('normalize — schema 4 from the real addon (session-v4.lua)', () => {
  const { meta, records, problems } = normalize(load('session-v4.lua'));
  const PROFESSION_KINDS = [
    'skills',
    'skillUps',
    'recipes',
    'recipeSnapshots',
    'recipeStatus',
    'recipeDifficulty',
    'recipesLearned',
    'crafts',
    'nodes',
    'nodeLoot',
    'trainers',
    'vendors',
    'apiSamples',
  ] as const;

  it('validates with no problems and fills each of the 13 professions kinds', () => {
    expect(problems).toEqual([]);
    expect(meta).toMatchObject({ schemaVersion: 4, addonVersion: '0.3.0' });
    expect(PROFESSION_KINDS).toHaveLength(13);
    for (const kind of PROFESSION_KINDS) {
      expect(records[kind].length, kind).toBeGreaterThanOrEqual(1);
      expect(RECORD_KINDS).toContain(kind);
    }
  });

  it('yields unique natural keys and a valid schema 4 batch', () => {
    for (const kind of RECORD_KINDS) {
      const keys = (records[kind] as never[]).map((r) => recordKey(kind, r));
      expect(new Set(keys).size).toBe(keys.length);
    }
    const batch = UploadBatch.parse({
      schemaVersion: 4,
      uploaderId: 'pc-1',
      account: 'A',
      meta,
      records,
    });
    expect(batch.records.trainers).toHaveLength(1);
  });

  it('keeps what the addon observed: skill-up recipe, learn sources, procs, fishing, recipe items', () => {
    expect(records.skillUps).toEqual([
      expect.objectContaining({ skillLineId: 197, from: 50, to: 51, recipeId: 2963 }),
    ]);
    expect(records.recipesLearned.map((l) => l.via)).toEqual(['trainer:1103', 'item:2598']);
    expect(records.crafts.find((c) => c.recipeId === 2963)).toMatchObject({
      casts: 1,
      qty: 3,
      procs: 1,
      skillUps: 1,
      session: meta.session,
    });
    expect(records.nodes.find((n) => n.objectId === 0)).toMatchObject({ skillLineId: 356 });
    expect(records.nodes.find((n) => n.objectId === 1731)).toMatchObject({
      name: 'Copper Vein',
      opened: 2,
    });
    expect(
      records.recipeDifficulty.filter((d) => d.recipeId === 2393).map((d) => d.difficulty),
    ).toEqual(['medium', 'optimal']);
    expect(records.items.find((i) => i.itemId === 2598)).toMatchObject({
      classId: 9,
      subclassId: 2,
    });
  });

  it('API samples keep field misses and sparse multi-return samples as sent', () => {
    const byApi = new Map(records.apiSamples.map((s) => [s.api, s.sample]));
    expect(byApi.get('ForeverLedger.fieldMisses')).toEqual({
      'C_TradeSkillUI.GetRecipeSchematic:quantityMax': 'quantityMax|maxQuantity',
    });
    // NEW_RECIPE_LEARNED(recipeID, nil, baseRecipeID): the nil gap makes it a keyed table, not a list
    expect({ ...(byApi.get('NEW_RECIPE_LEARNED') as object) }).toEqual({ 1: 2393, 3: 2393 });
    expect(byApi.get('GetTrainerServiceInfo')).toEqual(['Tailoring', '', 'header', true]);
    expect(byApi.get('C_TradeSkillUI.GetRecipeSchematic:reagentSlot')).toMatchObject({
      quantityRequired: 2,
    });
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
