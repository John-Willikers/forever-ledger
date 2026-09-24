// Admin panel loot + dungeon reads (/admin/api/loot/*, /admin/api/items/:id, /admin/api/runs*, clear times): what the
// /v1 routes don't answer for the Loot, Item, Dungeons and Run pages. Everything here is uploaded data: the panel
// renders it as text.
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { INT4_MAX } from '../addon.js';
import type { Db } from '../db/client.js';
import { chicagoIso } from '../time.js';
import type { ReadGuard } from './analysis.js';
import { buildFilter, int4Param } from './analysis.js';
import { iso, rows } from './adminData.js';

/** "Forever-only" heuristic (ids above the Classic ranges), shown as a badge. Tunable in one place. */
export const FOREVER_ID_MIN = { quest: 90_000, item: 200_000, npc: 200_000 } as const;

const PAGE_DEFAULT = 50;
const PAGE_MAX = 200;
const OFFSET_MAX = 1_000_000;
const SEARCH_MAX = 100;
const TOP_ITEMS = 5;
const RUN_ID_MAX = 256;
/** Clear times listed per instance (fastest first). */
const CLEAR_TIMES_MAX = 1000;
/** Item qualities (Enum.ItemQuality: 0 poor … 8 WoW token). */
const QUALITY_MAX = 8;

const badRequest = (message: string) => Object.assign(new Error(message), { statusCode: 400 });

/** `?limit=` (default 50, clamped to 200) and `?offset=` (default 0); junk falls back to the defaults. */
export function pageParams(q: unknown) {
  const raw = q as Record<string, unknown>;
  const int = (v: unknown) => (typeof v === 'string' && /^\d{1,9}$/.test(v) ? Number(v) : null);
  const limit = int(raw.limit);
  const offset = int(raw.offset);
  return {
    limit: limit === null || limit < 1 ? PAGE_DEFAULT : Math.min(limit, PAGE_MAX),
    offset: offset === null ? 0 : Math.min(offset, OFFSET_MAX),
  };
}

/** `?search=` trimmed (at most 100 characters), else null. */
function searchParam(q: unknown) {
  const raw = (q as Record<string, unknown>).search;
  if (typeof raw !== 'string') return null;
  const s = raw.trim().slice(0, SEARCH_MAX);
  return s === '' ? null : s;
}

/** An ILIKE pattern matching `s` anywhere, with `%`, `_` and `\` taken literally. */
const containsPattern = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** A numeric search term that fits int4 (an id), else null. */
const idTerm = (s: string | null) =>
  s !== null && /^\d{1,10}$/.test(s) && Number(s) <= INT4_MAX ? Number(s) : null;

/** A route's `:id` as a positive int4, else a 400. */
function idParam(raw: string, what: string) {
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isInteger(n) || n <= 0 || n > INT4_MAX)
    throw badRequest(`bad ${what} id`);
  return n;
}

const intArray = (xs: number[]) => sql`${sql.param(xs)}::int[]`;

/**
 * Drop rates per build, npc and item: the rules of /v1/drops/rates (only sessions that recorded corpses, never the
 * legacy '' session). `c` has corpses and copper per build and npc (`npcs`: a predicate on `npc_id`), `d` the drops
 * per build, npc and item of those npcs.
 */
const ratesCtes = (build: number | null, npcs: SQL) => sql`
  c as (
    select build, npc_id, sum(count)::int as corpses, sum(copper)::bigint as copper
    from corpses
    where session <> '' and (${build}::int is null or build = ${build}::int) and ${npcs}
    group by build, npc_id
  ), d as (
    select d.build, d.npc_id, d.item_id, sum(d.count)::int as dropped, sum(d.quantity)::int as quantity
    from drops d
    join corpses k on k.npc_id = d.npc_id and k.build = d.build and k.uploader_id = d.uploader_id
      and k.account = d.account and k.session = d.session and k.session <> ''
    where (${build}::int is null or d.build = ${build}::int) and d.npc_id in (select npc_id from c)
    group by d.build, d.npc_id, d.item_id
  )`;

