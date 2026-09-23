import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { RECORD_KINDS } from '@forever-ledger/contracts';
import type { DiagnosticsReport, UploadBatch } from '@forever-ledger/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { postDiagnostics } from '../src/client.js';
import type { FetchLike } from '../src/client.js';
import { sanitize, sanitizeJson, summarizeRejected } from '../src/diagnostics.js';
import * as lib from '../src/lib.js';
import { Queue } from '../src/queue.js';

describe('sanitize', () => {
  it('redacts upload tokens and bearer headers', () => {
    expect(sanitize('token flt_AbC-12_x9 was refused')).toBe('token flt_*** was refused');
    expect(sanitize('authorization: Bearer abc.def ok')).toBe('authorization: Bearer *** ok');
    expect(sanitize('Bearer flt_secret')).toBe('Bearer ***');
    expect(sanitize('two: flt_a and flt_b')).toBe('two: flt_*** and flt_***');
  });

  it('replaces the Windows home folder in either slash style, any case', () => {
    const opts = { home: 'C:\\Users\\Bob', platform: 'win32' as const };
    expect(sanitize('could not parse C:\\Users\\Bob\\WTF\\x.lua', opts)).toBe(
      'could not parse ~\\WTF\\x.lua',
    );
    expect(sanitize('at c:/users/BOB/AppData/log', opts)).toBe('at ~/AppData/log');
    // JSON-escaped, as in a log line's key=value field.
    expect(sanitize('file="C:\\\\Users\\\\Bob\\\\a.lua"', opts)).toBe('file="~\\\\a.lua"');
    // Another user whose name starts the same is left alone.
    expect(sanitize('C:\\Users\\Bobby\\x', opts)).toBe('C:\\Users\\Bobby\\x');
  });

  it('replaces a POSIX home folder case-sensitively', () => {
    const opts = { home: '/home/bob', platform: 'linux' as const };
    expect(sanitize('/home/bob/.config/x and /home/bob', opts)).toBe('~/.config/x and ~');
    expect(sanitize('/HOME/BOB/x', opts)).toBe('/HOME/BOB/x');
  });

  it('uses os.homedir() by default', () => {
    expect(sanitize(`${homedir()}/x`)).toBe('~/x');
  });

  it('caps the length', () => {
    expect(sanitize('x'.repeat(600))).toHaveLength(500);
    expect(sanitize('x'.repeat(600)).endsWith('…')).toBe(true);
    expect(sanitize('abcdef', { max: 4 })).toBe('abc…');
    expect(sanitize('abc', { max: 4 })).toBe('abc');
  });
});

describe('sanitizeJson', () => {
  const opts = { home: '/home/bob', platform: 'linux' as const };

  it('sanitizes every string and key, and drops what JSON cannot hold', () => {
    const out = sanitizeJson(
      {
        file: '/home/bob/wow/x.lua',
        list: ['flt_secret', 3, true, null, undefined],
        ['/home/bob/key']: 1,
        fn: () => 1,
        err: new Error('boom at /home/bob/y'),
      },
      opts,
    );
    expect(out).toEqual({
      file: '~/wow/x.lua',
      list: ['flt_***', 3, true, null, null],
      '~/key': 1,
      err: { name: 'Error', message: 'boom at ~/y' },
    });
  });

  it('keeps the result under the byte limit', () => {
    const big = { lines: Array.from({ length: 200 }, (_, i) => `line ${i} ${'x'.repeat(40)}`) };
    const out = sanitizeJson(big, { ...opts, maxBytes: 1024 }) as Record<string, unknown>;
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(1024);
    expect(out.truncated).toBe(true);
    expect(typeof out.preview).toBe('string');
  });

  it('cuts deep nesting and long strings', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: { h: { i: 1 } } } } } } } } };
    expect(JSON.stringify(sanitizeJson(deep, opts))).toContain('"…"');
    const long = sanitizeJson({ s: 'y'.repeat(5000) }, opts) as { s: string };
    expect(long.s.length).toBeLessThanOrEqual(1000);
  });
});

