import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mintToken } from '../src/index.js';
import { findDisputes } from '../src/knowledge/disputes.js';
import { addManualClaim, ManualClaimError } from '../src/knowledge/manual.js';
import { importSeed } from '../src/knowledge/seed.js';
import { enqueueUrl, reparseAll } from '../src/knowledge/store.js';
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
        where entity_type = 'zone' and entity_key = 'tanaris' and parser = 'table@1'`,
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

  it('refuses bad reports: unknown URL, wrong hash, not gzip', async () => {
    const html = '<html><title>x</title></html>';
    expect(
      (await post('/v1/fetch/snapshots', report('https://example.org/x', html))).statusCode,
    ).toBe(404);
    const url = 'https://www.zockify.com/forever/skyborne';
    expect(
      (await post('/v1/fetch/snapshots', report(url, html, { sha256: 'b'.repeat(64) }))).statusCode,
    ).toBe(422);
    expect(
      (await post('/v1/fetch/snapshots', report(url, html, { htmlGzBase64: 'bm90IGd6aXA=' })))
        .statusCode,
    ).toBe(400);
    expect((await post('/v1/fetch/snapshots', { url })).statusCode).toBe(400);
  });

  it('backs off on 429 and gives up on 404', async () => {
    const url = 'https://www.zockify.com/forever/skyborne';
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
      { attribute: 'dropped_by', label: 'VERIFIED', n: 2 },
      { attribute: 'fished_in', label: 'VERIFIED', n: 1 },
      { attribute: 'lv_contains', label: 'VERIFIED', n: 1 },
      { attribute: 'name', label: 'VERIFIED', n: 3 },
    ]);
    expect(await s.count('web_comments')).toBe(1);
    const before = await s.count('claims');
    expect(await reparseAll(s.database.db)).toMatchObject({ pages: 2, added: 0 });
    expect(await s.count('claims')).toBe(before);
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
    expect(tanaris).toHaveLength(2);
    expect(tanaris.every((d) => d.tier === 5 && d.byTier === 4 && d.byLabel === 'VERIFIED')).toBe(
      true,
    );
  });
});
