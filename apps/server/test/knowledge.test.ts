import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mintToken } from '../src/index.js';
import { findDisputes } from '../src/knowledge/disputes.js';
import { addManualClaim, ManualClaimError, relabelClaim } from '../src/knowledge/manual.js';
import { importSeed } from '../src/knowledge/seed.js';
import { enqueueSeen } from '../src/knowledge/enqueue.js';
import { enqueueUrl, reparseAll, skipUrls } from '../src/knowledge/store.js';
import { startServer, webFixture } from './helpers.js';

const ZONES = 'https://mobalytics.gg/wow-forever/guides/zone-map-level-ranges';
const ITEM = 'https://www.wowhead.com/forever/item=7973/big-mouth-clam';

const seedFile = () =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../knowledge/seed/2026-10-06-brief.json', import.meta.url)),
      'utf8',
    ),
  );

function report(url: string, html: string, over: Record<string, unknown> = {}) {
  return {
    url,
    worker: 'cruiser',
    outcome: 'ok',
    finalUrl: url,
    httpStatus: 200,
    fetchedAt: '2026-10-06T07:12:03-05:00',
    sha256: createHash('sha256').update(html).digest('hex'),
    htmlGzBase64: gzipSync(html).toString('base64'),
    fetcher: 'fetchpage/test',
    ...over,
  };
}

