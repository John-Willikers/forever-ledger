import { contentHash, RECORD_KINDS, recordKey } from '@forever-ledger/contracts';
import type { Meta, RecordKind, Records, UploadBatch } from '@forever-ledger/contracts';

/** One record plus its natural key and content hash. */
export interface Entry {
  kind: RecordKind;
  key: string;
  hash: string;
  record: Records[RecordKind][number];
}

/** Server body limit is 5 MB; stay well under it. */
export const MAX_BATCH_BYTES = 4_000_000;
export const MAX_BATCH_RECORDS = 1_000;

export const emptyRecords = (): Records => ({
  characters: [],
  quests: [],
  questObservations: [],
  turnIns: [],
  items: [],
  itemSnapshots: [],
  drops: [],
  corpses: [],
  skills: [],
  skillUps: [],
  recipes: [],
  recipeSnapshots: [],
  recipeStatus: [],
  recipeDifficulty: [],
  recipesLearned: [],
  crafts: [],
  nodes: [],
  nodeLoot: [],
  trainers: [],
  vendors: [],
  apiSamples: [],
  runs: [],
});

/** Flattens records into entries, in RECORD_KINDS order (characters first, runs last). */
export function toEntries(records: Records): Entry[] {
  const out: Entry[] = [];
  for (const kind of RECORD_KINDS) {
    for (const record of records[kind]) {
      out.push({
        kind,
        key: recordKey(kind, record as never),
        hash: contentHash(record),
        record,
      });
    }
  }
  return out;
}

export function fromEntries(entries: Entry[]): Records {
  const records = emptyRecords();
  for (const e of entries) (records[e.kind] as unknown[]).push(e.record);
  return records;
}

export interface DiffResult {
  changed: Entry[];
  unchanged: number;
}

/**
 * Keeps only records whose hash differs from what the server already has (`acked`) or what is already
 * waiting in the queue (`queued`, which is newer than acked when both exist). Content the server
 * rejected with a 400 (`rejected`) is not re-queued until it changes. A key that appears twice in one
 * file keeps its last occurrence.
 */
export function diffRecords(
  records: Records,
  acked: Readonly<Record<string, string>>,
  queued: ReadonlyMap<string, string> = new Map(),
  rejected: Readonly<Record<string, string>> = {},
): DiffResult {
  const latest = new Map<string, Entry>();
  for (const e of toEntries(records)) {
    latest.delete(e.key);
    latest.set(e.key, e);
  }
  const changed: Entry[] = [];
  let unchanged = 0;
  for (const e of latest.values()) {
    const known = queued.get(e.key) ?? acked[e.key];
    if (known === e.hash || (known === undefined && rejected[e.key] === e.hash)) unchanged++;
    else changed.push(e);
  }
  // Re-sort by kind so each batch lists characters before the records that reference them.
  const order = new Map(RECORD_KINDS.map((k, i) => [k, i]));
  changed.sort((a, b) => (order.get(a.kind) ?? 0) - (order.get(b.kind) ?? 0));
  return { changed, unchanged };
}

export interface BatchHeader {
  uploaderId: string;
  account: string;
  meta: Meta;
}

export function buildBatch(header: BatchHeader, entries: Entry[]): UploadBatch {
  return {
    // The file's own schema major: the server accepts older majors, and queued batches keep theirs.
    schemaVersion: header.meta.schemaVersion,
    uploaderId: header.uploaderId,
    account: header.account,
    meta: header.meta,
    records: fromEntries(entries),
  };
}

export const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');

export interface ChunkOptions {
  maxRecords?: number;
  maxBytes?: number;
}

/**
 * Splits entries into groups whose serialized UploadBatch stays under `maxBytes` and `maxRecords`.
 * A single record bigger than the byte cap gets a batch of its own (the server will answer 413).
 */
export function chunkEntries(
  header: BatchHeader,
  entries: Entry[],
  opts: ChunkOptions = {},
): Entry[][] {
  const maxRecords = opts.maxRecords ?? MAX_BATCH_RECORDS;
  const maxBytes = opts.maxBytes ?? MAX_BATCH_BYTES;
  const envelope = jsonBytes(buildBatch(header, []));
  const chunks: Entry[][] = [];
  let cur: Entry[] = [];
  let bytes = envelope;
  for (const e of entries) {
    const size = jsonBytes(e.record) + 1; // + separating comma
    if (cur.length && (cur.length >= maxRecords || bytes + size > maxBytes)) {
      chunks.push(cur);
      cur = [];
      bytes = envelope;
    }
    cur.push(e);
    bytes += size;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}
