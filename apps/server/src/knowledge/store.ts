import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import {
  classifySource,
  defaultLabel,
  MAX_HTML_BYTES,
  normalizeUrl,
  stableStringify,
} from '@forever-ledger/contracts';
import type {
  ClaimLabel,
  EntityType,
  FetchLease,
  FetchReport,
  GameVersion,
  SourceTier,
} from '@forever-ledger/contracts';
import { and, eq, inArray, ne, notInArray, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import type { Db } from '../db/client.js';
import {
  claims,
  fetchBudget,
  fetchTargets,
  sources,
  webComments,
  webSnapshots,
} from '../db/schema.js';
import { FETCH_BUDGET_LOCK } from '../locks.js';
import { FOREVER_ID_THRESHOLDS } from '../routes/shared.js';
import { chicagoIso } from '../time.js';
import { looksLikeChallenge } from './challenge.js';
import { parseSnapshot } from './parsers/index.js';
import type { ClaimDraft, CommentDraft, ParseResult } from './parsers/index.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Conn = Db | Tx;

/** How long a worker holds a URL before another worker may take it. */
export const LEASE_MINUTES = 15;
/** A fetched page comes due again after this many days: Forever content and guides change while the beta runs. */
export const REFETCH_DAYS = 30;
/** Pages of Classic-era ids: their Wowhead data is Classic's and barely moves, so they wait longer. */
export const REFETCH_DAYS_CLASSIC = 90;

/** Days until a fetched page is due again: Classic-era item, quest and NPC ids wait REFETCH_DAYS_CLASSIC. */
export function refetchDays(entityType: string | null, entityId: number | null): number {
  if (entityId === null || entityType === null) return REFETCH_DAYS;
  const own = FOREVER_ID_THRESHOLDS[entityType as keyof typeof FOREVER_ID_THRESHOLDS];
  return own !== undefined && entityId < own ? REFETCH_DAYS_CLASSIC : REFETCH_DAYS;
}
/** Transient failures (403, 429, 5xx, worker errors) give up after this many attempts. */
export const MAX_ATTEMPTS = 5;

export const sha256Hex = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

/** The claim's entity key: the game id as text, else the trimmed, lowercased name. */
export function entityKeyOf(d: Pick<ClaimDraft, 'entityId' | 'entityName'>): string | null {
  if (d.entityId !== undefined && d.entityId !== null) return String(d.entityId);
  const name = d.entityName?.trim().toLowerCase();
  return name ? name : null;
}

export const valueHash = (value: unknown) => sha256Hex(stableStringify(value));

export interface SourceInfo {
  id: number;
  tier: SourceTier;
  gameVersion: GameVersion;
  build: number | null;
}

/** Adds claims from one source; existing ones (same source, entity, attribute and value) are left alone. */
export async function insertClaims(
  conn: Conn,
  source: SourceInfo,
  drafts: ClaimDraft[],
  parser: string,
): Promise<number> {
  const rows = drafts.flatMap((d) => {
    const entityKey = entityKeyOf(d);
    if (entityKey === null) return [];
    const label: ClaimLabel = d.label ?? defaultLabel(source.tier, source.gameVersion);
    return [
      {
        sourceId: source.id,
        entityType: d.entityType,
        entityKey,
        entityId: d.entityId ?? null,
        entityName: d.entityName ?? null,
        attribute: d.attribute,
        value: d.value,
        valueHash: valueHash(d.value),
        label,
        observedBuild: d.observedBuild ?? source.build,
        quote: d.quote ?? null,
        parser,
      },
    ];
  });
  let added = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const res = await conn
      .insert(claims)
      .values(rows.slice(i, i + 500))
      .onConflictDoNothing()
      .returning({ id: claims.id });
    added += res.length;
  }
  return added;
}

async function insertComments(
  conn: Conn,
  site: string,
  snapshotId: number,
  comments: CommentDraft[],
) {
  if (comments.length === 0) return;
  // A later fetch (or a reparse of the same page) carries the comment's current body, rating and date.
  await conn
    .insert(webComments)
    .values(comments.map((c) => ({ ...c, site, snapshotId })))
    .onConflictDoUpdate({
      target: [webComments.site, webComments.commentId],
      set: {
        body: sql`excluded.body`,
        rating: sql`excluded.rating`,
        postedAt: sql`excluded.posted_at`,
        dataTree: sql`excluded.data_tree`,
        gameVersion: sql`excluded.game_version`,
        snapshotId: sql`excluded.snapshot_id`,
      },
      setWhere: sql`excluded.snapshot_id >= ${webComments.snapshotId}`,
    });
}

