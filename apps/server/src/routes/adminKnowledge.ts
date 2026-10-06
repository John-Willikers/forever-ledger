// Admin panel knowledge reads and writes (/admin/api/knowledge/*): the fetch queue, sources, claims with their labels
// and tiers, disputes, and first-party field observations. Claims and comments come from web pages, so the panel shows
// them as text only; values are returned as stored JSON.
import { CLAIM_LABELS, ENTITY_TYPES, FetchUrl } from '@forever-ledger/contracts';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client.js';
import { findDisputes } from '../knowledge/disputes.js';
import { enqueueUrl } from '../knowledge/store.js';
import type { ReadGuard } from './analysis.js';
import { intParam, iso, rows } from './adminData.js';
import { badRequest, containsPattern, searchParam, textParam } from './shared.js';

export const KNOWLEDGE_LIST_LIMIT = 200;
const QUEUE_STATES = ['queued', 'leased', 'done', 'needs_human', 'failed'] as const;

const oneOf = <T extends string>(q: unknown, key: string, allowed: readonly T[]): T | null => {
  const v = textParam(q, key, 64);
  if (v === null) return null;
  if (!(allowed as readonly string[]).includes(v)) throw badRequest(`bad ?${key}=`);
  return v as T;
};

const and = (parts: SQL[]) => (parts.length ? sql.join(parts, sql` and `) : sql`true`);