/** Rates for the (build, npc) pairs in `c`, joined with item names; `pos` ranks items within a pair. */
const ratesSelect = sql`
  select d.build, d.npc_id as "npcId", d.item_id as "itemId", i.name, i.quality, d.dropped, d.quantity,
         round(d.dropped::numeric / nullif(c.corpses, 0), 4)::float8 as rate,
         row_number() over (partition by d.build, d.npc_id
                            order by d.dropped::numeric / nullif(c.corpses, 0) desc nulls last, d.dropped desc,
                                     d.item_id)::int as pos
  from d
  join c on c.build = d.build and c.npc_id = d.npc_id
  left join items i on i.item_id = d.item_id`;

interface RateRow {
  build: number;
  npcId: number;
  itemId: number;
  name: string | null;
  quality: number | null;
  dropped: number;
  quantity: number | null;
  rate: number | null;
  pos: number;
}
const rateItem = (r: RateRow) => ({
  itemId: r.itemId,
  name: r.name,
  quality: r.quality,
  dropped: r.dropped,
  quantity: r.quantity,
  rate: r.rate,
});

/**
 * `names` CTE: the best-known name of each npc in `ids` (the most common one among quest givers/enders, vendors and
 * trainers that recorded it). Mobs usually have none: the panel shows their id.
 */
const npcNamesCte = (ids: SQL) => sql`
  names as (
    select npc_id, mode() within group (order by name) as name
    from (
      select npc_id, npc_name as name from quest_observations where npc_id in ${ids} and npc_name <> ''
      union all
      select npc_id, name from vendors where npc_id in ${ids} and name <> ''
      union all
      select npc_id, name from trainers where npc_id in ${ids} and name <> ''
    ) n
    group by npc_id
  )`;

async function npcNames(db: Db, ids: number[]) {
  if (ids.length === 0) return new Map<number, string>();
  const rs = await rows<{ npc_id: number; name: string }>(
    db,
    sql`with ${npcNamesCte(sql`(select unnest(${intArray(ids)}))`)} select npc_id, name from names`,
  );
  return new Map(rs.map((r) => [r.npc_id, r.name]));
}

async function itemInfo(db: Db, ids: number[]) {
  if (ids.length === 0) return new Map<number, { name: string; quality: number | null }>();
  const rs = await rows<{ item_id: number; name: string; quality: number | null }>(
    db,
    sql`select item_id, name, quality from items where item_id = any(${intArray([...new Set(ids)])})`,
  );
  return new Map(rs.map((r) => [r.item_id, { name: r.name, quality: r.quality }]));
}

interface Snapshot {
  build: number;
  ilvl: number | null;
  reqLevel: number | null;
  sellPrice: number | null;
  stats: Record<string, number>;
}

const SNAPSHOT_FIELDS = ['ilvl', 'reqLevel', 'sellPrice'] as const;

/**
 * Changes between consecutive builds of an item (ascending): per stat old → new (null = absent) and the same for
 * ilvl, required level and sell price. Pairs where nothing changed are left out.
 */
export function statDiffs(snapshots: Snapshot[]) {
  const sorted = [...snapshots].sort((a, b) => a.build - b.build);
  const out: {
    fromBuild: number;
    toBuild: number;
    stats: { stat: string; from: number | null; to: number | null }[];
    fields: { field: (typeof SNAPSHOT_FIELDS)[number]; from: number | null; to: number | null }[];
  }[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!;
    const b = sorted[i]!;
    const keys = [
      ...new Set([...Object.keys(a.stats ?? {}), ...Object.keys(b.stats ?? {})]),
    ].sort();
    const stats = keys
      .map((stat) => ({ stat, from: a.stats?.[stat] ?? null, to: b.stats?.[stat] ?? null }))
      .filter((c) => c.from !== c.to);
    const fields = SNAPSHOT_FIELDS.map((field) => ({ field, from: a[field], to: b[field] })).filter(
      (c) => c.from !== c.to,
    );
    if (stats.length > 0 || fields.length > 0)
      out.push({ fromBuild: a.build, toBuild: b.build, stats, fields });
  }
  return out;
}

const str = (v: unknown) => (typeof v === 'string' ? v : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bool = (v: unknown) => (typeof v === 'boolean' ? v : null);
const list = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v)
    ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    : [];

