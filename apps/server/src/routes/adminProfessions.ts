// Admin panel reads for the Professions and Vendors & trainers pages: what /v1/professions/* doesn't answer. Every
// profession view folds Forever's "Classic" child skill lines into their base (`skillBase`, see analysis.ts). Record
// contents are untrusted: numbers and strings are read from jsonb by type, never cast blindly.
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { INT4_MAX } from '../addon.js';
import type { Db } from '../db/client.js';
import { chicagoIso } from '../time.js';
import type { ReadGuard } from './analysis.js';
import { buildFilter, int4Param, skillBase } from './analysis.js';
import { intParam, rows } from './adminData.js';
import { recipesTaughtBy, registerAdminRecipesRoutes } from './adminRecipes.js';
import {
  badRequest,
  charKeyParam,
  containsPattern,
  FOREVER_ID_THRESHOLDS,
  flagParam,
  idParam,
  searchParam,
  textParam,
} from './shared.js';
import { jarr, jint, jlen, jnum, jtext, viaItemId } from './sqlJson.js';

const LIST_DEFAULT_LIMIT = 100;
const LIST_MAX_LIMIT = 500;
/** An NPC subtitle is at most this long (contracts `npcTitle`). */
const TITLE_MAX = 200;
/** Rises kept per character and profession in the skill history (the addon itself keeps 2000). */
const SKILL_HISTORY_MAX = 2000;

/** A vendor listing paid (also) in items or currencies: `extendedCost` true / non-zero, or any `costs`. */
const extended = (it: SQL) => sql`(
  coalesce(${it}->'extendedCost' = 'true'::jsonb, false)
  or coalesce(${jnum(sql`${it}->'extendedCost'`)} <> 0, false)
  or ${jlen(sql`${it}->'costs'`)} > 0)`;

/** `?skillLine=` (base or child) as the base line's id, for `coalesce(b.base_id, line) = <this>`. */
const baseOf = (skillLine: number | null) =>
  sql`coalesce((select base_id from skill_base where id = ${skillLine}::int), ${skillLine}::int)`;

const epochIso = (secs: unknown) =>
  secs === null || secs === undefined ? null : chicagoIso(Number(secs) * 1000);

const round = (n: number, places = 4) => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

export interface Location {
  zone: string | null;
  subzone: string | null;
  mapId: number | null;
  x: number | null;
  y: number | null;
}

/**
 * An NPC's `loc` jsonb (the addon's `where()`: zone, subzone, mapID, x, y), keeping only well-typed fields; the map id
 * must be an int4.
 */
export function locationOf(loc: unknown): Location | null {
  if (typeof loc !== 'object' || loc === null || Array.isArray(loc)) return null;
  const l = loc as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const mapId = num(l.mapID);
  return {
    zone: str(l.zone),
    subzone: str(l.subzone),
    mapId: mapId !== null && Number.isInteger(mapId) && Math.abs(mapId) <= INT4_MAX ? mapId : null,
    x: num(l.x),
    y: num(l.y),
  };
}

export interface Spot {
  x: number;
  y: number;
  opens: number;
}

/**
 * Node spots per map from session rows: each row's opens are spread evenly over the spots it recorded (a session
 * doesn't say which spot each harvest came from), and spots equal to 0.1 map units are merged, adding their opens.
 * Junk (a bad map id, a point off the 0–100 map or not two numbers) is skipped. Spots come sorted by x, then y.
 */
export function spreadSpots(
  list: { opened: number; spots: { mapId: number; points: [number, number][] }[] }[],
): Map<number, Spot[]> {
  const merged = new Map<number, Map<string, Spot>>();
  const isCoord = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;
  for (const row of list) {
    if (!Array.isArray(row.spots)) continue;
    const valid: { mapId: number; x: number; y: number }[] = [];
    for (const spot of row.spots) {
      const mapId = spot?.mapId;
      if (typeof mapId !== 'number' || !Number.isInteger(mapId) || mapId <= 0) continue;
      if (!Array.isArray(spot.points)) continue;
      for (const p of spot.points) {
        if (!Array.isArray(p) || !isCoord(p[0]) || !isCoord(p[1])) continue;
        valid.push({ mapId, x: round(p[0], 1), y: round(p[1], 1) });
      }
    }
    const opened = typeof row.opened === 'number' && row.opened > 0 ? row.opened : 0;
    const share = valid.length > 0 ? opened / valid.length : 0;
    for (const { mapId, x, y } of valid) {
      if (!merged.has(mapId)) merged.set(mapId, new Map());
      const spots = merged.get(mapId)!;
      const key = `${x},${y}`;
      const s = spots.get(key) ?? { x, y, opens: 0 };
      s.opens += share;
      spots.set(key, s);
    }
  }
  return new Map(
    [...merged].map(([mapId, spots]) => [
      mapId,
      [...spots.values()]
        .map((s) => ({ ...s, opens: round(s.opens, 2) }))
        .sort((a, b) => a.x - b.x || a.y - b.y),
    ]),
  );
}

