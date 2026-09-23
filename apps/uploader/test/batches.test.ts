import { normalize } from '@forever-ledger/contracts';
import type { Records } from '@forever-ledger/contracts';
import { describe, expect, it } from 'vitest';
import {
  buildBatch,
  chunkEntries,
  diffRecords,
  jsonBytes,
  MAX_BATCH_BYTES,
  MAX_BATCH_RECORDS,
  toEntries,
} from '../src/batches.js';
import { loadFixtureDb } from './helpers/fixtures.js';

type Db = Record<string, Record<string, unknown>>;

async function fixture() {
  const db = structuredClone(await loadFixtureDb('session-v1.lua')) as Db;
  return { db, normalized: normalize(db) };
}

const ackAll = (records: Records) =>
  Object.fromEntries(toEntries(records).map((e) => [e.key, e.hash]));

describe('diffRecords', () => {
  it('queues everything the first time', async () => {
    const { normalized } = await fixture();
    const { changed, unchanged } = diffRecords(normalized.records, {});
    expect(unchanged).toBe(0);
    expect(changed.length).toBe(toEntries(normalized.records).length);
    expect(changed[0]?.kind).toBe('characters');
  });

  it('unchanged file → nothing', async () => {
    const { normalized } = await fixture();
    const acked = ackAll(normalized.records);
    const again = normalize(structuredClone(await loadFixtureDb('session-v1.lua')));
    const { changed, unchanged } = diffRecords(again.records, acked);
    expect(changed).toEqual([]);
    expect(unchanged).toBe(Object.keys(acked).length);
  });

  it('one changed record → only that record', async () => {
    const { db, normalized } = await fixture();
    const acked = ackAll(normalized.records);
    (db.runs as unknown as Record<string, unknown>[])[0]!.deaths = 2;
    const { changed } = diffRecords(normalize(db).records, acked);
    expect(changed.map((e) => e.key)).toEqual(['run:Thibodeaux-Bayou-36-1790000060']);
  });

  it('new build snapshot → only the new snapshot', async () => {
    const { db, normalized } = await fixture();
    const acked = ackAll(normalized.records);
    const item = (db.items as Record<string, Record<string, Record<string, unknown>>>)['872']!;
    item.byBuild!['61700'] = {
      firstSeen: 1790100000,
      ilvl: 23,
      stats: { ITEM_MOD_STRENGTH_SHORT: 9 },
      tooltip: ['Rockslicer'],
    };
    const { changed } = diffRecords(normalize(db).records, acked);
    expect(changed.map((e) => e.key)).toEqual(['isnap:872:61700']);
  });

  it('skips records already waiting in the queue with the same hash, resends newer ones', async () => {
    const { db, normalized } = await fixture();
    const entries = toEntries(normalized.records);
    const queued = new Map(entries.map((e) => [e.key, e.hash]));
    expect(diffRecords(normalized.records, {}, queued).changed).toEqual([]);

    (db.runs as unknown as Record<string, unknown>[])[0]!.deaths = 5;
    const { changed } = diffRecords(normalize(db).records, {}, queued);
    expect(changed.map((e) => e.key)).toEqual(['run:Thibodeaux-Bayou-36-1790000060']);
  });

  it('queued hash wins over acked (it is newer)', async () => {
    const { normalized } = await fixture();
    const acked = ackAll(normalized.records);
    const key = 'run:Thibodeaux-Bayou-36-1790000060';
    const queued = new Map([[key, 'something-newer']]);
    expect(diffRecords(normalized.records, acked, queued).changed.map((e) => e.key)).toEqual([key]);
  });

  it('dedupes a key that appears twice in one file (last wins)', async () => {
    const { normalized } = await fixture();
    const run = normalized.records.runs[0]!;
    const records = { ...normalized.records, runs: [run, { ...run, deaths: 9 }] };
    const runs = diffRecords(records, {}).changed.filter((e) => e.kind === 'runs');
    expect(runs).toHaveLength(1);
    expect((runs[0]!.record as { deaths: number }).deaths).toBe(9);
  });
});

describe('chunkEntries', () => {
  const header = async () => {
    const { normalized } = await fixture();
    return { uploaderId: 'u', account: 'A', meta: normalized.meta };
  };

  function manyDrops(n: number) {
    const drops = Array.from({ length: n }, (_, i) => ({
      itemId: i,
      build: 61600,
      npcId: 644,
      count: 1,
    }));
    return toEntries({
      characters: [],
      quests: [],
      questObservations: [],
      turnIns: [],
      items: [],
      itemSnapshots: [],
      drops,
      runs: [],
    });
  }

  it('defaults stay under the 5 MB server limit', () => {
    expect(MAX_BATCH_BYTES).toBeLessThanOrEqual(4_000_000);
    expect(MAX_BATCH_RECORDS).toBe(1000);
  });

  it('respects the record cap', async () => {
    const h = await header();
    const chunks = chunkEntries(h, manyDrops(2_500));
    expect(chunks.map((c) => c.length)).toEqual([1000, 1000, 500]);
  });

  it('respects the byte cap', async () => {
    const h = await header();
    const entries = manyDrops(500);
    const maxBytes = 5_000;
    const chunks = chunkEntries(h, entries, { maxBytes });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat()).toHaveLength(500);
    for (const c of chunks) expect(jsonBytes(buildBatch(h, c))).toBeLessThanOrEqual(maxBytes);
  });

  it('puts a single oversized record in a batch of its own', async () => {
    const h = await header();
    const entries = manyDrops(3);
    const chunks = chunkEntries(h, entries, { maxBytes: 10 });
    expect(chunks.map((c) => c.length)).toEqual([1, 1, 1]);
  });

  it('keeps order across chunks', async () => {
    const h = await header();
    const entries = manyDrops(25);
    const chunks = chunkEntries(h, entries, { maxRecords: 10 });
    expect(chunks.flat().map((e) => e.key)).toEqual(entries.map((e) => e.key));
  });
});
