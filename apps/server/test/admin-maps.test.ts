// Zone map routes (/admin/api/maps*, /admin/maps/:uiMapId) against a real Postgres: admin-only uploads validated by
// magic bytes, served back byte-identical with an ETag, and the list of uiMapIDs our data has points on.
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashToken } from '../src/index.js';
import { MAX_IMAGE_BYTES } from '../src/images.js';
import { createSession, csrfToken } from '../src/sessions.js';
import { jpeg, png, pngHeaderOnly, webpLossless, webpLossy } from './image-fixtures.js';
import { batchFromFixture, startServer } from './helpers.js';

type Server = Awaited<ReturnType<typeof startServer>>;

const COOKIE_SECRET = 'test-cookie-secret-admin-maps-0123456789abcdef';
const SESSION = '__Host-fl_session';
const CHICAGO_ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d-0[56]:00$/;

interface TestSession {
  userId: number;
  cookies: Record<string, string>;
  csrf: string;
}

describe('zone maps (real Postgres)', () => {
  let s: Server;
  let admin: TestSession;
  let member: TestSession;
  let distDir: string;

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

  const get = (url: string, who?: TestSession, headers: Record<string, string> = {}) =>
    s.app.inject({ method: 'GET', url, cookies: who?.cookies ?? {}, headers });

  const put = (
    url: string,
    who: TestSession | undefined,
    body: Buffer | string,
    contentType = 'image/png',
    csrf = who?.csrf,
  ) =>
    s.app.inject({
      method: 'PUT',
      url,
      cookies: who?.cookies ?? {},
      headers: { 'content-type': contentType, ...(csrf ? { 'x-csrf-token': csrf } : {}) },
      payload: body,
    });

  const del = (url: string, who: TestSession | undefined, csrf = who?.csrf) =>
    s.app.inject({
      method: 'DELETE',
      url,
      cookies: who?.cookies ?? {},
      headers: csrf ? { 'x-csrf-token': csrf } : {},
    });

  beforeAll(async () => {
    distDir = mkdtempSync(join(tmpdir(), 'fl-admin-dist-'));
    writeFileSync(
      join(distDir, 'index.html'),
      '<!doctype html><title>Forever Ledger admin</title>',
    );
    s = await startServer({ admin: { cookieSecret: COOKIE_SECRET, distDir } });
    admin = await sessionFor('JohnWilliker#1292', 'admin');
    member = await sessionFor('Friend#1111', 'member');
    for (const name of ['session-v5.lua', 'professions-v4.lua']) {
      const res = await s.app.inject({
        method: 'POST',
        url: '/v1/ingest',
        headers: s.auth,
        payload: batchFromFixture(name),
      });
      expect(res.statusCode, res.body).toBe(200);
    }
    // Uploaded jsonb that doesn't have the contract's shape never breaks the list.
    await s.database.pool.query(
      `insert into nodes (object_id, build, uploader_id, account, session, opened, spots) values
         (9001, 69977, 'pc-x', 'X', 's1', 1, '"not an array"'),
         (9002, 69977, 'pc-x', 'X', 's1', 1, '[{"mapId": "1411", "points": [[1, 2]]}, 5, {"mapId": 1.5}]'),
         (9003, 69977, 'pc-x', 'X', 's1', 3,
          '[{"mapId": 1411, "points": [[43.2, 68.5], [50, 50]]}, {"mapId": 1411, "points": "x"}]')`,
    );
  });

  afterAll(async () => {
    await s?.stop();
    rmSync(distDir, { recursive: true, force: true });
  });

  describe('access', () => {
    it('needs an admin session for every route, and CSRF on PUT/DELETE', async () => {
      const image = png(3, 2);
      for (const url of ['/admin/api/maps', '/admin/api/map-images', '/admin/maps/1429']) {
        expect((await get(url)).statusCode, url).toBe(401);
        expect((await get(url, member)).statusCode, url).toBe(403);
        // Upload tokens and reader tokens don't open the panel's routes.
        expect((await s.app.inject({ method: 'GET', url, headers: s.readerAuth })).statusCode).toBe(
          401,
        );
      }
      expect((await put('/admin/api/maps/1429', undefined, image)).statusCode).toBe(401);
      expect((await put('/admin/api/maps/1429', member, image)).statusCode).toBe(403);
      const noCsrf = await put('/admin/api/maps/1429', admin, image, 'image/png', '');
      expect(noCsrf.statusCode).toBe(403);
      expect(noCsrf.json()).toEqual({ error: 'invalid csrf token' });
      const wrongCsrf = await put('/admin/api/maps/1429', admin, image, 'image/png', member.csrf);
      expect(wrongCsrf.statusCode).toBe(403);
      expect((await del('/admin/api/maps/1429', admin, '')).statusCode).toBe(403);
      expect((await del('/admin/api/maps/1429', member)).statusCode).toBe(403);
      expect(await s.count('zone_maps')).toBe(0);
    });

    it('refuses an oversized body before any session work for anonymous callers', async () => {
      const res = await put('/admin/api/maps/1429', undefined, Buffer.alloc(MAX_IMAGE_BYTES + 1));
      expect([401, 413]).toContain(res.statusCode);
    });
  });

  describe('list', () => {
    it('lists every uiMapID seen, with its zone name and point counts', async () => {
      const res = await get('/admin/api/maps', admin);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const body = res.json() as {
        latestBuild: number | null;
        maps: {
          uiMapId: number;
          zone: string | null;
          points: { gathering: number; quests: number; npcs: number; total: number };
          image: unknown;
        }[];
      };
      expect(body.latestBuild).toBe(69977);
      const byId = new Map(body.maps.map((m) => [m.uiMapId, m]));
      // Goldshire: quest giver/ender and a trainer (session-v5), node spots (3 in session-v5, 3 in professions-v4).
      const elwynn = byId.get(1429)!;
      expect(elwynn.zone).toBe('Elwynn Forest');
      expect(elwynn.points.gathering).toBe(6);
      expect(elwynn.points.quests).toBeGreaterThan(0);
      expect(elwynn.points.npcs).toBeGreaterThan(0);
      expect(elwynn.points.total).toBe(
        elwynn.points.gathering + elwynn.points.quests + elwynn.points.npcs,
      );
      expect(elwynn.image).toBeNull();
      // professions-v4: a trainer and a vendor in Stormwind.
      expect(byId.get(1453)).toMatchObject({
        zone: 'Stormwind City',
        points: { gathering: 0, quests: 0, npcs: 2 },
      });
      // Only well-formed spots count; no name known for a map only gathered on.
      expect(byId.get(1411)).toMatchObject({ zone: null, points: { gathering: 2, total: 2 } });
      expect([...byId.keys()].every((id) => Number.isInteger(id) && id > 0)).toBe(true);
    });
  });

  describe('upload, serve, delete', () => {
    const formats = [
      ['image/png', png(1002, 668, (x, y) => [x % 256, y % 256, 90])],
      ['image/webp', webpLossy(1002, 668)],
      ['image/webp', webpLossless(501, 334)],
      ['image/jpeg', jpeg(1002, 668)],
    ] as const;

    it.each(formats)('stores %s and serves the same bytes with an ETag', async (mime, bytes) => {
      const up = await put('/admin/api/maps/1429?build=69977', admin, bytes, mime);
      expect(up.statusCode, up.body).toBe(200);
      const sha = createHash('sha256').update(bytes).digest('hex');
      const { map, warnings } = up.json();
      expect(map).toMatchObject({
        uiMapId: 1429,
        name: 'Elwynn Forest',
        mime,
        size: bytes.length,
        sha256: sha,
        build: 69977,
        uploadedBy: 'JohnWilliker#1292',
      });
      expect(map.uploadedAt).toMatch(CHICAGO_ISO);
      expect(warnings).toEqual([]);

      const img = await get('/admin/maps/1429', admin);
      expect(img.statusCode).toBe(200);
      expect(img.headers['content-type']).toBe(mime);
      expect(img.rawPayload.equals(bytes)).toBe(true);
      expect(img.headers.etag).toBe(`"${sha}"`);
      expect(img.headers['cache-control']).toBe('private, max-age=86400');
      expect(img.headers['x-content-type-options']).toBe('nosniff');
      expect(img.headers['content-security-policy']).toContain("default-src 'none'");

      for (const inm of [`"${sha}"`, `W/"${sha}"`, `"other", "${sha}"`, '*']) {
        const again = await get('/admin/maps/1429', admin, { 'if-none-match': inm });
        expect(again.statusCode, inm).toBe(304);
        expect(again.rawPayload.length).toBe(0);
        expect(again.headers.etag).toBe(`"${sha}"`);
      }
      const stale = await get('/admin/maps/1429', admin, { 'if-none-match': '"nope"' });
      expect(stale.statusCode).toBe(200);
    });

    it('shows the image in the list and the image index', async () => {
      const bytes = png(10, 10);
      expect((await put('/admin/api/maps/1453', admin, bytes)).statusCode).toBe(200);
      const list = (await get('/admin/api/maps', admin)).json();
      const row = list.maps.find((m: { uiMapId: number }) => m.uiMapId === 1453);
      expect(row.image).toMatchObject({
        mime: 'image/png',
        width: 10,
        height: 10,
        size: bytes.length,
        build: null,
        uploadedBy: 'JohnWilliker#1292',
      });
      expect(row.image.aspectWarning).toMatch(/1002:668/);
      expect(row.image).not.toHaveProperty('bytes');
      const index = await get('/admin/api/map-images', admin);
      expect(index.statusCode).toBe(200);
      expect(index.json().images).toContainEqual({
        uiMapId: 1453,
        name: 'Stormwind City',
        width: 10,
        height: 10,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    });

    it('warns about the aspect ratio and keeps a given name', async () => {
      const res = await put('/admin/api/maps/1411?name=Durotar', admin, png(20, 20));
      expect(res.statusCode).toBe(200);
      expect(res.json().map.name).toBe('Durotar');
      expect(res.json().warnings).toHaveLength(1);
      expect(res.json().warnings[0]).toMatch(/1002:668/);
      // A map without points can be uploaded too (an image first, points later).
      expect((await put('/admin/api/maps/1413', admin, png(3, 2))).statusCode).toBe(200);
      const list = (await get('/admin/api/maps', admin)).json();
      expect(list.maps.find((m: { uiMapId: number }) => m.uiMapId === 1413)).toMatchObject({
        zone: null,
        points: { total: 0 },
        image: { width: 3 },
      });
    });

    it('refuses what is not a PNG, WebP or JPEG, broken headers and too many pixels (400)', async () => {
      const good = png(4, 4);
      const cases: [string, Buffer | string, string][] = [
        [
          'svg',
          '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
          'image/svg+xml',
        ],
        ['html', '<!doctype html><script>alert(1)</script>', 'text/html'],
        ['html as png', '<!doctype html><script>alert(1)</script>', 'image/png'],
        ['json', '{"a":1}', 'application/json'],
        ['gif', 'GIF89a\x01\x00\x01\x00', 'image/gif'],
        ['fake magic', Buffer.concat([good.subarray(0, 8), Buffer.from('<html>')]), 'image/png'],
        ['truncated', good.subarray(0, good.length - 5), 'image/png'],
        ['too wide', pngHeaderOnly(4097, 10), 'image/png'],
        ['empty', Buffer.alloc(0), 'image/png'],
      ];
      for (const [name, body, type] of cases) {
        const res = await put('/admin/api/maps/1426', admin, body, type);
        expect(res.statusCode, `${name}: ${res.body}`).toBe(400);
        expect(res.headers['content-type'], name).toMatch(/application\/json/);
      }
      expect(
        (await s.database.pool.query(`select 1 from zone_maps where ui_map_id = 1426`)).rowCount,
      ).toBe(0);
    });

    it('refuses more than 8 MB (413)', async () => {
      const big = Buffer.concat([png(2, 2), Buffer.alloc(MAX_IMAGE_BYTES)]);
      const res = await put('/admin/api/maps/1426', admin, big);
      expect(res.statusCode).toBe(413);
      expect(res.json()).toEqual({ error: 'payload too large' });
    });

    it('checks ids and parameters', async () => {
      const image = png(3, 2);
      for (const url of [
        '/admin/api/maps/0',
        '/admin/api/maps/abc',
        '/admin/api/maps/99999999999',
      ]) {
        expect((await put(url, admin, image)).statusCode, url).toBe(400);
        expect((await del(url, admin)).statusCode, url).toBe(400);
      }
      expect((await put('/admin/api/maps/1426?build=abc', admin, image)).statusCode).toBe(200);
      expect((await put('/admin/api/maps/1426?build=99999999999', admin, image)).statusCode).toBe(
        400,
      );
      expect(
        (await put(`/admin/api/maps/1426?name=${'x'.repeat(101)}`, admin, image)).statusCode,
      ).toBe(400);
      expect((await get('/admin/maps/abc', admin)).statusCode).toBe(400);
      expect((await get('/admin/maps/0', admin)).statusCode).toBe(400);
    });

    it('deletes, then 404s', async () => {
      expect((await put('/admin/api/maps/1417', admin, png(3, 2))).statusCode).toBe(200);
      const res = await del('/admin/api/maps/1417', admin);
      expect(res.statusCode).toBe(204);
      expect((await del('/admin/api/maps/1417', admin)).statusCode).toBe(404);
      const img = await get('/admin/maps/1417', admin);
      expect(img.statusCode).toBe(404);
      expect(img.headers['content-type']).toMatch(/application\/json/);
      expect(img.headers['cache-control']).toBe('no-store');
    });
  });

  describe('SPA fallback', () => {
    it('never answers /admin/maps/* with the SPA, but the Maps page route is the SPA', async () => {
      for (const url of ['/admin/maps/1429/x', '/admin/maps/', '/admin/maps/1429/x?y=1']) {
        const res = await get(url, admin);
        expect([400, 404], url).toContain(res.statusCode);
        expect(res.headers['content-type'], url).toMatch(/application\/json/);
        expect(res.body, url).not.toContain('Forever Ledger admin');
      }
      const page = await get('/admin/maps', admin);
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain('Forever Ledger admin');
      expect(page.headers['content-security-policy']).toContain("img-src 'self' blob: data:");
    });
  });
});
