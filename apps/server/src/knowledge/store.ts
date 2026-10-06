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
import { and, eq, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import type { Db } from '../db/client.js';
import { claims, fetchTargets, sources, webComments, webSnapshots } from '../db/schema.js';
import { chicagoIso } from '../time.js';
import { looksLikeChallenge } from './challenge.js';
import { parseSnapshot } from './parsers/index.js';
import type { ClaimDraft, CommentDraft, ParseResult } from './parsers/index.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Conn = Db | Tx;

/** How long a worker holds a URL before another worker may take it. */
export const LEASE_MINUTES = 15;
/** A fetched page comes due again after this many days. */
export const REFETCH_DAYS = 30;
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
  await conn
    .insert(webComments)
    .values(comments.map((c) => ({ ...c, site, snapshotId })))
    .onConflictDoNothing();
}

/** The source row of a stored snapshot, created on first use. */
async function snapshotSource(
  conn: Conn,
  snap: { id: number; url: string; fetchedAt: Date },
  parsed: ParseResult,
): Promise<SourceInfo> {
  const cls = classifySource(snap.url);
  const [row] = await conn
    .insert(sources)
    .values({
      key: `snapshot:${snap.id}`,
      kind: 'web',
      url: snap.url,
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

/** Parses a stored page into its source, claims and comments. Safe to repeat. */
export async function applySnapshot(
  conn: Conn,
  snap: { id: number; url: string; fetchedAt: Date },
  html: string,
) {
  const parsed = parseSnapshot(html, snap.url);
  const source = await snapshotSource(conn, snap, parsed);
  const added = await insertClaims(conn, source, parsed.claims, parsed.parser);
  await insertComments(conn, classifySource(snap.url).site, snap.id, parsed.comments);
  return { sourceId: source.id, claims: added, problems: parsed.problems };
}

export const inflate = (gz: Buffer) =>
  gunzipSync(gz, { maxOutputLength: MAX_HTML_BYTES }).toString('utf8');

export interface EnqueueOptions {
  url: string;
  addedBy: 'seed' | 'cli' | 'admin' | 'ingest';
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

/** Leases up to `max` due URLs to a worker: queued or refetch-due rows, and leases that ran out. */
export async function leaseTargets(
  db: Db,
  tokenId: number,
  worker: string,
  max: number,
): Promise<FetchLease[]> {
  const res = await db.execute<{
    url: string;
    site: string;
    entity_type: string | null;
    entity_id: number | null;
    lease_until: Date;
    priority: number;
    next_due_at: Date;
  }>(sql`
    update fetch_targets t
       set state = 'leased', lease_token_id = ${tokenId}, lease_worker = ${worker},
           lease_until = now() + make_interval(mins => ${LEASE_MINUTES}),
           attempts = t.attempts + 1, updated_at = now()
     where t.url in (
       select url from fetch_targets
        where (state in ('queued', 'done') and next_due_at <= now())
           or (state = 'leased' and lease_until < now())
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
    readonly status: 400 | 404 | 422,
    message: string,
  ) {
    super(message);
  }
}

/** When a transient failure may be retried: 1 h, 2 h, 4 h, … capped at 7 days. */
const backoff = (attempts: number) =>
  sql`now() + make_interval(hours => ${Math.min(2 ** Math.max(attempts - 1, 0), 168)})`;

/** Records one fetch: stores an ok page (once per content hash) and moves the URL on in the queue. */
export async function recordFetchReport(db: Db, tokenId: number, report: FetchReport) {
  const url = normalizeUrl(report.url);
  const [target] = await db.select().from(fetchTargets).where(eq(fetchTargets.url, url));
  if (!target) throw new FetchReportError(404, 'url is not on the fetch queue');

  const settle = (set: PgUpdateSetSource<typeof fetchTargets>) =>
    db
      .update(fetchTargets)
      .set({
        leaseTokenId: null,
        leaseWorker: null,
        leaseUntil: null,
        lastStatus: report.httpStatus ?? null,
        lastOutcome: report.outcome,
        lastError: report.error ?? null,
        updatedAt: new Date(),
        ...set,
      })
      .where(eq(fetchTargets.url, url));

  let html: string | null = null;
  let gz: Buffer | null = null;
  if (report.outcome === 'ok') {
    gz = Buffer.from(report.htmlGzBase64!, 'base64');
    try {
      html = inflate(gz);
    } catch {
      throw new FetchReportError(400, 'htmlGzBase64 is not a gzip of at most 16 MB');
    }
    if (sha256Hex(html) !== report.sha256) {
      throw new FetchReportError(422, 'sha256 does not match the page');
    }
  }

  // The server's backstop: a challenge page is never stored as content.
  if (report.outcome === 'challenge' || (html !== null && looksLikeChallenge(html))) {
    await settle({ state: 'needs_human', lastOutcome: 'challenge' });
    return { result: 'challenge' as const };
  }

  if (report.outcome === 'http_error') {
    const s = report.httpStatus ?? 0;
    const transient = s === 403 || s === 429 || s >= 500;
    await settle(
      transient && target.attempts < MAX_ATTEMPTS
        ? { state: 'queued', nextDueAt: backoff(target.attempts) }
        : { state: 'failed' },
    );
    return { result: 'recorded' as const };
  }
  if (report.outcome === 'error') {
    await settle(
      target.attempts < MAX_ATTEMPTS
        ? { state: 'queued', nextDueAt: backoff(target.attempts) }
        : { state: 'failed' },
    );
    return { result: 'recorded' as const };
  }

  const fetchedAt = new Date(report.fetchedAt);
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(webSnapshots)
      .values({
        url,
        finalUrl: report.finalUrl!,
        httpStatus: report.httpStatus ?? null,
        fetchedAt,
        sha256: report.sha256!,
        bytes: Buffer.byteLength(html!),
        htmlGz: gz!,
        worker: report.worker,
        fetcher: report.fetcher,
        tokenId,
      })
      .onConflictDoNothing()
      .returning({ id: webSnapshots.id });
    const done: PgUpdateSetSource<typeof fetchTargets> = {
      state: 'done',
      attempts: 0,
      lastFetchedAt: fetchedAt,
      nextDueAt: sql`now() + make_interval(days => ${REFETCH_DAYS})`,
      leaseTokenId: null,
      leaseWorker: null,
      leaseUntil: null,
      lastStatus: report.httpStatus ?? null,
      lastOutcome: 'ok',
      lastError: null,
      updatedAt: new Date(),
    };
    await tx.update(fetchTargets).set(done).where(eq(fetchTargets.url, url));
    if (inserted.length === 0) {
      const [old] = await tx
        .select({ id: webSnapshots.id })
        .from(webSnapshots)
        .where(and(eq(webSnapshots.url, url), eq(webSnapshots.sha256, report.sha256!)));
      return { result: 'unchanged' as const, snapshotId: old?.id };
    }
    const id = inserted[0]!.id;
    const applied = await applySnapshot(tx, { id, url, fetchedAt }, html!);
    return { result: 'stored' as const, snapshotId: id, claims: applied.claims };
  });
}

/** Re-runs the parsers over every stored page (optionally one site). Claims are append-only, so this only adds. */
export async function reparseAll(db: Db, site?: string) {
  const snaps = await db
    .select({ id: webSnapshots.id, url: webSnapshots.url, fetchedAt: webSnapshots.fetchedAt })
    .from(webSnapshots)
    .orderBy(webSnapshots.id);
  let pages = 0;
  let added = 0;
  const problems: string[] = [];
  for (const s of snaps) {
    if (site && classifySource(s.url).site !== site) continue;
    const [row] = await db
      .select({ htmlGz: webSnapshots.htmlGz })
      .from(webSnapshots)
      .where(eq(webSnapshots.id, s.id));
    const r = await db.transaction((tx) => applySnapshot(tx, s, inflate(row!.htmlGz)));
    pages++;
    added += r.claims;
    problems.push(...r.problems.map((p) => `#${s.id} ${s.url}: ${p}`));
  }
  return { pages, added, problems };
}
