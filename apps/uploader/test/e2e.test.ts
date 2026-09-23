import { normalize } from '@forever-ledger/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toEntries } from '../src/batches.js';
import { runUploadPass } from '../src/pass.js';
import { collectStatus } from '../src/status.js';
import { FAST_READ, loadFixtureDb, readFixture, tempEnv } from './helpers/fixtures.js';
import type { TempEnv } from './helpers/fixtures.js';
import { startMockServer } from './helpers/mockServer.js';
import type { MockServer } from './helpers/mockServer.js';

const CHANGED_RUN = 'run:Thibodeaux-Bayou-36-1790000060';

let env: TempEnv;
let server: MockServer | undefined;
beforeEach(async () => {
  env = await tempEnv();
});
afterEach(async () => {
  await server?.close().catch(() => undefined);
  server = undefined;
  await env.cleanup();
});

const pass = (serverUrl: string) =>
  runUploadPass({ config: env.config({ serverUrl }), read: FAST_READ });

describe('upload-once end to end (mock server implementing the ingest contract)', () => {
  it('uploads everything once, then nothing; survives a server outage; delivers the change exactly once', async () => {
    const fixture = await readFixture('session-v1.lua');
    await env.writeSv(fixture);
    const total = toEntries(normalize(await loadFixtureDb('session-v1.lua')).records).length;

    server = await startMockServer();
    const first = await pass(server.url);
    expect(first.ok).toBe(true);
    expect(first.flush).toMatchObject({ acked: total, pendingBatches: 0, errors: [] });
    expect(server.receivedKeys).toHaveLength(total);
    expect(new Set(server.receivedKeys).size).toBe(total);

    // Same file again: the diff is empty, so nothing is sent at all.
    const requestsAfterFirst = server.ingestRequests;
    const second = await pass(server.url);
    expect(second.ok).toBe(true);
    expect(second.files[0]?.queuedRecords).toBe(0);
    expect(server.ingestRequests).toBe(requestsAfterFirst);

    // Kill the server, then the player finishes another pull (one more death on the first run).
    await server.close();
    const deadUrl = server.url;
    server = undefined;
    const bumped = fixture.replace('["deaths"] = 1,', '["deaths"] = 2,');
    expect(bumped).not.toBe(fixture);
    await env.writeSv(bumped);

    const offline = await pass(deadUrl);
    expect(offline.ok).toBe(false);
    expect(offline.flush?.retryable).toBe(true);
    expect(offline.files[0]).toMatchObject({ queuedRecords: 1, queuedBatches: 1 });
    const [status] = await collectStatus(env.config());
    expect(status).toMatchObject({
      account: 'TESTACCT',
      queuedBatches: 1,
      queuedRecords: 1,
      acked: total,
    });
    expect(status?.lastError?.message).toMatch(/network error/);

    // Still offline, another reload: the change is already queued, no duplicate batch.
    await pass(deadUrl);
    expect((await collectStatus(env.config()))[0]?.queuedBatches).toBe(1);

    // Server back (new port): exactly the changed record arrives, once.
    server = await startMockServer();
    const back = await pass(server.url);
    expect(back.ok).toBe(true);
    expect(server.receivedKeys).toEqual([CHANGED_RUN]);
    expect(server.batches[0]?.records.runs[0]?.deaths).toBe(2);

    const final = await pass(server.url);
    expect(final.ok).toBe(true);
    expect(server.receivedKeys).toEqual([CHANGED_RUN]);
    const [after] = await collectStatus(env.config());
    expect(after).toMatchObject({ queuedBatches: 0, acked: total });
    expect(after?.lastError).toBeUndefined();
    expect(after?.lastSuccessAt).toBeTypeOf('number');
  });

  it('uploads a schema 1 file, then only the turn-in that gained a choice after the addon update', async () => {
    await env.writeSv(await readFixture('session-v1.lua'));
    const total = toEntries(normalize(await loadFixtureDb('session-v1.lua')).records).length;
    server = await startMockServer();
    const first = await pass(server.url);
    expect(first.ok).toBe(true);
    expect(first.flush).toMatchObject({ acked: total, pendingBatches: 0, errors: [] });
    expect(server.batches.map((b) => b.schemaVersion)).toEqual(server.batches.map(() => 1));

    // Addon 0.2.3 writes the same play as schema 2: the turn-in now carries the chosen reward.
    await env.writeSv(await readFixture('session-v2.lua'));
    const sent = server.batches.length;
    const second = await pass(server.url);
    expect(second.ok).toBe(true);
    expect(server.receivedKeys.slice(total)).toEqual(['turnin:Thibodeaux-Bayou-1234-1790001080']);
    const batch = server.batches[sent]!;
    expect(batch.schemaVersion).toBe(2);
    expect(batch.meta.schemaVersion).toBe(2);
    expect(batch.records.turnIns[0]?.choice).toEqual({ index: 1, itemId: 5555 });
  });

  it('schema 3: a new session with the same drop counts is uploaded again, not hidden by the old hash', async () => {
    // Forever starts every /reload with an empty table, so two sessions can hold identical totals.
    const sv = (session: string) =>
      `ForeverLedgerDB = {
	["meta"] = { ["schemaVersion"] = 3, ["addonVersion"] = "0.2.4", ["build"] = 69977, ["session"] = "${session}" },
	["drops"] = { [2589] = { [69977] = { [1234] = 1 } } },
	["dropQty"] = { [2589] = { [69977] = { [1234] = 2 } } },
	["corpses"] = { [69977] = { [1234] = { ["n"] = 1, ["copper"] = 12 } } },
}
`;
    server = await startMockServer();
    await env.writeSv(sv('1790000000-aaaa'));
    expect((await pass(server.url)).ok).toBe(true);
    await env.writeSv(sv('1790000600-bbbb'));
    expect((await pass(server.url)).ok).toBe(true);
    expect(server.receivedKeys).toEqual([
      'drop:2589:69977:1234:1790000000-aaaa',
      'corpse:1234:69977:1790000000-aaaa',
      'drop:2589:69977:1234:1790000600-bbbb',
      'corpse:1234:69977:1790000600-bbbb',
    ]);
    expect(server.batches.map((b) => b.schemaVersion)).toEqual([3, 3]);
    expect(server.batches[1]?.records.drops[0]).toEqual({
      itemId: 2589,
      build: 69977,
      npcId: 1234,
      session: '1790000600-bbbb',
      count: 1,
      quantity: 2,
    });
    // The same session again: nothing new.
    const requests = server.ingestRequests;
    expect((await pass(server.url)).ok).toBe(true);
    expect(server.ingestRequests).toBe(requests);
  });

  it('bad token → 401 stops the pass with a clear message', async () => {
    await env.writeSv(await readFixture('session-v1.lua'));
    server = await startMockServer({ token: 'another-token' });
    const res = await pass(server.url);
    expect(res.fatal?.code).toBe('unauthorized');
    expect(server.ingestRequests).toBe(1);
  });

  it('413 from a real body limit → split until it fits', async () => {
    await env.writeSv(await readFixture('session-v1.lua'));
    server = await startMockServer({ bodyLimit: 3_000 });
    const res = await pass(server.url);
    expect(res.ok).toBe(true);
    expect(res.flush?.split).toBeGreaterThan(0);
    const total = toEntries(normalize(await loadFixtureDb('session-v1.lua')).records).length;
    expect(new Set(server.receivedKeys).size).toBe(total);
    expect(server.receivedKeys).toHaveLength(total);
  });
});
