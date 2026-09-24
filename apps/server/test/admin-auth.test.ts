import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, loggerOptions } from '../src/index.js';
import type { AppOptions } from '../src/index.js';
import { BNET_AUTHORIZE_URL, BNET_TOKEN_URL, BNET_USERINFO_URL } from '../src/bnet.js';
import { startServer } from './helpers.js';

type Server = Awaited<ReturnType<typeof startServer>>;
type App = Server['app'];

const CLIENT_ID = 'client-id-abc';
const CLIENT_SECRET = 'client-secret-SHOULD-NEVER-LEAK';
const REDIRECT_URI = 'https://ledger.example.test/admin/auth/callback';
const COOKIE_SECRET = 'test-cookie-secret-0123456789abcdef0123456789';
const ACCESS_TOKEN = 'bnet-access-token-SHOULD-NEVER-LEAK';
const CODE = 'bnet-auth-code-SHOULD-NEVER-LEAK';
const ADMIN_TAG = 'JohnWilliker#1292';

/** A stand-in for oauth.battle.net: records calls, answers token + userinfo. */
function fakeBattleNet() {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const state = {
    user: { sub: '1234', id: 1234, battletag: ADMIN_TAG } as Record<string, unknown>,
    tokenStatus: 200,
    userinfoStatus: 200,
  };
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === BNET_TOKEN_URL) {
      if (state.tokenStatus !== 200) {
        return Response.json({ error: 'invalid_grant' }, { status: state.tokenStatus });
      }
      return Response.json({
        access_token: ACCESS_TOKEN,
        token_type: 'bearer',
        expires_in: 86399,
        scope: 'openid',
      });
    }
    if (url === BNET_USERINFO_URL) {
      if (state.userinfoStatus !== 200)
        return new Response('nope', { status: state.userinfoStatus });
      return Response.json(state.user);
    }
    return new Response('unexpected', { status: 500 });
  }) as typeof globalThis.fetch;
  return { calls, state, fetch };
}

const cookieOf = (res: { cookies: { name: string; value: string }[] }, name: string) =>
  res.cookies.find((c) => c.name === name);

