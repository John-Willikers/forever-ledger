import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { contentHash, RECORD_KINDS, recordKey } from '@forever-ledger/contracts';
import type { UploadBatch } from '@forever-ledger/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FetchLike } from '../src/client.js';
import { FatalUploadError } from '../src/errors.js';
import { runUploadPass } from '../src/pass.js';
import { Queue } from '../src/queue.js';
import { StateStore } from '../src/state.js';
import { FAST_READ, readFixture, tempEnv } from './helpers/fixtures.js';
import type { TempEnv } from './helpers/fixtures.js';

type Reply = { status: number; body?: unknown } | 'network-error' | 'ack';

/** fetch stub: `script(n, batch)` decides each reply; 'ack' acknowledges every record like the server. */
function stubFetch(script: (n: number, batch: UploadBatch) => Reply) {
  const calls: UploadBatch[] = [];
  const fetchImpl: FetchLike = async (_url, init) => {
    const batch = JSON.parse(String(init?.body)) as UploadBatch;
    calls.push(batch);
    const reply = script(calls.length, batch);
    if (reply === 'network-error') throw new TypeError('fetch failed');
    if (reply === 'ack') {
      const acknowledged = RECORD_KINDS.flatMap((kind) =>
        batch.records[kind].map((r) => ({
          key: recordKey(kind, r as never),
          hash: contentHash(r),
        })),
      );
      return Response.json({ batchId: calls.length, acknowledged });
    }
    return Response.json(reply.body ?? { error: `status ${reply.status}` }, {
      status: reply.status,
    });
  };
  return { fetchImpl, calls };
}

const recordCount = (b: UploadBatch) => RECORD_KINDS.reduce((n, k) => n + b.records[k].length, 0);

let env: TempEnv;
beforeEach(async () => {
  env = await tempEnv();
  await env.writeSv(await readFixture('session-v1.lua'));
});
afterEach(() => env.cleanup());

const pass = (fetchImpl: FetchLike, extra: Partial<Parameters<typeof runUploadPass>[0]> = {}) =>
  runUploadPass({
    config: env.config({ serverUrl: 'http://ledger.test' }),
    fetchImpl,
    read: FAST_READ,
    ...extra,
  });

async function queueState() {
  const cfg = env.config();
  const q = new Queue(cfg.stateDir);
  const state = await StateStore.open(cfg.stateDir);
  return {
    queued: await q.stats('TESTACCT'),
    rejected: await q.rejectedCount('TESTACCT'),
    acked: Object.keys(state.peek('TESTACCT')?.acked ?? {}).length,
    account: state.peek('TESTACCT'),
  };
}