interface RunRow {
  id: string;
  build: number;
  char: string;
  char_class: string | null;
  char_level: number | null;
  instance: string | null;
  instance_id: number;
  difficulty: number | null;
  max_players: number | null;
  started_at: Date;
  finished_at: Date | null;
  end_reason: string | null;
  active_secs: number | null;
  away_secs: number;
  xp_total: number;
  quest_xp: number;
  mob_xp: number | null;
  deaths: number;
  loot_method: string | null;
  bosses_killed: number;
  bosses_total: number;
  loot_count: number;
  party_count: number;
}

const runColumns = sql`
  r.id, r.build, r.char, ch.class as char_class, r.char_level, r.instance, r.instance_id, r.difficulty,
  r.max_players, r.started_at, r.finished_at, r.end_reason, r.active_secs, r.away_secs, r.xp_total, r.quest_xp,
  r.mob_xp, r.deaths, r.loot_method,
  (select count(*) filter (where killed) from run_bosses b where b.run_id = r.id)::int as bosses_killed,
  (select count(*) from run_bosses b where b.run_id = r.id)::int as bosses_total,
  (case when jsonb_typeof(r.loot) = 'array' then jsonb_array_length(r.loot) else 0 end)::int as loot_count,
  (select count(*) from run_party p where p.run_id = r.id)::int as party_count`;

/** A run's summary. `mobXp` is the recorded mob XP, else total minus quest XP (as /v1/runs/summary counts it). */
const runSummary = (r: RunRow) => ({
  id: r.id,
  build: r.build,
  char: r.char,
  charClass: r.char_class,
  charLevel: r.char_level,
  instance: r.instance,
  instanceId: r.instance_id,
  difficulty: r.difficulty,
  maxPlayers: r.max_players,
  startedAt: chicagoIso(r.started_at),
  finishedAt: iso(r.finished_at),
  endReason: r.end_reason,
  activeSecs: r.active_secs,
  awaySecs: r.away_secs,
  xpTotal: r.xp_total,
  questXp: r.quest_xp,
  mobXp: r.mob_xp ?? r.xp_total - r.quest_xp,
  deaths: r.deaths,
  lootMethod: r.loot_method,
  bosses: { killed: r.bosses_killed, total: r.bosses_total },
  loot: r.loot_count,
  party: r.party_count,
});

