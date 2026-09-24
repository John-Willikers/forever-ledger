// Admin panel data + access routes (/admin/api/*) against a real Postgres, with sessions seeded directly.
import { Writable } from 'node:stream';
import { NO_ADDON_RELEASE, RECORD_KINDS } from '@forever-ledger/contracts';
import type { UploadBatch } from '@forever-ledger/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, hashToken, loggerOptions, mintToken } from '../src/index.js';
import { createSession, csrfToken } from '../src/sessions.js';
import { batchFromFixture, startServer } from './helpers.js';

type Server = Awaited<ReturnType<typeof startServer>>;

const COOKIE_SECRET = 'test-cookie-secret-admin-api-0123456789abcdef';
const SESSION = '__Host-fl_session';
/** America/Chicago ISO: `2026-09-23T00:22:17-05:00`. */
const CHICAGO_ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d-0[56]:00$/;

interface TestSession {
  userId: number;
  cookies: Record<string, string>;
  csrf: string;
}

/** The v5 fixture as another character, so tokens can own different characters. */
function otherCharacterBatch(account: string, uploaderId: string): UploadBatch {
  const b = batchFromFixture('session-v5.lua', account, uploaderId);
  return {
    ...b,
    records: {
      ...b.records,
      characters: b.records.characters.map((c) => ({
        ...c,
        key: 'Boudreaux-Bayou',
        name: 'Boudreaux',
        class: 'PRIEST',
        level: 7,
      })),
    },
  };
}

const GETS = [
  '/admin/api/overview',
  '/admin/api/uploads',
  '/admin/api/uploads/hourly',
  '/admin/api/characters',
  '/admin/api/tokens',
  '/admin/api/users',
  '/admin/api/api-samples',
  '/admin/api/api-samples/ForeverLedger.errors',
];