describe('offline queue', () => {
  it('500 → batch stays queued, nothing acked', async () => {
    const { fetchImpl, calls } = stubFetch(() => ({ status: 500 }));
    const res = await pass(fetchImpl);
    expect(res.ok).toBe(false);
    expect(res.flush?.retryable).toBe(true);
    expect(calls).toHaveLength(1);
    const s = await queueState();
    expect(s.queued.batches).toBe(1);
    expect(s.queued.records).toBe(recordCount(calls[0]!));
    expect(s.acked).toBe(0);
    expect(s.account?.lastError?.message).toMatch(/500/);
  });

  it('batches persist across a restart and are sent before new ones, acked only on 2xx', async () => {
    const offline = stubFetch(() => 'network-error');
    await pass(offline.fetchImpl, { chunk: { maxRecords: 5 } });
    const before = await queueState();
    expect(before.queued.batches).toBeGreaterThan(1);
    expect(before.acked).toBe(0);

    // "Restart": fresh StateStore/Queue objects read everything back from disk.
    const online = stubFetch(() => 'ack');
    const res = await pass(online.fetchImpl, { chunk: { maxRecords: 5 } });
    expect(res.ok).toBe(true);
    expect(res.files[0]?.queuedRecords).toBe(0); // nothing re-queued: already pending
    expect(online.calls).toHaveLength(before.queued.batches);
    const sentKeys = online.calls.flatMap((b) =>
      RECORD_KINDS.flatMap((k) => b.records[k].map((r) => recordKey(k, r as never))),
    );
    expect(new Set(sentKeys).size).toBe(sentKeys.length);
    const after = await queueState();
    expect(after.queued.batches).toBe(0);
    expect(after.acked).toBe(before.queued.records);
    expect(after.account?.lastSuccessAt).toBeTypeOf('number');
    expect(after.account?.lastError).toBeUndefined();
  });

  it('re-diffing while batches are queued does not duplicate them', async () => {
    const offline = stubFetch(() => 'network-error');
    await pass(offline.fetchImpl);
    await pass(offline.fetchImpl);
    await pass(offline.fetchImpl);
    const s = await queueState();
    expect(s.queued.batches).toBe(1);
  });

  it('marks acked only what the server acknowledged', async () => {
    const { fetchImpl } = stubFetch((_n, batch) => ({
      status: 200,
      body: {
        batchId: 1,
        acknowledged: [{ key: recordKey('characters', batch.records.characters[0]!), hash: 'x' }],
      },
    }));
    await pass(fetchImpl);
    const s = await queueState();
    expect(s.acked).toBe(1);
    expect(s.queued.batches).toBe(0);
    // Unacked records are picked up again by the next diff.
    const again = await pass(stubFetch(() => 'ack').fetchImpl);
    expect(again.files[0]?.queuedRecords).toBeGreaterThan(1);
  });

  it('413 → splits the batch in half and retries', async () => {
    const { fetchImpl, calls } = stubFetch((_n, batch) =>
      recordCount(batch) > 4 ? { status: 413 } : 'ack',
    );
    const res = await pass(fetchImpl);
    expect(res.ok).toBe(true);
    expect(res.flush?.split).toBeGreaterThan(0);
    const acceptedRecords = calls
      .filter((b) => recordCount(b) <= 4)
      .reduce((n, b) => n + recordCount(b), 0);
    expect(acceptedRecords).toBe(recordCount(calls[0]!));
    expect((await queueState()).acked).toBe(recordCount(calls[0]!));
  });

  it('400 → bisects to the bad record, moves only it to rejected/, does not re-queue it', async () => {
    const poison = 'run:Thibodeaux-Bayou-36-1790000060';
    const hasPoison = (b: UploadBatch) =>
      b.records.runs.some((r) => recordKey('runs', r) === poison);
    const { fetchImpl } = stubFetch((_n, b) =>
      hasPoison(b) ? { status: 400, body: { message: 'bad run' } } : 'ack',
    );
    const res = await pass(fetchImpl);
    const total = res.files[0]!.records;
    expect(res.ok).toBe(false);
    expect(res.flush?.rejected).toBe(1);
    expect(res.flush?.split).toBeGreaterThan(0);
    const s = await queueState();
    expect(s.rejected).toBe(1);
    expect(s.queued.batches).toBe(0);
    expect(s.acked).toBe(total - 1);
    expect(s.account?.rejected).toEqual({ [poison]: expect.any(String) });

    const dir = join(env.config().stateDir, 'rejected', 'TESTACCT');
    const [file] = await readdir(dir);
    const rejected = JSON.parse(await readFile(join(dir, file!), 'utf8')) as {
      entries: { key: string }[];
      rejected: { status: number; message: string };
    };
    expect(rejected.rejected).toMatchObject({ status: 400, message: '400 bad run' });
    expect(rejected.entries.map((e) => e.key)).toEqual([poison]);

    // Same content again: not re-queued. Changed content: tried again.
    const again = await pass(stubFetch(() => 'ack').fetchImpl);
    expect(again.files[0]?.queuedRecords).toBe(0);
    await env.writeSv(
      (await readFixture('session-v1.lua')).replace('["deaths"] = 1,', '["deaths"] = 2,'),
    );
    const fixed = await pass(stubFetch(() => 'ack').fetchImpl);
    expect(fixed.ok).toBe(true);
    expect(fixed.files[0]?.queuedRecords).toBe(1);
    expect((await queueState()).account?.rejected).toEqual({});
  });

  it('401 → stops with a clear error and keeps the queue', async () => {
    const { fetchImpl, calls } = stubFetch(() => ({ status: 401 }));
    const res = await pass(fetchImpl, { chunk: { maxRecords: 5 } });
    expect(res.ok).toBe(false);
    expect(res.fatal).toBeInstanceOf(FatalUploadError);
    expect(res.fatal?.code).toBe('unauthorized');
    expect(res.fatal?.message).toMatch(/token/);
    expect(calls).toHaveLength(1);
    expect((await queueState()).queued.batches).toBeGreaterThan(1);
  });

  it('409 → stops and tells the user to update', async () => {
    const { fetchImpl } = stubFetch(() => ({ status: 409 }));
    const res = await pass(fetchImpl);
    expect(res.fatal?.code).toBe('unsupported-schema');
    expect(res.fatal?.message).toMatch(/Update the Forever Ledger uploader/);
    expect((await queueState()).queued.batches).toBe(1);
  });

  it('writes queue files atomically (no temp files left behind)', async () => {
    await pass(stubFetch(() => 'network-error').fetchImpl, { chunk: { maxRecords: 3 } });
    const files = await readdir(join(env.config().stateDir, 'queue', 'TESTACCT'));
    expect(files.length).toBeGreaterThan(1);
    expect(files.every((f) => f.endsWith('.json'))).toBe(true);
    expect((await readdir(env.config().stateDir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});
