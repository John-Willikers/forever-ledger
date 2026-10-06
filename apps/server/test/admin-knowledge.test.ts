// Admin knowledge routes (/admin/api/knowledge/*) against a real Postgres, loaded with the 2026-10-06 brief seed.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashToken } from '../src/index.js';
import { importSeed } from '../src/knowledge/seed.js';
import { createSession, csrfToken } from '../src/sessions.js';
import { startServer } from './helpers.js';

const COOKIE_SECRET = 'test-cookie-secret-admin-knowledge-0123456789abcd';
const SESSION = '__Host-fl_session';
const CHICAGO_ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d-0[56]:00$/;

describe('admin knowledge API (real Postgres)', () => {
  let s: Awaited<ReturnType<typeof startServer>>;
  let admin: { cookies: Record<string, string>; csrf: string };
  let member: Record<string, string>;

  async function sessionFor(battletag: string, role: 'admin' | 'member') {
    const { rows } = await s.database.pool.query(
      `insert into users (bnet_sub, battletag, role) values ($1, $2, $3) returning id`,
      [`sub-${battletag}`, battletag, role],
    );
    const value = await createSession(s.database.db, rows[0].id as number, {});
    return {
      cookies: { [SESSION]: s.app.signCookie(value) },
      csrf: csrfToken(COOKIE_SECRET, hashToken(value)),
    };
  }
  const json = async (url: string) => {
    const res = await s.app.inject({ method: 'GET', url, cookies: admin.cookies });
    expect(res.statusCode, `${url} ${res.body}`).toBe(200);
    return res.json();
  };

  beforeAll(async () => {
    s = await startServer({ admin: { cookieSecret: COOKIE_SECRET, authPerMinute: 10_000 } });
    admin = await sessionFor('JohnWilliker#1292', 'admin');
    member = (await sessionFor('Friend#1111', 'member')).cookies;
    const seed = readFileSync(
      fileURLToPath(new URL('../../../knowledge/seed/2026-10-06-brief.json', import.meta.url)),
      'utf8',
    );
    await importSeed(s.database.db, JSON.parse(seed));
  });
  afterAll(() => s?.stop());

  it('is admin-only', async () => {
    for (const url of ['/admin/api/knowledge/summary', '/admin/api/knowledge/claims']) {
      expect((await s.app.inject({ method: 'GET', url })).statusCode).toBe(401);
      expect((await s.app.inject({ method: 'GET', url, cookies: member })).statusCode).toBe(403);
    }
  });

  it('summarizes the queue and labels', async () => {
    const sum = await json('/admin/api/knowledge/summary');
    expect(sum).toMatchObject({
      snapshots: 0,
      sources: 17,
      claims: 42,
      observations: 1,
      queue: { queued: 14, leased: 0, done: 0, needs_human: 0, failed: 0 },
      labels: { FALSE: 5, ANECDOTE: 1, UNVERIFIED: 3 },
      lastSnapshotAt: null,
    });
  });

  it('lists and filters claims with their source tier', async () => {
    const all = await json('/admin/api/knowledge/claims');
    expect(all.total).toBe(42);
    const falses = await json('/admin/api/knowledge/claims?label=FALSE');
    expect(falses.items).toHaveLength(5);
    expect(falses.items.every((c: { tier: number }) => c.tier === 7)).toBe(true);
    const clam = await json('/admin/api/knowledge/claims?search=big-mouth');
    expect(clam.items.map((c: { attribute: string }) => c.attribute)).toContain('fishing_yield');
    expect(clam.items[0].createdAt).toMatch(CHICAGO_ISO);
    expect(
      (
        await s.app.inject({
          method: 'GET',
          url: '/admin/api/knowledge/claims?label=MAYBE',
          cookies: admin.cookies,
        })
      ).statusCode,
    ).toBe(400);
  });

  it('lists sources, disputes and observations', async () => {
    const sources = await json('/admin/api/knowledge/sources');
    expect(sources.items[0]).toMatchObject({ tier: 1, kind: 'first_party', claims: 1 });
    const disputes = await json('/admin/api/knowledge/disputes');
    expect(disputes.items.length).toBeGreaterThanOrEqual(5);
    const obs = await json('/admin/api/knowledge/observations');
    expect(obs.items).toHaveLength(1);
    expect(obs.items[0]).toMatchObject({
      key: '2026-10-06-steamwheedle-clams',
      durationMins: 40,
      result: { bigMouthClams: 0 },
    });
    expect(obs.items[0].observedAt).toMatch(CHICAGO_ISO);
  });

  it('queues a URL with CSRF, and refuses other schemes', async () => {
    const post = (
      payload: object,
      headers: Record<string, string> = { 'x-csrf-token': admin.csrf },
    ) =>
      s.app.inject({
        method: 'POST',
        url: '/admin/api/knowledge/queue',
        cookies: admin.cookies,
        headers,
        payload,
      });
    expect((await post({ url: 'https://www.wowhead.com/forever/item=7973' }, {})).statusCode).toBe(
      403,
    );
    const ok = await post({ url: 'https://www.wowhead.com/forever/item=7973', priority: 30 });
    expect(ok.statusCode).toBe(201);
    expect((await post({ url: 'javascript:alert(1)' })).statusCode).toBe(400);
    expect((await post({ url: 'https://x.org', priority: 1000 })).statusCode).toBe(400);
    const q = await json('/admin/api/knowledge/queue?search=wowhead');
    expect(q.items).toEqual([
      expect.objectContaining({
        url: 'https://www.wowhead.com/forever/item=7973',
        site: 'wowhead.com',
        priority: 30,
        state: 'queued',
        addedBy: 'admin',
      }),
    ]);
    expect(q.items[0].nextDueAt).toMatch(CHICAGO_ISO);
  });
});
