// Friends' tray helpers (tray helper plan): a tray enrolls with its upload token, the helper waits for an admin's
// approval, then leases only wowhead.com entity pages within 200 a day; pausing stops it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashToken } from '../src/index.js';
import { enqueueUrl } from '../src/knowledge/store.js';
import { createSession, csrfToken } from '../src/sessions.js';
import { startServer } from './helpers.js';

const COOKIE_SECRET = 'test-cookie-secret-fetch-helpers-0123456789abcdef';
const SESSION = '__Host-fl_session';

describe('tray fetch helpers (real Postgres)', () => {
  let s: Awaited<ReturnType<typeof startServer>>;
  let admin: { cookies: Record<string, string>; csrf: string };
  let helper = '';
  let helperId = 0;

  const call = (method: 'GET' | 'POST', url: string, token: string, payload?: object) =>
    s.app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload });
  const adminPost = (url: string, payload: object) =>
    s.app.inject({
      method: 'POST',
      url,
      cookies: admin.cookies,
      headers: { 'x-csrf-token': admin.csrf },
      payload,
    });

  beforeAll(async () => {
    s = await startServer({ admin: { cookieSecret: COOKIE_SECRET, authPerMinute: 10_000 } });
    const { rows } = await s.database.pool.query(
      `insert into users (bnet_sub, battletag, role) values ('sub-a', 'JohnWilliker#1292', 'admin') returning id`,
    );
    const value = await createSession(s.database.db, rows[0].id as number, {});
    admin = {
      cookies: { [SESSION]: s.app.signCookie(value) },
      csrf: csrfToken(COOKIE_SECRET, hashToken(value)),
    };
    for (const [url, entityType, entityId] of [
      ['https://mobalytics.gg/wow-forever/guides/zone-map-level-ranges', null, null],
      ['https://www.wowhead.com/forever/guide/fishing', null, null],
      ['https://www.wowhead.com/forever/item=7973', 'item', 7973],
      ['https://www.wowhead.com/forever/npc=5431', 'npc', 5431],
    ] as const) {
      await enqueueUrl(s.database.db, {
        url,
        addedBy: 'cli',
        priority: 50,
        entityType,
        entityId,
      });
    }
  });
  afterAll(() => s?.stop());

  it('a tray enrolls with its upload token and gets a helper token pending approval', async () => {
    const res = await call('POST', '/v1/fetch/enroll', s.token, { worker: 'cody-pc' });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('pending');
    helper = res.json().token;
    expect(helper).toMatch(/^flt_/);
    const [row] = (
      await s.database.pool.query(
        `select id, label, can_fetch, helper_status, fetch_daily_budget, fetch_sites from api_tokens
          where token_hash = $1`,
        [hashToken(helper)],
      )
    ).rows;
    expect(row).toMatchObject({
      label: 'helper: test',
      can_fetch: true,
      helper_status: 'pending',
      fetch_daily_budget: 200,
      fetch_sites: ['wowhead.com'],
    });
    helperId = row.id;
  });

  it('a pending helper sees its status but leases nothing', async () => {
    const status = await call('GET', '/v1/fetch/status', helper);
    expect(status.json()).toMatchObject({
      status: 'pending',
      budget: { day: { used: 0, limit: 200 }, hour: { used: 0, limit: 13 } },
    });
    const lease = await call('POST', '/v1/fetch/lease', helper, { worker: 'cody-pc' });
    expect(lease.statusCode).toBe(403);
    expect(lease.json()).toEqual({ error: 'helper waiting for approval', status: 'pending' });
  });

  it('only upload tokens enroll; a helper token cannot upload', async () => {
    expect((await call('POST', '/v1/fetch/enroll', helper, {})).statusCode).toBe(403);
    expect((await call('POST', '/v1/fetch/enroll', 'flt_nope', {})).statusCode).toBe(401);
    const ingest = await call('POST', '/v1/ingest', helper, {});
    expect(ingest.statusCode).toBe(401);
  });

  it('once approved it leases only wowhead.com entity pages', async () => {
    const approve = await adminPost(`/admin/api/tokens/${helperId}/helper`, { status: 'approved' });
    expect(approve.statusCode, approve.body).toBe(200);
    const lease = await call('POST', '/v1/fetch/lease', helper, { worker: 'cody-pc', max: 10 });
    expect(lease.statusCode).toBe(200);
    expect(
      lease
        .json()
        .leases.map((l: { url: string }) => l.url)
        .sort(),
    ).toEqual([
      'https://www.wowhead.com/forever/item=7973',
      'https://www.wowhead.com/forever/npc=5431',
    ]);
    expect(lease.json().budget.day).toEqual({ used: 2, limit: 200 });
  });

  it('the admin sees helpers and can pause one or change its budget', async () => {
    const list = await s.app.inject({
      method: 'GET',
      url: '/admin/api/tokens',
      cookies: admin.cookies,
    });
    const row = list.json().items.find((t: { id: number }) => t.id === helperId);
    expect(row.helper).toMatchObject({ status: 'approved', dailyBudget: 200, fetchedToday: 2 });
    expect(
      (await adminPost(`/admin/api/tokens/${helperId}/helper`, { dailyBudget: 0 })).statusCode,
    ).toBe(400);
    expect(
      (await adminPost(`/admin/api/tokens/${helperId}/helper`, { status: 'pending' })).statusCode,
    ).toBe(400);
    const paused = await adminPost(`/admin/api/tokens/${helperId}/helper`, {
      status: 'paused',
      dailyBudget: 100,
    });
    expect(paused.json()).toEqual({ id: helperId, status: 'paused', dailyBudget: 100 });
    expect((await call('POST', '/v1/fetch/lease', helper, { worker: 'cody-pc' })).statusCode).toBe(
      403,
    );
    expect((await call('GET', '/v1/fetch/status', helper)).json().budget.day.limit).toBe(100);
    // Not a helper: cruiser-style tokens have no helper controls.
    expect((await adminPost(`/admin/api/tokens/1/helper`, { status: 'paused' })).statusCode).toBe(
      404,
    );
  });

  it('enrolling again (a reinstall) replaces the old helper, which then stops working', async () => {
    const again = await call('POST', '/v1/fetch/enroll', s.token, {});
    expect(again.statusCode).toBe(201);
    expect((await call('GET', '/v1/fetch/status', helper)).statusCode).toBe(401);
    expect((await call('GET', '/v1/fetch/status', again.json().token)).json().status).toBe(
      'pending',
    );
  });
});