export function registerAdminLootRoutes(app: FastifyInstance, db: Db, preHandler: ReadGuard) {
  /**
   * Mobs with corpse data, per build: corpses looted, average copper per corpse, distinct items dropped and the top 5
   * items by rate. `?build=`, `?search=` (npc name or id), `?limit=` / `?offset=`. Most looted first.
   */
  app.get('/admin/api/loot/mobs', { preHandler }, async (req) => {
    const build = buildFilter(req.query);
    const search = searchParam(req.query);
    const id = idTerm(search);
    const { limit, offset } = pageParams(req.query);
    const mobs = await rows<{
      build: number;
      npc_id: number;
      name: string | null;
      corpses: number;
      avg_copper: number | null;
      items: number;
      total: number;
    }>(
      db,
      sql`
      with ${ratesCtes(build, sql`true`)},
      ${npcNamesCte(sql`(select npc_id from c)`)}
      select c.build, c.npc_id, n.name, c.corpses,
             round(c.copper::numeric / nullif(c.corpses, 0), 1)::float8 as avg_copper,
             (select count(*) from d where d.build = c.build and d.npc_id = c.npc_id)::int as items,
             count(*) over ()::int as total
      from c left join names n using (npc_id)
      where ${search}::text is null
         or n.name ilike ${search === null ? null : containsPattern(search)}
         or c.npc_id = ${id}::int
      order by c.corpses desc, c.build desc, c.npc_id
      limit ${limit} offset ${offset}`,
    );
    const npcIds = [...new Set(mobs.map((m) => m.npc_id))];
    const top =
      npcIds.length === 0
        ? []
        : await rows<RateRow>(
            db,
            sql`
            with ${ratesCtes(build, sql`npc_id = any(${intArray(npcIds)})`)}
            select * from (${ratesSelect}) r where pos <= ${TOP_ITEMS} order by pos`,
          );
    return {
      items: mobs.map((m) => ({
        build: m.build,
        npcId: m.npc_id,
        name: m.name,
        foreverOnly: m.npc_id >= FOREVER_ID_MIN.npc,
        corpses: m.corpses,
        avgCopper: m.avg_copper,
        items: m.items,
        topItems: top.filter((t) => t.build === m.build && t.npcId === m.npc_id).map(rateItem),
      })),
      total: mobs[0]?.total ?? (offset > 0 ? await countMobs() : 0),
      limit,
      offset,
    };

    /** The total when the page is past the end (no row carried it). */
    async function countMobs() {
      const [r] = await rows<{ n: number }>(
        db,
        sql`
        with ${ratesCtes(build, sql`true`)},
        ${npcNamesCte(sql`(select npc_id from c)`)}
        select count(*)::int as n from c left join names n using (npc_id)
        where ${search}::text is null
           or n.name ilike ${search === null ? null : containsPattern(search)}
           or c.npc_id = ${id}::int`,
      );
      return r?.n ?? 0;
    }
  });

  /** One mob: per build (newest first), corpses, average copper and every item it dropped by rate. */
  app.get<{ Params: { npcId: string } }>(
    '/admin/api/loot/mobs/:npcId',
    { preHandler },
    async (req, reply) => {
      const npcId = idParam(req.params.npcId, 'npc');
      const build = buildFilter(req.query);
      const npcs = sql`npc_id = ${npcId}::int`;
      const corpses = await rows<{ build: number; corpses: number; avg_copper: number | null }>(
        db,
        sql`
        with ${ratesCtes(build, npcs)}
        select build, corpses, round(copper::numeric / nullif(corpses, 0), 1)::float8 as avg_copper
        from c order by build desc`,
      );
      if (corpses.length === 0)
        return reply.status(404).send({ error: 'no corpses recorded for this npc' });
      const items = await rows<RateRow>(
        db,
        sql`with ${ratesCtes(build, npcs)} select * from (${ratesSelect}) r order by pos`,
      );
      const names = await npcNames(db, [npcId]);
      return {
        npcId,
        name: names.get(npcId) ?? null,
        foreverOnly: npcId >= FOREVER_ID_MIN.npc,
        builds: corpses.map((c) => ({
          build: c.build,
          corpses: c.corpses,
          avgCopper: c.avg_copper,
          items: items.filter((i) => i.build === c.build).map(rateItem),
        })),
      };
    },
  );

  /**
   * Items with their latest snapshot (ilvl, required level, sell price), how many distinct sources of each kind list
   * them, and the Forever-only flag. `?search=` (name or id), `?quality=` (0–8), `?class=` (a class id, or the class
   * name as `type`, case-insensitive), `?limit=` / `?offset=`. `classes` counts items per class name (unfiltered).
   */
  app.get('/admin/api/loot/items', { preHandler }, async (req) => {
    const q = req.query as Record<string, unknown>;
    const search = searchParam(q);
    const id = idTerm(search);
    const qualityRaw = typeof q.quality === 'string' && q.quality !== '' ? q.quality : null;
    if (qualityRaw !== null && !(/^\d$/.test(qualityRaw) && Number(qualityRaw) <= QUALITY_MAX))
      throw badRequest(`?quality= must be 0-${QUALITY_MAX}`);
    const quality = qualityRaw === null ? null : Number(qualityRaw);
    const cls =
      typeof q.class === 'string' && q.class.trim() !== '' ? q.class.trim().slice(0, 64) : null;
    const classId = cls !== null && /^\d{1,9}$/.test(cls) ? Number(cls) : null;
    const className = cls !== null && classId === null ? cls : null;
    const { limit, offset } = pageParams(q);

    const where = sql`
      (${search}::text is null or i.name ilike ${search === null ? null : containsPattern(search)}
         or i.item_id = ${id}::int)
      and (${quality}::int is null or i.quality = ${quality}::int)
      and (${classId}::int is null or i.class_id = ${classId}::int)
      and (${className}::text is null or lower(i.type) = lower(${className}::text))`;
    const [page, count, classes] = await Promise.all([
      rows<{
        item_id: number;
        name: string;
        quality: number | null;
        type: string | null;
        subtype: string | null;
        equip_loc: string | null;
        class_id: number | null;
        subclass_id: number | null;
        build: number | null;
        ilvl: number | null;
        req_level: number | null;
        sell_price: number | null;
      }>(
        db,
        sql`
        select i.item_id, i.name, i.quality, i.type, i.subtype, i.equip_loc, i.class_id, i.subclass_id,
               s.build, s.ilvl, s.req_level, s.sell_price
        from items i
        left join lateral (
          select build, ilvl, req_level, sell_price from item_snapshots
          where item_id = i.item_id order by build desc limit 1
        ) s on true
        where ${where}
        order by i.name, i.item_id
        limit ${limit} offset ${offset}`,
      ),
      rows<{ n: number }>(db, sql`select count(*)::int as n from items i where ${where}`),
      rows<{ name: string; count: number }>(
        db,
        sql`select type as name, count(*)::int as count from items where type is not null and type <> ''
            group by type order by count desc, type`,
      ),
    ]);
    const ids = page.map((p) => p.item_id);
    const sources =
      ids.length === 0
        ? []
        : await rows<{ item_id: number; kind: string; n: number }>(
            db,
            sql`
            select item_id, kind, count(distinct src)::int as n from (
              select item_id, 'drops' as kind, npc_id as src from drops where item_id = any(${intArray(ids)})
              union all
              select item_id, 'nodes', object_id from node_loot where item_id = any(${intArray(ids)})
              union all
              select (it->>'itemId')::int, 'vendors', v.npc_id
              from vendors v cross join lateral jsonb_array_elements(
                case when jsonb_typeof(v.items) = 'array' then v.items else '[]'::jsonb end) it
              where (it->>'itemId')::int = any(${intArray(ids)})
              union all
              select item_id, 'quests', quest_id from quest_reward_options where item_id = any(${intArray(ids)})
              union all
              select output_item_id, 'recipes', recipe_id from recipe_snapshots
              where output_item_id = any(${intArray(ids)})
            ) s
            group by item_id, kind`,
          );
    const countOf = (itemId: number, kind: string) =>
      sources.find((s) => s.item_id === itemId && s.kind === kind)?.n ?? 0;
    return {
      items: page.map((p) => ({
        itemId: p.item_id,
        name: p.name,
        quality: p.quality,
        type: p.type,
        subtype: p.subtype,
        equipLoc: p.equip_loc,
        classId: p.class_id,
        subclassId: p.subclass_id,
        build: p.build,
        ilvl: p.ilvl,
        reqLevel: p.req_level,
        sellPrice: p.sell_price,
        foreverOnly: p.item_id >= FOREVER_ID_MIN.item,
        sources: {
          drops: countOf(p.item_id, 'drops'),
          nodes: countOf(p.item_id, 'nodes'),
          vendors: countOf(p.item_id, 'vendors'),
          quests: countOf(p.item_id, 'quests'),
          recipes: countOf(p.item_id, 'recipes'),
        },
      })),
      total: count[0]?.n ?? 0,
      limit,
      offset,
      classes,
    };
  });

  /**
   * What the Item page needs besides /v1/items/:id: stat and field changes between builds, drop rates per mob (the
   * rates rules) with names, vendors selling it (price, extended costs named, NPC subtitle) and recipes making or
   * using it.
   */
  app.get<{ Params: { id: string } }>(
    '/admin/api/items/:id',
    { preHandler },
    async (req, reply) => {
      const id = idParam(req.params.id, 'item');
      const [item] = await rows<{ item_id: number }>(
        db,
        sql`select item_id from items where item_id = ${id}`,
      );
      if (!item) return reply.status(404).send({ error: 'item not seen yet' });

      const [snapshots, rates, vendors, produces, reagentIn] = await Promise.all([
        rows<Snapshot>(
          db,
          sql`select build, ilvl, req_level as "reqLevel", sell_price as "sellPrice", stats
            from item_snapshots where item_id = ${id} order by build`,
        ),
        rows<{
          build: number;
          npcId: number;
          corpses: number;
          dropped: number;
          quantity: number | null;
          rate: number | null;
        }>(
          db,
          sql`
        with ${ratesCtes(null, sql`npc_id in (select npc_id from drops where item_id = ${id})`)}
        select d.build, d.npc_id as "npcId", c.corpses, d.dropped, d.quantity,
               round(d.dropped::numeric / nullif(c.corpses, 0), 4)::float8 as rate
        from d join c on c.build = d.build and c.npc_id = d.npc_id
        where d.item_id = ${id}
        order by d.build desc, rate desc nulls last, d.npc_id`,
        ),
        rows<Record<string, unknown> & { seenAt: Date }>(
          db,
          sql`
        select v.npc_id as "npcId", v.name as "npcName", v.title as "npcTitle", v.build, v.loc,
               v.seen_at as "seenAt",
               (it->>'price')::int as price, (it->>'stack')::int as stack,
               (it->>'numAvailable')::int as "numAvailable",
               (select jsonb_agg(
                         case when ci.name is null then c else c || jsonb_build_object('name', ci.name) end
                         order by ord)
                from jsonb_array_elements(case when jsonb_typeof(it->'costs') = 'array'
                                               then it->'costs' else '[]'::jsonb end)
                     with ordinality as e(c, ord)
                left join items ci on ci.item_id = (c->>'itemId')::int) as costs
        from vendors v
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(v.items) = 'array' then v.items else '[]'::jsonb end) as it
        where (it->>'itemId')::int = ${id}
        order by v.build desc, v.npc_id`,
        ),
        rows<Record<string, unknown>>(
          db,
          sql`
        select s.recipe_id as "recipeId", r.name, s.build, s.qty_min as "qtyMin", s.qty_max as "qtyMax",
               coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'itemId', (e.reagent->>'itemId')::int, 'name', i.name, 'qty', (e.reagent->>'qty')::int)
                        order by e.ord)
                 from jsonb_array_elements(s.reagents) with ordinality as e(reagent, ord)
                 left join items i on i.item_id = (e.reagent->>'itemId')::int
               ), '[]'::jsonb) as reagents
        from recipe_snapshots s left join recipes r using (recipe_id)
        where s.output_item_id = ${id}
        order by s.build desc, s.recipe_id`,
        ),
        rows<Record<string, unknown>>(
          db,
          sql`
        select s.recipe_id as "recipeId", r.name, s.build, (e->>'qty')::int as qty,
               s.output_item_id as "outputItemId", o.name as "outputItemName"
        from recipe_snapshots s
        cross join lateral jsonb_array_elements(s.reagents) e
        left join recipes r using (recipe_id)
        left join items o on o.item_id = s.output_item_id
        where s.reagents @> ${JSON.stringify([{ itemId: id }])}::jsonb and (e->>'itemId')::int = ${id}
        order by s.build desc, s.recipe_id`,
        ),
      ]);
      const names = await npcNames(db, [...new Set(rates.map((r) => r.npcId))]);
      return {
        itemId: id,
        foreverOnly: id >= FOREVER_ID_MIN.item,
        statDiffs: statDiffs(snapshots),
        dropRates: rates.map((r) => ({ ...r, npcName: names.get(r.npcId) ?? null })),
        vendors: vendors.map((v) => ({ ...v, seenAt: chicagoIso(v.seenAt) })),
        recipes: { produces, reagentIn },
      };
    },
  );

  /** Runs, newest first: `?build=`, `?instance=` (instance id), `?limit=` / `?offset=`; `instances` for the filter. */
  app.get('/admin/api/runs', { preHandler }, async (req) => {
    const build = buildFilter(req.query);
    const instance = int4Param(req.query, 'instance');
    const { limit, offset } = pageParams(req.query);
    const where = sql`(${build}::int is null or r.build = ${build}::int)
      and (${instance}::int is null or r.instance_id = ${instance}::int)`;
    const [page, count, instances] = await Promise.all([
      rows<RunRow>(
        db,
        sql`
        select ${runColumns}
        from runs r left join characters ch on ch.key = r.char
        where ${where}
        order by r.started_at desc, r.id
        limit ${limit} offset ${offset}`,
      ),
      rows<{ n: number }>(db, sql`select count(*)::int as n from runs r where ${where}`),
      rows<{ instanceId: number; instance: string | null; runs: number }>(
        db,
        sql`select instance_id as "instanceId", max(instance) as instance, count(*)::int as runs
            from runs group by instance_id order by instance nulls last, instance_id`,
      ),
    ]);
    return { items: page.map(runSummary), total: count[0]?.n ?? 0, limit, offset, instances };
  });

  /** Clear times (active seconds) of finished runs per instance, fastest first; `?build=`. */
  app.get('/admin/api/dungeons/clear-times', { preHandler }, async (req) => {
    const build = buildFilter(req.query);
    const rs = await rows<{
      instance_id: number;
      instance: string | null;
      runs: { id: string; build: number; activeSecs: number }[];
    }>(
      db,
      sql`
      select instance_id, max(instance) as instance,
             (array_agg(jsonb_build_object('id', id, 'build', build, 'activeSecs', active_secs)
                        order by active_secs, id))[1:${CLEAR_TIMES_MAX}] as runs
      from runs
      where finished_at is not null and active_secs > 0
        and (${build}::int is null or build = ${build}::int)
      group by instance_id
      order by instance nulls last, instance_id`,
    );
    return rs.map((r) => ({ instanceId: r.instance_id, instance: r.instance, runs: r.runs }));
  });

  /** One run: summary, boss timeline, loot and boss/group loot with item names, party classes and levels. */
  app.get<{ Params: { id: string } }>('/admin/api/runs/:id', { preHandler }, async (req, reply) => {
    const id = req.params.id;
    if (id.length === 0 || id.length > RUN_ID_MAX)
      return reply.status(400).send({ error: 'bad run id' });
    const [run] = await rows<RunRow & { loot: unknown; boss_loot: unknown; group_loot: unknown }>(
      db,
      sql`
      select ${runColumns}, r.loot, r.boss_loot, r.group_loot
      from runs r left join characters ch on ch.key = r.char
      where r.id = ${id}`,
    );
    if (!run) return reply.status(404).send({ error: 'no such run' });
    const [bosses, party] = await Promise.all([
      rows<{
        ord: number;
        encounterId: number | null;
        name: string | null;
        killed: boolean;
        atSecs: number;
      }>(
        db,
        sql`select ord, encounter_id as "encounterId", name, killed, at_secs as "atSecs"
            from run_bosses where run_id = ${id} order by ord`,
      ),
      rows<{ slot: number; class: string | null; level: number | null }>(
        db,
        sql`select slot, class, level from run_party where run_id = ${id} order by slot`,
      ),
    ]);
    const loot = list(run.loot).map((l) => ({ itemId: num(l.itemID), npcId: num(l.npcID) }));
    const bossLoot = list(run.boss_loot);
    const groupLoot = list(run.group_loot);
    const items = await itemInfo(
      db,
      [
        ...loot.map((l) => l.itemId),
        ...bossLoot.map((b) => num(b.itemId)),
        ...groupLoot.map((g) => num(g.itemId)),
      ].filter((n): n is number => n !== null && n <= INT4_MAX),
    );
    const names = await npcNames(
      db,
      [...new Set(loot.map((l) => l.npcId))].filter(
        (n): n is number => n !== null && n <= INT4_MAX,
      ),
    );
    const item = (itemId: number | null) => {
      const known = itemId === null ? undefined : items.get(itemId);
      return { itemId, name: known?.name ?? null, quality: known?.quality ?? null };
    };
    const { bosses: _b, loot: _l, party: _p, ...summary } = runSummary(run);
    return {
      ...summary,
      bosses,
      loot: loot.map((l) => ({
        ...item(l.itemId),
        npcId: l.npcId,
        npcName: (l.npcId === null ? undefined : names.get(l.npcId)) ?? null,
      })),
      bossLoot: bossLoot.map((b) => {
        const encounterId = num(b.encounterId);
        return {
          encounterId,
          bossName:
            bosses.find((x) => x.encounterId !== null && x.encounterId === encounterId)?.name ??
            null,
          ...item(num(b.itemId)),
          qty: num(b.qty),
          winnerClass: str(b.winnerClass),
          winnerIsSelf: bool(b.winnerIsSelf),
          allPassed: bool(b.allPassed),
          rolls: list(b.rolls).map((r) => ({
            class: str(r.class),
            roll: num(r.roll),
            state: str(r.state),
          })),
        };
      }),
      groupLoot: groupLoot.map((g) => ({
        ...item(num(g.itemId)),
        qty: num(g.qty),
        by: str(g.by),
        class: str(g.class),
        won: bool(g.won),
      })),
      party,
    };
  });
}
