// Admin quest + character timeline routes (/admin/api/quests*, /admin/api/characters/:key/timeline) against a real
// Postgres, with the session-v1..v5 fixtures plus one hand-built batch (more characters, turn-ins and quests).
import type { UploadBatch } from '@forever-ledger/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FOREVER_QUEST_ID_MIN, QUESTS_MAX_LIMIT } from '../src/routes/adminQuests.js';
import { createSession } from '../src/sessions.js';
import { batchFromFixture, startServer } from './helpers.js';

type Server = Awaited<ReturnType<typeof startServer>>;

const COOKIE_SECRET = 'test-cookie-secret-admin-quests-0123456789abcdef';
const SESSION = '__Host-fl_session';
const CHICAGO_ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d-0[56]:00$/;

const OLD = 61582;
const NEW = 69977;

/** The Chicago calendar day of epoch seconds, `YYYY-MM-DD`. */
const chicagoDay = (secs: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(secs * 1000));

/**
 * Boudreaux (PRIEST) and Clotilde turn in 1234 in the old build (picks: 5555 ×2 with Thibodeaux's, 5556 ×1; XP paid
 * 850/700/850 → avg 800 ≠ offered 850). 90001 is Forever-only (a giver and an ender with locations). 2000 is offered
 * but never turned in. 1234 is also seen in the new build (offered 900, no turn-ins).
 */
function extraBatch(): UploadBatch {
  const b = batchFromFixture('session-v5.lua', 'ACCOUNT2', 'pc-2');
  const r = b.records;
  return {
    ...b,
    records: {
      ...r,
      characters: [
        {
          key: 'Boudreaux-Bayou',
          name: 'Boudreaux',
          realm: 'Bayou',
          class: 'PRIEST',
          race: 'Human',
          faction: 'Alliance',
          level: 12,
          lastSeen: 1_790_200_000,
        },
      ],
      quests: [
        {
          questId: 90001,
          title: 'Bayou Bounty',
          level: 8,
          category: 'The Barrens',
          objectives: ['Gator hide: 0/5'],
        },
        { questId: 2000, title: 'Wanted: Hogger', level: 11, category: 'Elwynn Forest' },
      ],
      questObservations: [
        {
          questId: 90001,
          build: OLD,
          stage: 'detail',
          char: 'Boudreaux-Bayou',
          level: 10,
          time: 1_790_040_000,
          xp: 400,
          money: 100,
          npc: {
            name: 'Old Bayou Mo',
            id: 200_001,
            loc: { zone: 'The Barrens', subzone: 'Mo’s Shack', mapID: 1413, x: 50, y: 40 },
          },
        },
        {
          questId: 90001,
          build: OLD,
          stage: 'complete',
          char: 'Boudreaux-Bayou',
          level: 11,
          time: 1_790_050_000,
          xp: 400,
          money: 100,
          npc: {
            name: '<b>Mo’s Cousin</b>',
            id: 200_002,
            loc: { zone: 'The Barrens', mapID: 1413, x: 52.5, y: 44 },
          },
        },
        {
          questId: 2000,
          build: OLD,
          stage: 'detail',
          char: 'Thibodeaux-Bayou',
          level: 10,
          time: 1_790_000_500,
          xp: 1100,
          npc: { name: 'Marshal Dughan', id: 240 },
        },
        {
          questId: 1234,
          build: NEW,
          stage: 'detail',
          char: 'Thibodeaux-Bayou',
          level: 10,
          time: 1_790_300_000,
          xp: 900,
          money: 600,
          npc: { name: 'Marshal Dughan', id: 240 },
          choices: [{ itemID: 5555, count: 1 }],
        },
      ],
      turnIns: [
        {
          id: 'Boudreaux-Bayou-90001-1790050000',
          questId: 90001,
          build: OLD,
          char: 'Boudreaux-Bayou',
          xp: 400,
          money: 100,
          level: 11,
          time: 1_790_050_000,
        },
        {
          id: 'Boudreaux-Bayou-1234-1790100000',
          questId: 1234,
          build: OLD,
          char: 'Boudreaux-Bayou',
          xp: 700,
          money: 500,
          level: 12,
          time: 1_790_100_000,
          choice: { index: 1, itemId: 5555 },
        },
        {
          id: 'Clotilde-Bayou-1234-1790090000',
          questId: 1234,
          build: OLD,
          char: 'Clotilde-Bayou',
          xp: 850,
          money: 500,
          level: 11,
          time: 1_790_090_000,
          choice: { index: 2, itemId: 5556 },
        },
      ],
    },
  };
}

