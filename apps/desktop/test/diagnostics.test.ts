import type { DiagnosticsReport } from '@forever-ledger/contracts';
import { silentLogger } from '@forever-ledger/uploader/lib';
import type { FetchLike } from '@forever-ledger/uploader/lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiagnosticsReporter } from '../src/main/diagnostics.js';
import type { ReporterDeps } from '../src/main/diagnostics.js';

const T0 = 1_790_000_000_000;
const TARGET = { serverUrl: 'https://ledger.example', token: 'flt_secret', uploaderId: 'pc-1' };

type Reply = { status: number; body?: unknown } | 'network-error';

function setup(over: Partial<ReporterDeps> = {}) {
  let now = T0;
  let enabled = true;
  let target: typeof TARGET | undefined = TARGET;
  const replies: Reply[] = [];
  const sent: DiagnosticsReport[] = [];
  const headers: Record<string, string>[] = [];
  const fetchImpl = vi.fn<FetchLike>(async (_url, init) => {
    sent.push(JSON.parse(String(init?.body)) as DiagnosticsReport);
    headers.push(init?.headers as Record<string, string>);
    const r = replies.shift() ?? { status: 200 };
    if (r === 'network-error') throw new TypeError('fetch failed');
    const body =
      r.body ?? (r.status === 200 ? { accepted: sent.at(-1)?.events.length } : { error: 'x' });
    return new Response(JSON.stringify(body), { status: r.status });
  });
  const changes = vi.fn();
  const reporter = new DiagnosticsReporter({
    appVersion: '0.1.4',
    platform: 'win32 10.0.22631',
    target: () => target,
    enabled: () => enabled,
    logger: silentLogger(),
    now: () => now,
    fetchImpl,
    onChange: changes,
    sanitize: { home: 'C:\\Users\\Bob', platform: 'win32' },
    ...over,
  });
  return {
    reporter,
    fetchImpl,
    sent,
    headers,
    replies,
    changes,
    advance: async (ms: number) => {
      now += ms;
      await vi.advanceTimersByTimeAsync(ms);
    },
    setEnabled: (v: boolean) => (enabled = v),
    setTarget: (t: typeof TARGET | undefined) => (target = t),
  };
}