export function registerAdminKnowledgeRoutes(app: FastifyInstance, db: Db, preHandler: ReadGuard) {
  app.get('/admin/api/knowledge/summary', { preHandler }, async () => {
    const [counts] = await rows<Record<string, number>>(
      db,
      sql`select (select count(*)::int from web_snapshots) as snapshots,
                 (select count(*)::int from sources) as sources,
                 (select count(*)::int from claims) as claims,
                 (select count(*)::int from web_comments) as comments,
                 (select count(*)::int from field_observations) as observations`,
    );
    const queue = await rows<{ state: string; n: number }>(
      db,
      sql`select state, count(*)::int as n from fetch_targets group by state`,
    );
    const labels = await rows<{ label: string; n: number }>(
      db,
      sql`select label, count(*)::int as n from claims group by label`,
    );
    const [last] = await rows<{ at: Date | null }>(
      db,
      sql`select max(received_at) as at from web_snapshots`,
    );
    return {
      ...counts,
      queue: Object.fromEntries(
        QUEUE_STATES.map((s) => [s, queue.find((q) => q.state === s)?.n ?? 0]),
      ),
      labels: Object.fromEntries(
        CLAIM_LABELS.map((l) => [l, labels.find((x) => x.label === l)?.n ?? 0]),
      ),
      lastSnapshotAt: iso(last?.at ? new Date(last.at) : null),
    };
  });

  app.get('/admin/api/knowledge/queue', { preHandler }, async (req) => {
    const state = oneOf(req.query, 'state', QUEUE_STATES);
    const search = searchParam(req.query);
    const limit = intParam(req.query, 'limit', KNOWLEDGE_LIST_LIMIT, KNOWLEDGE_LIST_LIMIT);
    const where = and([
      ...(state ? [sql`state = ${state}`] : []),
      ...(search ? [sql`url ilike ${containsPattern(search)} escape '\\'`] : []),
    ]);
    const list = await rows<Record<string, unknown>>(
      db,
      sql`select url, site, entity_type, entity_id, priority, state, attempts, last_status, last_outcome,
                 last_error, next_due_at, last_fetched_at, lease_worker, added_by
            from fetch_targets where ${where}
           order by (state = 'needs_human') desc, priority desc, next_due_at limit ${limit}`,
    );
    const [{ total } = { total: 0 }] = await rows<{ total: number }>(
      db,
      sql`select count(*)::int as total from fetch_targets where ${where}`,
    );
    return {
      total,
      items: list.map((r) => ({
        url: r.url,
        site: r.site,
        entityType: r.entity_type,
        entityId: r.entity_id,
        priority: r.priority,
        state: r.state,
        attempts: r.attempts,
        lastStatus: r.last_status,
        lastOutcome: r.last_outcome,
        lastError: r.last_error,
        nextDueAt: iso(r.next_due_at ? new Date(r.next_due_at as string) : null),
        lastFetchedAt: iso(r.last_fetched_at ? new Date(r.last_fetched_at as string) : null),
        leaseWorker: r.lease_worker,
        addedBy: r.added_by,
      })),
    };
  });

  /** `{ url, priority? }`: queue a page (or make it due now). */
  app.post('/admin/api/knowledge/queue', { preHandler }, async (req, reply) => {
    const body = (req.body ?? {}) as { url?: unknown; priority?: unknown };
    const url = FetchUrl.safeParse(body.url);
    if (!url.success) throw badRequest('url must be an http(s) URL');
    const priority = body.priority ?? 0;
    if (typeof priority !== 'number' || !Number.isInteger(priority) || Math.abs(priority) > 100) {
      throw badRequest('priority must be a whole number from -100 to 100');
    }
    const queued = await enqueueUrl(db, {
      url: url.data,
      addedBy: 'admin',
      priority,
      refresh: true,
    });
    return reply.status(queued ? 201 : 200).send({ queued });
  });

  app.get('/admin/api/knowledge/sources', { preHandler }, async () => {
    const list = await rows<Record<string, unknown>>(
      db,
      sql`select s.id, s.key, s.kind, s.url, s.site, s.tier, s.game_version, s.build, s.title, s.page_updated_at,
                 s.fetched_at, s.note, s.snapshot_id, count(c.id)::int as claims
            from sources s left join claims c on c.source_id = s.id
           group by s.id order by s.tier, s.site, s.id`,
    );
    return {
      items: list.map((r) => ({
        id: r.id,
        key: r.key,
        kind: r.kind,
        url: r.url,
        site: r.site,
        tier: r.tier,
        gameVersion: r.game_version,
        build: r.build,
        title: r.title,
        pageUpdatedAt: iso(r.page_updated_at ? new Date(r.page_updated_at as string) : null),
        fetchedAt: iso(r.fetched_at ? new Date(r.fetched_at as string) : null),
        note: r.note,
        snapshotId: r.snapshot_id,
        claims: r.claims,
      })),
    };
  });

  app.get('/admin/api/knowledge/claims', { preHandler }, async (req) => {
    const entityType = oneOf(req.query, 'type', ENTITY_TYPES);
    const label = oneOf(req.query, 'label', CLAIM_LABELS);
    const search = searchParam(req.query);
    const limit = intParam(req.query, 'limit', KNOWLEDGE_LIST_LIMIT, KNOWLEDGE_LIST_LIMIT);
    const where = and([
      ...(entityType ? [sql`c.entity_type = ${entityType}`] : []),
      ...(label ? [sql`c.label = ${label}`] : []),
      ...(search
        ? [
            sql`(c.entity_key ilike ${containsPattern(search.toLowerCase())} escape '\\'
                 or c.entity_name ilike ${containsPattern(search)} escape '\\'
                 or c.attribute ilike ${containsPattern(search)} escape '\\')`,
          ]
        : []),
    ]);
    const list = await rows<Record<string, unknown>>(
      db,
      sql`select c.id, c.entity_type, c.entity_key, c.entity_id, c.entity_name, c.attribute, c.value, c.label,
                 c.observed_build, c.quote, c.parser, c.created_at, s.tier, s.site, s.url, s.title
            from claims c join sources s on s.id = c.source_id
           where ${where}
           order by c.entity_type, c.entity_key, c.attribute, s.tier, c.id limit ${limit}`,
    );
    const [{ total } = { total: 0 }] = await rows<{ total: number }>(
      db,
      sql`select count(*)::int as total from claims c where ${where}`,
    );
    return {
      total,
      items: list.map((r) => ({
        id: r.id,
        entityType: r.entity_type,
        entityKey: r.entity_key,
        entityId: r.entity_id,
        entityName: r.entity_name,
        attribute: r.attribute,
        value: r.value,
        label: r.label,
        observedBuild: r.observed_build,
        quote: r.quote,
        parser: r.parser,
        createdAt: iso(new Date(r.created_at as string)),
        tier: r.tier,
        site: r.site,
        url: r.url,
        title: r.title,
      })),
    };
  });

  app.get('/admin/api/knowledge/disputes', { preHandler }, async () => ({
    items: await findDisputes(db),
  }));

  app.get('/admin/api/knowledge/observations', { preHandler }, async () => {
    const list = await rows<Record<string, unknown>>(
      db,
      sql`select id, key, character, faction, race, class, level, build, game_version, observed_at, duration_mins,
                 location, method, setup, result, notes
            from field_observations order by observed_at desc, id desc`,
    );
    return {
      items: list.map((r) => ({
        id: r.id,
        key: r.key,
        character: r.character,
        faction: r.faction,
        race: r.race,
        class: r.class,
        level: r.level,
        build: r.build,
        gameVersion: r.game_version,
        observedAt: iso(new Date(r.observed_at as string)),
        durationMins: r.duration_mins,
        location: r.location,
        method: r.method,
        setup: r.setup,
        result: r.result,
        notes: r.notes,
      })),
    };
  });
}