export interface VendorOffer {
  itemId: number;
  npcId: number;
  name: string | null;
  title: string | null;
  build: number;
  /** The gold part, in copper, for `stack` items. */
  price: number | null;
  stack: number | null;
  /** Also paid in items or currencies. */
  extended: boolean;
}

export interface CostOutput {
  itemId: number;
  name: string | null;
  qtyMin: number | null;
  qtyMax: number | null;
  /** Vendor sell price of one output item, in copper. */
  sellPrice: number | null;
}

/**
 * Reagent cost of one craft: each reagent at the cheapest known vendor gold price per item (price / stack; a listing
 * with an extended cost, or without a positive gold price, is not a price), the total of the known ones, and the
 * output's vendor value (sell price × average quantity made). Profit only when every reagent and the value are known.
 */
export function reagentCost(
  reagents: { itemId: number; name: string | null; qty: number }[],
  offers: VendorOffer[],
  output: CostOutput | null,
) {
  const priced = reagents.map((r) => {
    const mine = offers.filter((o) => o.itemId === r.itemId);
    let best: { o: VendorOffer; unit: number } | null = null;
    for (const o of mine) {
      if (o.extended || o.price === null || !(o.price > 0)) continue;
      const unit = o.price / (o.stack !== null && o.stack > 0 ? o.stack : 1);
      if (!best || unit < best.unit) best = { o, unit };
    }
    return {
      itemId: r.itemId,
      name: r.name,
      qty: r.qty,
      unitPrice: best ? round(best.unit) : null,
      cost: best ? round(best.unit * r.qty) : null,
      vendor: best
        ? {
            npcId: best.o.npcId,
            name: best.o.name,
            title: best.o.title,
            build: best.o.build,
            price: best.o.price,
            stack: best.o.stack,
          }
        : null,
      extendedOnly: !best && mine.some((o) => o.extended),
    };
  });
  const unknownItemIds = priced.filter((r) => r.cost === null).map((r) => r.itemId);
  const known = round(priced.reduce((n, r) => n + (r.cost ?? 0), 0));
  const out = output && {
    itemId: output.itemId,
    name: output.name,
    qtyMin: output.qtyMin,
    qtyMax: output.qtyMax,
    unitSellPrice: output.sellPrice,
    value:
      output.sellPrice === null
        ? null
        : round(
            (output.sellPrice * ((output.qtyMin ?? 1) + (output.qtyMax ?? output.qtyMin ?? 1))) / 2,
          ),
  };
  const complete = unknownItemIds.length === 0;
  return {
    reagents: priced,
    total: { known, complete, unknownItemIds },
    output: out,
    profit: complete && out && out.value !== null ? round(out.value - known) : null,
  };
}

/** `?offset=` as a non-negative integer, else 0. */
function offsetParam(q: unknown) {
  const raw = (q as Record<string, unknown>).offset;
  return typeof raw === 'string' && /^\d{1,9}$/.test(raw) ? Number(raw) : 0;
}

interface NpcRow {
  npcId: number;
  name: string | null;
  title: string | null;
  build: number;
  builds: number[];
  loc: unknown;
  seenAt: unknown;
}

const npcOut = <R extends NpcRow>({ loc, seenAt, ...r }: R) => ({
  npcId: r.npcId,
  name: r.name,
  title: r.title,
  forever: r.npcId >= FOREVER_ID_THRESHOLDS.npc,
  build: r.build,
  builds: r.builds,
  location: locationOf(loc),
  ...Object.fromEntries(
    Object.entries(r).filter(([k]) => !['npcId', 'name', 'title', 'build', 'builds'].includes(k)),
  ),
  seenAt: epochIso(seenAt),
});

interface MapNode {
  objectId: number;
  name: string | null;
  skillLineId: number | null;
  skillLineName: string | null;
  opens: number;
  rankMin: number | null;
  spots: Spot[];
}

/** Most frequent non-null value; ties go to the smallest. */
function mode(values: (string | null)[]) {
  const counts = new Map<string, number>();
  for (const v of values) if (v !== null) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  for (const [v, n] of counts)
    if (best === null || n > counts.get(best)! || (n === counts.get(best)! && v < best)) best = v;
  return best;
}

