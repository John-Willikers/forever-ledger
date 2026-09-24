// Admin panel reads that /v1 doesn't answer: overview KPIs, the uploads feed, characters with owners, API samples.
// Record contents never leave raw_uploads here: only counts per kind and the upload's metadata.
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client.js';
import { chicagoIso } from '../time.js';
import type { ReadGuard } from './analysis.js';
import { buildFilter } from './analysis.js';
import { jarr } from './sqlJson.js';

/** The addon's own reports in api_samples: its Lua errors and the field names it looked for but didn't find. */
export const FLAGGED_SAMPLES = {
  'ForeverLedger.errors': 'errors',
  'ForeverLedger.fieldMisses': 'fieldMisses',
} as const;
const FLAGGED_APIS = Object.keys(FLAGGED_SAMPLES);
type SampleFlag = (typeof FLAGGED_SAMPLES)[keyof typeof FLAGGED_SAMPLES];

const UPLOADS_DEFAULT_LIMIT = 50;
const UPLOADS_MAX_LIMIT = 200;
const HOURLY_DEFAULT_DAYS = 7;
const HOURLY_MAX_DAYS = 31;
const API_NAME_MAX = 128;

export async function rows<T>(db: Db, query: SQL) {
  const res = await db.execute(query);
  return res.rows as T[];
}

export const iso = (d: Date | null) => (d ? chicagoIso(d) : null);

/** `?<key>=` as a positive integer up to `max` (clamped), else the default. */
export function intParam(q: unknown, key: string, def: number, max: number) {
  const raw = (q as Record<string, unknown>)[key];
  const n = Number(raw);
  if (typeof raw !== 'string' || !/^\d+$/.test(raw) || n < 1) return def;
  return Math.min(n, max);
}