describe('postDiagnostics', () => {
  const report: DiagnosticsReport = {
    uploaderId: 'pc-1',
    appVersion: '0.1.4',
    platform: 'win32 10.0.22631',
    events: [{ at: 1_790_000_000, level: 'error', source: 'uploader', message: 'boom' }],
  };
  const reply =
    (status: number, body: unknown): FetchLike =>
    async () =>
      new Response(JSON.stringify(body), { status });

  it('posts the report with the bearer token', async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    const fetchImpl: FetchLike = async (url, init) => {
      seen = { url: String(url), init };
      return new Response(JSON.stringify({ accepted: 1 }), { status: 200 });
    };
    const res = await postDiagnostics({
      serverUrl: 'https://ledger.example',
      token: 'flt_x',
      report,
      fetchImpl,
    });
    expect(res).toEqual({ kind: 'ok', accepted: 1 });
    expect(seen?.url).toBe('https://ledger.example/v1/diagnostics');
    expect(seen?.init?.method).toBe('POST');
    const headers = seen?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer flt_x');
    expect(JSON.parse(String(seen?.init?.body))).toEqual(report);
  });

  it('classifies failures', async () => {
    const post = (fetchImpl: FetchLike) =>
      postDiagnostics({ serverUrl: 'https://s', token: 'flt_x', report, fetchImpl });
    expect(await post(reply(400, { error: 'invalid DiagnosticsReport' }))).toEqual({
      kind: 'rejected',
      status: 400,
      message: '400 invalid DiagnosticsReport',
    });
    expect((await post(reply(413, { error: 'payload too large' }))).kind).toBe('rejected');
    expect((await post(reply(401, { error: 'invalid or revoked token' }))).kind).toBe(
      'unauthorized',
    );
    expect((await post(reply(429, { error: 'slow down' }))).kind).toBe('retry');
    expect((await post(reply(503, {}))).kind).toBe('retry');
    expect((await post(reply(200, { nope: true }))).kind).toBe('retry');
    const offline = await post(async () => {
      throw new TypeError('fetch failed');
    });
    expect(offline).toMatchObject({ kind: 'retry', message: expect.stringMatching(/network/) });
  });
});

describe('summarizeRejected', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fl-diag-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const batch = (key: number): UploadBatch =>
    ({
      schemaVersion: 4,
      uploaderId: 'pc-1',
      account: 'ACC',
      meta: {},
      records: {
        ...Object.fromEntries(RECORD_KINDS.map((k) => [k, []])),
        quests: [{ questId: key, title: `Secret title ${key}` }],
      },
    }) as unknown as UploadBatch;

  it('is empty without a rejected folder', async () => {
    expect(await summarizeRejected(dir)).toEqual({ total: 0, accounts: [] });
  });

  it('counts parked batches and samples the newest, with kind/key and issues only', async () => {
    const q = new Queue(dir);
    for (let i = 1; i <= 5; i++) {
      const qb = await q.enqueue('ACC', batch(i), 1_790_000_000_000 + i);
      await q.reject(
        'ACC',
        qb.id,
        {
          status: 400,
          message: '400 invalid UploadBatch',
          issues: [
            { path: 'records.quests.0.level', message: 'Expected number' },
            { path: 'a', message: 'b' },
            { path: 'c', message: 'd' },
            { path: 'e', message: 'f' },
          ],
        },
        1_790_000_100_000 + i * 1000,
      );
    }
    const s = await summarizeRejected(dir, { sample: 2 });
    expect(s.total).toBe(5);
    expect(s.accounts).toHaveLength(1);
    const a = s.accounts[0]!;
    expect(a).toMatchObject({ account: 'ACC', batches: 5 });
    expect(a.sample).toHaveLength(2);
    expect(a.sample[0]).toEqual({
      at: 1_790_000_105,
      status: 400,
      message: '400 invalid UploadBatch',
      issues: [
        { path: 'records.quests.0.level', message: 'Expected number' },
        { path: 'a', message: 'b' },
        { path: 'c', message: 'd' },
      ],
      records: [{ kind: 'quests', key: expect.stringContaining('5') }],
    });
    expect(JSON.stringify(s)).not.toContain('Secret title');
  });

  it('is exported from the library entry point', () => {
    expect(lib.sanitize).toBe(sanitize);
    expect(lib.sanitizeJson).toBe(sanitizeJson);
    expect(lib.summarizeRejected).toBe(summarizeRejected);
    expect(lib.postDiagnostics).toBe(postDiagnostics);
  });
});
