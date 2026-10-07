// Fishing search (schema 7 fishing_casts): yield per zone and subzone, where an item is caught, and the casts
// themselves. The same queries serve /v1/fishing/* (reader tokens, admin sessions) and /admin/api/fishing/* (the
// panel). Every filter is optional: ?zone=&subzone=&build=&char=&lure=yes|no&minSkill=&item=<id|name>.
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client.js';
import type { ReadGuard } from './analysis.js';
import { intParam, iso, rows } from './adminData.js';
import { badRequest, CHAR_KEY_MAX, containsPattern, idTerm, textParam } from './shared.js';

export const FISHING_CASTS_LIMIT = 500;
const TEXT_MAX = 128;

export interface FishingFilters {
  zone: string | null;
  subzone: string | null;
  build: number | null;
  char: string | null;
  lure: 'yes' | 'no' | null;
  minSkill: number | null;
}

/** The filters from a query string; a bad value is a 400. */
export function fishingFilters(q: unknown): FishingFilters {
  const num = (key: string) => {
    const v = textParam(q, key, 10);
    if (v === null) return null;
    if (!/^\d{1,9}$/.test(v)) throw badRequest(`?${key}= must be a whole number`);
    return Number(v);
  };
  const lure = textParam(q, 'lure', 3);
  if (lure !== null && lure !== 'yes' && lure !== 'no')
    throw badRequest('?lure= must be yes or no');
  return {
    zone: textParam(q, 'zone', TEXT_MAX),
    subzone: textParam(q, 'subzone', TEXT_MAX),
    build: num('build'),
    char: textParam(q, 'char', CHAR_KEY_MAX),
    lure: lure as 'yes' | 'no' | null,
    minSkill: num('minSkill'),
  };
}

/** `and`-joined conditions on fishing_casts aliased `c`. */
export function fishingWhere(f: FishingFilters): SQL {
  const parts: SQL[] = [sql`true`];
  if (f.zone) parts.push(sql`lower(c.zone) = lower(${f.zone})`);
  if (f.subzone) parts.push(sql`lower(c.subzone) = lower(${f.subzone})`);
  if (f.build !== null) parts.push(sql`c.build = ${f.build}`);
  if (f.char) parts.push(sql`c.char = ${f.char}`);
  if (f.lure === 'yes') parts.push(sql`c.lure is not null`);
  if (f.lure === 'no') parts.push(sql`c.lure is null`);
  if (f.minSkill !== null)
    parts.push(sql`coalesce(c.skill, 0) + coalesce(c.modifier, 0) >= ${f.minSkill}`);
  return sql.join(parts, sql` and `);
}

/** Item ids an `?item=` names: the id itself, or items whose name contains the text. */
async function itemIds(db: Db, raw: string | null): Promise<number[] | null> {
  if (raw === null) return null;
  const id = idTerm(raw);
  if (id !== null) return [id];
  const found = await rows<{ item_id: number }>(
    db,
    sql`select item_id from items where name ilike ${containsPattern(raw)} escape '\\' limit 50`,
  );
  return found.map((r) => r.item_id);
}

const rate = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 10000) / 10000 : null);

/** Per zone and subzone: casts by outcome, skill, lure share, and what came up (count and rate per cast). */
export async function fishingYield(db: Db, f: FishingFilters) {
  const where = fishingWhere(f);
  const groups = await rows<{
    zone: string | null;
    subzone: string | null;
    casts: number;
    caught: number;
    escaped: number;
    not_hooked: number;
    none: number;
    lured: number;
    skill_min: number | null;
    skill_max: number | null;
    first_at: Date;
    last_at: Date;
  }>(
    db,
    sql`select c.zone, c.subzone, count(*)::int as casts,
               count(*) filter (where c.outcome = 'loot')::int as caught,
               count(*) filter (where c.outcome = 'escaped')::int as escaped,
               count(*) filter (where c.outcome = 'notHooked')::int as not_hooked,
               count(*) filter (where c.outcome = 'none')::int as none,
               count(*) filter (where c.lure is not null)::int as lured,
               min(c.skill + coalesce(c.modifier, 0)) as skill_min,
               max(c.skill + coalesce(c.modifier, 0)) as skill_max,
               min(c.cast_at) as first_at, max(c.cast_at) as last_at
          from fishing_casts c where ${where}
         group by c.zone, c.subzone order by casts desc`,
  );
  const catches = await rows<{
    zone: string | null;
    subzone: string | null;
    item_id: number;
    name: string | null;
    times: number;
    qty: number;
  }>(
    db,
    sql`select c.zone, c.subzone, (l->>'itemId')::int as item_id, i.name,
               count(*)::int as times, sum((l->>'qty')::int)::int as qty
          from fishing_casts c cross join lateral jsonb_array_elements(c.loot) l
          left join items i on i.item_id = (l->>'itemId')::int
         where ${where}
         group by 1, 2, 3, 4 order by times desc`,
  );
  return groups.map((g) => ({
    zone: g.zone,
    subzone: g.subzone,
    casts: g.casts,
    outcomes: { loot: g.caught, escaped: g.escaped, notHooked: g.not_hooked, none: g.none },
    luredCasts: g.lured,
    effectiveSkill: { min: g.skill_min, max: g.skill_max },
    firstAt: iso(new Date(g.first_at)),
    lastAt: iso(new Date(g.last_at)),
    catches: catches
      .filter((c) => c.zone === g.zone && c.subzone === g.subzone)
      .map((c) => ({
        itemId: c.item_id,
        name: c.name,
        times: c.times,
        qty: c.qty,
        perCast: rate(c.times, g.casts),
      })),
  }));
}