/** Descending by dotted version numbers (`0.3.10` above `0.3.9`); non-numeric parts compare as text. */
export function compareVersionsDesc(a: string, b: string) {
  const pa = a.split(/[.-]/);
  const pb = b.split(/[.-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '';
    const y = pb[i] ?? '';
    const nx = Number(x);
    const ny = Number(y);
    const c =
      x !== '' && y !== '' && Number.isFinite(nx) && Number.isFinite(ny)
        ? ny - nx
        : y.localeCompare(x);
    if (c !== 0) return c;
  }
  return 0;
}

interface VersionRow {
  version: string;
  uploaders: number;
  last_seen: Date;
}
const versionList = (rs: VersionRow[]) =>
  rs
    .map((r) => ({ version: r.version, uploaders: r.uploaders, lastSeen: chicagoIso(r.last_seen) }))
    .sort((a, b) => compareVersionsDesc(a.version, b.version));

/** A JSON object's key count or an array's length (entries in an addon report sample). */
const entriesSql = (col: SQL) => sql`case jsonb_typeof(${col})
  when 'object' then (select count(*) from jsonb_object_keys(${col}))
  when 'array' then jsonb_array_length(${col})
  else 0 end::int`;

const owner = (id: number | null, battletag: string | null) =>
  id === null ? null : { id, battletag };

export function registerAdminDataRoutes(app: FastifyInstance, db: Db, preHandler: ReadGuard) {
  app.get('/admin/api/overview', { preHandler }, async () => {
    const [uploads, byKind, chars, buildRows, addon, tray, health, flagged] = await Promise.all([
      rows<{
        today: number;
        last7d: number;
        total: number;
        last_at: Date | null;
        accounts: number;
        uploaders: number;
      }>(
        db,
        sql`
        select count(*) filter (where received_at >= (date_trunc('day', now() at time zone 'America/Chicago')
                                                     at time zone 'America/Chicago'))::int as today,
               count(*) filter (where received_at >= now() - interval '7 days')::int as last7d,
               count(*)::int as total,
               max(received_at) as last_at,
               count(distinct (uploader_id, account))::int as accounts,
               count(distinct uploader_id)::int as uploaders
        from raw_uploads`,
      ),
      rows<{ kind: string; count: number }>(
        db,
        sql`
        select k.key as kind, sum(jsonb_array_length(k.value))::int as count
        from (select payload->'records' as r from raw_uploads
              where jsonb_typeof(payload->'records') = 'object') u
        cross join lateral jsonb_each(u.r) k
        where jsonb_typeof(k.value) = 'array'
        group by k.key
        having sum(jsonb_array_length(k.value)) > 0
        order by count desc, kind`,
      ),
      rows<{ n: number }>(db, sql`select count(*)::int as n from characters`),
      rows<{
        build: number;
        version: string | null;
        interface: number | null;
        first_seen: Date;
        last_seen: Date;
        uploads: number;
      }>(
        db,
        sql`
        select b.build, b.version, b.interface, b.first_seen, b.last_seen, coalesce(u.n, 0)::int as uploads
        from builds b
        left join (select client_build, count(*) as n from raw_uploads group by client_build) u
          on u.client_build = b.build
        order by b.last_seen desc, b.build desc`,
      ),
      // The addon version in each uploader's latest upload (ids first, so only those payloads are read).
      rows<VersionRow>(
        db,
        sql`
        with latest as (
          select distinct on (uploader_id) id from raw_uploads order by uploader_id, id desc
        )
        select v.version, count(*)::int as uploaders, max(v.received_at) as last_seen
        from (select u.payload->'meta'->>'addonVersion' as version, u.received_at
              from raw_uploads u join latest using (id)) v
        where v.version is not null
        group by v.version`,
      ),
      // The tray app version in each uploader's latest error report.
      rows<VersionRow>(
        db,
        sql`
        select version, count(*)::int as uploaders, max(received_at) as last_seen
        from (select distinct on (uploader_id) app_version as version, received_at
              from diagnostics order by uploader_id, received_at desc, id desc) v
        group by version`,
      ),
      rows<{ ingest_errors: number; diagnostics: Record<string, number> }>(
        db,
        sql`
        select (select count(*)::int from ingest_errors
                where received_at >= now() - interval '7 days') as ingest_errors,
               (select coalesce(jsonb_object_agg(level, n), '{}'::jsonb)
                from (select level, count(*)::int as n from diagnostics
                      where received_at >= now() - interval '7 days' group by level) d) as diagnostics`,
      ),
      rows<{ api: string; build: number; observed_at: Date; entries: number }>(
        db,
        sql`
        select * from (
          select api, build, observed_at, ${entriesSql(sql`sample`)} as entries
          from api_samples where api = any(${sql.param(FLAGGED_APIS)}::text[])
        ) s
        where entries > 0
        order by build desc, api`,
      ),
    ]);
    const u = uploads[0]!;
    const h = health[0]!;
    return {
      generatedAt: chicagoIso(),
      uploads: { today: u.today, last7d: u.last7d, total: u.total, lastAt: iso(u.last_at) },
      recordsByKind: byKind,
      totals: {
        characters: chars[0]!.n,
        accounts: u.accounts,
        uploaders: u.uploaders,
        records: byKind.reduce((n, k) => n + k.count, 0),
      },
      builds: buildRows.map((b) => ({
        build: b.build,
        version: b.version,
        interface: b.interface,
        firstSeen: chicagoIso(b.first_seen),
        lastSeen: chicagoIso(b.last_seen),
        uploads: b.uploads,
      })),
      versions: { addon: versionList(addon), tray: versionList(tray) },
      health: {
        ingestErrors7d: h.ingest_errors,
        diagnostics7d: h.diagnostics,
        flaggedSamples: flagged.map((f) => ({
          api: f.api,
          build: f.build,
          observedAt: chicagoIso(f.observed_at),
          entries: f.entries,
        })),
      },
    };
  });

  /** Recent uploads, newest first: metadata and record counts per kind, never the records. `?before=` is an id. */
  app.get('/admin/api/uploads', { preHandler }, async (req) => {
    const limit = intParam(req.query, 'limit', UPLOADS_DEFAULT_LIMIT, UPLOADS_MAX_LIMIT);
    const before = intParam(req.query, 'before', 0, 2_147_483_647) || null;
    const rs = await rows<{
      id: number;
      received_at: Date;
      token_id: number | null;
      label: string | null;
      owner_id: number | null;
      owner_battletag: string | null;
      uploader_id: string;
      account: string;
      schema_version: number;
      client_build: number;
      addon_version: string | null;
      records: Record<string, number>;
    }>(
      db,
      sql`
      select u.id, u.received_at, u.token_id, t.label, usr.id as owner_id, usr.battletag as owner_battletag,
             u.uploader_id, u.account, u.schema_version, u.client_build,
             u.payload->'meta'->>'addonVersion' as addon_version,
             (select coalesce(jsonb_object_agg(k.key, jsonb_array_length(k.value)), '{}'::jsonb)
              from jsonb_each(case when jsonb_typeof(u.payload->'records') = 'object'
                                   then u.payload->'records' else '{}'::jsonb end) k
              where jsonb_typeof(k.value) = 'array' and jsonb_array_length(k.value) > 0) as records
      from raw_uploads u
      left join api_tokens t on t.id = u.token_id
      left join users usr on usr.id = t.user_id
      where ${before}::int is null or u.id < ${before}::int
      order by u.id desc
      limit ${limit + 1}`,
    );
    const page = rs.slice(0, limit);
    return {
      items: page.map((r) => ({
        id: r.id,
        receivedAt: chicagoIso(r.received_at),
        tokenId: r.token_id,
        tokenLabel: r.label,
        owner: owner(r.owner_id, r.owner_battletag),
        uploaderId: r.uploader_id,
        account: r.account,
        schemaVersion: r.schema_version,
        clientBuild: r.client_build,
        addonVersion: r.addon_version,
        records: r.records,
        total: Object.values(r.records).reduce((n, c) => n + c, 0),
      })),
      nextBefore: rs.length > limit ? page.at(-1)!.id : null,
    };
  });

  /** Uploads per hour over the last `?days=` (default 7, max 31), empty hours included, hours in America/Chicago. */
  app.get('/admin/api/uploads/hourly', { preHandler }, async (req) => {
    const days = intParam(req.query, 'days', HOURLY_DEFAULT_DAYS, HOURLY_MAX_DAYS);
    const rs = await rows<{ hour: Date; count: number }>(
      db,
      sql`
      with hours as (
        select generate_series(date_trunc('hour', now()) - make_interval(days => ${days}::int),
                               date_trunc('hour', now()), interval '1 hour') as h
      )
      select hours.h as hour, count(u.id)::int as count
      from hours
      left join raw_uploads u on u.received_at >= hours.h and u.received_at < hours.h + interval '1 hour'
      group by hours.h
      order by hours.h`,
    );
    return { days, buckets: rs.map((r) => ({ hour: chicagoIso(r.hour), count: r.count })) };
  });

  /** Characters with the owners of the tokens whose uploads contained them. */
  app.get('/admin/api/characters', { preHandler }, async () => {
    const rs = await rows<{
      key: string;
      name: string;
      realm: string;
      class: string | null;
      race: string | null;
      faction: string | null;
      level: number | null;
      last_seen: Date | null;
      owners: { id: number; battletag: string }[];
      tokens: { id: number; label: string }[];
    }>(
      db,
      sql`
      with seen as (
        select distinct c->>'key' as key, u.token_id
        from raw_uploads u
        cross join lateral jsonb_array_elements(${jarr(sql`u.payload->'records'->'characters'`)}) c
        where u.token_id is not null
      )
      select ch.key, ch.name, ch.realm, ch.class, ch.race, ch.faction, ch.level, ch.last_seen,
             coalesce(jsonb_agg(distinct jsonb_build_object('id', usr.id, 'battletag', usr.battletag))
                        filter (where usr.id is not null), '[]'::jsonb) as owners,
             coalesce(jsonb_agg(distinct jsonb_build_object('id', t.id, 'label', t.label))
                        filter (where t.id is not null), '[]'::jsonb) as tokens
      from characters ch
      left join seen s on s.key = ch.key
      left join api_tokens t on t.id = s.token_id
      left join users usr on usr.id = t.user_id
      group by ch.key
      order by ch.last_seen desc nulls last, ch.key`,
    );
    return {
      items: rs.map((r) => ({
        key: r.key,
        name: r.name,
        realm: r.realm,
        class: r.class,
        race: r.race,
        faction: r.faction,
        level: r.level,
        lastSeen: iso(r.last_seen),
        owners: r.owners,
        tokens: r.tokens,
      })),
    };
  });

  /** Every API sample (without its JSON), the addon's error / field-miss reports first. */
  app.get('/admin/api/api-samples', { preHandler }, async () => {
    const rs = await rows<{
      api: string;
      build: number;
      observed_at: Date;
      size: number;
      entries: number;
    }>(
      db,
      sql`
      select api, build, observed_at, octet_length(sample::text)::int as size,
             ${entriesSql(sql`sample`)} as entries
      from api_samples
      order by (api = any(${sql.param(FLAGGED_APIS)}::text[])) desc, api, build desc`,
    );
    return {
      items: rs.map((r) => ({
        api: r.api,
        build: r.build,
        observedAt: chicagoIso(r.observed_at),
        size: r.size,
        flag: (FLAGGED_SAMPLES[r.api as keyof typeof FLAGGED_SAMPLES] ?? null) as SampleFlag | null,
        entries: r.entries,
      })),
    };
  });

  /** One API sample: `?build=`, else the newest build that has it. */
  app.get<{ Params: { api: string } }>(
    '/admin/api/api-samples/:api',
    { preHandler },
    async (req, reply) => {
      const api = req.params.api;
      if (api.length === 0 || api.length > API_NAME_MAX)
        return reply.status(400).send({ error: 'bad api name' });
      const build = buildFilter(req.query);
      const rs = await rows<{
        build: number;
        observed_at: Date;
        sample: unknown;
        builds: number[];
      }>(
        db,
        sql`
        select build, observed_at, sample,
               (select array_agg(build order by build desc) from api_samples where api = ${api}) as builds
        from api_samples
        where api = ${api} and (${build}::int is null or build = ${build}::int)
        order by build desc
        limit 1`,
      );
      const r = rs[0];
      if (!r) return reply.status(404).send({ error: 'no such sample' });
      return {
        api,
        build: r.build,
        observedAt: chicagoIso(r.observed_at),
        sample: r.sample,
        builds: r.builds,
      };
    },
  );
}