/** Runs /login → Battle.net → /callback and returns the session cookie value (if any). */
async function login(app: App, code = CODE) {
  const start = await app.inject({ method: 'GET', url: '/admin/auth/login' });
  const state = new URL(start.headers.location as string).searchParams.get('state')!;
  const stateCookie = cookieOf(start, 'fl_oauth_state')!.value;
  const cb = await app.inject({
    method: 'GET',
    url: `/admin/auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    cookies: { fl_oauth_state: stateCookie },
  });
  return { cb, session: cookieOf(cb, 'fl_session')?.value };
}

const me = (app: App, session?: string) =>
  app.inject({
    method: 'GET',
    url: '/admin/auth/me',
    cookies: session ? { fl_session: session } : {},
  });

describe('admin auth (real Postgres, stubbed Battle.net)', () => {
  let s: Server;
  let bnet: ReturnType<typeof fakeBattleNet>;
  let app: App;
  let distDir: string;

  const adminOptions = (over: Partial<NonNullable<AppOptions['admin']>> = {}) => ({
    bnet: { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUri: REDIRECT_URI },
    adminBattletags: [ADMIN_TAG],
    cookieSecret: COOKIE_SECRET,
    fetch: bnet.fetch,
    distDir,
    authPerMinute: 10_000,
    ...over,
  });

  beforeAll(async () => {
    distDir = mkdtempSync(join(tmpdir(), 'fl-admin-dist-'));
    writeFileSync(
      join(distDir, 'index.html'),
      '<!doctype html><title>Forever Ledger admin</title>',
    );
    mkdirSync(join(distDir, 'assets'));
    writeFileSync(join(distDir, 'assets', 'app-abc123.js'), 'console.log("hi")');
    bnet = fakeBattleNet();
    s = await startServer({ admin: adminOptions() });
    app = s.app;
  });
  afterAll(async () => {
    await s?.stop();
    rmSync(distDir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await s.database.pool.query('delete from sessions; delete from users;');
    bnet.calls.length = 0;
    bnet.state.user = { sub: '1234', id: 1234, battletag: ADMIN_TAG };
    bnet.state.tokenStatus = 200;
    bnet.state.userinfoStatus = 200;
  });

  describe('login', () => {
    it('redirects to Battle.net with the right params and a signed state cookie', async () => {
      const res = await app.inject({ method: 'GET', url: '/admin/auth/login' });
      expect(res.statusCode).toBe(302);
      const loc = new URL(res.headers.location as string);
      expect(`${loc.origin}${loc.pathname}`).toBe(BNET_AUTHORIZE_URL);
      expect(loc.searchParams.get('response_type')).toBe('code');
      expect(loc.searchParams.get('client_id')).toBe(CLIENT_ID);
      expect(loc.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
      expect(loc.searchParams.get('scope')).toBe('openid');
      const state = loc.searchParams.get('state')!;
      expect(state.length).toBeGreaterThanOrEqual(32);

      const cookie = cookieOf(res, 'fl_oauth_state') as Record<string, unknown>;
      expect(cookie).toBeDefined();
      expect(cookie.value).not.toBe(state); // signed
      expect(String(cookie.value).startsWith(`${state}.`)).toBe(true);
      expect(cookie.httpOnly).toBe(true);
      expect(cookie.secure).toBe(true);
      expect(cookie.path).toBe('/admin/auth');
      expect(cookie.maxAge).toBe(600);
      expect(String(cookie.sameSite).toLowerCase()).toBe('lax');
      // Battle.net's secret never goes to the browser.
      expect(res.headers.location).not.toContain(CLIENT_SECRET);
    });

    it('returns 503 when Battle.net is not configured; the rest of the server still works', async () => {
      const other = await buildApp({ database: s.database, admin: { distDir } });
      try {
        const res = await other.inject({ method: 'GET', url: '/admin/auth/login' });
        expect(res.statusCode).toBe(503);
        expect(res.json()).toEqual({ error: 'Battle.net login not configured' });
        const who = await me(other);
        expect(who.statusCode).toBe(200);
        expect(who.json()).toMatchObject({ user: null, loginConfigured: false });
        const health = await other.inject({ method: 'GET', url: '/v1/health' });
        expect(health.statusCode).toBe(200);
        const quests = await other.inject({ method: 'GET', url: '/v1/quests/xp', headers: s.auth });
        expect(quests.statusCode).toBe(200);
      } finally {
        await other.close();
      }
    });
  });

  describe('callback', () => {
    it('exchanges the code, creates the user and a session, sets the cookie and redirects', async () => {
      const { cb, session } = await login(app);
      expect(cb.statusCode).toBe(302);
      expect(cb.headers.location).toBe('/admin/');

      // Token exchange: POST form with Basic auth; userinfo with a Bearer header, not a query string.
      const tokenCall = bnet.calls.find((c) => c.url === BNET_TOKEN_URL)!;
      expect(tokenCall.init?.method).toBe('POST');
      const headers = new Headers(tokenCall.init?.headers);
      expect(headers.get('authorization')).toBe(
        `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
      );
      const form = new URLSearchParams(String(tokenCall.init?.body));
      expect(Object.fromEntries(form)).toEqual({
        grant_type: 'authorization_code',
        code: CODE,
        redirect_uri: REDIRECT_URI,
      });
      const infoCall = bnet.calls.find((c) => c.url.startsWith(BNET_USERINFO_URL))!;
      expect(infoCall.url).toBe(BNET_USERINFO_URL);
      expect(new Headers(infoCall.init?.headers).get('authorization')).toBe(
        `Bearer ${ACCESS_TOKEN}`,
      );

      const cookie = cookieOf(cb, 'fl_session') as Record<string, unknown>;
      expect(cookie.httpOnly).toBe(true);
      expect(cookie.secure).toBe(true);
      expect(cookie.path).toBe('/');
      expect(String(cookie.sameSite).toLowerCase()).toBe('lax');
      expect(cookie.maxAge).toBe(7 * 86400);
      // The state cookie is cleared.
      expect(cookieOf(cb, 'fl_oauth_state')?.value).toBe('');

      const { rows: users } = await s.database.pool.query('select * from users');
      expect(users).toHaveLength(1);
      expect(users[0]).toMatchObject({ bnet_sub: '1234', battletag: ADMIN_TAG, role: 'admin' });
      expect(users[0].last_login_at).toBeInstanceOf(Date);

      const { rows: sessions } = await s.database.pool.query('select * from sessions');
      expect(sessions).toHaveLength(1);
      expect(sessions[0].user_id).toBe(users[0].id);
      // Only the hash is stored.
      expect(String(session)).not.toContain(sessions[0].id);
      expect(sessions[0].id).toMatch(/^[0-9a-f]{64}$/);
      const ttl = (sessions[0].expires_at as Date).getTime() - Date.now();
      expect(ttl).toBeGreaterThan(7 * 86400_000 - 60_000);
      expect(ttl).toBeLessThanOrEqual(7 * 86400_000 + 1000);

      const who = await me(app, session);
      expect(who.json()).toEqual({
        user: { id: users[0].id, battletag: ADMIN_TAG, role: 'admin' },
        csrf: expect.any(String),
        loginConfigured: true,
      });
    });

    it('refuses a state that does not match the cookie', async () => {
      const start = await app.inject({ method: 'GET', url: '/admin/auth/login' });
      const stateCookie = cookieOf(start, 'fl_oauth_state')!.value;
      const cb = await app.inject({
        method: 'GET',
        url: `/admin/auth/callback?code=${CODE}&state=someone-elses-state-value-0123456789`,
        cookies: { fl_oauth_state: stateCookie },
      });
      expect(cb.statusCode).toBe(302);
      expect(cb.headers.location).toMatch(/^\/admin\/\?error=/);
      expect(cookieOf(cb, 'fl_session')).toBeUndefined();
      expect(bnet.calls).toHaveLength(0);
      expect(await s.count('sessions')).toBe(0);
    });

    it('refuses a missing state cookie and a forged (unsigned) one', async () => {
      const start = await app.inject({ method: 'GET', url: '/admin/auth/login' });
      const state = new URL(start.headers.location as string).searchParams.get('state')!;
      for (const cookies of [{}, { fl_oauth_state: state }] as Record<string, string>[]) {
        const cb = await app.inject({
          method: 'GET',
          url: `/admin/auth/callback?code=${CODE}&state=${state}`,
          cookies,
        });
        expect(cb.statusCode).toBe(302);
        expect(cb.headers.location).toMatch(/^\/admin\/\?error=/);
        expect(cookieOf(cb, 'fl_session')).toBeUndefined();
      }
      const noState = await app.inject({ method: 'GET', url: `/admin/auth/callback?code=${CODE}` });
      expect(noState.headers.location).toMatch(/^\/admin\/\?error=/);
      expect(bnet.calls).toHaveLength(0);
      expect(await s.count('sessions')).toBe(0);
    });

    it('redirects with an error when Battle.net fails or the user cancels', async () => {
      bnet.state.tokenStatus = 400;
      const failed = await login(app);
      expect(failed.cb.statusCode).toBe(302);
      expect(failed.cb.headers.location).toMatch(/^\/admin\/\?error=/);
      expect(failed.session).toBeUndefined();

      bnet.state.tokenStatus = 200;
      bnet.state.userinfoStatus = 500;
      const failedInfo = await login(app);
      expect(failedInfo.cb.headers.location).toMatch(/^\/admin\/\?error=/);
      expect(failedInfo.session).toBeUndefined();

      bnet.state.userinfoStatus = 200;
      bnet.state.user = { sub: '1234' }; // no battletag
      const badInfo = await login(app);
      expect(badInfo.cb.headers.location).toMatch(/^\/admin\/\?error=/);
      expect(badInfo.session).toBeUndefined();

      const start = await app.inject({ method: 'GET', url: '/admin/auth/login' });
      const state = new URL(start.headers.location as string).searchParams.get('state')!;
      const cancelled = await app.inject({
        method: 'GET',
        url: `/admin/auth/callback?error=access_denied&error_description=%3Cscript%3E&state=${state}`,
        cookies: { fl_oauth_state: cookieOf(start, 'fl_oauth_state')!.value },
      });
      expect(cancelled.statusCode).toBe(302);
      const loc = new URL(cancelled.headers.location as string, 'https://x.test');
      expect(loc.pathname).toBe('/admin/');
      // A fixed message, never Battle.net's own text.
      expect(loc.searchParams.get('error')).toBe('Battle.net login was cancelled.');
      expect(await s.count('sessions')).toBe(0);
      expect(await s.count('users')).toBe(0);
    });
  });

  describe('roles', () => {
    it('keeps an admin pinned by sub when the BattleTag changes, and refreshes the tag', async () => {
      await login(app);
      bnet.state.user = { sub: '1234', id: 1234, battletag: 'Renamed#4242' };
      const { session } = await login(app);
      const { rows } = await s.database.pool.query('select bnet_sub, battletag, role from users');
      expect(rows).toEqual([{ bnet_sub: '1234', battletag: 'Renamed#4242', role: 'admin' }]);
      expect((await me(app, session)).json().user).toMatchObject({
        battletag: 'Renamed#4242',
        role: 'admin',
      });
    });

    it('promotes an existing member whose BattleTag is later listed', async () => {
      await s.database.pool.query(
        `insert into users (bnet_sub, battletag, role) values ('1234', '${ADMIN_TAG}', 'member')`,
      );
      await login(app);
      const { rows } = await s.database.pool.query('select role from users');
      expect(rows).toEqual([{ role: 'admin' }]);
    });

    it('matches BattleTags exactly (case and #number)', async () => {
      bnet.state.user = { sub: '555', id: 555, battletag: 'johnwilliker#1292' };
      await login(app);
      bnet.state.user = { sub: '556', id: 556, battletag: 'JohnWilliker#1293' };
      await login(app);
      const { rows } = await s.database.pool.query('select role from users order by id');
      expect(rows).toEqual([{ role: 'member' }, { role: 'member' }]);
    });

    it('a member gets 403 on /admin/api and on /v1 reads', async () => {
      bnet.state.user = { sub: '999', id: 999, battletag: 'Friend#1111' };
      const { cb, session } = await login(app);
      expect(cb.headers.location).toBe('/admin/');
      expect(session).toBeDefined();
      const who = (await me(app, session)).json();
      expect(who.user).toMatchObject({ battletag: 'Friend#1111', role: 'member' });

      const ping = await app.inject({
        method: 'GET',
        url: '/admin/api/ping',
        cookies: { fl_session: session! },
      });
      expect(ping.statusCode).toBe(403);
      expect(ping.json()).toEqual({ error: 'not authorized' });

      const quests = await app.inject({
        method: 'GET',
        url: '/v1/quests/xp',
        cookies: { fl_session: session! },
      });
      expect(quests.statusCode).toBe(403);
      expect(quests.json()).toEqual({ error: 'not authorized' });
    });
  });

  describe('sessions', () => {
    it('/admin/api/ping needs a session', async () => {
      const anon = await app.inject({ method: 'GET', url: '/admin/api/ping' });
      expect(anon.statusCode).toBe(401);
      // Bearer tokens are for /v1, not the admin API.
      const bearer = await app.inject({ method: 'GET', url: '/admin/api/ping', headers: s.auth });
      expect(bearer.statusCode).toBe(401);

      const { session } = await login(app);
      const ok = await app.inject({
        method: 'GET',
        url: '/admin/api/ping',
        cookies: { fl_session: session! },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toEqual({
        ok: true,
        user: { id: expect.any(Number), battletag: ADMIN_TAG, role: 'admin' },
      });
    });

    it('refuses a tampered or unknown session cookie', async () => {
      const { session } = await login(app);
      const [raw] = session!.split('.');
      for (const value of [raw!, `${raw}x.${session!.split('.')[1]}`, 'garbage']) {
        const res = await me(app, value);
        expect(res.json().user).toBeNull();
      }
    });

    it('expires sessions', async () => {
      const { session } = await login(app);
      await s.database.pool.query(`update sessions set expires_at = now() - interval '1 second'`);
      expect((await me(app, session)).json().user).toBeNull();
      const res = await app.inject({
        method: 'GET',
        url: '/admin/api/ping',
        cookies: { fl_session: session! },
      });
      expect(res.statusCode).toBe(401);
      const v1 = await app.inject({
        method: 'GET',
        url: '/v1/quests/xp',
        cookies: { fl_session: session! },
      });
      expect(v1.statusCode).toBe(401);
      expect(v1.json()).toEqual({ error: 'invalid or revoked token' });
    });

    it('slides the expiry once more than a day of it is used', async () => {
      const { session } = await login(app);
      // Fresh session: no renewal.
      const fresh = await me(app, session);
      expect(cookieOf(fresh, 'fl_session')).toBeUndefined();

      await s.database.pool.query(`update sessions set expires_at = now() + interval '5 days'`);
      const renewed = await me(app, session);
      expect(renewed.json().user).not.toBeNull();
      const cookie = cookieOf(renewed, 'fl_session') as Record<string, unknown>;
      expect(cookie?.maxAge).toBe(7 * 86400);
      expect(cookie?.value).toBe(session);
      const { rows } = await s.database.pool.query('select expires_at from sessions');
      const ttl = (rows[0].expires_at as Date).getTime() - Date.now();
      expect(ttl).toBeGreaterThan(7 * 86400_000 - 60_000);
    });

    it('logout needs the CSRF token, then deletes the session and clears the cookie', async () => {
      const { session } = await login(app);
      const { csrf } = (await me(app, session)).json();
      expect(csrf).toEqual(expect.any(String));

      for (const headers of [{}, { 'x-csrf-token': 'wrong' }] as Record<string, string>[]) {
        const refused = await app.inject({
          method: 'POST',
          url: '/admin/auth/logout',
          cookies: { fl_session: session! },
          headers,
        });
        expect(refused.statusCode).toBe(403);
        expect(await s.count('sessions')).toBe(1);
      }

      const out = await app.inject({
        method: 'POST',
        url: '/admin/auth/logout',
        cookies: { fl_session: session! },
        headers: { 'x-csrf-token': csrf },
      });
      expect(out.statusCode).toBe(204);
      expect(cookieOf(out, 'fl_session')?.value).toBe('');
      expect(await s.count('sessions')).toBe(0);
      expect((await me(app, session)).json().user).toBeNull();
    });

    it('CSRF tokens are per session', async () => {
      const a = await login(app);
      const b = await login(app);
      const csrfA = (await me(app, a.session)).json().csrf;
      const csrfB = (await me(app, b.session)).json().csrf;
      expect(csrfA).not.toBe(csrfB);
      const cross = await app.inject({
        method: 'POST',
        url: '/admin/auth/logout',
        cookies: { fl_session: b.session! },
        headers: { 'x-csrf-token': csrfA },
      });
      expect(cross.statusCode).toBe(403);
    });

    it('/admin/api writes need the CSRF header', async () => {
      const { session } = await login(app);
      const { csrf } = (await me(app, session)).json();
      const without = await app.inject({
        method: 'POST',
        url: '/admin/api/ping',
        cookies: { fl_session: session! },
      });
      expect(without.statusCode).toBe(403);
      expect(without.json()).toEqual({ error: 'invalid csrf token' });
      const withCsrf = await app.inject({
        method: 'POST',
        url: '/admin/api/ping',
        cookies: { fl_session: session! },
        headers: { 'x-csrf-token': csrf },
      });
      expect(withCsrf.statusCode).toBe(200);
    });
  });

  describe('/v1 reads', () => {
    it('work with a bearer token and with an admin session; sessions do not touch last_used_at', async () => {
      const bearer = await app.inject({ method: 'GET', url: '/v1/quests/xp', headers: s.auth });
      expect(bearer.statusCode).toBe(200);

      await s.database.pool.query('update api_tokens set last_used_at = null');
      const { session } = await login(app);
      for (const url of [
        '/v1/quests/xp',
        '/v1/runs/summary',
        '/v1/drops/rates',
        '/v1/professions/recipes',
        '/v1/export',
        '/v1/diagnostics',
      ]) {
        const res = await app.inject({ method: 'GET', url, cookies: { fl_session: session! } });
        expect(res.statusCode, url).toBe(200);
      }
      const { rows } = await s.database.pool.query(
        'select count(*)::int as n from api_tokens where last_used_at is not null',
      );
      expect(rows[0].n).toBe(0);

      const anon = await app.inject({ method: 'GET', url: '/v1/quests/xp' });
      expect(anon.statusCode).toBe(401);
      expect(anon.json()).toEqual({ error: 'invalid or revoked token' });
    });

    it('keeps the addon manifest and ingest bearer-only', async () => {
      const { session } = await login(app);
      const manifest = await app.inject({
        method: 'GET',
        url: '/v1/addon/manifest',
        cookies: { fl_session: session! },
      });
      expect(manifest.statusCode).toBe(401);
      const ingest = await app.inject({
        method: 'POST',
        url: '/v1/ingest',
        cookies: { fl_session: session! },
        payload: {},
      });
      expect(ingest.statusCode).toBe(401);
    });
  });

  describe('static admin panel', () => {
    it('serves index.html, assets, and falls back to index.html for client routes', async () => {
      const root = await app.inject({ method: 'GET', url: '/admin/' });
      expect(root.statusCode).toBe(200);
      expect(root.headers['content-type']).toMatch(/text\/html/);
      expect(root.body).toContain('Forever Ledger admin');

      const bare = await app.inject({ method: 'GET', url: '/admin' });
      expect(bare.statusCode).toBe(302);
      expect(bare.headers.location).toBe('/admin/');

      const asset = await app.inject({ method: 'GET', url: '/admin/assets/app-abc123.js' });
      expect(asset.statusCode).toBe(200);
      expect(asset.body).toContain('console.log');
      expect(asset.headers['cache-control']).toContain('immutable');

      for (const url of ['/admin/some/route', '/admin/quests?zone=12']) {
        const res = await app.inject({ method: 'GET', url });
        expect(res.statusCode, url).toBe(200);
        expect(res.body).toContain('Forever Ledger admin');
        expect(res.headers['cache-control']).toContain('no-cache');
      }
    });

    it('never falls back for /admin/api and /admin/auth', async () => {
      for (const url of ['/admin/api/unknown', '/admin/auth/unknown']) {
        const res = await app.inject({ method: 'GET', url });
        expect(res.statusCode, url).toBe(404);
        expect(res.headers['content-type']).toMatch(/application\/json/);
        expect(res.body).not.toContain('Forever Ledger admin');
      }
      const post = await app.inject({ method: 'POST', url: '/admin/some/route' });
      expect(post.statusCode).toBe(404);
    });

    it('answers 503 when the panel is not built', async () => {
      const other = await buildApp({
        database: s.database,
        admin: { distDir: join(distDir, 'does-not-exist') },
      });
      try {
        for (const url of ['/admin/', '/admin/some/route']) {
          const res = await other.inject({ method: 'GET', url });
          expect(res.statusCode, url).toBe(503);
          expect(res.body).toBe('admin panel not built');
        }
        const api = await other.inject({ method: 'GET', url: '/admin/api/unknown' });
        expect(api.statusCode).toBe(404);
      } finally {
        await other.close();
      }
    });
  });

  describe('rate limit', () => {
    it('limits /admin/auth/* per IP', async () => {
      const other = await buildApp({
        database: s.database,
        admin: adminOptions({ authPerMinute: 3 }),
      });
      try {
        const codes = [];
        for (let i = 0; i < 5; i++) codes.push((await me(other)).statusCode);
        expect(codes).toEqual([200, 200, 200, 429, 429]);
        // Only the auth routes: the SPA and /v1 are unaffected.
        expect((await other.inject({ method: 'GET', url: '/admin/' })).statusCode).toBe(200);
      } finally {
        await other.close();
      }
    });
  });

  describe('logging', () => {
    it('never logs codes, states, tokens, secrets or session cookies', async () => {
      const lines: string[] = [];
      const stream = new Writable({
        write(chunk, _enc, cb) {
          lines.push(String(chunk));
          cb();
        },
      });
      const logged = await buildApp({
        database: s.database,
        logger: { ...loggerOptions, level: 'trace', stream },
        admin: adminOptions(),
      });
      try {
        const { session } = await login(logged);
        const { csrf } = (await me(logged, session)).json();
        bnet.state.tokenStatus = 401;
        const start = await logged.inject({ method: 'GET', url: '/admin/auth/login' });
        const state = new URL(start.headers.location as string).searchParams.get('state')!;
        await logged.inject({
          method: 'GET',
          url: `/admin/auth/callback?code=${CODE}&state=${state}`,
          cookies: { fl_oauth_state: cookieOf(start, 'fl_oauth_state')!.value },
        });
        await logged.inject({
          method: 'POST',
          url: '/admin/auth/logout',
          cookies: { fl_session: session! },
          headers: { 'x-csrf-token': csrf },
        });
        const out = lines.join('');
        expect(out).toContain('/admin/auth/callback'); // requests are logged…
        for (const secret of [
          CODE,
          state,
          ACCESS_TOKEN,
          CLIENT_SECRET,
          COOKIE_SECRET,
          session!,
          session!.split('.')[0]!,
          csrf,
        ]) {
          expect(out, secret).not.toContain(secret); // …without their secrets
        }
      } finally {
        await logged.close();
      }
    });
  });
});
