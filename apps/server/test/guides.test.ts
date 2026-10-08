// In-game guides: built from a real run, held for the tray that uploads the character, delivered and acked
// (project-plans/forever-ledger-guides.md), on real Postgres.
import { GuideDoc } from '@forever-ledger/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashToken, mintToken } from '../src/index.js';
import {
  createGuide,
  GuideError,
  GUIDES_PER_HOUR,
  questMinLevels,
  trayFor,
} from '../src/knowledge/guides.js';
import { createSession, csrfToken } from '../src/sessions.js';
import { batchFromFixture, startServer } from './helpers.js';

const COOKIE_SECRET = 'test-cookie-secret-guides-0123456789abcdef0123';
const ME = 'Thibodeaux Willikers-Bayou';
const at = (min: number) => new Date(Date.UTC(2026, 9, 1, 0, 0) + min * 60_000).toISOString();

describe('in-game guides (real Postgres)', () => {
  let s: Awaited<ReturnType<typeof startServer>>;
  let admin: { cookies: Record<string, string>; csrf: string };
  const q = async (text: string, params: unknown[] = []) =>
    (await s.database.pool.query(text, params)).rows;
  const tray = (method: 'GET' | 'POST', url: string, payload?: object) =>
    s.app.inject({ method, url, headers: s.auth, payload });

  beforeAll(async () => {
    s = await startServer({ admin: { cookieSecret: COOKIE_SECRET, authPerMinute: 10_000 } });
    const [u] = await q(
      `insert into users (bnet_sub, battletag, role) values ('sub-g', 'JohnWilliker#1292', 'admin') returning id`,
    );
    const value = await createSession(s.database.db, u.id, {});
    admin = {
      cookies: { '__Host-fl_session': s.app.signCookie(value) },
      csrf: csrfToken(COOKIE_SECRET, hashToken(value)),
    };
    // The tray (s.token) uploads Thibodeaux; Rot is an Undead whose run the guide follows.
    const res = await tray('POST', '/v1/ingest', batchFromFixture('session-v9.lua'));
    expect(res.statusCode, res.body).toBe(200);
    await q(`insert into characters (key, name, realm, class, race, level)
             values ('Rot-Bayou', 'Rot', 'Bayou', 'WARLOCK', 'Scourge', 4)`);
    await q(`insert into quests (quest_id, title, level, category, objectives) values
      (363, 'Rude Awakening', 1, 'Deathknell', null),
      (376, 'The Damned', 3, 'Deathknell', '["0/6 Scavenger |cffff0000Paw"]'),
      (365, 'Tainted Scroll', 1, 'Warlock', null)`);
    await q(
      `insert into quest_observations (quest_id, build, stage, char, level, observed_at, npc_name, npc_loc) values
       (363, 70245, 'accept', 'Rot-Bayou', 1, $1, 'Undertaker Mordo', $3),
       (363, 70245, 'complete', 'Rot-Bayou', 1, $2, 'Shadow Priest Sarvis', $4),
       (376, 70245, 'accept', 'Rot-Bayou', 2, $2, 'Novice Elreth', $4),
       (376, 70245, 'complete', 'Rot-Bayou', 3, $5, 'Novice Elreth', $4)`,
      [
        at(0),
        at(4),
        JSON.stringify({
          zone: 'Tirisfal Glades',
          subzone: 'Deathknell',
          x: 30.2,
          y: 71.6,
          mapID: 1420,
        }),
        JSON.stringify({
          zone: 'Tirisfal Glades',
          subzone: 'Deathknell',
          x: 30.8,
          y: 66.2,
          mapID: 1420,
        }),
        at(20),
      ],
    );
    for (const [id, quest, level, min] of [
      ['r1', 363, 1, 4],
      ['r3', 365, 2, 10],
      ['r2', 376, 4, 20],
    ] as const) {
      await q(
        `insert into turn_ins (id, quest_id, build, char, level, xp, turned_in_at) values ($1, $2, 70245, 'Rot-Bayou', $3, 100, $4)`,
        [id, quest, level, at(min)],
      );
    }
  });
  afterAll(() => s?.stop());

  it("builds a guide from a real run and holds it for the character's tray", async () => {
    const made = await createGuide(s.database.db, {
      character: 'Thibodeaux Willikers',
      start: 'undead',
      toLevel: 4,
      requestedBy: 'discord:123',
    });
    expect(made).toMatchObject({ character: 'Thibodeaux Willikers', basedOn: 'Rot', tray: true });
    expect(made.title).toBe("Undead 1-4 (Rot's run)");
    const res = await tray('GET', '/v1/guides');
    expect(res.statusCode).toBe(200);
    const [g] = res.json().guides;
    expect(GuideDoc.parse(g)).toMatchObject({ id: made.id, char: ME, basedOn: 'Rot' });
    expect(g.steps[0]).toMatchObject({
      action: 'accept',
      npc: 'Undertaker Mordo',
      mapId: 1420,
      x: 30.2,
      y: 71.6,
    });
    const doIt = g.steps.find((x: { action: string }) => x.action === 'complete');
    // WoW's "|" escapes are stripped from anything a player uploaded.
    expect(doIt.quests[0].objectives).toEqual(['Scavenger cffff0000Paw: 6']);
    // Pickups carry the level they can be taken at (here: the lowest level one of our characters took them at).
    expect(g.steps[0].quests[0]).toMatchObject({ questId: 363, minLevel: 1, minLevelFrom: 'seen' });
    // Thibodeaux is a Hunter: Rot's Warlock quest is left out.
    const titles = g.steps.flatMap((x: { quests: { title: string }[] }) =>
      x.quests.map((q) => q.title),
    );
    expect(titles).not.toContain('Tainted Scroll');
  });

  it("a quest's minimum level comes from Wowhead when the ledger has it", async () => {
    const [src] = await q(
      `insert into sources (key, kind, url, site, tier, game_version)
       values ('snapshot:minlvl', 'web', 'https://www.wowhead.com/forever/quest=376', 'wowhead.com', 3, 'forever') returning id`,
    );
    await q(
      `insert into claims (source_id, entity_type, entity_key, entity_id, attribute, value, value_hash, label, parser)
       values ($1, 'quest', '376', 376, 'req_level', '2', 'rl', 'VERIFIED', 'wowhead@4')`,
      [src.id],
    );
    const levels = await questMinLevels(s.database.db, [363, 376, 99999]);
    expect(levels.get(376)).toEqual({ level: 2, from: 'wowhead' });
    expect(levels.get(363)).toEqual({ level: 1, from: 'seen' });
    expect(levels.has(99999)).toBe(false);
  });

  it('another account uploading a file that claims the character never gets its guides', async () => {
    const { token: evil } = await mintToken(s.database.db, 'evil');
    const claim = await s.app.inject({
      method: 'POST',
      url: '/v1/ingest',
      headers: { authorization: `Bearer ${evil}` },
      payload: batchFromFixture('session-v9.lua', 'ACCOUNT2', 'pc-evil'),
    });
    expect(claim.statusCode, claim.body).toBe(200);
    const [owner] = await q(`select id from api_tokens where label = 'test'`);
    expect(await trayFor(s.database.db, ME)).toBe(owner.id);
  });

  it('the tray acks what it wrote; another token sees nothing', async () => {
    const [g] = (await tray('GET', '/v1/guides')).json().guides;
    const ack = await tray('POST', '/v1/guides/ack', { ids: [g.id, 9999] });
    expect(ack.json()).toEqual({ acked: 1 });
    const [row] = await q(`select delivered_at from guides where id = $1`, [g.id]);
    expect(row.delivered_at).not.toBeNull();
    const other = await s.app.inject({ method: 'GET', url: '/v1/guides', headers: s.readerAuth });
    expect(other.json().guides).toEqual([]);
    expect((await s.app.inject({ method: 'GET', url: '/v1/guides' })).statusCode).toBe(401);
  });

  it('refuses characters no tray uploads, unknown characters, and too many guides an hour', async () => {
    await expect(
      createGuide(s.database.db, {
        character: 'Rot',
        start: 'undead',
        toLevel: 4,
        requestedBy: 'x',
      }),
    ).rejects.toThrow('no Forever Ledger tray uploads Rot');
    await expect(
      createGuide(s.database.db, {
        character: 'Nobody',
        start: 'undead',
        toLevel: 4,
        requestedBy: 'x',
      }),
    ).rejects.toBeInstanceOf(GuideError);
    for (let i = 1; i < GUIDES_PER_HOUR; i++) {
      await createGuide(s.database.db, {
        character: ME,
        start: 'undead',
        toLevel: 4,
        requestedBy: 'x',
      });
    }
    await expect(
      createGuide(s.database.db, { character: ME, start: 'undead', toLevel: 4, requestedBy: 'x' }),
    ).rejects.toThrow('guides this hour');
    // Only the newest five stay.
    expect((await tray('GET', '/v1/guides')).json().guides).toHaveLength(5);
  });

  it('the admin page previews without sending, lists and deletes', async () => {
    const post = (url: string, payload: object) =>
      s.app.inject({
        method: 'POST',
        url,
        cookies: admin.cookies,
        headers: { 'x-csrf-token': admin.csrf },
        payload,
      });
    const before = (await q(`select count(*)::int as n from guides`))[0].n;
    const preview = await post('/admin/api/guides', {
      character: ME,
      start: 'undead',
      toLevel: 4,
      preview: true,
    });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toMatchObject({ id: null, tray: true, doc: { basedOn: 'Rot' } });
    // Rot did every quest of its own run: nothing left to send.
    const done = await post('/admin/api/guides', {
      character: 'Rot',
      start: 'undead',
      toLevel: 4,
      preview: true,
    });
    expect(done.json().error).toBe("Rot has already turned in every quest of Rot's run to 4");
    expect((await q(`select count(*)::int as n from guides`))[0].n).toBe(before);
    const bad = await post('/admin/api/guides', { character: 'Rot', start: 'undead', toLevel: 4 });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error).toContain('no Forever Ledger tray uploads Rot');
    const list = await s.app.inject({
      method: 'GET',
      url: '/admin/api/guides',
      cookies: admin.cookies,
    });
    const first = list.json().items[0];
    expect(first).toMatchObject({ char: ME, requestedBy: 'x', tray: 'test' });
    const del = await post(`/admin/api/guides/${first.id}/delete`, {});
    expect(del.json()).toEqual({ id: first.id, deleted: true });
    expect(
      (await tray('GET', '/v1/guides')).json().guides.map((g: { id: number }) => g.id),
    ).not.toContain(first.id);
  });
});
