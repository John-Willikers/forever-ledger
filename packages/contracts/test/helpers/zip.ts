import { createHash } from 'node:crypto';
import { strToU8, zipSync } from 'fflate';

export const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

const bytes = (v: string | Uint8Array) => (typeof v === 'string' ? strToU8(v) : v);

/** A well-formed zip built by fflate. `level: 0` stores entries uncompressed. */
export const zip = (entries: Record<string, string | Uint8Array>, level: 0 | 6 = 6) =>
  zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, bytes(v)])), { level });

export interface RawEntry {
  name: string;
  /** Bytes written after the local header (already compressed when `method` is 8). */
  data?: string | Uint8Array;
  /** Compression method in the central directory (0 stored, 8 deflate, anything else). */
  method?: number;
  /** Central-directory compressed size; defaults to the data length. */
  size?: number;
  /** Central-directory uncompressed size; defaults to the data length. */
  originalSize?: number;
  /** Reuse the local record of the entry at this index instead of writing one (overlapping entries). */
  at?: number;
}

/** Hand-built zip whose central directory can lie about sizes, methods and offsets. */
export function rawZip(entries: RawEntry[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let off = 0;
  const push = (c: Uint8Array) => {
    chunks.push(c);
    off += c.length;
  };

  const records = entries.map((e) => {
    const name = strToU8(e.name);
    const data = bytes(e.data ?? '');
    return {
      name,
      data,
      method: e.method ?? 0,
      size: e.size ?? data.length,
      originalSize: e.originalSize ?? data.length,
    };
  });

  records.forEach((r, i) => {
    const target = entries[i]?.at;
    if (target !== undefined) {
      offsets.push(offsets[target] ?? 0);
      return;
    }
    offsets.push(off);
    const h = new Uint8Array(30 + r.name.length);
    const v = new DataView(h.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x800, true); // UTF-8 names
    v.setUint16(8, r.method, true);
    v.setUint32(18, r.size, true);
    v.setUint32(22, r.originalSize, true);
    v.setUint16(26, r.name.length, true);
    h.set(r.name, 30);
    push(h);
    push(r.data);
  });

  const cdStart = off;
  records.forEach((r, i) => {
    const h = new Uint8Array(46 + r.name.length);
    const v = new DataView(h.buffer);
    v.setUint32(0, 0x02014b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 20, true);
    v.setUint16(8, 0x800, true); // UTF-8 names
    v.setUint16(10, r.method, true);
    v.setUint32(20, r.size, true);
    v.setUint32(24, r.originalSize, true);
    v.setUint16(28, r.name.length, true);
    v.setUint32(42, offsets[i] ?? 0, true);
    h.set(r.name, 46);
    push(h);
  });

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, records.length, true);
  ev.setUint16(10, records.length, true);
  ev.setUint32(12, off - cdStart, true);
  ev.setUint32(16, cdStart, true);
  push(eocd);

  const out = new Uint8Array(off);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}