/** A stored page: the URL asked for and the one the browser ended on after redirects. */
export interface SnapshotRef {
  id: number;
  url: string;
  finalUrl: string;
  fetchedAt: Date;
}

/**
 * The source row of a stored snapshot, created on first use. Tier and game version come from the URL the page was
 * finally served from, so a Forever link that redirects to a Classic page is classed as Classic.
 */
async function snapshotSource(
  conn: Conn,
  snap: SnapshotRef,
  parsed: ParseResult,
): Promise<SourceInfo> {
  const cls = classifySource(snap.finalUrl);
  const [row] = await conn
    .insert(sources)
    .values({
      key: `snapshot:${snap.id}`,
      kind: 'web',
      url: snap.finalUrl,
      site: cls.site,
      tier: cls.tier,
      gameVersion: cls.gameVersion,
      build: parsed.build,
      title: parsed.title,
      pageUpdatedAt: parsed.pageUpdatedAt,
      snapshotId: snap.id,
      fetchedAt: snap.fetchedAt,
    })
    .onConflictDoUpdate({
      target: sources.key,
      set: { title: parsed.title, pageUpdatedAt: parsed.pageUpdatedAt, build: parsed.build },
    })
    .returning({
      id: sources.id,
      tier: sources.tier,
      gameVersion: sources.gameVersion,
      build: sources.build,
    });
  return { ...row!, tier: row!.tier as SourceTier };
}

/**
 * Parses a stored page into its source, claims and comments, and queues the pages it says to follow (a quest list's
 * quests; a URL already on the queue is left as it is). Safe to repeat. With `replace`, claims an older parser
 * read off this same page are dropped first (a parser fix, not new information); hand-entered claims stay.
 */
export async function applySnapshot(
  conn: Conn,
  snap: SnapshotRef,
  html: string,
  opts: { replace?: boolean } = {},
) {
  const parsed = parseSnapshot(html, snap.finalUrl);
  const source = await snapshotSource(conn, snap, parsed);
  if (opts.replace) {
    await conn
      .delete(claims)
      .where(
        and(
          eq(claims.sourceId, source.id),
          ne(claims.parser, parsed.parser),
          notInArray(claims.parser, ['manual', 'seed', 'observation']),
        ),
      );
  }
  const added = await insertClaims(conn, source, parsed.claims, parsed.parser);
  await insertComments(conn, classifySource(snap.finalUrl).site, snap.id, parsed.comments);
  let queued = 0;
  for (const f of parsed.follow ?? []) {
    if (await enqueueUrl(conn, { ...f, addedBy: 'parser' })) queued++;
  }
  return { sourceId: source.id, claims: added, queued, problems: parsed.problems };
}

/** The page's raw bytes (at most MAX_HTML_BYTES; larger throws). */
export const inflateBytes = (gz: Buffer) => gunzipSync(gz, { maxOutputLength: MAX_HTML_BYTES });

export const inflate = (gz: Buffer) => inflateBytes(gz).toString('utf8');

export interface EnqueueOptions {
  url: string;
  /** `parser`: a stored page named it (`ParseResult.follow`). */
  addedBy: 'seed' | 'cli' | 'admin' | 'ingest' | 'parser';
  priority?: number;
  entityType?: EntityType | null;
  entityId?: number | null;
  /** Make an existing row due now (not while it is leased). */
  refresh?: boolean;
}

/** Puts a URL on the fetch queue; true when it was added or refreshed. */
export async function enqueueUrl(conn: Conn, opts: EnqueueOptions): Promise<boolean> {
  const url = normalizeUrl(opts.url);
  const row = {
    url,
    site: classifySource(url).site,
    entityType: opts.entityType ?? null,
    entityId: opts.entityId ?? null,
    priority: opts.priority ?? 0,
    addedBy: opts.addedBy,
  };
  const q = conn.insert(fetchTargets).values(row);
  const res = opts.refresh
    ? await q
        .onConflictDoUpdate({
          target: fetchTargets.url,
          set: {
            state: 'queued',
            nextDueAt: sql`now()`,
            attempts: 0,
            priority: sql`greatest(${fetchTargets.priority}, excluded.priority)`,
            updatedAt: sql`now()`,
          },
          setWhere: sql`${fetchTargets.state} <> 'leased' or ${fetchTargets.leaseUntil} < now()`,
        })
        .returning({ url: fetchTargets.url })
    : await q.onConflictDoNothing().returning({ url: fetchTargets.url });
  return res.length > 0;
}