export function registerAdminProfessionsRoutes(
  app: FastifyInstance,
  db: Db,
  preHandler: ReadGuard,
) {
  /**
   * Per base profession: the characters with it (rank / max rank over its lines, recipes they know), recipes known by
   * anyone / seen, crafts summed over sessions, gathering opens and distinct nodes, trainers teaching it and vendors
   * selling one of its recipe items (items it was learned from, or Recipe-class items named "<Prefix>: <recipe>").
   * A skill line never seen in `skills` stands for itself, without a name.
   */
  app.get('/admin/api/professions/overview', { preHandler }, async () => {
    const [lines, chars, recipeCounts, known, crafts, gathering, trainers, vendors] =
      await Promise.all([
        rows<{ baseId: number; name: string; ids: number[] }>(
          db,
          sql`with ${skillBase}
          select base_id as "baseId", base_name as name, array_agg(id order by id) as ids
          from skill_base group by base_id, base_name`,
        ),
        rows<{
          baseId: number;
          char: string;
          rank: number;
          maxRank: number;
          lastSeen: unknown;
        }>(
          db,
          sql`with ${skillBase}
          select b.base_id as "baseId", s.char, max(s.rank)::int as rank, max(s.max_rank)::int as "maxRank",
                 extract(epoch from max(s.last_seen)) as "lastSeen"
          from skills s join skill_base b on b.id = s.skill_line_id
          group by b.base_id, s.char
          order by s.char`,
        ),
        rows<{ baseId: number; seen: number; known: number }>(
          db,
          sql`with ${skillBase}, r as (
            select r.recipe_id, coalesce(b.base_id, r.skill_line_id) as base_id
            from recipes r left join skill_base b on b.id = r.skill_line_id
            where r.skill_line_id is not null
          ), k as (
            select recipe_id from recipe_status where learned
            union select recipe_id from recipes_learned
          )
          select r.base_id as "baseId", count(distinct r.recipe_id)::int as seen,
                 count(distinct k.recipe_id)::int as known
          from r left join k using (recipe_id)
          group by r.base_id`,
        ),
        rows<{ baseId: number; char: string; known: number }>(
          db,
          sql`with ${skillBase}, k as (
            select recipe_id, char from recipe_status where learned
            union select recipe_id, char from recipes_learned
          )
          select coalesce(b.base_id, r.skill_line_id) as "baseId", k.char, count(distinct k.recipe_id)::int as known
          from k join recipes r using (recipe_id) left join skill_base b on b.id = r.skill_line_id
          where r.skill_line_id is not null
          group by 1, 2`,
        ),
        rows<{ baseId: number; casts: number; qty: number; procs: number; skillUps: number }>(
          db,
          sql`with ${skillBase}
          select coalesce(b.base_id, r.skill_line_id) as "baseId", sum(c.casts)::float8 as casts,
                 sum(c.qty)::float8 as qty, sum(c.procs)::float8 as procs, sum(c.skill_ups)::float8 as "skillUps"
          from crafts c join recipes r using (recipe_id) left join skill_base b on b.id = r.skill_line_id
          where r.skill_line_id is not null
          group by 1`,
        ),
        rows<{ baseId: number; opens: number; nodes: number }>(
          db,
          sql`with ${skillBase}
          select coalesce(b.base_id, n.skill_line_id) as "baseId", sum(n.opened)::float8 as opens,
                 count(distinct n.object_id)::int as nodes
          from nodes n left join skill_base b on b.id = n.skill_line_id
          where n.skill_line_id is not null
          group by 1`,
        ),
        rows<{ baseId: number; n: number }>(
          db,
          sql`with ${skillBase}
          select coalesce(b.base_id, t.skill_line_id) as "baseId", count(distinct t.npc_id)::int as n
          from trainers t left join skill_base b on b.id = t.skill_line_id
          where t.skill_line_id is not null
          group by 1`,
        ),
        rows<{ baseId: number; n: number }>(
          db,
          sql`with ${skillBase}, taught as (
            select ${viaItemId(sql`via`)} as item_id, recipe_id from recipes_learned
            where ${viaItemId(sql`via`)} is not null
            union
            select i.item_id, r.recipe_id from items i
            join recipes r on i.class_id = 9 and right(i.name, length(r.name) + 2) = ': ' || r.name
          ), sold as (
            select distinct v.npc_id, ${jint(sql`it->'itemId'`)} as item_id
            from vendors v cross join lateral jsonb_array_elements(${jarr(sql`v.items`)}) as it
          )
          select coalesce(b.base_id, r.skill_line_id) as "baseId", count(distinct s.npc_id)::int as n
          from sold s join taught t using (item_id) join recipes r using (recipe_id)
          left join skill_base b on b.id = r.skill_line_id
          where r.skill_line_id is not null
          group by 1`,
        ),
      ]);

    const ids = new Set<number>([
      ...lines.map((l) => l.baseId),
      ...recipeCounts.map((r) => r.baseId),
      ...crafts.map((c) => c.baseId),
      ...gathering.map((g) => g.baseId),
      ...trainers.map((t) => t.baseId),
      ...vendors.map((v) => v.baseId),
    ]);
    const professions = [...ids].map((id) => {
      const line = lines.find((l) => l.baseId === id);
      const r = recipeCounts.find((x) => x.baseId === id);
      const c = crafts.find((x) => x.baseId === id);
      const g = gathering.find((x) => x.baseId === id);
      return {
        skillLineId: id,
        name: line?.name ?? null,
        skillLineIds: line?.ids ?? [id],
        characters: chars
          .filter((x) => x.baseId === id)
          .map((x) => ({
            char: x.char,
            rank: x.rank,
            maxRank: x.maxRank,
            lastSeen: epochIso(x.lastSeen),
            recipesKnown: known.find((k) => k.baseId === id && k.char === x.char)?.known ?? 0,
          })),
        recipes: { known: r?.known ?? 0, seen: r?.seen ?? 0 },
        crafts: {
          casts: c?.casts ?? 0,
          qty: c?.qty ?? 0,
          procs: c?.procs ?? 0,
          skillUps: c?.skillUps ?? 0,
        },
        gathering: { opens: g?.opens ?? 0, nodes: g?.nodes ?? 0 },
        trainers: trainers.find((x) => x.baseId === id)?.n ?? 0,
        vendors: vendors.find((x) => x.baseId === id)?.n ?? 0,
      };
    });
    professions.sort(
      (a, b) =>
        (a.name === null ? 1 : 0) - (b.name === null ? 1 : 0) ||
        (a.name ?? '').localeCompare(b.name ?? '') ||
        a.skillLineId - b.skillLineId,
    );
    return { professions };
  });

  /**
   * Rank over time per character (`?char=` for one) and base profession: one point per rise (Forever records each rise
   * on the base and on the child line), oldest first, the newest 2000 per profession; `rank` / `maxRank` are the
   * current ones from `skills` (a profession only seen rising has its highest rank and no max).
   */
  app.get('/admin/api/professions/skill-history', { preHandler }, async (req) => {
    const char = charKeyParam(req.query);
    const [lines, current, points] = await Promise.all([
      rows<{ id: number; baseId: number; name: string }>(
        db,
        sql`with ${skillBase} select id, base_id as "baseId", base_name as name from skill_base`,
      ),
      rows<{ char: string; baseId: number; rank: number; maxRank: number }>(
        db,
        sql`with ${skillBase}
        select s.char, b.base_id as "baseId", max(s.rank)::int as rank, max(s.max_rank)::int as "maxRank"
        from skills s join skill_base b on b.id = s.skill_line_id
        where ${char}::text is null or s.char = ${char}::text
        group by s.char, b.base_id`,
      ),
      rows<{
        char: string;
        baseId: number;
        observedAt: unknown;
        fromRank: number;
        rank: number;
        build: number;
        recipeId: number | null;
        recipeName: string | null;
      }>(
        db,
        sql`with ${skillBase}, ups as (
          select u.char, coalesce(b.base_id, u.skill_line_id) as base_id, u.observed_at, u.to_rank,
                 min(u.from_rank) as from_rank, max(u.build) as build, max(u.recipe_id) as recipe_id
          from skill_ups u left join skill_base b on b.id = u.skill_line_id
          where ${char}::text is null or u.char = ${char}::text
          group by u.char, 2, u.observed_at, u.to_rank
        ), ranked as (
          select ups.*, row_number() over (
            partition by char, base_id order by observed_at desc, to_rank desc) as pos
          from ups
        )
        select u.char, u.base_id as "baseId", extract(epoch from u.observed_at) as "observedAt",
               u.from_rank as "fromRank", u.to_rank as rank, u.build, u.recipe_id as "recipeId",
               r.name as "recipeName"
        from ranked u left join recipes r on r.recipe_id = u.recipe_id
        where u.pos <= ${SKILL_HISTORY_MAX}
        order by u.observed_at, u.to_rank`,
      ),
    ]);
    const nameOf = (id: number) => lines.find((l) => l.baseId === id)?.name ?? null;
    const chars = [...new Set([...current.map((c) => c.char), ...points.map((p) => p.char)])].sort(
      (a, b) => (a < b ? -1 : a > b ? 1 : 0),
    );
    const items = chars.map((c) => {
      const bases = [
        ...new Set([
          ...current.filter((x) => x.char === c).map((x) => x.baseId),
          ...points.filter((p) => p.char === c).map((p) => p.baseId),
        ]),
      ];
      const professions = bases.map((id) => {
        const cur = current.find((x) => x.char === c && x.baseId === id);
        const mine = points
          .filter((p) => p.char === c && p.baseId === id)
          .map(({ char: _c, baseId: _b, observedAt, ...p }) => ({
            observedAt: epochIso(observedAt),
            ...p,
          }));
        return {
          skillLineId: id,
          name: nameOf(id),
          rank: cur?.rank ?? Math.max(...mine.map((p) => p.rank)),
          maxRank: cur?.maxRank ?? null,
          points: mine,
        };
      });
      professions.sort(
        (a, b) => (a.name ?? '￿').localeCompare(b.name ?? '￿') || a.skillLineId - b.skillLineId,
      );
      return { char: c, professions };
    });
    return { items };
  });

  /**
   * Craft counters per recipe and build, summed over sessions, uploaders and accounts (`sessions` counts the rows);
   * `?skillLine=` (base or child) keeps one base profession, `?build=` one build. The output item comes from the
   * recipe's schematic in that build.
   */
  app.get('/admin/api/professions/crafts', { preHandler }, async (req) => {
    const skillLine = int4Param(req.query, 'skillLine');
    const build = buildFilter(req.query);
    const items = await rows(
      db,
      sql`with ${skillBase}, c as (
        select recipe_id, build, sum(casts)::float8 as casts, sum(qty)::float8 as qty,
               sum(procs)::float8 as procs, sum(skill_ups)::float8 as skill_ups, count(*)::int as sessions
        from crafts where ${build}::int is null or build = ${build}::int
        group by recipe_id, build
      )
      select c.recipe_id as "recipeId", r.name, c.build,
             case when r.skill_line_id is not null then jsonb_build_object(
               'skillLineId', coalesce(b.base_id, r.skill_line_id), 'name', b.base_name) end as profession,
             s.output_item_id as "outputItemId", o.name as "outputItemName",
             c.casts, c.qty, c.procs, c.skill_ups as "skillUps", c.sessions
      from c
      left join recipes r on r.recipe_id = c.recipe_id
      left join skill_base b on b.id = r.skill_line_id
      left join recipe_snapshots s on s.recipe_id = c.recipe_id and s.build = c.build
      left join items o on o.item_id = s.output_item_id
      where ${skillLine}::int is null or coalesce(b.base_id, r.skill_line_id) = ${baseOf(skillLine)}
      order by c.build desc, c.casts desc, c.qty desc, c.recipe_id`,
    );
    return { items };
  });

  /**
   * Gathering spots per map (`?build=` for one build, else all merged): per node type its name (the one most sessions
   * gave), base profession, opens on this map (each session's opens spread over its spots), lowest rank seen and the
   * spots with their share of opens. The map's zone name comes from an NPC seen on it, when any.
   */
  app.get('/admin/api/professions/gathering-map', { preHandler }, async (req) => {
    const build = buildFilter(req.query);
    const [builds, nodeRows, zones] = await Promise.all([
      rows<{ build: number }>(db, sql`select distinct build from nodes order by build desc`),
      rows<{
        objectId: number;
        name: string | null;
        skillLineId: number | null;
        skillLineName: string | null;
        opened: number;
        rankMin: number | null;
        spots: { mapId: number; points: [number, number][] }[];
      }>(
        db,
        sql`with ${skillBase}
        select n.object_id as "objectId", n.name, coalesce(b.base_id, n.skill_line_id) as "skillLineId",
               b.base_name as "skillLineName", n.opened, n.rank_min as "rankMin", n.spots
        from nodes n left join skill_base b on b.id = n.skill_line_id
        where ${build}::int is null or n.build = ${build}::int
        order by n.object_id`,
      ),
      rows<{ mapId: number; zone: string }>(
        db,
        sql`select distinct on (map_id) map_id as "mapId", zone from (
          select ${jint(sql`loc->'mapID'`)} as map_id, ${jtext(sql`loc`, 'zone')} as zone, seen_at from vendors
          union all
          select ${jint(sql`loc->'mapID'`)}, ${jtext(sql`loc`, 'zone')}, seen_at from trainers
        ) z
        where map_id is not null and zone is not null
        order by map_id, seen_at desc`,
      ),
    ]);

    type NodeRow = (typeof nodeRows)[number];
    const byObject = new Map<number, NodeRow[]>();
    for (const r of nodeRows) {
      const list = byObject.get(r.objectId);
      if (list) list.push(r);
      else byObject.set(r.objectId, [r]);
    }

    const maps = new Map<number, { mapId: number; opens: number; nodes: MapNode[] }>();
    for (const [objectId, src] of byObject) {
      const name = mode(src.map((r) => r.name));
      // The base profession: the highest line id seen, as /v1/professions/gathering does.
      const line = src
        .filter((r) => r.skillLineId !== null)
        .sort((a, b) => b.skillLineId! - a.skillLineId!)[0];
      for (const [mapId, spots] of spreadSpots(src)) {
        // Lowest rank per map: only the sessions that recorded a spot there.
        const ranks = src
          .filter((r) => Array.isArray(r.spots) && r.spots.some((s) => s?.mapId === mapId))
          .flatMap((r) => (r.rankMin === null ? [] : [r.rankMin]));
        const opens = round(
          spots.reduce((t, s) => t + s.opens, 0),
          2,
        );
        const m = maps.get(mapId) ?? { mapId, opens: 0, nodes: [] };
        m.opens = round(m.opens + opens, 2);
        m.nodes.push({
          objectId,
          name,
          skillLineId: line?.skillLineId ?? null,
          skillLineName: line?.skillLineName ?? null,
          opens,
          rankMin: ranks.length > 0 ? Math.min(...ranks) : null,
          spots,
        });
        maps.set(mapId, m);
      }
    }
    const list = [...maps.values()]
      .sort((a, b) => b.opens - a.opens || a.mapId - b.mapId)
      .map((m) => ({
        mapId: m.mapId,
        zone: zones.find((z) => z.mapId === m.mapId)?.zone ?? null,
        opens: m.opens,
        nodes: m.nodes.sort((a, b) => b.opens - a.opens || a.objectId - b.objectId),
      }));
    return { build, builds: builds.map((b) => b.build), maps: list };
  });

  /**
   * Reagent cost of a recipe (`?recipeId=`, schematic of `?build=` or the newest one): each reagent at the cheapest
   * known vendor gold price per item over every build (extended-cost listings ignored; unknown when no vendor sells
   * it for gold), the known total, and the output's vendor sell price (from the item's snapshot in that build, else
   * its newest) × average quantity made. See `reagentCost`.
   */
  app.get('/admin/api/professions/cost', { preHandler }, async (req, reply) => {
    const recipeId = int4Param(req.query, 'recipeId');
    if (recipeId === null) throw badRequest('pass ?recipeId=');
    const build = buildFilter(req.query);
    const [recipe] = await rows<{ name: string }>(
      db,
      sql`select name from recipes where recipe_id = ${recipeId}`,
    );
    if (!recipe) return reply.status(404).send({ error: 'recipe not seen yet' });
    const builds = (
      await rows<{ build: number }>(
        db,
        sql`select build from recipe_snapshots where recipe_id = ${recipeId} order by build desc`,
      )
    ).map((b) => b.build);
    const snapBuild = build === null ? (builds[0] ?? null) : builds.includes(build) ? build : null;
    const head = { recipeId, name: recipe.name, build: snapBuild, builds };
    if (snapBuild === null) return { ...head, ...reagentCost([], [], null) };

    const [snap] = await rows<{
      outputItemId: number | null;
      outputName: string | null;
      qtyMin: number | null;
      qtyMax: number | null;
      sellPrice: number | null;
    }>(
      db,
      sql`select s.output_item_id as "outputItemId", o.name as "outputName", s.qty_min as "qtyMin",
                 s.qty_max as "qtyMax",
                 (select sell_price from item_snapshots x where x.item_id = s.output_item_id
                  order by (x.build = s.build) desc, x.build desc limit 1) as "sellPrice"
          from recipe_snapshots s left join items o on o.item_id = s.output_item_id
          where s.recipe_id = ${recipeId} and s.build = ${snapBuild}`,
    );
    const reagents = await rows<{ itemId: number; name: string | null; qty: number }>(
      db,
      sql`select r.item_id as "itemId", i.name, r.qty
          from recipe_snapshots s
          cross join lateral jsonb_array_elements(${jarr(sql`s.reagents`)}) with ordinality as e(g, ord)
          cross join lateral (select ${jint(sql`g->'itemId'`)} as item_id, ${jnum(sql`g->'qty'`)} as qty) r
          left join items i on i.item_id = r.item_id
          where s.recipe_id = ${recipeId} and s.build = ${snapBuild} and r.item_id is not null
            and r.qty is not null
          order by e.ord`,
    );
    const offers = await rows<VendorOffer>(
      db,
      sql`select l.item_id as "itemId", v.npc_id as "npcId", v.name, v.title, v.build,
                 ${jnum(sql`it->'price'`)} as price, ${jnum(sql`it->'stack'`)} as stack,
                 ${extended(sql`it`)} as extended
          from vendors v
          cross join lateral jsonb_array_elements(${jarr(sql`v.items`)}) with ordinality as e(it, ord)
          cross join lateral (select ${jint(sql`it->'itemId'`)} as item_id) l
          where l.item_id = any(${sql.param(reagents.map((r) => r.itemId))}::int[])
          order by v.build desc, v.npc_id, e.ord`,
    );
    const output =
      snap && snap.outputItemId !== null
        ? {
            itemId: snap.outputItemId,
            name: snap.outputName,
            qtyMin: snap.qtyMin,
            qtyMax: snap.qtyMax,
            sellPrice: snap.sellPrice,
          }
        : null;
    return { ...head, ...reagentCost(reagents, offers, output) };
  });

  // ---- vendors and trainers ----

  /** Newest row per NPC (highest build, then latest scan) with all its builds, filtered; `extra` adds columns. */
  const npcList = async (table: 'vendors' | 'trainers', q: unknown, extra: SQL) => {
    const search = searchParam(q);
    const title = textParam(q, 'title', TITLE_MAX);
    const foreverOnly = flagParam(q, 'foreverOnly');
    const limit = intParam(q, 'limit', LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT);
    const offset = offsetParam(q);
    const t = sql.raw(table);
    const latest = sql`${skillBase}, latest as (
      select distinct on (npc_id) * from ${t} order by npc_id, build desc, seen_at desc
    ), filtered as (
      select l.* from latest l
      where (${search}::text is null
             or l.name ilike ${search === null ? null : containsPattern(search)}::text escape '\\'
             or l.title ilike ${search === null ? null : containsPattern(search)}::text escape '\\'
             or l.npc_id::text = ${search}::text)
        and (${title}::text is null or lower(l.title) = lower(${title}::text))
        and (not ${foreverOnly}::boolean or l.npc_id >= ${FOREVER_ID_THRESHOLDS.npc})
    )`;
    const [items, total, titles] = await Promise.all([
      rows<NpcRow>(
        db,
        sql`with ${latest}
        select l.npc_id as "npcId", l.name, l.title, l.build,
               (select array_agg(x.build order by x.build desc) from ${t} x where x.npc_id = l.npc_id) as builds,
               l.loc, extract(epoch from l.seen_at) as "seenAt", ${extra}
        from filtered l
        left join skill_base b on ${table === 'trainers' ? sql`b.id = l.skill_line_id` : sql`false`}
        order by l.name nulls last, l.npc_id
        limit ${limit} offset ${offset}`,
      ),
      rows<{ n: number }>(db, sql`with ${latest} select count(*)::int as n from filtered`),
      rows<{ title: string; count: number }>(
        db,
        sql`with ${latest}
        select title, count(*)::int as count from latest where title is not null
        group by title order by title`,
      ),
    ]);
    return {
      total: total[0]!.n,
      limit,
      offset,
      foreverNpcMin: FOREVER_ID_THRESHOLDS.npc,
      titles,
      items: items.map(npcOut),
    };
  };

  /**
   * Vendors, one row per NPC in its newest build: `?search=` (name, subtitle or npc id; ≤ 100 chars), `?title=` (exact
   * subtitle, any case; ≤ 200 chars), `?foreverOnly=true` (npc id ≥ FOREVER_ID_THRESHOLDS.npc), `?limit=` /
   * `?offset=`. Longer text is a 400. Counts: listings, listings of Recipe-class items (items.class_id = 9) and listings
   * with an extended cost. `titles` lists every subtitle seen.
   */
  app.get('/admin/api/vendors', { preHandler }, async (req) =>
    npcList(
      'vendors',
      req.query,
      sql`(select count(*) from jsonb_array_elements(${jarr(sql`l.items`)}))::int as "itemCount",
          (select count(*) from jsonb_array_elements(${jarr(sql`l.items`)}) as it
           join items i on i.item_id = ${jint(sql`it->'itemId'`)} where i.class_id = 9)::int as "recipeItemCount",
          (select count(*) from jsonb_array_elements(${jarr(sql`l.items`)}) as it
           where ${extended(sql`it`)})::int as "extendedCostCount"`,
    ),
  );

  /** Newest scan of an NPC, or the one of `?build=`. */
  const npcRow = (table: 'vendors' | 'trainers', npcId: number, build: number | null) =>
    rows<NpcRow & { skillLineId?: number | null; complete?: boolean }>(
      db,
      sql`select npc_id as "npcId", name, title, build, loc, extract(epoch from seen_at) as "seenAt",
                 (select array_agg(x.build order by x.build desc) from ${sql.raw(table)} x
                  where x.npc_id = ${npcId}) as builds
                 ${table === 'trainers' ? sql`, skill_line_id as "skillLineId", complete` : sql``}
          from ${sql.raw(table)}
          where npc_id = ${npcId} and (${build}::int is null or build = ${build}::int)
          order by build desc, seen_at desc limit 1`,
    );

  /**
   * One vendor's listings in order: item name, quality, class, the gold `price` for `stack` items, stock (-1 =
   * unlimited), and the extended cost (`costs`: items or currencies, named from `items` when known; null when none).
   * `teaches`: the recipe a listing teaches (`{ recipeId, name }`, see `recipesTaughtBy`), else null.
   */
  app.get<{ Params: { npcId: string } }>(
    '/admin/api/vendors/:npcId',
    { preHandler },
    async (req, reply) => {
      const npcId = idParam(req.params.npcId, 'npc');
      const build = buildFilter(req.query);
      const [v] = await npcRow('vendors', npcId, build);
      if (!v) return reply.status(404).send({ error: 'vendor not seen yet' });
      const items = await rows<Record<string, unknown> & { itemId: number | null }>(
        db,
        sql`select l.item_id as "itemId", i.name, i.quality, i.class_id as "classId", i.type, i.subtype,
                   ${jnum(sql`it->'price'`)} as price, ${jnum(sql`it->'stack'`)} as stack,
                   ${jnum(sql`it->'numAvailable'`)} as "numAvailable",
                   ${jint(sql`it->'currencyId'`)} as "currencyId",
                   ${extended(sql`it`)} as "extendedCost",
                   case when ${jlen(sql`it->'costs'`)} > 0 then (
                     select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                              'amount', ${jnum(sql`c->'amount'`)},
                              'itemId', ${jint(sql`c->'itemId'`)},
                              'currencyId', ${jint(sql`c->'currencyId'`)},
                              'name', coalesce(ci.name, ${jtext(sql`c`, 'name')})))
                            order by o)
                     from jsonb_array_elements(it->'costs') with ordinality as k(c, o)
                     left join items ci on ci.item_id = ${jint(sql`c->'itemId'`)}
                   ) end as costs
            from vendors v
            cross join lateral jsonb_array_elements(${jarr(sql`v.items`)}) with ordinality as e(it, ord)
            cross join lateral (select ${jint(sql`it->'itemId'`)} as item_id) l
            left join items i on i.item_id = l.item_id
            where v.npc_id = ${npcId} and v.build = ${v.build}
            order by e.ord`,
      );
      const taught = await recipesTaughtBy(
        db,
        items.flatMap((i) => (i.itemId === null ? [] : [i.itemId])),
      );
      return {
        ...npcOut(v),
        items: items.map((i) => ({
          ...i,
          teaches: (i.itemId !== null && taught.get(i.itemId)) || null,
        })),
      };
    },
  );

  /**
   * Trainers, one row per NPC in its newest build, with the profession it teaches (folded to the base), whether a scan
   * saw its whole list (`complete`) and its service count. Same filters as /admin/api/vendors.
   */
  app.get('/admin/api/trainers', { preHandler }, async (req) =>
    npcList(
      'trainers',
      req.query,
      sql`coalesce(b.base_id, l.skill_line_id) as "skillLineId", b.base_name as "skillLineName", l.complete,
          (select count(*) from jsonb_array_elements(${jarr(sql`l.services`)}))::int as "serviceCount"`,
    ),
  );

  /**
   * One trainer's services in order: name, type (available / unavailable / used), cost in copper, required skill and
   * rank, required level, the item it makes and `recipeId`: the recipe of the same name in the trainer's profession
   * (lowest id), else null. `complete` false: the scan ran with a type filter off or a header
   * collapsed, so the list can miss services.
   */
  app.get<{ Params: { npcId: string } }>(
    '/admin/api/trainers/:npcId',
    { preHandler },
    async (req, reply) => {
      const npcId = idParam(req.params.npcId, 'npc');
      const build = buildFilter(req.query);
      const [t] = await npcRow('trainers', npcId, build);
      if (!t) return reply.status(404).send({ error: 'trainer not seen yet' });
      const [line] = await rows<{ skillLineId: number | null; skillLineName: string | null }>(
        db,
        sql`with ${skillBase}
            select coalesce(b.base_id, ${t.skillLineId ?? null}::int) as "skillLineId", b.base_name as "skillLineName"
            from (select 1) one left join skill_base b on b.id = ${t.skillLineId ?? null}::int`,
      );
      const services = await rows(
        db,
        sql`with ${skillBase}
            select ${jtext(sql`svc`, 'name')} as name, ${jtext(sql`svc`, 'type')} as type,
                   ${jnum(sql`svc->'cost'`)} as cost, ${jtext(sql`svc`, 'skill')} as skill,
                   ${jnum(sql`svc->'skillRank'`)} as "skillRank", ${jnum(sql`svc->'level'`)} as level,
                   l.item_id as "itemId", i.name as "itemName",
                   (select min(r.recipe_id) from recipes r left join skill_base rb on rb.id = r.skill_line_id
                    where r.name = ${jtext(sql`svc`, 'name')}
                      and (${line?.skillLineId ?? null}::int is null or r.skill_line_id is null
                           or coalesce(rb.base_id, r.skill_line_id) = ${line?.skillLineId ?? null}::int)
                   ) as "recipeId"
            from trainers t
            cross join lateral jsonb_array_elements(${jarr(sql`t.services`)}) with ordinality as e(svc, ord)
            cross join lateral (select ${jint(sql`svc->'itemId'`)} as item_id) l
            left join items i on i.item_id = l.item_id
            where t.npc_id = ${npcId} and t.build = ${t.build}
            order by e.ord`,
      );
      const { skillLineId: _s, complete, ...rest } = t;
      return {
        ...npcOut(rest),
        complete: complete ?? false,
        skillLineId: line?.skillLineId ?? null,
        skillLineName: line?.skillLineName ?? null,
        services,
      };
    },
  );

  registerAdminRecipesRoutes(app, db, preHandler);
}