const FIVE_MIN = 5 * 60_000;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('DiagnosticsReporter', () => {
  it('sends new events every 5 minutes, sanitized, with the report header', async () => {
    const t = setup();
    t.reporter.start();
    t.reporter.record({
      level: 'error',
      source: 'parse',
      message: 'could not parse C:\\Users\\Bob\\WoW\\ForeverLedger.lua: bad token flt_abc',
      detail: { file: 'c:/users/bob/WoW/x.lua' },
    });
    expect(t.reporter.status()).toEqual({ enabled: true, pending: 1 });
    await t.advance(FIVE_MIN - 1);
    expect(t.fetchImpl).not.toHaveBeenCalled();
    await t.advance(1);
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]).toEqual({
      uploaderId: 'pc-1',
      appVersion: '0.1.4',
      platform: 'win32 10.0.22631',
      events: [
        {
          at: T0 / 1000,
          level: 'error',
          source: 'parse',
          message: 'could not parse ~\\WoW\\ForeverLedger.lua: bad token flt_***',
          detail: { file: '~/WoW/x.lua' },
        },
      ],
    });
    expect(t.headers[0]?.authorization).toBe('Bearer flt_secret');
    expect(t.reporter.status()).toEqual({ enabled: true, pending: 0, lastSentAt: T0 + FIVE_MIN });
    expect(t.changes).toHaveBeenCalled();

    // Nothing new: nothing sent.
    await t.advance(FIVE_MIN);
    expect(t.sent).toHaveLength(1);
    t.reporter.stop();
  });

  it('merges identical messages (numbers aside) and counts them in detail', async () => {
    const t = setup();
    t.reporter.start();
    t.reporter.record({ level: 'warn', source: 'uploader', message: 'retry #1 in 5s' });
    await t.advance(1000);
    t.reporter.record({ level: 'warn', source: 'uploader', message: 'retry #2 in 10s' });
    t.reporter.record({ level: 'warn', source: 'uploader', message: 'retry #3 in 20s' });
    t.reporter.record({ level: 'error', source: 'uploader', message: 'retry #3 in 20s' });
    expect(t.reporter.status().pending).toBe(2);
    await t.advance(FIVE_MIN);
    expect(t.sent[0]?.events).toEqual([
      {
        at: T0 / 1000,
        level: 'warn',
        source: 'uploader',
        message: 'retry #1 in 5s',
        detail: { count: 3, lastAt: T0 / 1000 + 1 },
      },
      { at: T0 / 1000 + 1, level: 'error', source: 'uploader', message: 'retry #3 in 20s' },
    ]);
    t.reporter.stop();
  });

  it('keeps the latest detail next to the count; wraps a non-object detail', async () => {
    const t = setup();
    t.reporter.start();
    t.reporter.record({ level: 'error', source: 'tray', message: 'a', detail: { code: 7 } });
    t.reporter.record({ level: 'error', source: 'tray', message: 'a', detail: { code: 8 } });
    t.reporter.record({ level: 'error', source: 'tray', message: 'b', detail: ['x'] });
    t.reporter.record({ level: 'error', source: 'tray', message: 'b', detail: ['y'] });
    await t.advance(FIVE_MIN);
    expect(t.sent[0]?.events.map((e) => e.detail)).toEqual([
      { code: 8, count: 2, lastAt: T0 / 1000 },
      { detail: ['y'], count: 2, lastAt: T0 / 1000 },
    ]);
    t.reporter.stop();
  });

  it('sends at most 50 events per report; the rest go next cycle', async () => {
    const t = setup();
    t.reporter.start();
    for (let i = 0; i < 60; i++)
      t.reporter.record({ level: 'warn', source: 'tray', message: `problem ${'x'.repeat(i)}` });
    await t.advance(FIVE_MIN);
    expect(t.sent[0]?.events).toHaveLength(50);
    expect(t.reporter.status().pending).toBe(10);
    await t.advance(FIVE_MIN);
    expect(t.sent[1]?.events).toHaveLength(10);
    expect(t.sent[1]?.events[0]?.message).toBe(`problem ${'x'.repeat(50)}`);
    t.reporter.stop();
  });

  it('sends 10 s after a fatal event, once for a burst', async () => {
    const t = setup();
    t.reporter.start();
    t.reporter.record({ level: 'fatal', source: 'uploader', message: 'token rejected' });
    await t.advance(5_000);
    t.reporter.record({ level: 'error', source: 'tray', message: 'something else' });
    t.reporter.record({ level: 'fatal', source: 'tray', message: 'another fatal' });
    await t.advance(4_999);
    expect(t.fetchImpl).not.toHaveBeenCalled();
    await t.advance(1);
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]?.events.map((e) => e.message)).toEqual([
      'token rejected',
      'something else',
      'another fatal',
    ]);
    t.reporter.stop();
  });

  it('keeps events after a failed send and retries next cycle', async () => {
    const t = setup();
    t.reporter.start();
    t.replies.push('network-error', { status: 503 });
    t.reporter.record({ level: 'error', source: 'uploader', message: 'first' });
    await t.advance(FIVE_MIN);
    expect(t.sent).toHaveLength(1);
    expect(t.reporter.status()).toEqual({ enabled: true, pending: 1 });
    t.reporter.record({ level: 'error', source: 'uploader', message: 'first' });
    t.reporter.record({ level: 'error', source: 'uploader', message: 'second' });
    await t.advance(FIVE_MIN);
    expect(t.sent).toHaveLength(2);
    await t.advance(FIVE_MIN);
    expect(t.sent).toHaveLength(3);
    // The failed attempts' events are merged with what came later, oldest first.
    expect(t.sent[2]?.events).toEqual([
      expect.objectContaining({ message: 'first', detail: { count: 2, lastAt: T0 / 1000 + 300 } }),
      expect.objectContaining({ message: 'second' }),
    ]);
    expect(t.reporter.status().pending).toBe(0);
    t.reporter.stop();
  });

  it('keeps at most 200 events while it cannot send, dropping the oldest', async () => {
    const t = setup();
    t.setTarget(undefined);
    t.reporter.start();
    for (let i = 0; i < 250; i++)
      t.reporter.record({ level: 'warn', source: 'tray', message: `p${'x'.repeat(i)}` });
    expect(t.reporter.status().pending).toBe(200);
    await t.advance(FIVE_MIN);
    // Never sends without a token.
    expect(t.fetchImpl).not.toHaveBeenCalled();
    t.setTarget(TARGET);
    await t.advance(FIVE_MIN);
    expect(t.sent[0]?.events[0]?.message).toBe(`p${'x'.repeat(50)}`);
    t.reporter.stop();
  });

  it('drops a report the server refuses (400)', async () => {
    const t = setup();
    t.reporter.start();
    t.replies.push({ status: 400, body: { error: 'invalid DiagnosticsReport' } });
    t.reporter.record({ level: 'error', source: 'tray', message: 'x' });
    await t.advance(FIVE_MIN);
    expect(t.reporter.status().pending).toBe(0);
    expect(t.reporter.status().lastSentAt).toBeUndefined();
    t.reporter.stop();
  });

  it('collects and sends nothing while turned off, and forgets what was pending', async () => {
    const t = setup();
    t.reporter.start();
    t.reporter.record({ level: 'error', source: 'tray', message: 'before' });
    t.setEnabled(false);
    t.reporter.record({ level: 'fatal', source: 'tray', message: 'while off' });
    await t.advance(FIVE_MIN);
    expect(t.fetchImpl).not.toHaveBeenCalled();
    expect(t.reporter.status()).toEqual({ enabled: false, pending: 0 });
    t.reporter.stop();
  });

  it('does not report the same problem twice when it is also logged', async () => {
    const t = setup();
    t.reporter.start();
    // Logged first, then reported with its structure (pass.ts logs a parse error before the pass ends).
    t.reporter.noteLogLine({
      level: 'error',
      text: 'could not parse C:\\\\Users\\\\Bob\\\\x.lua: unexpected "}" account=ACC file="C:\\\\Users\\\\Bob\\\\x.lua"',
    });
    t.reporter.record({
      level: 'error',
      source: 'parse',
      message: 'could not parse C:\\Users\\Bob\\x.lua: unexpected "}"',
    });
    // Reported first, then logged (the controller logs after recording).
    t.reporter.record(
      { level: 'error', source: 'addon-sync', message: 'addon sync failed: getaddrinfo ENOTFOUND' },
      'getaddrinfo ENOTFOUND',
    );
    t.reporter.noteLogLine({
      level: 'warn',
      text: 'addon sync failed (retry #1 soon) status=error err="getaddrinfo ENOTFOUND"',
    });
    // An unrelated log line is kept; a line logged by an uploader child logger is the uploader's.
    t.reporter.noteLogLine({ level: 'warn', text: 'cannot save prefs file=x' });
    t.reporter.noteLogLine({ level: 'warn', text: 'upload failed, will retry account=ACC' });
    await t.advance(FIVE_MIN);
    expect(t.sent[0]?.events.map((e) => [e.source, e.message])).toEqual([
      ['parse', 'could not parse ~\\x.lua: unexpected "}"'],
      ['addon-sync', 'addon sync failed: getaddrinfo ENOTFOUND'],
      ['tray', 'cannot save prefs file=x'],
      ['uploader', 'upload failed, will retry account=ACC'],
    ]);
    // Much later the same log line counts again.
    await t.advance(10 * 60_000);
    t.reporter.noteLogLine({
      level: 'warn',
      text: 'addon sync failed (retry #4 soon) status=error err="getaddrinfo ENOTFOUND"',
    });
    expect(t.reporter.status().pending).toBe(1);
    t.reporter.stop();
  });

  it('recognizes a logged duplicate even deep inside a long log line', async () => {
    const t = setup();
    t.reporter.noteLogLine({
      level: 'warn',
      text: `something long ${'x'.repeat(600)} err="HTTP 502 Bad Gateway"`,
    });
    expect(t.reporter.status().pending).toBe(1);
    t.reporter.record(
      { level: 'error', source: 'addon-sync', message: 'addon sync failed: HTTP 502 Bad Gateway' },
      'HTTP 502 Bad Gateway',
    );
    expect(t.reporter.status().pending).toBe(1);
    await t.reporter.flush();
    expect(t.sent[0]?.events.map((e) => e.source)).toEqual(['addon-sync']);
  });
});