describe('knowledge pipeline', () => {
  let s: Awaited<ReturnType<typeof startServer>>;
  let fetchAuth: { authorization: string };

  beforeAll(async () => {
    s = await startServer();
    const { token } = await mintToken(s.database.db, 'cruiser', { canFetch: true });
    fetchAuth = { authorization: `Bearer ${token}` };
  });
  afterAll(() => s?.stop());

  const post = (url: string, payload: unknown, headers = fetchAuth) =>
    s.app.inject({ method: 'POST', url, headers, payload: payload as object });
  const q = async (text: string, params: unknown[] = []) =>
    (await s.database.pool.query(text, params)).rows;

  it('keeps fetch tokens to the fetch routes', async () => {
    const ingest = await s.app.inject({
      method: 'POST',
      url: '/v1/ingest',
      headers: fetchAuth,
      payload: {},
    });
    expect(ingest.statusCode).toBe(401);
    await expect(
      mintToken(s.database.db, 'both', { canFetch: true, canRead: true }),
    ).rejects.toThrow(/cannot also read/);
  });

  it('only lets fetch-scope tokens use the fetch routes', async () => {
    expect((await post('/v1/fetch/lease', { worker: 'x' }, { authorization: '' })).statusCode).toBe(
      401,
    );
    expect((await post('/v1/fetch/lease', { worker: 'x' }, s.readerAuth)).statusCode).toBe(403);
    expect((await post('/v1/fetch/lease', { worker: 'x' }, s.auth)).statusCode).toBe(403);
  });

  it('imports the brief seed idempotently', async () => {
    const first = await importSeed(s.database.db, seedFile());
    expect(first).toMatchObject({ sources: 16, observations: 1, queued: 14 });
    expect(first.claims).toBe(42);
    const again = await importSeed(s.database.db, seedFile());
    expect(again).toMatchObject({ claims: 0, queued: 0 });
    expect(await s.count('claims')).toBe(42);
    const [obs] = await q(
      `select c.label, s.tier, c.value from claims c join sources s on s.id = c.source_id
        where s.kind = 'first_party'`,
    );
    expect(obs).toMatchObject({ label: 'VERIFIED', tier: 1, value: { caught: 0, minutes: 40 } });
  });

  it('leases the highest-priority due URLs and nothing twice', async () => {
    const a = await post('/v1/fetch/lease', { worker: 'cruiser', max: 2 });
    expect(a.statusCode).toBe(200);
    const leases = a.json().leases as { url: string; leaseUntil: string }[];
    expect(leases.map((l) => l.url)[0]).toBe(ZONES);
    expect(leases).toHaveLength(2);
    expect(leases[0]!.leaseUntil).toMatch(/-0[56]:00$/);
    const b = (await post('/v1/fetch/lease', { worker: 'other', max: 10 })).json().leases as {
      url: string;
    }[];
    expect(b).toHaveLength(10);
    expect(b.map((l) => l.url)).not.toContain(ZONES);
    expect((await post('/v1/fetch/lease', { worker: 'other' })).json().leases).toHaveLength(2);
    expect((await post('/v1/fetch/lease', { worker: 'other' })).json().leases).toHaveLength(0);
  });

  it('stores a page once, parses it, and labels claims by source tier', async () => {
    const html = webFixture('guide-zones.html');
    const r = await post('/v1/fetch/snapshots', report(ZONES, html));
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ result: 'stored', claims: 4 });
    // Reported twice without a new lease: refused. A re-fetch (due again, leased again) of the same page is unchanged.
    expect((await post('/v1/fetch/snapshots', report(ZONES, html))).statusCode).toBe(409);
    await q(`update fetch_targets set next_due_at = now() where url = $1`, [ZONES]);
    const [lease] = (await post('/v1/fetch/lease', { worker: 'cruiser', max: 1 })).json().leases;
    expect(lease.url).toBe(ZONES);
    const again = await post('/v1/fetch/snapshots', report(ZONES, html));
    expect(again.json()).toMatchObject({ result: 'unchanged', snapshotId: r.json().snapshotId });
    expect(await s.count('web_snapshots')).toBe(1);

    const [target] = await q(
      `select state, attempts, next_due_at > now() + interval '29 days' as later
                                from fetch_targets where url = $1`,
      [ZONES],
    );
    expect(target).toMatchObject({ state: 'done', attempts: 0, later: true });
    const [src] = await q(`select tier, game_version, build, title from sources where key = $1`, [
      `snapshot:${r.json().snapshotId}`,
    ]);
    expect(src).toEqual({
      tier: 4,
      game_version: 'forever',
      build: 70009,
      title: 'WoW Forever Zone Map Level Ranges',
    });
    const tanaris = await q(
      `select label, observed_build, value from claims
        where entity_type = 'zone' and entity_key = 'tanaris' and parser = 'mobalytics@1+table@2'`,
    );
    expect(tanaris).toEqual([
      { label: 'VERIFIED', observed_build: 70009, value: { min: 40, max: 50 } },
    ]);
  });

  it('never stores a challenge page, even one reported as ok', async () => {
    const url = 'https://www.zockify.com/forever/races';
    const html = webFixture('cloudflare-challenge.html');
    const r = await post('/v1/fetch/snapshots', report(url, html));
    expect(r.json()).toEqual({ result: 'challenge' });
    const [t] = await q(`select state, last_outcome from fetch_targets where url = $1`, [url]);
    expect(t).toEqual({ state: 'needs_human', last_outcome: 'challenge' });
    expect(await s.count('web_snapshots')).toBe(1);
  });

  it('refuses bad reports and still settles the URL', async () => {
    const html = '<html><title>x</title></html>';
    expect(
      (await post('/v1/fetch/snapshots', report('https://example.org/x', html))).statusCode,
    ).toBe(404);
    const url = 'https://www.zockify.com/forever/skyborne';
    expect(
      (await post('/v1/fetch/snapshots', report(url, html, { sha256: 'b'.repeat(64) }))).statusCode,
    ).toBe(422);
    // The refused report gave the lease back: the URL waits out a backoff instead of looping.
    const [t] = await q(
      `select state, last_outcome, next_due_at > now() + interval '50 minutes' as later
         from fetch_targets where url = $1`,
      [url],
    );
    expect(t).toEqual({ state: 'queued', last_outcome: 'refused', later: true });
    // No lease any more, so another report for it is refused.
    expect((await post('/v1/fetch/snapshots', report(url, html))).statusCode).toBe(409);
    const gz =
      'https://www.icy-veins.com/wow-forever/news/all-new-race-and-class-combos-and-racial-abilities-in-wow-forever-official';
    expect(
      (await post('/v1/fetch/snapshots', report(gz, html, { htmlGzBase64: 'bm90IGd6aXA=' })))
        .statusCode,
    ).toBe(400);
    expect((await post('/v1/fetch/snapshots', { url })).statusCode).toBe(400);
  });

  it('only takes reports from the token holding the lease', async () => {
    const { token } = await mintToken(s.database.db, 'other-worker', { canFetch: true });
    const other = { authorization: `Bearer ${token}` };
    const url =
      'https://www.method.gg/wow-forever/all-class-and-race-combinations-in-world-of-warcraft-forever';
    const r = await post('/v1/fetch/snapshots', report(url, '<html></html>'), other);
    expect(r.statusCode).toBe(409);
    expect((await q(`select state from fetch_targets where url = $1`, [url]))[0]).toEqual({
      state: 'leased',
    });
  });

  it('backs off on 429 and gives up on 404', async () => {
    const url = 'https://news.blizzard.com/en-us/article/24304075';
    const failed = { outcome: 'http_error', htmlGzBase64: undefined, sha256: undefined };
    await post('/v1/fetch/snapshots', report(url, '', { ...failed, httpStatus: 429 }));
    const [t] = await q(
      `select state, next_due_at > now() + interval '50 minutes' as later from fetch_targets where url = $1`,
      [url],
    );
    expect(t).toEqual({ state: 'queued', later: true });
    const gone = 'https://www.zockify.com/forever/professions';
    await post('/v1/fetch/snapshots', report(gone, '', { ...failed, httpStatus: 404 }));
    expect((await q(`select state from fetch_targets where url = $1`, [gone]))[0]).toEqual({
      state: 'failed',
    });
  });

  it('stops handing out a URL whose lease keeps running out', async () => {
    const url = 'https://example.org/crashes-the-worker';
    await enqueueUrl(s.database.db, { url, addedBy: 'cli', priority: 99 });
    await q(
      `update fetch_targets set state = 'leased', attempts = 5, lease_until = now() - interval '1 minute'
        where url = $1`,
      [url],
    );
    const leases = (await post('/v1/fetch/lease', { worker: 'cruiser', max: 10 })).json().leases;
    expect(leases.map((l: { url: string }) => l.url)).not.toContain(url);
    expect((await q(`select state from fetch_targets where url = $1`, [url]))[0]).toEqual({
      state: 'failed',
    });
  });

  it('parses a Wowhead page into names, relations and comments; reparse adds nothing', async () => {
    await enqueueUrl(s.database.db, { url: ITEM, addedBy: 'cli', priority: 50 });
    const [lease] = (await post('/v1/fetch/lease', { worker: 'cruiser', max: 1 })).json().leases;
    expect(lease).toMatchObject({ url: ITEM, site: 'wowhead.com' });
    const r = await post('/v1/fetch/snapshots', report(ITEM, webFixture('wowhead-item.html')));
    expect(r.json().result).toBe('stored');
    const rows = await q(
      `select attribute, label, count(*)::int as n from claims c join sources s on s.id = c.source_id
        where s.snapshot_id = $1 group by 1, 2 order by 1`,
      [r.json().snapshotId],
    );
    expect(rows).toEqual([
      { attribute: 'dropped_by', label: 'CLASSIC', n: 2 },
      { attribute: 'fished_in', label: 'CLASSIC', n: 1 },
      { attribute: 'lv_contains', label: 'CLASSIC', n: 1 },
      { attribute: 'name', label: 'VERIFIED', n: 3 },
    ]);
    expect(await s.count('web_comments')).toBe(1);
    const before = await s.count('claims');
    expect(await reparseAll(s.database.db)).toMatchObject({ pages: 2, added: 0 });
    expect(await s.count('claims')).toBe(before);
    // A parser fix: claims an older parser version read off the page are swapped, hand-entered ones stay.
    await q(`update claims set parser = 'wowhead@0' where parser = 'wowhead@2'`);
    expect(await reparseAll(s.database.db, 'wowhead.com', { replace: true })).toMatchObject({
      pages: 1,
      added: 7,
    });
    expect(await s.count('claims')).toBe(before);
    expect(
      (await q(`select count(*)::int as n from claims where parser = 'wowhead@0'`))[0],
    ).toEqual({ n: 0 });
  });

  it('checks a hand-entered quote against the stored page', async () => {
    const [{ id }] = await q(`select id from sources where url = $1 and kind = 'web'`, [ZONES]);
    const claim = {
      source: id as number,
      entityType: 'zone' as const,
      entityName: 'Feralas',
      attribute: 'level_range',
      value: { min: 40, max: 50 },
    };
    await expect(
      addManualClaim(s.database.db, { ...claim, quote: 'Feralas is 30-40' }),
    ).rejects.toBeInstanceOf(ManualClaimError);
    expect(
      await addManualClaim(s.database.db, {
        ...claim,
        quote: 'Tanaris, Feralas and The Hinterlands are 40-50',
      }),
    ).toBe(1);
  });

  it('finds disputes: FALSE labels and less trusted sources that disagree', async () => {
    const all = await findDisputes(s.database.db);
    const falses = all.filter((d) => d.byClaimId === null);
    // The Google answer's five contradicted statements.
    expect(falses.length).toBe(5);
    // The seed's tier 4 Mobalytics Tanaris range against a tier 5 claim that says otherwise.
    const [src] = await q(`select id from sources where key = 'seed:claude-classic-knowledge'`);
    await q(
      `insert into claims (source_id, entity_type, entity_key, entity_name, attribute, value, value_hash, label, parser)
       values ($1, 'zone', 'tanaris', 'Tanaris', 'level_range', '{"min":43,"max":50}', 'h', 'CLASSIC', 'manual')`,
      [src.id],
    );
    const tanaris = await findDisputes(s.database.db, { entityType: 'zone', entityKey: 'Tanaris' });
    // One row for the contradicted claim, however many sources contradict it.
    expect(tanaris).toHaveLength(1);
    expect(tanaris[0]).toMatchObject({ tier: 5, byTier: 4, byLabel: 'VERIFIED' });
  });

  it('classes a page by where it was finally served from', async () => {
    const url = 'https://www.wowhead.com/forever/item=4655';
    await enqueueUrl(s.database.db, { url, addedBy: 'cli', priority: 99 });
    const [lease] = (await post('/v1/fetch/lease', { worker: 'cruiser', max: 1 })).json().leases;
    expect(lease.url).toBe(url);
    const r = await post(
      '/v1/fetch/snapshots',
      report(url, webFixture('wowhead-item.html'), {
        finalUrl: 'https://www.wowhead.com/classic/item=4655',
      }),
    );
    const [src] = await q(`select tier, game_version, url from sources where snapshot_id = $1`, [
      r.json().snapshotId,
    ]);
    expect(src).toEqual({
      tier: 5,
      game_version: 'classic',
      url: 'https://www.wowhead.com/classic/item=4655',
    });
    const labels = await q(
      `select distinct label from claims c join sources s on s.id = c.source_id where s.snapshot_id = $1`,
      [r.json().snapshotId],
    );
    expect(labels).toEqual([{ label: 'CLASSIC' }]);
  });

  it('relabels a claim with a dated reason, never its value', async () => {
    const [c] = await q(
      `select c.id from claims c join sources s on s.id = c.source_id
        where s.key = 'seed:mobalytics-zone-map' and c.entity_key = 'searing gorge'`,
    );
    await expect(relabelClaim(s.database.db, c.id, 'FALSE', ' ')).rejects.toBeInstanceOf(
      ManualClaimError,
    );
    expect(await relabelClaim(s.database.db, c.id, 'FALSE', 'the fetched page says 43–50')).toEqual(
      { from: 'VERIFIED', to: 'FALSE' },
    );
    const [after] = await q(`select label, value, note from claims where id = $1`, [c.id]);
    expect(after.label).toBe('FALSE');
    expect(after.value).toEqual({ min: 43, max: 55 });
    expect(after.note).toMatch(
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d-0[56]:00 VERIFIED → FALSE: the fetched page says 43–50$/,
    );
  });

  it('queues entity pages for ids the addon has seen, Forever ids first, never id 0', async () => {
    await q(`insert into items (item_id, name) values (4655, 'Clam'), (250001, 'Forever Thing')`);
    await q(`insert into quests (quest_id, title) values (90001, 'A Forever Quest')`);
    await q(
      `insert into drops (item_id, build, npc_id, uploader_id, account, session, count, quantity)
       values (4655, 1, 0, 'pc', 'A', 's', 1, 1), (4655, 1, 5431, 'pc', 'A', 's', 1, 1)`,
    );
    const r = await enqueueSeen(s.database.db, 'https://www.wowhead.com/forever/{type}={id}');
    // item 4655 was queued by an earlier test; npc 0 is skipped.
    expect(r).toEqual({ seen: 4, queued: 3 });
    const rows = await q(
      `select url, priority from fetch_targets where added_by = 'ingest' order by priority desc, url`,
    );
    expect(rows.map((x) => x.url)).not.toContain('https://www.wowhead.com/forever/npc=0');
    expect(rows.slice(0, 2)).toEqual([
      { url: 'https://www.wowhead.com/forever/item=250001', priority: 10 },
      { url: 'https://www.wowhead.com/forever/quest=90001', priority: 10 },
    ]);
    await expect(enqueueSeen(s.database.db, 'https://x/{id}')).rejects.toThrow(/\{type\}/);
  });

  it('skipped URLs are never leased and never queued again', async () => {
    const url = 'https://www.wowhead.com/forever/item=3167';
    await enqueueUrl(s.database.db, { url, addedBy: 'ingest', priority: 100 });
    expect(
      await skipUrls(s.database.db, [url, 'https://example.org/not-queued'], 'junk tier A'),
    ).toBe(1);
    expect(
      (await q(`select state, last_error from fetch_targets where url = $1`, [url]))[0],
    ).toEqual({
      state: 'skipped',
      last_error: 'junk tier A',
    });
    expect(await enqueueUrl(s.database.db, { url, addedBy: 'ingest' })).toBe(false);
    const leases = (await post('/v1/fetch/lease', { worker: 'cruiser', max: 10 })).json().leases;
    expect(leases.map((l: { url: string }) => l.url)).not.toContain(url);
    expect(await enqueueUrl(s.database.db, { url, addedBy: 'cli', refresh: true })).toBe(true);
  });
});
