import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { RecordKind, UploadBatch } from '@forever-ledger/contracts';
import { toEntries } from './batches.js';
import { isNotFound, writeJsonAtomic } from './fsutil.js';

export interface QueuedEntry {
  kind: RecordKind;
  key: string;
  hash: string;
}

/** One pending batch on disk: `stateDir/queue/<account>/<id>.json`. */
export interface QueuedBatch {
  version: 1;
  id: string;
  account: string;
  createdAt: number;
  /** Key/hash of every record in `batch`, so re-diffing does not need to rehash the queue. */
  entries: QueuedEntry[];
  batch: UploadBatch;
}

export interface RejectedBatch extends Partial<QueuedBatch> {
  rejected: { at: number; status?: number; message: string };
}

let seq = 0;

/** Sortable id: fixed-width epoch ms + in-process sequence, so lexical order = enqueue order. */
function newId(now: number): string {
  seq = (seq + 1) % 1_000_000;
  return `${String(now).padStart(13, '0')}-${String(seq).padStart(6, '0')}-${randomBytes(3).toString('hex')}`;
}

const dirName = (account: string) => encodeURIComponent(account);

/**
 * File-per-batch offline queue. Batches are flushed oldest-first; a batch file is only deleted after
 * the server acknowledged it (or it was moved to `rejected/`).
 */
export class Queue {
  readonly root: string;
  readonly rejectedRoot: string;

  constructor(stateDir: string) {
    this.root = join(stateDir, 'queue');
    this.rejectedRoot = join(stateDir, 'rejected');
  }

  private dir(account: string) {
    return join(this.root, dirName(account));
  }

  private async names(dir: string): Promise<string[]> {
    try {
      return (await readdir(dir)).filter((n) => n.endsWith('.json')).sort();
    } catch (err) {
      if (isNotFound(err)) return [];
      throw err;
    }
  }

  /** Accounts that have a queue folder (possibly empty). */
  async accounts(): Promise<string[]> {
    try {
      const dirs = await readdir(this.root, { withFileTypes: true });
      return dirs
        .filter((d) => d.isDirectory())
        .map((d) => decodeURIComponent(d.name))
        .sort();
    } catch (err) {
      if (isNotFound(err)) return [];
      throw err;
    }
  }

  /** Pending batch ids, oldest first. */
  async list(account: string): Promise<string[]> {
    return (await this.names(this.dir(account))).map((n) => n.slice(0, -'.json'.length));
  }

  async read(account: string, id: string): Promise<QueuedBatch> {
    const text = await readFile(join(this.dir(account), `${id}.json`), 'utf8');
    return JSON.parse(text) as QueuedBatch;
  }

  async enqueue(account: string, batch: UploadBatch, now = Date.now()): Promise<QueuedBatch> {
    return this.write(account, newId(now), batch, now);
  }

  private async write(account: string, id: string, batch: UploadBatch, now: number) {
    const entries = toEntries(batch.records).map(({ kind, key, hash }) => ({ kind, key, hash }));
    const qb: QueuedBatch = { version: 1, id, account, createdAt: now, entries, batch };
    await writeJsonAtomic(join(this.dir(account), `${id}.json`), qb, { pretty: false });
    return qb;
  }

  async remove(account: string, id: string): Promise<void> {
    await rm(join(this.dir(account), `${id}.json`), { force: true });
  }

  /**
   * Replaces one batch with several smaller ones that keep its place in the queue
   * (`<id>.1`, `<id>.2` sort right after `<id>` and before anything newer).
   */
  async replace(account: string, id: string, parts: UploadBatch[]): Promise<void> {
    const old = await this.read(account, id);
    for (const [i, part] of parts.entries())
      await this.write(account, `${id}.${i + 1}`, part, old.createdAt);
    await this.remove(account, id);
  }

  /** Moves a batch the server will never accept to `rejected/<account>/`, with the reason. */
  async reject(
    account: string,
    id: string,
    reason: { status?: number; message: string },
    now = Date.now(),
  ): Promise<void> {
    let body: Partial<QueuedBatch>;
    try {
      body = await this.read(account, id);
    } catch (err) {
      if (isNotFound(err)) return;
      // Unreadable batch: keep the raw text for inspection.
      const raw = await readFile(join(this.dir(account), `${id}.json`), 'utf8').catch(() => '');
      body = { id, account, raw } as Partial<QueuedBatch>;
    }
    const out: RejectedBatch = { ...body, rejected: { at: now, ...reason } };
    await mkdir(join(this.rejectedRoot, dirName(account)), { recursive: true });
    await writeJsonAtomic(join(this.rejectedRoot, dirName(account), `${id}.json`), out);
    await this.remove(account, id);
  }

  /** key → hash of every record waiting in the queue (newer batches win). */
  async pendingHashes(account: string): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const id of await this.list(account)) {
      let qb: QueuedBatch;
      try {
        qb = await this.read(account, id);
      } catch {
        continue; // flush will move it to rejected/
      }
      for (const e of qb.entries) out.set(e.key, e.hash);
    }
    return out;
  }

  async stats(account: string): Promise<{ batches: number; records: number }> {
    let records = 0;
    const ids = await this.list(account);
    for (const id of ids) {
      try {
        records += (await this.read(account, id)).entries.length;
      } catch {
        // counted as a batch, records unknown
      }
    }
    return { batches: ids.length, records };
  }

  async rejectedCount(account: string): Promise<number> {
    return (await this.names(join(this.rejectedRoot, dirName(account)))).length;
  }
}