describe('admin API (real Postgres)', () => {
  let s: Server;
  let admin: TestSession;
  let member: TestSession;
  let tray: { id: number; token: string };
  let cody: { id: number; token: string };
  const batches: UploadBatch[] = [];

  /** A user with a live session, as the Battle.net callback would leave it. */
  async function sessionFor(battletag: string, role: 'admin' | 'member'): Promise<TestSession> {
    const { rows } = await s.database.pool.query(
      `insert into users (bnet_sub, battletag, role) values ($1, $2, $3) returning id`,
      [`sub-${battletag}`, battletag, role],
    );
    const userId = rows[0].id as number;
    const value = await createSession(s.database.db, userId, {});
    return {
      userId,
      cookies: { [SESSION]: s.app.signCookie(value) },
      csrf: csrfToken(COOKIE_SECRET, hashToken(value)),
    };
  }

  const get = (url: string, who?: TestSession) =>
    s.app.inject({ method: 'GET', url, cookies: who?.cookies ?? {} });

  const post = (url: string, who: TestSession | undefined, body?: object, csrf = who?.csrf) =>
    s.app.inject({
      method: 'POST',
      url,
      cookies: who?.cookies ?? {},
      headers: csrf ? { 'x-csrf-token': csrf } : {},
      ...(body === undefined ? {} : { payload: body }),
    });

  const ingest = async (token: string, batch: UploadBatch) => {
    const res = await s.app.inject({
      method: 'POST',
      url: '/v1/ingest',
      headers: { authorization: `Bearer ${token}` },
      payload: batch,
    });
    expect(res.statusCode, res.body).toBe(200);
    batches.push(batch);
  };

  beforeAll(async () => {
    s = await startServer({
      admin: { cookieSecret: COOKIE_SECRET, authPerMinute: 10_000 },
      diagnosticsPerMinute: 10_000,
    });
    admin = await sessionFor('JohnWilliker#1292', 'admin');
    member = await sessionFor('Friend#1111', 'member');
    tray = await mintToken(s.database.db, 'gaming-pc-tray');
    cody = await mintToken(s.database.db, 'cody');

    await ingest(tray.token, batchFromFixture('session-v5.lua', 'ACCOUNT1', 'pc-1'));
    await ingest(cody.token, otherCharacterBatch('ACCOUNT2', 'pc-2'));
    await ingest(tray.token, batchFromFixture('professions-v4.lua', 'ACCOUNT1', 'pc-1'));

    // One refused batch (ingest error) and two tray-app reports.
    const bad = await s.app.inject({
      method: 'POST',
      url: '/v1/ingest',
      headers: { authorization: `Bearer ${tray.token}` },
      payload: { schemaVersion: 99, uploaderId: 'pc-1', account: 'ACCOUNT1' },
    });
    expect(bad.statusCode).toBe(409);
    for (const [token, report] of [
      [
        tray.token,
        {
          uploaderId: 'pc-1',
          appVersion: '0.1.3',
          platform: 'win32 10.0.22631',
          events: [{ at: 1_790_000_000, level: 'warn', source: 'addon-sync', message: 'slow' }],
        },
      ],
      [
        tray.token,
        {
          uploaderId: 'pc-1',
          appVersion: '0.1.4',
          platform: 'win32 10.0.22631',
          events: [
            { at: 1_790_000_100, level: 'error', source: 'uploader', message: 'network error' },
          ],
        },
      ],
    ] as const) {
      const res = await s.app.inject({
        method: 'POST',
        url: '/v1/diagnostics',
        headers: { authorization: `Bearer ${token}` },
        payload: report,
      });
      expect(res.statusCode).toBe(200);
    }
  });
  afterAll(async () => {
    await s?.stop();
  });

  describe('authorization', () => {
    it('every GET needs an admin session', async () => {
      for (const url of GETS) {
        const anon = await get(url);
        expect(anon.statusCode, url).toBe(401);
        for (const headers of [s.auth, s.readerAuth]) {
          const bearer = await s.app.inject({ method: 'GET', url, headers });
          expect(bearer.statusCode, url).toBe(401);
        }
        const m = await get(url, member);
        expect(m.statusCode, url).toBe(403);
        const ok = await get(url, admin);
        expect(ok.statusCode, `${url} ${ok.body}`).toBe(200);
        expect(ok.headers['cache-control'], url).toBe('no-store');
      }
    });

    it('every write needs an admin session and the CSRF header, and changes nothing otherwise', async () => {
      const writes: [string, object | undefined][] = [
        ['/admin/api/tokens', { label: 'sneaky' }],
        [`/admin/api/tokens/${cody.id}/revoke`, undefined],
        [`/admin/api/tokens/${cody.id}/owner`, { userId: member.userId }],
        [`/admin/api/tokens/${cody.id}/read`, { canRead: true }],
        [`/admin/api/users/${member.userId}/role`, { role: 'admin' }],
      ];
      const snapshot = async () =>
        (
          await s.database.pool.query(
            `select (select json_agg(t order by id) from (select id, label, revoked_at, user_id, can_read from api_tokens) t) as tokens,
                    (select json_agg(u order by id) from (select id, role from users) u) as users`,
          )
        ).rows[0];
      const before = await snapshot();
      for (const [url, body] of writes) {
        expect((await post(url, undefined, body)).statusCode, url).toBe(401);
        expect((await post(url, member, body)).statusCode, url).toBe(403);
        const noCsrf = await post(url, admin, body, '');
        expect(noCsrf.statusCode, url).toBe(403);
        expect(noCsrf.json(), url).toEqual({ error: 'invalid csrf token' });
        const wrongCsrf = await post(url, admin, body, member.csrf);
        expect(wrongCsrf.statusCode, url).toBe(403);
      }
      expect(await snapshot()).toEqual(before);
    });
  });

  describe('overview', () => {
    it('counts uploads, records by kind, characters, accounts, uploaders, builds, versions and health', async () => {
      const res = await get('/admin/api/overview', admin);
      const o = res.json();
      expect(o.generatedAt).toMatch(CHICAGO_ISO);
      expect(o.uploads).toEqual({ today: 3, last7d: 3, total: 3, lastAt: expect.any(String) });
      expect(o.uploads.lastAt).toMatch(CHICAGO_ISO);

      const expected = new Map<string, number>();
      for (const b of batches)
        for (const k of RECORD_KINDS) {
          const n = b.records[k].length;
          if (n) expected.set(k, (expected.get(k) ?? 0) + n);
        }
      expect(
        Object.fromEntries(
          o.recordsByKind.map((r: { kind: string; count: number }) => [r.kind, r.count]),
        ),
      ).toEqual(Object.fromEntries(expected));
      // Biggest first.
      const counts = o.recordsByKind.map((r: { count: number }) => r.count);
      expect(counts).toEqual([...counts].sort((a, b) => b - a));
      expect(o.totals).toEqual({
        characters: 2,
        accounts: 2,
        uploaders: 2,
        records: [...expected.values()].reduce((a, b) => a + b, 0),
      });

      expect(o.builds.map((b: { build: number }) => b.build).sort()).toEqual([61582, 69977]);
      const b61582 = o.builds.find((b: { build: number }) => b.build === 61582);
      expect(b61582).toMatchObject({ version: '1.15.7', uploads: 2 });
      expect(b61582.firstSeen).toMatch(CHICAGO_ISO);
      expect(b61582.lastSeen).toMatch(CHICAGO_ISO);

      // Latest upload per uploader: pc-1 last sent professions-v4 (0.3.0), pc-2 sent v5 (0.3.3).
      expect(o.versions.addon).toEqual([
        { version: '0.3.3', uploaders: 1, lastSeen: expect.stringMatching(CHICAGO_ISO) },
        { version: '0.3.0', uploaders: 1, lastSeen: expect.stringMatching(CHICAGO_ISO) },
      ]);
      // Latest report per uploader: pc-1 now runs 0.1.4.
      expect(o.versions.tray).toEqual([
        { version: '0.1.4', uploaders: 1, lastSeen: expect.stringMatching(CHICAGO_ISO) },
      ]);

      expect(o.health.ingestErrors7d).toBe(1);
      expect(o.health.diagnostics7d).toEqual({ warn: 1, error: 1 });
      expect(o.health.flaggedSamples.map((f: { api: string }) => f.api).sort()).toEqual([
        'ForeverLedger.errors',
        'ForeverLedger.fieldMisses',
      ]);
      for (const f of o.health.flaggedSamples) {
        expect(f.build).toBe(61582);
        expect(f.entries).toBeGreaterThan(0);
        expect(f.observedAt).toMatch(CHICAGO_ISO);
      }
    });
  });

  describe('uploads', () => {
    it('lists recent uploads newest first with counts per kind, never the records', async () => {
      await s.database.pool.query('update api_tokens set user_id = $1 where id = $2', [
        admin.userId,
        tray.id,
      ]);
      try {
        const res = await get('/admin/api/uploads', admin);
        const { items, nextBefore } = res.json();
        expect(items).toHaveLength(3);
        expect(nextBefore).toBeNull();
        expect(items.map((u: { id: number }) => u.id)).toEqual(
          [...items.map((u: { id: number }) => u.id)].sort((a, b) => b - a),
        );
        const [latest, second] = items;
        expect(latest).toEqual({
          id: expect.any(Number),
          receivedAt: expect.stringMatching(CHICAGO_ISO),
          tokenId: tray.id,
          tokenLabel: 'gaming-pc-tray',
          owner: { id: admin.userId, battletag: 'JohnWilliker#1292' },
          uploaderId: 'pc-1',
          account: 'ACCOUNT1',
          schemaVersion: 4,
          clientBuild: 69977,
          addonVersion: '0.3.0',
          records: Object.fromEntries(
            RECORD_KINDS.filter((k) => batches[2]!.records[k].length > 0).map((k) => [
              k,
              batches[2]!.records[k].length,
            ]),
          ),
          total: RECORD_KINDS.reduce((n, k) => n + batches[2]!.records[k].length, 0),
        });
        expect(second).toMatchObject({ tokenLabel: 'cody', owner: null, account: 'ACCOUNT2' });
        // No record contents: no character names, item names, samples.
        expect(res.body).not.toContain('Thibodeaux');
        expect(res.body).not.toContain('Boudreaux');
        expect(res.body).not.toContain('payload');
      } finally {
        await s.database.pool.query('update api_tokens set user_id = null');
      }
    });

    it('pages with ?limit= and ?before=', async () => {
      const first = (await get('/admin/api/uploads?limit=2', admin)).json();
      expect(first.items).toHaveLength(2);
      expect(first.nextBefore).toBe(first.items[1].id);
      const rest = (
        await get(`/admin/api/uploads?limit=2&before=${first.nextBefore}`, admin)
      ).json();
      expect(rest.items).toHaveLength(1);
      expect(rest.items[0].id).toBeLessThan(first.nextBefore);
      expect(rest.nextBefore).toBeNull();
      // Nonsense falls back to the defaults.
      const junk = await get('/admin/api/uploads?limit=-4&before=abc', admin);
      expect(junk.statusCode).toBe(200);
      expect(junk.json().items).toHaveLength(3);
    });

    it('counts uploads per hour (America/Chicago), empty hours included', async () => {
      const res = (await get('/admin/api/uploads/hourly', admin)).json();
      expect(res.days).toBe(7);
      expect(res.buckets).toHaveLength(7 * 24 + 1);
      for (const b of res.buckets) {
        expect(b.hour).toMatch(/^\d{4}-\d\d-\d\dT\d\d:00:00-0[56]:00$/);
        expect(Number.isInteger(b.count)).toBe(true);
      }
      expect(res.buckets.reduce((n: number, b: { count: number }) => n + b.count, 0)).toBe(3);
      // Everything was uploaded just now: the current hour (or the one before, right at the turn of an hour).
      expect(res.buckets.at(-1).count + res.buckets.at(-2).count).toBe(3);
      // Hours are consecutive.
      const times = res.buckets.map((b: { hour: string }) => Date.parse(b.hour));
      for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBe(3_600_000);

      expect((await get('/admin/api/uploads/hourly?days=1', admin)).json().buckets).toHaveLength(
        25,
      );
      expect((await get('/admin/api/uploads/hourly?days=400', admin)).json().days).toBe(31);
      expect((await get('/admin/api/uploads/hourly?days=zzz', admin)).json().days).toBe(7);
    });
  });

  describe('characters', () => {
    it('lists characters with the owners of the tokens that uploaded them', async () => {
      const list = async () => (await get('/admin/api/characters', admin)).json().items;
      const byKey = async () =>
        new Map((await list()).map((c: { key: string }) => [c.key, c])) as Map<
          string,
          Record<string, unknown>
        >;

      let chars = await byKey();
      expect([...chars.keys()].sort()).toEqual(['Boudreaux-Bayou', 'Thibodeaux-Bayou']);
      const thib = chars.get('Thibodeaux-Bayou')!;
      expect(thib).toMatchObject({
        name: 'Thibodeaux',
        realm: 'Bayou',
        class: 'HUNTER',
        owners: [],
        tokens: [{ id: tray.id, label: 'gaming-pc-tray' }],
      });
      expect(thib.lastSeen).toMatch(CHICAGO_ISO);
      expect(chars.get('Boudreaux-Bayou')).toMatchObject({
        class: 'PRIEST',
        level: 7,
        owners: [],
        tokens: [{ id: cody.id, label: 'cody' }],
      });

      // Assigning token owners through the API shows up here.
      const friend = await sessionFor('Cody#2222', 'member');
      try {
        expect(
          (await post(`/admin/api/tokens/${tray.id}/owner`, admin, { userId: admin.userId }))
            .statusCode,
        ).toBe(200);
        expect(
          (await post(`/admin/api/tokens/${cody.id}/owner`, admin, { userId: friend.userId }))
            .statusCode,
        ).toBe(200);
        chars = await byKey();
        expect(chars.get('Thibodeaux-Bayou')!.owners).toEqual([
          { id: admin.userId, battletag: 'JohnWilliker#1292' },
        ]);
        expect(chars.get('Boudreaux-Bayou')!.owners).toEqual([
          { id: friend.userId, battletag: 'Cody#2222' },
        ]);

        // Clearing the owner.
        const cleared = await post(`/admin/api/tokens/${tray.id}/owner`, admin, { userId: null });
        expect(cleared.json()).toEqual({ id: tray.id, owner: null });
        expect((await byKey()).get('Thibodeaux-Bayou')!.owners).toEqual([]);
      } finally {
        await s.database.pool.query('update api_tokens set user_id = null');
        await s.database.pool.query('delete from users where id = $1', [friend.userId]);
      }
    });
  });

  describe('tokens', () => {
    it('lists tokens with owner, uploads and last upload, never a hash or plaintext', async () => {
      const res = await get('/admin/api/tokens', admin);
      const items = res.json().items as Record<string, unknown>[];
      const t = items.find((i) => i.id === tray.id)!;
      expect(t).toEqual({
        id: tray.id,
        label: 'gaming-pc-tray',
        createdAt: expect.stringMatching(CHICAGO_ISO),
        revokedAt: null,
        lastUsedAt: expect.stringMatching(CHICAGO_ISO),
        owner: null,
        canRead: false,
        uploads: 2,
        lastUploadAt: expect.stringMatching(CHICAGO_ISO),
      });
      expect(items.find((i) => i.id === cody.id)).toMatchObject({ uploads: 1 });
      expect(items.find((i) => i.label === 'test')).toMatchObject({
        canRead: false,
        uploads: 0,
        lastUploadAt: null,
      });
      expect(items.find((i) => i.label === 'test-reader')).toMatchObject({ canRead: true });
      expect(res.body).not.toContain(tray.token);
      expect(res.body).not.toContain(hashToken(tray.token));
      expect(res.body).not.toMatch(/token_?hash/i);
    });

    it('mints a token: plaintext in the response once, only its hash stored', async () => {
      const res = await post('/admin/api/tokens', admin, {
        label: '  sam laptop ',
        ownerUserId: member.userId,
      });
      expect(res.statusCode).toBe(201);
      const minted = res.json();
      expect(minted).toEqual({
        id: expect.any(Number),
        label: 'sam laptop',
        owner: { id: member.userId, battletag: 'Friend#1111' },
        canRead: false,
        token: expect.stringMatching(/^flt_[A-Za-z0-9_-]{43}$/),
      });
      const { rows } = await s.database.pool.query('select * from api_tokens where id = $1', [
        minted.id,
      ]);
      expect(rows[0].token_hash).toBe(hashToken(minted.token));
      expect(rows[0].user_id).toBe(member.userId);
      expect(rows[0].can_read).toBe(false);
      expect(JSON.stringify(rows[0])).not.toContain(minted.token);

      // An upload token by default: accepted on upload routes but can't read; the list never shows it again.
      const manifest = await s.app.inject({
        method: 'GET',
        url: '/v1/addon/manifest',
        headers: { authorization: `Bearer ${minted.token}` },
      });
      expect(manifest.statusCode).toBe(404); // past the token check: nothing published here
      expect(manifest.json()).toEqual({ error: NO_ADDON_RELEASE });
      const read = await s.app.inject({
        method: 'GET',
        url: '/v1/quests/xp',
        headers: { authorization: `Bearer ${minted.token}` },
      });
      expect(read.statusCode).toBe(403);
      const list = await get('/admin/api/tokens', admin);
      expect(list.body).not.toContain(minted.token);
      expect(list.json().items.find((i: { id: number }) => i.id === minted.id)).toMatchObject({
        label: 'sam laptop',
        owner: { id: member.userId, battletag: 'Friend#1111' },
      });

      // Without an owner.
      const plain = await post('/admin/api/tokens', admin, { label: 'spare' });
      expect(plain.statusCode).toBe(201);
      expect(plain.json().owner).toBeNull();

      // A reader token, asked for explicitly.
      const reader = await post('/admin/api/tokens', admin, { label: 'script', canRead: true });
      expect(reader.statusCode).toBe(201);
      expect(reader.json()).toMatchObject({ label: 'script', canRead: true });
      const readOk = await s.app.inject({
        method: 'GET',
        url: '/v1/quests/xp',
        headers: { authorization: `Bearer ${reader.json().token}` },
      });
      expect(readOk.statusCode).toBe(200);
    });

    it('refuses bad mint requests without creating a token', async () => {
      const before = await s.count('api_tokens');
      for (const body of [
        {},
        { label: '' },
        { label: '   ' },
        { label: 42 },
        { label: 'x'.repeat(101) },
        { label: 'ok', ownerUserId: 999_999 },
        { label: 'ok', ownerUserId: 'one' },
        { label: 'ok', canRead: 'yes' },
        { label: 'ok', canRead: 1 },
      ]) {
        const res = await post('/admin/api/tokens', admin, body);
        expect(res.statusCode, JSON.stringify(body)).toBe(400);
      }
      expect(await s.count('api_tokens')).toBe(before);
    });

    it('never logs the minted token', async () => {
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
        admin: { cookieSecret: COOKIE_SECRET },
      });
      try {
        const res = await logged.inject({
          method: 'POST',
          url: '/admin/api/tokens',
          cookies: admin.cookies,
          headers: { 'x-csrf-token': admin.csrf },
          payload: { label: 'logged' },
        });
        expect(res.statusCode).toBe(201);
        const { token, id } = res.json();
        const out = lines.join('');
        expect(out).toContain('/admin/api/tokens');
        expect(out).not.toContain(token);
        expect(out).not.toContain(hashToken(token));
        await s.database.pool.query('delete from api_tokens where id = $1', [id]);
      } finally {
        await logged.close();
      }
    });

    it('revokes a token (idempotent); the token stops working', async () => {
      const t = await mintToken(s.database.db, 'to-revoke');
      const res = await post(`/admin/api/tokens/${t.id}/revoke`, admin);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        id: t.id,
        revokedAt: expect.stringMatching(CHICAGO_ISO),
        alreadyRevoked: false,
      });
      const read = await s.app.inject({
        method: 'GET',
        url: '/v1/addon/manifest',
        headers: { authorization: `Bearer ${t.token}` },
      });
      expect(read.statusCode).toBe(401);
      const again = await post(`/admin/api/tokens/${t.id}/revoke`, admin);
      expect(again.statusCode).toBe(200);
      expect(again.json()).toMatchObject({ alreadyRevoked: true, revokedAt: res.json().revokedAt });

      expect((await post('/admin/api/tokens/999999/revoke', admin)).statusCode).toBe(404);
      expect((await post('/admin/api/tokens/abc/revoke', admin)).statusCode).toBe(400);
    });

    it('assigns and clears owners; refuses unknown tokens and users', async () => {
      const res = await post(`/admin/api/tokens/${cody.id}/owner`, admin, {
        userId: member.userId,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        id: cody.id,
        owner: { id: member.userId, battletag: 'Friend#1111' },
      });
      const cleared = await post(`/admin/api/tokens/${cody.id}/owner`, admin, { userId: null });
      expect(cleared.json()).toEqual({ id: cody.id, owner: null });

      expect(
        (await post(`/admin/api/tokens/${cody.id}/owner`, admin, { userId: 999_999 })).statusCode,
      ).toBe(400);
      expect((await post(`/admin/api/tokens/${cody.id}/owner`, admin, {})).statusCode).toBe(400);
      expect(
        (await post('/admin/api/tokens/999999/owner', admin, { userId: null })).statusCode,
      ).toBe(404);
    });
  });

  describe('token read scope', () => {
    const readAs = (token: string) =>
      s.app.inject({
        method: 'GET',
        url: '/v1/quests/xp',
        headers: { authorization: `Bearer ${token}` },
      });

    it('grants and takes back read access; the token follows at once', async () => {
      const t = await mintToken(s.database.db, 'scope-toggle');
      expect((await readAs(t.token)).statusCode).toBe(403);

      const grant = await post(`/admin/api/tokens/${t.id}/read`, admin, { canRead: true });
      expect(grant.statusCode).toBe(200);
      expect(grant.json()).toEqual({ id: t.id, canRead: true });
      expect((await readAs(t.token)).statusCode).toBe(200);
      const listed = (await get('/admin/api/tokens', admin)).json().items;
      expect(listed.find((i: { id: number }) => i.id === t.id)).toMatchObject({ canRead: true });

      const take = await post(`/admin/api/tokens/${t.id}/read`, admin, { canRead: false });
      expect(take.json()).toEqual({ id: t.id, canRead: false });
      const refused = await readAs(t.token);
      expect(refused.statusCode).toBe(403);
      expect(refused.json()).toEqual({ error: 'token cannot read' });
    });

    it('refuses bad bodies and unknown tokens', async () => {
      const t = await mintToken(s.database.db, 'scope-bad');
      for (const body of [{}, { canRead: 'true' }, { canRead: 1 }, { canRead: null }]) {
        const res = await post(`/admin/api/tokens/${t.id}/read`, admin, body);
        expect(res.statusCode, JSON.stringify(body)).toBe(400);
      }
      expect(
        (await post('/admin/api/tokens/999999/read', admin, { canRead: true })).statusCode,
      ).toBe(404);
      expect((await post('/admin/api/tokens/abc/read', admin, { canRead: true })).statusCode).toBe(
        400,
      );
      const { rows } = await s.database.pool.query(
        'select can_read from api_tokens where id = $1',
        [t.id],
      );
      expect(rows[0].can_read).toBe(false);
    });

    it('a revoked token stays revoked when granted read access', async () => {
      const t = await mintToken(s.database.db, 'scope-revoked');
      await post(`/admin/api/tokens/${t.id}/revoke`, admin);
      expect(
        (await post(`/admin/api/tokens/${t.id}/read`, admin, { canRead: true })).statusCode,
      ).toBe(200);
      expect((await readAs(t.token)).statusCode).toBe(401);
    });
  });

  describe('users', () => {
    const resetRoles = async () => {
      await s.database.pool.query(
        `update users set role = case when id = $1 then 'admin' else 'member' end`,
        [admin.userId],
      );
    };
    beforeEach(resetRoles);
    afterEach(resetRoles);

    it('lists users with their token counts', async () => {
      await s.database.pool.query('update api_tokens set user_id = null');
      await s.database.pool.query('update api_tokens set user_id = $1 where id in ($2, $3)', [
        admin.userId,
        tray.id,
        cody.id,
      ]);
      try {
        const items = (await get('/admin/api/users', admin)).json().items;
        expect(items.find((u: { id: number }) => u.id === admin.userId)).toEqual({
          id: admin.userId,
          battletag: 'JohnWilliker#1292',
          role: 'admin',
          createdAt: expect.stringMatching(CHICAGO_ISO),
          lastLoginAt: null,
          tokens: 2,
        });
        expect(items.find((u: { id: number }) => u.id === member.userId)).toMatchObject({
          role: 'member',
          tokens: 0,
        });
      } finally {
        await s.database.pool.query('update api_tokens set user_id = null');
      }
    });

    it('changes roles; the last admin cannot demote themselves', async () => {
      const last = await post(`/admin/api/users/${admin.userId}/role`, admin, { role: 'member' });
      expect(last.statusCode).toBe(409);
      expect(last.json()).toEqual({ error: 'cannot demote the last admin' });

      const promote = await post(`/admin/api/users/${member.userId}/role`, admin, {
        role: 'admin',
      });
      expect(promote.statusCode).toBe(200);
      expect(promote.json()).toEqual({ id: member.userId, role: 'admin' });
      // The promoted user can use the admin API right away (roles are read per request).
      expect((await get('/admin/api/users', member)).statusCode).toBe(200);

      // With a second admin, demoting yourself works, and takes effect immediately.
      const self = await post(`/admin/api/users/${admin.userId}/role`, admin, { role: 'member' });
      expect(self.statusCode).toBe(200);
      expect((await get('/admin/api/users', admin)).statusCode).toBe(403);
    });

    it('refuses unknown users and roles', async () => {
      expect(
        (await post('/admin/api/users/999999/role', admin, { role: 'admin' })).statusCode,
      ).toBe(404);
      expect(
        (await post(`/admin/api/users/${member.userId}/role`, admin, { role: 'owner' })).statusCode,
      ).toBe(400);
      expect((await post('/admin/api/users/x/role', admin, { role: 'admin' })).statusCode).toBe(
        400,
      );
    });
  });

  describe('api samples', () => {
    it('lists samples with size and flags, errors and fieldMisses first', async () => {
      const items = (await get('/admin/api/api-samples', admin)).json().items;
      expect(items.length).toBeGreaterThan(5);
      expect(
        items
          .slice(0, 2)
          .map((i: { api: string }) => i.api)
          .sort(),
      ).toEqual(['ForeverLedger.errors', 'ForeverLedger.fieldMisses']);
      const errs = items.find((i: { api: string }) => i.api === 'ForeverLedger.errors');
      expect(errs).toEqual({
        api: 'ForeverLedger.errors',
        build: 61582,
        observedAt: expect.stringMatching(CHICAGO_ISO),
        size: expect.any(Number),
        flag: 'errors',
        entries: expect.any(Number),
      });
      expect(errs.entries).toBeGreaterThan(0);
      const plain = items.find((i: { api: string }) => i.api === 'UnitCastingInfo');
      expect(plain.flag).toBeNull();
      expect(items[0]).not.toHaveProperty('sample');
    });

    it('returns one sample (latest build by default, or ?build=)', async () => {
      const res = await get('/admin/api/api-samples/ForeverLedger.fieldMisses', admin);
      expect(res.statusCode).toBe(200);
      const expected = batches[0]!.records.apiSamples.find(
        (a) => a.api === 'ForeverLedger.fieldMisses',
      )!;
      expect(res.json()).toEqual({
        api: 'ForeverLedger.fieldMisses',
        build: 61582,
        observedAt: expect.stringMatching(CHICAGO_ISO),
        sample: expected.sample,
        builds: [61582],
      });
      // An api seen in two builds: newest build unless asked.
      const recipe = encodeURIComponent('C_TradeSkillUI.GetRecipeInfo');
      const latest = (await get(`/admin/api/api-samples/${recipe}`, admin)).json();
      expect(latest.build).toBe(69977);
      expect(latest.builds).toEqual([69977, 61582]);
      const older = (await get(`/admin/api/api-samples/${recipe}?build=61582`, admin)).json();
      expect(older.build).toBe(61582);

      expect((await get('/admin/api/api-samples/Nope.nothing', admin)).statusCode).toBe(404);
      expect((await get(`/admin/api/api-samples/${recipe}?build=1`, admin)).statusCode).toBe(404);
    });
  });

  describe('diagnostics filters (/v1/diagnostics with an admin session)', () => {
    const list = async (q: string) => {
      const res = await get(`/v1/diagnostics${q}`, admin);
      expect(res.statusCode, res.body).toBe(200);
      return res.json().items as { type: string; level?: string; source?: string }[];
    };

    it('filters by type, level and source; ingest errors count as level error, source ingest', async () => {
      expect((await list('')).length).toBe(3);
      expect((await list('?type=ingest-error')).map((i) => i.type)).toEqual(['ingest-error']);
      expect((await list('?type=diagnostic')).map((i) => i.level).sort()).toEqual([
        'error',
        'warn',
      ]);
      expect((await list('?level=warn')).map((i) => i.source)).toEqual(['addon-sync']);
      expect((await list('?level=error')).map((i) => i.type).sort()).toEqual([
        'diagnostic',
        'ingest-error',
      ]);
      expect((await list('?source=uploader')).map((i) => i.level)).toEqual(['error']);
      expect((await list('?source=ingest')).map((i) => i.type)).toEqual(['ingest-error']);
      expect(await list('?source=ingest&type=diagnostic')).toEqual([]);
    });

    it('refuses unknown filter values', async () => {
      for (const q of ['?type=x', '?level=debug', '?source=nope']) {
        expect((await get(`/v1/diagnostics${q}`, admin)).statusCode, q).toBe(400);
      }
    });
  });
});