/**
 * Takes URLs off the queue for good: they become `skipped`, so a later `enqueue-seen` or seed leaves them alone (only
 * `knowledge-cli add --refresh` or the panel brings one back). A URL being fetched right now is left alone. Returns
 * how many were skipped.
 */
export async function skipUrls(conn: Conn, urls: string[], reason: string): Promise<number> {
  if (urls.length === 0) return 0;
  const res = await conn
    .update(fetchTargets)
    .set({ state: 'skipped', lastError: reason.slice(0, 500), updatedAt: new Date() })
    .where(
      and(
        inArray(fetchTargets.url, urls.map(normalizeUrl)),
        sql`not (${fetchTargets.state} = 'leased' and ${fetchTargets.leaseUntil} >= now())`,
      ),
    )
    .returning({ url: fetchTargets.url });
  return res.length;
}

export interface FetchBudget {
  /** URLs a day (America/Chicago day). */
  daily: number;
  /** URLs an hour, so a day's budget is spread out instead of spent in one burst. */
  hourly: number;
}

export const DEFAULT_FETCH_BUDGET: FetchBudget = { daily: 400, hourly: 25 };

export interface BudgetState {
  day: { used: number; limit: number };
  hour: { used: number; limit: number };
}

/**
 * Leases up to `max` due URLs to a worker (queued or refetch-due rows, and leases that ran out), within the server's
 * budget for that worker's token: never more than `budget.hourly` this hour or `budget.daily` this Chicago day. Returns the leases and what is
 * left, so the worker can wait when the answer is empty.
 */
