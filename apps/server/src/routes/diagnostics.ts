import { DiagnosticsReport } from '@forever-ledger/contracts';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { verifyBearer } from '../auth.js';
import type { Db } from '../db/client.js';
import { diagnostics, ingestErrors } from '../db/schema.js';
import { chicagoIso } from '../time.js';
import { requireToken } from './analysis.js';

export interface DiagnosticsOptions {
  /** Reports per minute per token (default 30). */
  perMinute?: number;
  /** Max report body in bytes (default 256 KB). */
  bodyLimit?: number;
}

export const DIAGNOSTICS_BODY_LIMIT = 256 * 1024;
const DEFAULT_LIST_DAYS = 7;
const DEFAULT_LIST_LIMIT = 200;
const MAX_LIST_LIMIT = 1000;
const INT4_MAX = 2_147_483_647;

/** `?since=` as epoch seconds or an ISO date; undefined when absent, null when unreadable. */
function parseSince(raw: unknown): Date | null | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (typeof raw !== 'string') return null;
  if (/^\d+(\.\d+)?$/.test(raw)) return new Date(Number(raw) * 1000);
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : new Date(ms);
}

const shortText = (v: unknown) => (typeof v === 'string' && v ? v.slice(0, 128) : null);

/**
 * Stores an ingest request the server refused (400/409), with what the body says about its sender. Best effort: a
 * failure here is logged and never changes the response.
 */
export async function recordIngestError(
  db: Db,
  entry: {
    tokenId: number;
    body: unknown;
    status: number;
    error: string;
    issues?: { path: string; message: string }[];
  },
) {
  const b = (typeof entry.body === 'object' && entry.body !== null ? entry.body : {}) as Record<
    string,
    unknown
  >;
  const sv = b.schemaVersion;
  await db.insert(ingestErrors).values({
    tokenId: entry.tokenId,
    uploaderId: shortText(b.uploaderId),
    account: shortText(b.account),
    schemaVersion:
      typeof sv === 'number' && Number.isInteger(sv) && Math.abs(sv) <= INT4_MAX ? sv : null,
    status: entry.status,
    error: entry.error.slice(0, 1000),
    // Validation messages are static zod templates today; cap them anyway so a future change can't bloat the table.
    issues:
      entry.issues?.slice(0, 20).map((i) => ({
        path: i.path.slice(0, 200),
        message: i.message.slice(0, 300),
      })) ?? null,
  });
}

interface ListRow {
  type: 'diagnostic' | 'ingest-error';
  id: number;
  received_at: Date;
  occurred_at: Date;
  token_id: number | null;
  uploader_id: string | null;
  app_version: string | null;
  platform: string | null;
  level: string | null;
  source: string | null;
  message: string | null;
  detail: unknown;
  account: string | null;
  schema_version: number | null;
  status: number | null;
  error: string | null;
  issues: unknown;
}

function listItem(r: ListRow) {
  const common = {
    type: r.type,
    id: r.id,
    receivedAt: chicagoIso(r.received_at),
    tokenId: r.token_id,
    uploaderId: r.uploader_id,
  };
  if (r.type === 'diagnostic')
    return {
      ...common,
      occurredAt: chicagoIso(r.occurred_at),
      appVersion: r.app_version,
      platform: r.platform,
      level: r.level,
      source: r.source,
      message: r.message,
      detail: r.detail,
    };
  return {
    ...common,
    account: r.account,
    schemaVersion: r.schema_version,
    status: r.status,
    error: r.error,
    issues: r.issues,
  };
}

export function registerDiagnosticsRoutes(
  app: FastifyInstance,
  db: Db,
  opts: DiagnosticsOptions = {},
) {
  /** Error reports from the tray app. */
  app.post(
    '/v1/diagnostics',
    {
      bodyLimit: opts.bodyLimit ?? DIAGNOSTICS_BODY_LIMIT,
      config: {
        rateLimit: {
          max: opts.perMinute ?? 30,
          timeWindow: '1 minute',
          keyGenerator: (req) => req.headers.authorization ?? req.ip,
        },
      },
    },
    async (req, reply) => {
      const tokenId = await verifyBearer(db, req.headers.authorization);
      if (tokenId === null) return reply.status(401).send({ error: 'invalid or revoked token' });
      const parsed = DiagnosticsReport.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'invalid DiagnosticsReport',
          issues: parsed.error.issues
            .slice(0, 20)
            .map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
      }
      const r = parsed.data;
      await db.insert(diagnostics).values(
        r.events.map((e) => ({
          tokenId,
          uploaderId: r.uploaderId,
          appVersion: r.appVersion,
          platform: r.platform,
          level: e.level,
          source: e.source,
          message: e.message,
          detail: e.detail ?? null,
          occurredAt: new Date(e.at * 1000),
        })),
      );
      const counts: Record<string, number> = {};
      for (const e of r.events) counts[e.level] = (counts[e.level] ?? 0) + 1;
      req.log.info(
        { uploaderId: r.uploaderId, appVersion: r.appVersion, ...counts },
        'diagnostics received',
      );
      return { accepted: r.events.length };
    },
  );

  /** Recent error reports and refused ingests, newest first (`?since=` epoch secs or ISO, default 7 days). */
  app.get(
    '/v1/diagnostics',
    {
      preHandler: requireToken(db),
      config: {
        rateLimit: {
          max: opts.perMinute ?? 30,
          timeWindow: '1 minute',
          keyGenerator: (req) => req.headers.authorization ?? req.ip,
        },
      },
    },
    async (req, reply) => {
      const q = req.query as Record<string, unknown>;
      const parsedSince = parseSince(q.since);
      if (parsedSince === null || (parsedSince && Number.isNaN(parsedSince.getTime())))
        return reply.status(400).send({ error: 'since must be epoch seconds or an ISO date' });
      const since = parsedSince ?? new Date(Date.now() - DEFAULT_LIST_DAYS * 86_400_000);
      const n = Number(q.limit);
      const limit = Number.isInteger(n) && n > 0 ? Math.min(n, MAX_LIST_LIMIT) : DEFAULT_LIST_LIMIT;

      const res = await db.execute(sql`
      select * from (
        select 'diagnostic' as type, id, received_at, occurred_at, token_id, uploader_id, app_version, platform,
               level, source, message, detail,
               null::text as account, null::int as schema_version, null::int as status, null::text as error,
               null::jsonb as issues
        from diagnostics where received_at >= ${since}
        union all
        select 'ingest-error', id, received_at, received_at, token_id, uploader_id, null, null,
               null, null, null, null,
               account, schema_version, status, error, issues
        from ingest_errors where received_at >= ${since}
      ) x
      order by received_at desc, occurred_at desc, id desc
      limit ${limit}`);
      return { since: chicagoIso(since), items: (res.rows as unknown as ListRow[]).map(listItem) };
    },
  );
}
