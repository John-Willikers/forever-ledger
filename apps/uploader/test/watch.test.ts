import { writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startWatch } from '../src/watch.js';
import type { WatchEvent, WatchHandle } from '../src/watch.js';
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

  describe('events', () => {
    const recorder = () => {
      const events: WatchEvent[] = [];
      return {
        events,
        onEvent: (e: WatchEvent) => events.push(e),
        types: () => events.map((e) => e.type),
      };
    };

    it('emits pass-start then pass-end with the result for the initial pass', async () => {
      await env.writeSv(await readFixture('session-v1.lua'));
      server = await startMockServer();
      const rec = recorder();
      handle = await startWatch({
        config: env.config({ serverUrl: server.url }),
        ...fast,
        onEvent: rec.onEvent,
      });
      await handle.idle();
      expect(rec.types()).toEqual(['pass-start', 'pass-end']);
      const end = rec.events[1];
      expect(end?.type === 'pass-end' && end.result.ok).toBe(true);
      expect(end?.type === 'pass-end' && end.result.flush?.sent).toBe(1);
    });

    it('emits events around queue retries', async () => {
      await env.writeSv(await readFixture('session-v1.lua'));
      const port = await (async () => {
        const s = await startMockServer();
        await s.close();
        return s.port;
      })();
      const rec = recorder();
      handle = await startWatch({
        config: env.config({ serverUrl: `http://127.0.0.1:${port}` }),
        ...fast,
        onEvent: rec.onEvent,
      });
      await handle.idle();
      server = await startMockServer({ port });
      await vi.waitFor(
        () =>
          expect(
            rec.events.some(
              (e) => e.type === 'pass-end' && e.result.files.length === 0 && e.result.ok,
            ),
          ).toBe(true),
        { timeout: 5_000 },
      );
      await handle.idle();
      // Every pass-start is followed by its pass-end.
      expect(rec.types().join(',')).toMatch(/^(pass-start,pass-end,)*pass-start,pass-end$/);
    });

    it('emits fatal after the pass that hit it', async () => {
      await env.writeSv(await readFixture('session-v1.lua'));
      server = await startMockServer({ token: 'nope' });
      const rec = recorder();
      handle = await startWatch({
        config: env.config({ serverUrl: server.url }),
        ...fast,
        onEvent: rec.onEvent,
      });
      const fatal = await handle.done;
      expect(rec.types()).toEqual(['pass-start', 'pass-end', 'fatal']);
      expect(rec.events[2]).toEqual({ type: 'fatal', error: fatal });
    });

    it('a listener that throws does not stop watching', async () => {
      const fixture = await readFixture('session-v1.lua');
      const file = await env.writeSv(fixture);
      server = await startMockServer();
      let calls = 0;
      handle = await startWatch({
        config: env.config({ serverUrl: server.url }),
        ...fast,
        onEvent: () => {
          calls++;
          throw new Error('listener bug');
        },
      });
      await vi.waitFor(() => expect(server?.receivedKeys.length).toBeGreaterThan(0), {
        timeout: 5_000,
      });
      await handle.idle();
      const initial = server.receivedKeys.length;
      await writeFile(file, fixture.replace('["deaths"] = 1,', '["deaths"] = 3,'));
      await vi.waitFor(() => expect(server?.receivedKeys.length).toBe(initial + 1), {
        timeout: 5_000,
      });
      await handle.idle();
      expect(calls).toBeGreaterThanOrEqual(4);
    });
  });

  describe('trigger', () => {
    it('runs a full pass of every watched file now', async () => {
      const fixture = await readFixture('session-v1.lua');
      const file = await env.writeSv(fixture);
      server = await startMockServer();
      const types: string[] = [];
      handle = await startWatch({
        config: env.config({ serverUrl: server.url }),
        ...fast,
        // Slow enough that the file watcher never reports the rewrite during this test.
        awaitWriteFinish: { stabilityThreshold: 60_000, pollInterval: 100 },
        onEvent: (e) => types.push(e.type),
      });
      await handle.idle();
      const initial = server.receivedKeys.length;
      expect(initial).toBeGreaterThan(0);

      await writeFile(file, fixture.replace('["deaths"] = 1,', '["deaths"] = 3,'));
      handle.trigger();
      await vi.waitFor(() => expect(server?.receivedKeys.length).toBe(initial + 1), {
        timeout: 5_000,
      });
      await handle.idle();
      expect(types).toEqual(['pass-start', 'pass-end', 'pass-start', 'pass-end']);
    });

    it('does nothing after close', async () => {
      await env.writeSv(await readFixture('session-v1.lua'));
      server = await startMockServer();
      const types: string[] = [];
      handle = await startWatch({
        config: env.config({ serverUrl: server.url }),
        ...fast,
        onEvent: (e) => types.push(e.type),
      });
      await handle.idle();
      await handle.close();
      handle.trigger();
      await handle.idle();
      expect(types).toEqual(['pass-start', 'pass-end']);
    });
  });
});