export async function leaseTargets(
  db: Db,
  tokenId: number,
  worker: string,
  max: number,
  budget: FetchBudget = DEFAULT_FETCH_BUDGET,
  fence: LeaseFence = { sites: null, entityPagesOnly: false },
): Promise<{ leases: FetchLease[]; budget: BudgetState }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${FETCH_BUDGET_LOCK})`);
    const used = await tx.execute<{ day: number; hour: number }>(sql`
      select coalesce(sum(leased) filter (
               where hour >= date_trunc('day', now() at time zone 'America/Chicago') at time zone 'America/Chicago'), 0)::int as day,
             coalesce(sum(leased) filter (where hour = date_trunc('hour', now())), 0)::int as hour
        from fetch_budget where token_id = ${tokenId} and hour >= now() - interval '2 days'`);
    const day = used.rows[0]?.day ?? 0;
    const hour = used.rows[0]?.hour ?? 0;
    const allowed = Math.max(0, Math.min(max, budget.daily - day, budget.hourly - hour));
    const state = (n: number): BudgetState => ({
      day: { used: day + n, limit: budget.daily },
      hour: { used: hour + n, limit: budget.hourly },
    });
    if (allowed === 0) return { leases: [], budget: state(0) };
    const leases = await leaseDue(tx, tokenId, worker, allowed, fence);
    if (leases.length > 0) {
      await tx
        .insert(fetchBudget)
        .values({
          tokenId,
          hour: sql`date_trunc('hour', now())` as unknown as Date,
          leased: leases.length,
        })
        .onConflictDoUpdate({
          target: [fetchBudget.tokenId, fetchBudget.hour],
          set: { leased: sql`${fetchBudget.leased} + excluded.leased` },
        });
    }
    return { leases, budget: state(leases.length) };
  });
}

/** Which pages a worker may be handed: `sites` (null: any) and, for helpers, entity pages only. */
export interface LeaseFence {
  sites: string[] | null;
  entityPagesOnly: boolean;
}

async function leaseDue(
  db: Conn,
  tokenId: number,
  worker: string,
  max: number,
  fence: LeaseFence,
): Promise<FetchLease[]> {
  const fenced = sql.join(
    [
      sql`true`,
      ...(fence.sites
        ? [
            sql`site in (${sql.join(
              fence.sites.map((x) => sql`${x}`),
              sql`, `,
            )})`,
          ]
        : []),
      ...(fence.entityPagesOnly ? [sql`entity_type is not null`] : []),
    ],
    sql` and `,
  );
  const res = await db.execute<{
    url: string;
    site: string;
    entity_type: string | null;
    entity_id: number | null;
    lease_until: Date;
    priority: number;
    next_due_at: Date;
  }>(sql`
    with gave_up as (
      -- A lease that keeps running out without a report (the worker crashes on the page) stops being handed out.
      update fetch_targets
         set state = 'failed', lease_token_id = null, lease_worker = null, lease_until = null,
             last_error = 'lease ran out ' || attempts || ' times without a report', updated_at = now()
       where state = 'leased' and lease_until < now() and attempts >= ${MAX_ATTEMPTS})
    update fetch_targets t
       set state = 'leased', lease_token_id = ${tokenId}, lease_worker = ${worker},
           lease_until = now() + make_interval(mins => ${LEASE_MINUTES}),
           attempts = t.attempts + 1, updated_at = now()
     where t.url in (
       select url from fetch_targets
        where ((state in ('queued', 'done') and next_due_at <= now())
           or (state = 'leased' and lease_until < now() and attempts < ${MAX_ATTEMPTS}))
          and ${fenced}
        order by priority desc, next_due_at
        limit ${max}
        for update skip locked)
    returning t.url, t.site, t.entity_type, t.entity_id, t.lease_until, t.priority, t.next_due_at`);
  // UPDATE … RETURNING has no order: hand them out in queue order.
  const rows = [...res.rows].sort(
    (a, b) =>
      b.priority - a.priority ||
      new Date(a.next_due_at).getTime() - new Date(b.next_due_at).getTime(),
  );
  return rows.map((r) => ({
    url: r.url,
    site: r.site,
    entityType: r.entity_type as EntityType | null,
    entityId: r.entity_id,
    leaseUntil: chicagoIso(new Date(r.lease_until)),
  }));
}

export class FetchReportError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 422,
    message: string,
  ) {
    super(message);
  }
}

/** When a transient failure may be retried: 1 h, 2 h, 4 h, … capped at 7 days. */
const backoff = (attempts: number) =>
  sql`now() + make_interval(hours => ${Math.min(2 ** Math.max(attempts - 1, 0), 168)})`;

const CLEAR_LEASE = { leaseTokenId: null, leaseWorker: null, leaseUntil: null } as const;

/**
 * Records one fetch: stores an ok page (once per content hash) and moves the URL on in the queue. Only the token that
 * holds the URL's lease may report it (409 otherwise). A report the server refuses (400, 422) still settles the URL, so
 * a page that can never be stored stops coming back after MAX_ATTEMPTS.
 */
export async function recordFetchReport(db: Db, tokenId: number, report: FetchReport) {
  const url = normalizeUrl(report.url);
  const [target] = await db.select().from(fetchTargets).where(eq(fetchTargets.url, url));
  if (!target) throw new FetchReportError(404, 'url is not on the fetch queue');
  if (target.state !== 'leased' || target.leaseTokenId !== tokenId) {
    throw new FetchReportError(409, 'this token does not hold the lease on that url');
  }

  const held = and(
    eq(fetchTargets.url, url),
    eq(fetchTargets.state, 'leased'),
    eq(fetchTargets.leaseTokenId, tokenId),
  );
  const settle = (set: PgUpdateSetSource<typeof fetchTargets>, conn: Conn = db) =>
    conn
      .update(fetchTargets)
      .set({
        ...CLEAR_LEASE,
        lastStatus: report.httpStatus ?? null,
        lastOutcome: report.outcome,
        lastError: report.error ?? null,
        updatedAt: new Date(),
        ...set,
      })
      .where(held);
  const retryOrFail = (): PgUpdateSetSource<typeof fetchTargets> =>
    target.attempts < MAX_ATTEMPTS
      ? { state: 'queued', nextDueAt: backoff(target.attempts) }
      : { state: 'failed' };
  const refuse = async (status: 400 | 422, message: string): Promise<never> => {
    await settle({ ...retryOrFail(), lastOutcome: 'refused', lastError: message });
    throw new FetchReportError(status, message);
  };

  let bytes: Buffer | null = null;
  let gz: Buffer | null = null;
  if (report.outcome === 'ok') {
    gz = Buffer.from(report.htmlGzBase64!, 'base64');
    try {
      bytes = inflateBytes(gz);
    } catch {
      return refuse(400, 'htmlGzBase64 is not a gzip of at most 16 MB');
    }
    // The hash is over the page's bytes as sent, so a page that is not UTF-8 still matches.
    if (sha256Hex(bytes) !== report.sha256) return refuse(422, 'sha256 does not match the page');
  }
  const html = bytes?.toString('utf8') ?? null;

  // The server's backstop: a challenge page is never stored as content.
  if (report.outcome === 'challenge' || (html !== null && looksLikeChallenge(html))) {
    await settle({ state: 'needs_human', lastOutcome: 'challenge' });
    return { result: 'challenge' as const };
  }

  if (report.outcome === 'http_error') {
    const s = report.httpStatus ?? 0;
    const transient = s === 403 || s === 429 || s >= 500;
    await settle(transient ? retryOrFail() : { state: 'failed' });
    return { result: 'recorded' as const };
  }
  if (report.outcome === 'error') {
    await settle(retryOrFail());
    return { result: 'recorded' as const };
  }

  // Store the raw page and settle the URL first: a parser bug must never lose the page.
  const fetchedAt = new Date(report.fetchedAt);
  const finalUrl = normalizeUrl(report.finalUrl!);
  const stored = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(webSnapshots)
      .values({
        url,
        finalUrl,
        httpStatus: report.httpStatus ?? null,
        fetchedAt,
        sha256: report.sha256!,
        bytes: bytes!.length,
        htmlGz: gz!,
        worker: report.worker,
        fetcher: report.fetcher,
        tokenId,
      })
      .onConflictDoNothing()
      .returning({ id: webSnapshots.id });
    await settle(
      {
        state: 'done',
        attempts: 0,
        lastFetchedAt: fetchedAt,
        nextDueAt: sql`now() + make_interval(days => ${refetchDays(target.entityType, target.entityId)})`,
        lastOutcome: 'ok',
      },
      tx,
    );
    if (inserted.length > 0) return { id: inserted[0]!.id, isNew: true };
    const [old] = await tx
      .select({ id: webSnapshots.id })
      .from(webSnapshots)
      .where(and(eq(webSnapshots.url, url), eq(webSnapshots.sha256, report.sha256!)));
    return { id: old!.id, isNew: false };
  });
  if (!stored.isNew) return { result: 'unchanged' as const, snapshotId: stored.id };

  try {
    const applied = await db.transaction((tx) =>
      applySnapshot(tx, { id: stored.id, url, finalUrl, fetchedAt }, html!),
    );
    return { result: 'stored' as const, snapshotId: stored.id, claims: applied.claims };
  } catch (err) {
    const message = `parse failed: ${(err as Error).message}`.slice(0, 500);
    await db.update(fetchTargets).set({ lastError: message }).where(eq(fetchTargets.url, url));
    return { result: 'stored' as const, snapshotId: stored.id, claims: 0 };
  }
}

/**
 * Re-runs the parsers over every stored page (optionally one site). Claims are append-only, so this only adds, unless
 * `replace` swaps out what older parser versions read off the same pages.
 */
export async function reparseAll(db: Db, site?: string, opts: { replace?: boolean } = {}) {
  const snaps = await db
    .select({
      id: webSnapshots.id,
      url: webSnapshots.url,
      finalUrl: webSnapshots.finalUrl,
      fetchedAt: webSnapshots.fetchedAt,
    })
    .from(webSnapshots)
    .orderBy(webSnapshots.id);
  let pages = 0;
  let added = 0;
  let queued = 0;
  const problems: string[] = [];
  for (const s of snaps) {
    if (site && classifySource(s.url).site !== site) continue;
    const [row] = await db
      .select({ htmlGz: webSnapshots.htmlGz })
      .from(webSnapshots)
      .where(eq(webSnapshots.id, s.id));
    try {
      const r = await db.transaction((tx) => applySnapshot(tx, s, inflate(row!.htmlGz), opts));
      pages++;
      added += r.claims;
      queued += r.queued;
      problems.push(...r.problems.map((p) => `#${s.id} ${s.url}: ${p}`));
    } catch (err) {
      problems.push(`#${s.id} ${s.url}: parse failed: ${(err as Error).message}`);
    }
  }
  return { pages, added, queued, problems };
}
