import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mintToken, revokeToken } from '../src/index.js';
import { batchFromFixture, startServer } from './helpers.js';

type Server = Awaited<ReturnType<typeof startServer>>;

const event = (over: Record<string, unknown> = {}) => ({
  at: 1_790_000_000,
  level: 'error',
  source: 'uploader',
  message: 'upload failed, will retry: network error',
  ...over,
});

const report = (over: Record<string, unknown> = {}) => ({
  uploaderId: 'pc-1',
  appVersion: '0.1.4',
  platform: 'win32 10.0.22631',
  events: [event()],
  ...over,
});

/** America/Chicago ISO: `2026-09-23T00:22:17-05:00`. */
const CHICAGO_ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d-0[56]:00$/;

describe('diagnostics API (real Postgres)', () => {
  let s: Server;
  beforeAll(async () => {
    s = await startServer();
  });
  afterAll(async () => {
    await s?.stop();
  });

  const postReport = (body: unknown, headers: Record<string, string> = s.auth) =>
    s.app.inject({ method: 'POST', url: '/v1/diagnostics', headers, payload: body as object });
  const list = (query = '', headers: Record<string, string> = s.auth) =>
    s.app.inject({ method: 'GET', url: `/v1/diagnostics${query}`, headers });

  it('stores a report and lists it with Chicago timestamps', async () => {
    const res = await postReport(
      report({
        events: [
          event({ at: 1_790_000_000, level: 'fatal', source: 'tray', detail: { count: 3 } }),
          event({ at: 1_790_000_060, level: 'warn', source: 'addon-sync', message: 'no network' }),
        ],
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ accepted: 2 });
    expect(await s.count('diagnostics')).toBe(2);

    const { rows } = await s.database.pool.query(
      'select token_id, uploader_id, app_version, platform, level, source, message, detail, occurred_at from diagnostics order by id',
    );
    expect(rows[0]).toMatchObject({
      uploader_id: 'pc-1',
      app_version: '0.1.4',
      platform: 'win32 10.0.22631',
      level: 'fatal',
      source: 'tray',
      detail: { count: 3 },
    });
    expect(rows[0].token_id).toEqual(expect.any(Number));
    expect((rows[0].occurred_at as Date).getTime()).toBe(1_790_000_000_000);
    expect(rows[1].detail).toBeNull();

    const got = await list();
    expect(got.statusCode).toBe(200);
    const body = got.json();
    expect(body.since).toMatch(CHICAGO_ISO);
    const items = body.items.filter((i: { type: string }) => i.type === 'diagnostic');
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      type: 'diagnostic',
      uploaderId: 'pc-1',
      appVersion: '0.1.4',
      platform: 'win32 10.0.22631',
      level: 'warn',
      source: 'addon-sync',
      message: 'no network',
    });
    expect(items[0].receivedAt).toMatch(CHICAGO_ISO);
    expect(items[0].occurredAt).toMatch(CHICAGO_ISO);
    expect(items[1]).toMatchObject({ level: 'fatal', detail: { count: 3 } });
  });

  it('needs a valid token to post or list', async () => {
    expect((await postReport(report(), {})).statusCode).toBe(401);
    expect((await postReport(report(), { authorization: 'Bearer flt_nope' })).statusCode).toBe(401);
    expect((await list('', {})).statusCode).toBe(401);
    const { id, token } = await mintToken(s.database.db, 'friend');
    await revokeToken(s.database.db, id);
    expect((await postReport(report(), { authorization: `Bearer ${token}` })).statusCode).toBe(401);
  });

  it('rejects malformed reports with 400 and stores nothing', async () => {
    const before = await s.count('diagnostics');
    const res = await postReport(report({ events: [event({ message: 'x'.repeat(501) })] }));
    expect(res.statusCode).toBe(400);
    expect(res.json().issues[0].path).toBe('events.0.message');
    expect((await postReport(report({ events: [] }))).statusCode).toBe(400);
    const tooBig = { s: 'x'.repeat(5000) };
    expect((await postReport(report({ events: [event({ detail: tooBig })] }))).statusCode).toBe(
      400,
    );
    expect(await s.count('diagnostics')).toBe(before);
  });

  it('refuses bodies over 256 KB with 413', async () => {
    const res = await s.app.inject({
      method: 'POST',
      url: '/v1/diagnostics',
      headers: { ...s.auth, 'content-type': 'application/json' },
      payload: JSON.stringify({ ...report(), junk: 'x'.repeat(300 * 1024) }),
    });
    expect(res.statusCode).toBe(413);
  });

  it('records failed ingests (400 and 409) without the token and keeps the responses', async () => {
    const batch = batchFromFixture('session-v1.lua', 'ACCOUNT-ERR', 'pc-err');
    const res409 = await s.app.inject({
      method: 'POST',
      url: '/v1/ingest',
      headers: s.auth,
      payload: { ...batch, schemaVersion: 99 },
    });
    expect(res409.statusCode).toBe(409);
    expect(res409.json().error).toMatch(/unsupported schemaVersion 99/);

    const bad = structuredClone(batch) as unknown as { records: { runs: { start: unknown }[] } };
    bad.records.runs[0]!.start = 'yesterday';
    const res400 = await s.app.inject({
      method: 'POST',
      url: '/v1/ingest',
      headers: s.auth,
      payload: bad,
    });
    expect(res400.statusCode).toBe(400);
    expect(res400.json().issues[0].path).toBe('records.runs.0.start');

    const { rows } = await s.database.pool.query('select * from ingest_errors order by id');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      uploader_id: 'pc-err',
      account: 'ACCOUNT-ERR',
      schema_version: 99,
      status: 409,
      issues: null,
    });
    expect(rows[0].error).toMatch(/unsupported schemaVersion 99/);
    expect(rows[1]).toMatchObject({
      status: 400,
      error: 'invalid UploadBatch',
      schema_version: batch.schemaVersion,
    });
    expect(rows[1].issues[0]).toMatchObject({ path: 'records.runs.0.start' });
    expect(rows[0].token_id).toEqual(expect.any(Number));
    const token = s.auth.authorization.slice('Bearer '.length);
    expect(JSON.stringify(rows)).not.toContain(token);

    // A body that is not an object at all: recorded with what little is known.
    const res = await s.app.inject({
      method: 'POST',
      url: '/v1/ingest',
      headers: { ...s.auth, 'content-type': 'application/json' },
      payload: '"hello"',
    });
    expect(res.statusCode).toBe(400);
    const last = await s.database.pool.query(
      'select uploader_id, account, schema_version, status, error from ingest_errors order by id desc limit 1',
    );
    expect(last.rows[0]).toEqual({
      uploader_id: null,
      account: null,
      schema_version: null,
      status: 400,
      error: 'expected a JSON UploadBatch',
    });

    const items = (await list()).json().items as { type: string; status?: number }[];
    const errors = items.filter((i) => i.type === 'ingest-error');
    expect(errors.map((e) => e.status)).toEqual([400, 400, 409]);
    expect(errors[2]).toMatchObject({ account: 'ACCOUNT-ERR', uploaderId: 'pc-err' });
  });

  it('lists newest first, merged, with since and limit', async () => {
    const all = (await list()).json().items as { type: string; receivedAt: string }[];
    expect(all.length).toBeGreaterThanOrEqual(5);
    expect(new Set(all.map((i) => i.type))).toEqual(new Set(['diagnostic', 'ingest-error']));
    const times = all.map((i) => Date.parse(i.receivedAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    // The last ingest error was received after the diagnostics.
    expect(all[0]!.type).toBe('ingest-error');

    expect((await list('?limit=2')).json().items).toHaveLength(2);
    const future = Math.floor(Date.now() / 1000) + 3600;
    expect((await list(`?since=${future}`)).json().items).toEqual([]);
    expect((await list('?since=2000-01-01T00:00:00Z')).json().items).toHaveLength(all.length);
    expect((await list('?since=yesterday')).statusCode).toBe(400);
  });
});

describe('diagnostics API limits', () => {
  let s: Server;
  beforeAll(async () => {
    s = await startServer({ diagnosticsPerMinute: 3, ingestPerMinute: 100 });
  });
  afterAll(async () => {
    await s?.stop();
  });

  it('rate-limits reading the list per token too', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await s.app.inject({ method: 'GET', url: '/v1/diagnostics', headers: s.auth });
      codes.push(res.statusCode);
    }
    expect(codes).toEqual([200, 200, 200, 429, 429]);
  });

  it('rate-limits reports per token, separately from ingest', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await s.app.inject({
        method: 'POST',
        url: '/v1/diagnostics',
        headers: s.auth,
        payload: report(),
      });
      codes.push(res.statusCode);
    }
    expect(codes).toEqual([200, 200, 200, 429, 429]);
    const ingest = await s.app.inject({
      method: 'POST',
      url: '/v1/ingest',
      headers: s.auth,
      payload: batchFromFixture('session-v1.lua'),
    });
    expect(ingest.statusCode).toBe(200);
  });
});