interface Row {
  questId: number;
  build: number;
  builds: number[];
  title: string | null;
  level: number | null;
  category: string | null;
  xpOffered: number | null;
  moneyOffered: number | null;
  turnIns: number;
  avgXpPaid: number | null;
  xpMismatch: boolean;
  foreverOnly: boolean;
  rewardChoices: { itemId: number; name: string | null; quality: number | null; picks: number }[];
  givers: string[];
  enders: string[];
  lastSeen: string | null;
}

describe('admin quests + character timeline (real Postgres)', () => {
  let s: Server;
  let admin: Record<string, string>;
  let member: Record<string, string>;

  async function sessionFor(battletag: string, role: 'admin' | 'member') {
    const { rows } = await s.database.pool.query(
      `insert into users (bnet_sub, battletag, role) values ($1, $2, $3) returning id`,
      [`sub-${battletag}`, battletag, role],
    );
    const value = await createSession(s.database.db, rows[0].id as number, {});
    return { [SESSION]: s.app.signCookie(value) };
  }

  const get = (url: string, cookies: Record<string, string> = admin) =>
    s.app.inject({ method: 'GET', url, cookies });

  const list = async (query = '') => {
    const res = await get(`/admin/api/quests${query}`);
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as { total: number; limit: number; offset: number; items: Row[] } & {
      zones: { zone: string; quests: number }[];
      builds: number[];
    };
  };

  beforeAll(async () => {
    s = await startServer({ admin: { cookieSecret: COOKIE_SECRET, authPerMinute: 10_000 } });
    admin = await sessionFor('JohnWilliker#1292', 'admin');
    member = await sessionFor('Friend#1111', 'member');
    const batches = [
      ...[
        'session-v1.lua',
        'session-v2.lua',
        'session-v3.lua',
        'session-v4.lua',
        'session-v5.lua',
      ].map((f) => batchFromFixture(f)),
      extraBatch(),
    ];
    for (const batch of batches) {
      const res = await s.app.inject({
        method: 'POST',
        url: '/v1/ingest',
        headers: s.auth,
        payload: batch,
      });
      expect(res.statusCode, res.body).toBe(200);
    }
  });
  afterAll(async () => {
    await s?.stop();
  });

  describe('authorization', () => {
    const urls = [
      '/admin/api/quests',
      '/admin/api/quests/1234',
      '/admin/api/characters/Thibodeaux-Bayou/timeline',
    ];
    it('needs an admin session: 401 anonymous or bearer, 403 member, 200 admin (no-store)', async () => {
      for (const url of urls) {
        expect((await get(url, {})).statusCode, url).toBe(401);
        for (const headers of [s.auth, s.readerAuth]) {
          const bearer = await s.app.inject({ method: 'GET', url, headers });
          expect(bearer.statusCode, url).toBe(401);
        }
        expect((await get(url, member)).statusCode, url).toBe(403);
        const ok = await get(url);
        expect(ok.statusCode, `${url} ${ok.body}`).toBe(200);
        expect(ok.headers['cache-control'], url).toBe('no-store');
      }
    });
  });

  describe('GET /admin/api/quests', () => {
    it('lists each quest at its newest build, with facets', async () => {
      const r = await list();
      expect(r.total).toBe(3);
      expect(r.items.map((q) => q.questId)).toEqual([1234, 2000, 90001]);
      expect(r.zones).toEqual([
        { zone: 'Elwynn Forest', quests: 1 },
        { zone: 'The Barrens', quests: 1 },
        { zone: 'The Deadmines', quests: 1 },
      ]);
      expect(r.builds).toEqual([NEW, OLD]);

      const q1234 = r.items.find((q) => q.questId === 1234)!;
      // The new build's numbers only: another build's turn-ins never leak into it.
      expect(q1234).toMatchObject({
        build: NEW,
        builds: [NEW, OLD],
        title: 'Red Silk Bandanas',
        level: 17,
        category: 'The Deadmines',
        suggestedGroup: 5,
        xpOffered: 900,
        moneyOffered: 600,
        turnIns: 0,
        avgXpPaid: null,
        xpMismatch: false,
        foreverOnly: false,
        givers: ['Marshal Dughan'],
        enders: [],
      });
      expect(q1234.rewardChoices).toEqual([
        { itemId: 5555, name: "Swampwalker's Boots", quality: 2, picks: 0 },
      ]);
      expect(q1234.lastSeen).toMatch(CHICAGO_ISO);
    });

    it('answers one build with pick counts from turn-ins and the offered≠paid flag', async () => {
      const r = await list(`?build=${OLD}`);
      const q = r.items.find((x) => x.questId === 1234)!;
      expect(q).toMatchObject({
        build: OLD,
        xpOffered: 850,
        moneyOffered: 500,
        turnIns: 3,
        avgXpPaid: 800,
        xpMismatch: true,
        givers: ['Marshal Dughan'],
        enders: ['Marshal Dughan'],
      });
      expect(q.rewardChoices).toEqual([
        { itemId: 5555, name: "Swampwalker's Boots", quality: 2, picks: 2 },
        { itemId: 5556, name: 'Bayou Staff', quality: 2, picks: 1 },
      ]);
      const forever = r.items.find((x) => x.questId === 90001)!;
      expect(forever).toMatchObject({
        foreverOnly: true,
        xpOffered: 400,
        avgXpPaid: 400,
        xpMismatch: false,
        givers: ['Old Bayou Mo'],
        // Untrusted text comes back as-is (the panel renders it as text).
        enders: ['<b>Mo’s Cousin</b>'],
        rewardChoices: [],
      });
      // A build nobody saw: nothing.
      expect((await list('?build=12345')).total).toBe(0);
    });

    it('flags Forever-only quests by id (≥ 90000) and filters on it', async () => {
      expect(FOREVER_QUEST_ID_MIN).toBe(90000);
      const r = await list('?forever=1');
      expect(r.items.map((q) => q.questId)).toEqual([90001]);
      expect(r.total).toBe(1);
    });

    it('filters on mismatch, search, zone and level range', async () => {
      expect((await list(`?build=${OLD}&mismatch=1`)).items.map((q) => q.questId)).toEqual([1234]);
      expect((await list('?search=hogger')).items.map((q) => q.questId)).toEqual([2000]);
      expect((await list('?search=90001')).items.map((q) => q.questId)).toEqual([90001]);
      // LIKE wildcards are literal.
      expect((await list('?search=%25')).total).toBe(0);
      expect((await list('?search=_')).total).toBe(0);
      expect(
        (await list(`?zone=${encodeURIComponent('The Barrens')}`)).items.map((q) => q.questId),
      ).toEqual([90001]);
      expect((await list('?minLevel=9&maxLevel=12')).items.map((q) => q.questId)).toEqual([2000]);
      expect((await list('?minLevel=12')).items.map((q) => q.questId)).toEqual([1234]);
    });

    it('pages with limit/offset, caps the limit and refuses bad parameters', async () => {
      const first = await list('?limit=1');
      expect(first).toMatchObject({ total: 3, limit: 1, offset: 0 });
      expect(first.items.map((q) => q.questId)).toEqual([1234]);
      const second = await list('?limit=1&offset=1');
      expect(second.items.map((q) => q.questId)).toEqual([2000]);
      const past = await list('?limit=2&offset=10');
      expect(past).toMatchObject({ total: 3, items: [] });
      const capped = await list('?limit=100000');
      expect(capped.limit).toBe(QUESTS_MAX_LIMIT);
      expect((await list('?limit=abc')).limit).toBe(100);

      for (const q of [
        `?search=${'x'.repeat(101)}`,
        `?zone=${'x'.repeat(201)}`,
        '?build=99999999999',
        '?minLevel=99999999999',
      ]) {
        const res = await get(`/admin/api/quests${q}`);
        expect(res.statusCode, q).toBe(400);
      }
    });
  });

  describe('GET /admin/api/quests/:id', () => {
    it('answers observations, turn-ins, reward options with picks and objectives', async () => {
      const res = await get('/admin/api/quests/1234');
      expect(res.statusCode, res.body).toBe(200);
      const d = res.json();
      expect(d.quest).toEqual({
        questId: 1234,
        title: 'Red Silk Bandanas',
        level: 17,
        category: 'The Deadmines',
        suggestedGroup: 5,
        objectives: ['Red Silk Bandana: 0/10'],
        foreverOnly: false,
      });
      expect(d.builds).toEqual([NEW, OLD]);

      // Newest build first, then by time (detail before accept at the same second).
      expect(
        d.observations.map((o: { build: number; stage: string }) => `${o.build}:${o.stage}`),
      ).toEqual([`${NEW}:detail`, `${OLD}:detail`, `${OLD}:accept`, `${OLD}:complete`]);
      const complete = d.observations.find(
        (o: { build: number; stage: string }) => o.build === OLD && o.stage === 'complete',
      );
      expect(complete).toMatchObject({
        char: 'Thibodeaux-Bayou',
        class: 'HUNTER',
        level: 10,
        xp: 850,
        money: 500,
        npc: {
          id: 240,
          name: 'Marshal Dughan',
          loc: {
            zone: 'The Deadmines',
            subzone: 'Goldshire',
            mapID: 1429,
            x: 42.1,
            y: 65.9,
          },
        },
        loc: null,
      });
      expect(complete.observedAt).toMatch(CHICAGO_ISO);
      const accept = d.observations.find((o: { stage: string }) => o.stage === 'accept');
      expect(accept.npc).toBeNull();
      expect(accept.loc).toEqual({
        zone: 'Elwynn Forest',
        subzone: 'Goldshire',
        mapID: 1429,
        x: 42.1,
        y: 65.9,
      });

      // Newest turn-in first.
      expect(d.turnInsTotal).toBe(3);
      expect(
        d.turnIns.map((t: { char: string; xp: number; choice: unknown }) => [
          t.char,
          t.xp,
          t.choice,
        ]),
      ).toEqual([
        ['Boudreaux-Bayou', 700, { itemId: 5555, name: "Swampwalker's Boots", quality: 2 }],
        ['Clotilde-Bayou', 850, { itemId: 5556, name: 'Bayou Staff', quality: 2 }],
        ['Thibodeaux-Bayou', 850, { itemId: 5555, name: "Swampwalker's Boots", quality: 2 }],
      ]);
      expect(d.turnIns[0]).toMatchObject({ build: OLD, level: 12, money: 500, class: 'PRIEST' });
      expect(d.turnIns[1].class).toBeNull();
      expect(d.turnIns[0].turnedInAt).toMatch(CHICAGO_ISO);

      expect(d.rewards).toEqual([
        {
          build: NEW,
          kind: 'choice',
          itemId: 5555,
          name: "Swampwalker's Boots",
          quality: 2,
          count: 1,
          picks: 0,
        },
        {
          build: OLD,
          kind: 'choice',
          itemId: 5555,
          name: "Swampwalker's Boots",
          quality: 2,
          count: 1,
          picks: 2,
        },
        {
          build: OLD,
          kind: 'choice',
          itemId: 5556,
          name: 'Bayou Staff',
          quality: 2,
          count: 1,
          picks: 1,
        },
      ]);
    });

    it('flags Forever-only quests and keeps untrusted names as text', async () => {
      const d = (await get('/admin/api/quests/90001')).json();
      expect(d.quest.foreverOnly).toBe(true);
      expect(d.observations.map((o: { npc: { name: string } }) => o.npc.name)).toEqual([
        'Old Bayou Mo',
        '<b>Mo’s Cousin</b>',
      ]);
      expect(d.observations[0].npc.loc).toEqual({
        zone: 'The Barrens',
        subzone: 'Mo’s Shack',
        mapID: 1413,
        x: 50,
        y: 40,
      });
      expect(d.observations[1].npc.loc).toEqual({
        zone: 'The Barrens',
        subzone: null,
        mapID: 1413,
        x: 52.5,
        y: 44,
      });
    });

    it('404s an unknown quest and 400s a bad id', async () => {
      expect((await get('/admin/api/quests/424242')).statusCode).toBe(404);
      for (const id of ['abc', '0', '-1', '1.5', '99999999999'])
        expect((await get(`/admin/api/quests/${id}`)).statusCode, id).toBe(400);
    });
  });

  describe('GET /admin/api/characters/:key/timeline', () => {
    it('merges levels from observations, turn-ins and the character, sorted and deduped', async () => {
      const res = await get('/admin/api/characters/Boudreaux-Bayou/timeline');
      expect(res.statusCode, res.body).toBe(200);
      const t = res.json();
      expect(t.character).toMatchObject({
        key: 'Boudreaux-Bayou',
        name: 'Boudreaux',
        class: 'PRIEST',
        level: 12,
      });
      expect(t.character.lastSeen).toMatch(CHICAGO_ISO);
      // detail 10 @040000, complete 11 @050000 == turn-in 11 @050000 (deduped), turn-in 12 @100000, character 12.
      expect(t.levels.map((p: { level: number }) => p.level)).toEqual([10, 11, 12, 12]);
      const times = t.levels.map((p: { at: string }) => Date.parse(p.at));
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(times).toEqual(
        [1_790_040_000, 1_790_050_000, 1_790_100_000, 1_790_200_000].map((x) => x * 1000),
      );
      for (const p of t.levels) expect(p.at).toMatch(CHICAGO_ISO);
    });

    it('answers quest XP over time (cumulative) and per Chicago day', async () => {
      const t = (await get('/admin/api/characters/Boudreaux-Bayou/timeline')).json();
      expect(
        t.turnIns.map((x: { questId: number; title: string; xp: number; cumulativeXp: number }) => [
          x.questId,
          x.title,
          x.xp,
          x.cumulativeXp,
        ]),
      ).toEqual([
        [90001, 'Bayou Bounty', 400, 400],
        [1234, 'Red Silk Bandanas', 700, 1100],
      ]);
      expect(t.turnIns[1]).toMatchObject({ build: OLD, level: 12, money: 500 });
      expect(t.turnIns[1].turnedInAt).toMatch(CHICAGO_ISO);
      const days = [...new Set([chicagoDay(1_790_050_000), chicagoDay(1_790_100_000)])];
      const expected =
        days.length === 1
          ? [{ day: days[0], xp: 1100, turnIns: 2 }]
          : [
              { day: days[0], xp: 400, turnIns: 1 },
              { day: days[1], xp: 700, turnIns: 1 },
            ];
      expect(t.perDay).toEqual(expected);
      expect(t.totals).toEqual({ turnIns: 2, questXp: 1100 });
    });

    it('collapses a long run at one level to its first and last point', async () => {
      const t = (await get('/admin/api/characters/Thibodeaux-Bayou/timeline')).json();
      // Thibodeaux: level 10 everywhere (obs @000000, @000500, @001080, turn-in @001080, @300000, character).
      expect(t.levels.map((p: { level: number }) => p.level)).toEqual([10, 10]);
      expect(t.levels.map((p: { at: string }) => Date.parse(p.at) / 1000)).toEqual([
        1_790_000_000, 1_790_300_000,
      ]);
    });

    it('answers a character only seen in turn-ins, 404s an unknown one, 400s an oversized key', async () => {
      const t = (await get('/admin/api/characters/Clotilde-Bayou/timeline')).json();
      expect(t.character).toBeNull();
      expect(t.turnIns).toHaveLength(1);
      expect((await get('/admin/api/characters/Nobody-Here/timeline')).statusCode).toBe(404);
      // Over 128 chars: refused. (Fastify stops matching params over 100 chars first: 414 or the SPA's 404.)
      const long = (await get(`/admin/api/characters/${'x'.repeat(129)}/timeline`)).statusCode;
      expect(long).toBeGreaterThanOrEqual(400);
      expect(long).toBeLessThan(500);
    });
  });
});
