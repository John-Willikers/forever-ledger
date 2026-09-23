import { createHash } from 'node:crypto';
import type { Records, RecordKind } from './schemas.js';

type RecordOf<K extends RecordKind> = Records[K][number];

const sessionSuffix = (session: unknown) =>
  typeof session === 'string' && session !== '' ? `:${session}` : '';

/** Natural key for every record kind. Uploader state and server acks are keyed by these strings. */
export function recordKey<K extends RecordKind>(kind: K, record: RecordOf<K>): string {
  const r = record as Record<string, unknown>;
  switch (kind) {
    case 'characters':
      return `char:${r.key}`;
    case 'quests':
      return `quest:${r.questId}`;
    case 'questObservations':
      return `qobs:${r.questId}:${r.build}:${r.stage}:${r.char}`;
    case 'turnIns':
      return `turnin:${r.id}`;
    case 'items':
      return `item:${r.itemId}`;
    case 'itemSnapshots':
      return `isnap:${r.itemId}:${r.build}`;
    // Schema 1/2 drops (session '') keep their old key, so acks from older uploaders stay valid.
    case 'drops':
      return `drop:${r.itemId}:${r.build}:${r.npcId}${sessionSuffix(r.session)}`;
    case 'corpses':
      return `corpse:${r.npcId}:${r.build}${sessionSuffix(r.session)}`;
    case 'runs':
      return `run:${r.id}`;
    default:
      throw new Error(`unknown record kind ${String(kind)}`);
  }
}

/** JSON with object keys sorted at every level, so equal content always hashes equally. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v ?? null)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** sha256 of the record's stable JSON (hex, first 32 chars). */
export function contentHash(record: unknown): string {
  return createHash('sha256').update(stableStringify(record)).digest('hex').slice(0, 32);
}