/** Where an item was fished: per zone and subzone, how often it came up out of every cast there. */
export async function whereCaught(db: Db, f: FishingFilters, ids: number[]) {
  if (ids.length === 0) return [];
  const where = fishingWhere(f);
  const list = sql.join(
    ids.map((i) => sql`${i}`),
    sql`, `,
  );
  const res = await rows<{
    zone: string | null;
    subzone: string | null;
    casts: number;
    times: number;
    qty: number;
  }>(
    db,
    sql`select c.zone, c.subzone, count(*)::int as casts,
               count(*) filter (where exists (select 1 from jsonb_array_elements(c.loot) l
                                               where (l->>'itemId')::int in (${list})))::int as times,
               coalesce(sum((select sum((l->>'qty')::int) from jsonb_array_elements(c.loot) l
                              where (l->>'itemId')::int in (${list}))), 0)::int as qty
          from fishing_casts c where ${where}
         group by c.zone, c.subzone order by times desc, casts desc`,
  );
  return res.map((r) => ({ ...r, perCast: rate(r.times, r.casts) }));
}

export async function recentCasts(db: Db, f: FishingFilters, limit: number) {
  const res = await rows<Record<string, unknown>>(
    db,
    sql`select c.id, c.char, c.build, c.cast_at, c.zone, c.subzone, c.map_id, c.x, c.y, c.skill, c.skill_max,
               c.modifier, c.lure, c.outcome, c.secs, c.money,
               coalesce((select jsonb_agg(jsonb_build_object('itemId', (l->>'itemId')::int, 'qty', (l->>'qty')::int,
                                                             'name', i.name))
                           from jsonb_array_elements(c.loot) l
                           left join items i on i.item_id = (l->>'itemId')::int), '[]'::jsonb) as loot
          from fishing_casts c where ${fishingWhere(f)}
         order by c.cast_at desc limit ${limit}`,
  );
  return res.map((r) => ({
    id: r.id,
    char: r.char,
    build: r.build,
    castAt: iso(new Date(r.cast_at as string)),
    zone: r.zone,
    subzone: r.subzone,
    mapId: r.map_id,
    x: r.x,
    y: r.y,
    skill: r.skill,
    skillMax: r.skill_max,
    modifier: r.modifier,
    lure: r.lure,
    outcome: r.outcome,
    secs: r.secs,
    money: r.money,
    loot: r.loot,
  }));
}

/** Zones and subzones fished, for the panel's pickers. */
export async function fishingZones(db: Db) {
  return rows<{ zone: string | null; subzone: string | null; casts: number }>(
    db,
    sql`select zone, subzone, count(*)::int as casts from fishing_casts
         group by zone, subzone order by zone, subzone`,
  );
}

function register(app: FastifyInstance, db: Db, prefix: string, preHandler: ReadGuard) {
  app.get(`${prefix}/yield`, { preHandler }, async (req) => ({
    groups: await fishingYield(db, fishingFilters(req.query)),
  }));
  app.get(`${prefix}/where`, { preHandler }, async (req) => {
    const raw = textParam(req.query, 'item', TEXT_MAX);
    if (raw === null) throw badRequest('?item= is required (an item id or part of its name)');
    const ids = (await itemIds(db, raw)) ?? [];
    return { itemIds: ids, zones: await whereCaught(db, fishingFilters(req.query), ids) };
  });
  app.get(`${prefix}/casts`, { preHandler }, async (req) => ({
    items: await recentCasts(
      db,
      fishingFilters(req.query),
      intParam(req.query, 'limit', 100, FISHING_CASTS_LIMIT),
    ),
  }));
  app.get(`${prefix}/zones`, { preHandler }, async () => ({ items: await fishingZones(db) }));
}

/** GET /v1/fishing/{yield,where,casts,zones} (readers) and the same under /admin/api/fishing (admins). */
export function registerFishingRoutes(
  app: FastifyInstance,
  db: Db,
  guards: { reader: ReadGuard; admin: ReadGuard },
) {
  register(app, db, '/v1/fishing', guards.reader);
  register(app, db, '/admin/api/fishing', guards.admin);
}
