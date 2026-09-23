import { writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startWatch } from '../src/watch.js';
import type { WatchHandle } from '../src/watch.js';
import { FAST_READ, readFixture, tempEnv } from './helpers/fixtures.js';
import type { TempEnv } from './helpers/fixtures.js';
import { startMockServer } from './helpers/mockServer.js';
import type { MockServer } from './helpers/mockServer.js';

let env: TempEnv;
let server: MockServer | undefined;
let handle: WatchHandle | undefined;
beforeEach(async () => {
  env = await tempEnv();
});
afterEach(async () => {
  await handle?.close();
  await server?.close().catch(() => undefined);
  handle = undefined;
  server = undefined;
  await env.cleanup();
});

const fast = {
  read: FAST_READ,
  tickMs: 20,
  awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 },
  backoff: { baseMs: 20, capMs: 100 },
};

describe('watch', () => {
  it('uploads on start, re-uploads only what changed after WoW rewrites the file', async () => {
    const fixture = await readFixture('session-v1.lua');
    const file = await env.writeSv(fixture);
    server = await startMockServer();
    handle = await startWatch({ config: env.config({ serverUrl: server.url }), ...fast });
    expect(handle.watchedFiles()).toHaveLength(1);

    await vi.waitFor(() => expect(server?.receivedKeys.length).toBeGreaterThan(0), {
      timeout: 5_000,
    });
    await handle.idle();
    const initial = server.receivedKeys.length;

    await writeFile(file, fixture.replace('["deaths"] = 1,', '["deaths"] = 3,'));
    await vi.waitFor(() => expect(server?.receivedKeys.length).toBe(initial + 1), {
      timeout: 5_000,
    });
    expect(server.receivedKeys.at(-1)).toBe('run:Thibodeaux-Bayou-36-1790000060');
  });

  it('keeps retrying the queue with backoff until the server comes back', async () => {
    await env.writeSv(await readFixture('session-v1.lua'));
    const port = await (async () => {
      const s = await startMockServer();
      await s.close();
      return s.port;
    })();
    handle = await startWatch({
      config: env.config({ serverUrl: `http://127.0.0.1:${port}` }),
      ...fast,
    });
    await handle.idle();
    server = await startMockServer({ port });
    await vi.waitFor(() => expect(server?.receivedKeys.length).toBeGreaterThan(0), {
      timeout: 5_000,
    });
  });

  it('stops with the fatal error on 401', async () => {
    await env.writeSv(await readFixture('session-v1.lua'));
    server = await startMockServer({ token: 'nope' });
    handle = await startWatch({ config: env.config({ serverUrl: server.url }), ...fast });
    const fatal = await handle.done;
    expect(fatal?.code).toBe('unauthorized');
  });
});
