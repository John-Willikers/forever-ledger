// Admin panel builds reads (/admin/api/builds, /admin/api/build-diff): the client builds seen and what changed between
// two of them, for entities observed in both. Everything compared is uploaded data: jsonb columns are read in JS and
// every value is type-checked (a wrong type reads as absent, never a 500), and the panel renders it as text.
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { INT4_MAX } from '../addon.js';
import type { Db } from '../db/client.js';
import type { ReadGuard } from './analysis.js';
import { iso, rows } from './adminData.js';
import { itemInfo, npcNames, ratesCtes, statDiffs } from './adminLoot.js';
import { badRequest } from './shared.js';

/** Changes listed per category (the total is always counted). `?limit=` lowers it. */
export const BUILD_DIFF_LIMIT = 500;
/** Entities listed as a sample of those only one build saw. */
export const ONLY_IN_SAMPLE = 50;
/** Drop rates are compared only for npcs looted at least this often in both builds (`?minCorpses=`). */
export const MIN_CORPSES_DEFAULT = 5;
const MIN_CORPSES_MAX = 1_000_000;

/** Quest stages whose XP and money are what the quest offers (as /v1/quests/xp). */
const OFFER_STAGES = sql`('detail', 'complete', 'log')`;
/** Quest stages that show the reward choices. */
const REWARD_STAGES = sql`('detail', 'complete')`;

// ---- parameters ------------------------------------------------------------------------------------------------

/**
 * `?<key>=` as an integer in [min, max], null when absent or empty; anything else is a 400. With `clamp`, values
 * above `max` are lowered to it instead.
 */
function strictInt(q: unknown, key: string, min: number, max: number, clamp = false) {
  const raw = (q as Record<string, unknown>)[key];
  if (raw === undefined || raw === '') return null;
  if (typeof raw !== 'string' || !/^\d{1,10}$/.test(raw))
    throw badRequest(`?${key}= must be a whole number`);
  const n = Number(raw);
  if (n < min) throw badRequest(`?${key}= must be at least ${min}`);
  if (n > max) {
    if (clamp) return max;
    throw badRequest(`?${key}= must be at most ${max}`);
  }
  return n;
}

const notFound = (message: string) => Object.assign(new Error(message), { statusCode: 404 });

// ---- untrusted jsonb -------------------------------------------------------------------------------------------

type Json = Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === 'string' ? v : null);
/** A positive int4 (an id), else null. */
const id = (v: unknown) =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= INT4_MAX ? v : null;
const objects = (v: unknown): Json[] =>
  Array.isArray(v) ? v.filter((x): x is Json => typeof x === 'object' && x !== null) : [];

/** Numeric stats of an item snapshot; anything that isn't a number is left out. */
export function statsOf(v: unknown): Record<string, number> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
  const out: Record<string, number> = {};
  for (const [k, x] of Object.entries(v)) {
    const n = num(x);
    if (n !== null) out[k] = n;
  }
  return out;
}

/** Tooltip lines (strings only). */
export const linesOf = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** Lines in `to` but not `from` (added) and in `from` but not `to` (removed), each in its own order. */
export function lineChanges(from: string[], to: string[]) {
  const a = new Set(from);
  const b = new Set(to);
  return {
    added: [...new Set(to.filter((l) => !a.has(l)))],
    removed: [...new Set(from.filter((l) => !b.has(l)))],
  };
}

/** The first entry per key of a list (a key seen twice keeps its first entry). */
function byKey<T, K>(xs: T[], key: (x: T) => K | null) {
  const m = new Map<K, T>();
  for (const x of xs) {
    const k = key(x);
    if (k !== null && !m.has(k)) m.set(k, x);
  }
  return m;
}

/**
 * Keyed lists compared: entries only in `to` (added), only in `from` (removed), and in both where `same` says they
 * differ (changed). Order: `to`'s for added and changed, `from`'s for removed.
 */
export function keyedChanges<T, K>(from: Map<K, T>, to: Map<K, T>, same: (a: T, b: T) => boolean) {
  const added: T[] = [];
  const changed: { key: K; from: T; to: T }[] = [];
  for (const [k, b] of to) {
    const a = from.get(k);
    if (a === undefined) added.push(b);
    else if (!same(a, b)) changed.push({ key: k, from: a, to: b });
  }
  const removed = [...from].filter(([k]) => !to.has(k)).map(([, a]) => a);
  return { added, removed, changed };
}

/** Changed scalar fields between two records (`null` = absent). */
function fieldChanges<F extends string>(
  fields: readonly F[],
  a: Record<F, number | string | null>,
  b: Record<F, number | string | null>,
) {
  return fields
    .filter((f) => a[f] !== b[f])
    .map((field) => ({ field, from: a[field], to: b[field] }));
}

export interface ReagentEntry {
  itemId: number;
  qty: number | null;
}
export const reagentsOf = (v: unknown) =>
  byKey(
    objects(v).map((r) => ({ itemId: id(r.itemId), qty: num(r.qty) })),
    (r) => r.itemId,
  ) as Map<number, ReagentEntry>;

export interface VendorCostEntry {
  amount: number | null;
  itemId: number | null;
  currencyId: number | null;
  name: string | null;
}
export interface VendorEntry {
  itemId: number;
  price: number | null;
  stack: number | null;
  costs: VendorCostEntry[];
}
export const vendorItemsOf = (v: unknown) =>
  byKey(
    objects(v).map((it) => ({
      itemId: id(it.itemId),
      price: num(it.price),
      stack: num(it.stack),
      costs: objects(it.costs).map((c) => ({
        amount: num(c.amount),
        itemId: id(c.itemId),
        currencyId: id(c.currencyId),
        name: str(c.name),
      })),
    })),
    (it) => it.itemId,
  ) as Map<number, VendorEntry>;

const TRAINER_FIELDS = ['cost', 'skill', 'skillRank', 'level', 'itemId'] as const;
export interface ServiceEntry {
  name: string;
  cost: number | null;
  skill: string | null;
  skillRank: number | null;
  level: number | null;
  itemId: number | null;
}
export const servicesOf = (v: unknown) =>
  byKey(
    objects(v).map((s) => ({
      name: str(s.name),
      cost: num(s.cost),
      skill: str(s.skill),
      skillRank: num(s.skillRank),
      level: num(s.level),
      itemId: id(s.itemId),
    })),
    (s) => s.name,
  ) as Map<string, ServiceEntry>;

const sameCosts = (a: VendorCostEntry[], b: VendorCostEntry[]) =>
  JSON.stringify(a) === JSON.stringify(b);

// ---- queries ---------------------------------------------------------------------------------------------------

interface BuildRow {
  build: number;
  version: string | null;
  interface: number | null;
  first_seen: Date;
  last_seen: Date;
}

const buildInfo = (b: BuildRow) => ({
  build: b.build,
  version: b.version,
  interface: b.interface,
  firstSeen: iso(b.first_seen),
  lastSeen: iso(b.last_seen),
});

/** `{ total, sample }` of the ids `entities(a)` has and `entities(b)` hasn't; `entities` selects `id, name`. */
async function onlyIn(db: Db, entities: (build: number) => SQL, a: number, b: number) {
  const rs = await rows<{ id: number; name: string | null; total: number }>(
    db,
    sql`
    with x as (${entities(a)}), y as (${entities(b)})
    select x.id, x.name, count(*) over ()::int as total
    from x where not exists (select 1 from y where y.id = x.id)
    order by x.id
    limit ${ONLY_IN_SAMPLE}`,
  );
  return { total: rs[0]?.total ?? 0, sample: rs.map((r) => ({ id: r.id, name: r.name })) };
}

async function bothWays(db: Db, entities: (build: number) => SQL, from: number, to: number) {
  const [onlyInFrom, onlyInTo] = await Promise.all([
    onlyIn(db, entities, from, to),
    onlyIn(db, entities, to, from),
  ]);
  return { onlyInFrom, onlyInTo };
}

/** A capped change list with its total. */
const capped = <T>(changes: T[], limit: number) => ({
  total: changes.length,
  changes: changes.slice(0, limit),
});

const itemRef = (
  info: Map<number, { name: string; quality: number | null }>,
  itemId: number | null,
) => {
  const i = itemId === null ? undefined : info.get(itemId);
  return { name: i?.name ?? null, quality: i?.quality ?? null };
};

async function itemDiff(db: Db, from: number, to: number) {
  const rs = await rows<{
    item_id: number;
    name: string | null;
    quality: number | null;
    a_ilvl: number | null;
    a_req: number | null;
    a_sell: number | null;
    a_stats: unknown;
    a_tip: unknown;
    b_ilvl: number | null;
    b_req: number | null;
    b_sell: number | null;
    b_stats: unknown;
    b_tip: unknown;
  }>(
    db,
    sql`
    select a.item_id, i.name, i.quality,
           a.ilvl as a_ilvl, a.req_level as a_req, a.sell_price as a_sell, a.stats as a_stats, a.tooltip as a_tip,
           b.ilvl as b_ilvl, b.req_level as b_req, b.sell_price as b_sell, b.stats as b_stats, b.tooltip as b_tip
    from item_snapshots a
    join item_snapshots b on b.item_id = a.item_id and b.build = ${to}
    left join items i on i.item_id = a.item_id
    where a.build = ${from}
      and (a.ilvl is distinct from b.ilvl or a.req_level is distinct from b.req_level
           or a.sell_price is distinct from b.sell_price or a.stats is distinct from b.stats
           or a.tooltip is distinct from b.tooltip)
    order by a.item_id`,
  );
  const changes = rs.flatMap((r) => {
    // Builds 0 and 1: statDiffs sorts by build, and `from` may be the newer one.
    const [d] = statDiffs([
      {
        build: 0,
        ilvl: r.a_ilvl,
        reqLevel: r.a_req,
        sellPrice: r.a_sell,
        stats: statsOf(r.a_stats),
      },
      {
        build: 1,
        ilvl: r.b_ilvl,
        reqLevel: r.b_req,
        sellPrice: r.b_sell,
        stats: statsOf(r.b_stats),
      },
    ]);
    const tooltip = lineChanges(linesOf(r.a_tip), linesOf(r.b_tip));
    if (!d && tooltip.added.length === 0 && tooltip.removed.length === 0) return [];
    return [
      {
        itemId: r.item_id,
        name: r.name,
        quality: r.quality,
        fields: d?.fields ?? [],
        stats: d?.stats ?? [],
        tooltip,
      },
    ];
  });
  return changes;
}

const itemEntities = (build: number) => sql`
  select s.item_id as id, i.name from item_snapshots s left join items i using (item_id)
  where s.build = ${build}`;

async function questDiff(db: Db, from: number, to: number) {
  const [offers, options] = await Promise.all([
    rows<{
      quest_id: number;
      title: string | null;
      level: number | null;
      a_xp: number | null;
      a_money: number | null;
      a_rewards: boolean;
      b_xp: number | null;
      b_money: number | null;
      b_rewards: boolean;
    }>(
      db,
      sql`
      with o as (
        select quest_id, build,
               max(xp) filter (where stage in ${OFFER_STAGES})::int as xp,
               max(money) filter (where stage in ${OFFER_STAGES})::int as money,
               bool_or(stage in ${REWARD_STAGES}) as rewards
        from quest_observations where build in (${from}, ${to})
        group by quest_id, build
      )
      select a.quest_id, q.title, q.level,
             a.xp as a_xp, a.money as a_money, a.rewards as a_rewards,
             b.xp as b_xp, b.money as b_money, b.rewards as b_rewards
      from o a join o b on b.quest_id = a.quest_id and b.build = ${to}
      left join quests q on q.quest_id = a.quest_id
      where a.build = ${from}
      order by a.quest_id`,
    ),
    rows<{ quest_id: number; build: number; item_id: number; kind: string; count: number }>(
      db,
      sql`
      select quest_id, build, item_id, kind, count from quest_reward_options
      where build in (${from}, ${to})
        and quest_id in (select quest_id from quest_observations where build = ${from}
                         intersect
                         select quest_id from quest_observations where build = ${to})
      order by quest_id, kind, item_id`,
    ),
  ]);
  type Option = { itemId: number; kind: string; count: number };
  const optionsOf = (questId: number, build: number) =>
    byKey(
      options
        .filter((o) => o.quest_id === questId && o.build === build)
        .map((o) => ({ itemId: o.item_id, kind: o.kind, count: o.count })),
      (o: Option) => `${o.kind}:${o.itemId}`,
    );
  const raw = offers.flatMap((q) => {
    const xp =
      q.a_xp !== null && q.b_xp !== null && q.a_xp !== q.b_xp ? { from: q.a_xp, to: q.b_xp } : null;
    const money =
      q.a_money !== null && q.b_money !== null && q.a_money !== q.b_money
        ? { from: q.a_money, to: q.b_money }
        : null;
    // Reward options only count when both builds saw a stage that shows them.
    const r =
      q.a_rewards && q.b_rewards
        ? keyedChanges(
            optionsOf(q.quest_id, from),
            optionsOf(q.quest_id, to),
            (a, b) => a.count === b.count,
          )
        : { added: [], removed: [], changed: [] };
    if (!xp && !money && r.added.length + r.removed.length + r.changed.length === 0) return [];
    return [{ q, xp, money, r }];
  });
  const info = await itemInfo(
    db,
    raw.flatMap(({ r }) =>
      [...r.added, ...r.removed, ...r.changed.map((c) => c.to)].map((o) => o.itemId),
    ),
  );
  const option = (o: Option) => ({
    itemId: o.itemId,
    ...itemRef(info, o.itemId),
    kind: o.kind,
    count: o.count,
  });
  return raw.map(({ q, xp, money, r }) => ({
    questId: q.quest_id,
    title: q.title,
    level: q.level,
    xp,
    money,
    rewards: {
      added: r.added.map(option),
      removed: r.removed.map(option),
      changed: r.changed.map((c) => ({
        itemId: c.to.itemId,
        ...itemRef(info, c.to.itemId),
        kind: c.to.kind,
        from: c.from.count,
        to: c.to.count,
      })),
    },
  }));
}

const questEntities = (build: number) => sql`
  select o.quest_id as id, max(q.title) as name
  from quest_observations o left join quests q using (quest_id)
  where o.build = ${build} group by o.quest_id`;

const RECIPE_FIELDS = ['outputItemId', 'qtyMin', 'qtyMax', 'maxTrivial'] as const;

async function recipeDiff(db: Db, from: number, to: number) {
  type Side = { out: number | null; qmin: number | null; qmax: number | null; triv: number | null };
  const rs = await rows<
    {
      recipe_id: number;
      name: string | null;
      a_reagents: unknown;
      b_reagents: unknown;
    } & { [K in `${'a' | 'b'}_${keyof Side}`]: number | null }
  >(
    db,
    sql`
    select a.recipe_id, r.name,
           a.output_item_id as a_out, a.qty_min as a_qmin, a.qty_max as a_qmax, a.max_trivial as a_triv,
           a.reagents as a_reagents,
           b.output_item_id as b_out, b.qty_min as b_qmin, b.qty_max as b_qmax, b.max_trivial as b_triv,
           b.reagents as b_reagents
    from recipe_snapshots a
    join recipe_snapshots b on b.recipe_id = a.recipe_id and b.build = ${to}
    left join recipes r on r.recipe_id = a.recipe_id
    where a.build = ${from}
      and (a.output_item_id is distinct from b.output_item_id or a.qty_min is distinct from b.qty_min
           or a.qty_max is distinct from b.qty_max or a.max_trivial is distinct from b.max_trivial
           or a.reagents is distinct from b.reagents)
    order by a.recipe_id`,
  );
  const raw = rs.flatMap((r) => {
    const side = (p: 'a' | 'b') => ({
      outputItemId: r[`${p}_out`],
      qtyMin: r[`${p}_qmin`],
      qtyMax: r[`${p}_qmax`],
      maxTrivial: r[`${p}_triv`],
    });
    const fields = fieldChanges(RECIPE_FIELDS, side('a'), side('b'));
    const reagents = keyedChanges(
      reagentsOf(r.a_reagents),
      reagentsOf(r.b_reagents),
      (a, b) => a.qty === b.qty,
    );
    if (
      fields.length + reagents.added.length + reagents.removed.length + reagents.changed.length ===
      0
    )
      return [];
    return [{ r, fields, reagents, outputItemId: r.b_out ?? r.a_out }];
  });
  const info = await itemInfo(
    db,
    raw.flatMap(({ reagents, outputItemId }) => [
      ...(outputItemId === null ? [] : [outputItemId]),
      ...reagents.added.map((x) => x.itemId),
      ...reagents.removed.map((x) => x.itemId),
      ...reagents.changed.map((x) => x.to.itemId),
    ]),
  );
  const reagent = (x: ReagentEntry) => ({
    itemId: x.itemId,
    name: itemRef(info, x.itemId).name,
    qty: x.qty,
  });
  return raw.map(({ r, fields, reagents, outputItemId }) => ({
    recipeId: r.recipe_id,
    name: r.name,
    outputItemId,
    outputName: itemRef(info, outputItemId).name,
    fields,
    reagents: {
      added: reagents.added.map(reagent),
      removed: reagents.removed.map(reagent),
      changed: reagents.changed.map((c) => ({
        itemId: c.to.itemId,
        name: itemRef(info, c.to.itemId).name,
        from: c.from.qty,
        to: c.to.qty,
      })),
    },
  }));
}

const recipeEntities = (build: number) => sql`
  select s.recipe_id as id, r.name from recipe_snapshots s left join recipes r using (recipe_id)
  where s.build = ${build}`;

async function vendorDiff(db: Db, from: number, to: number) {
  const rs = await rows<{
    npc_id: number;
    name: string | null;
    title: string | null;
    a_items: unknown;
    b_items: unknown;
  }>(
    db,
    sql`
    select a.npc_id, coalesce(b.name, a.name) as name, coalesce(b.title, a.title) as title,
           a.items as a_items, b.items as b_items
    from vendors a join vendors b on b.npc_id = a.npc_id and b.build = ${to}
    where a.build = ${from} and a.items is distinct from b.items
    order by a.npc_id`,
  );
  const raw = rs.flatMap((v) => {
    const c = keyedChanges(
      vendorItemsOf(v.a_items),
      vendorItemsOf(v.b_items),
      (a, b) => a.price === b.price && a.stack === b.stack && sameCosts(a.costs, b.costs),
    );
    return c.added.length + c.removed.length + c.changed.length === 0 ? [] : [{ v, c }];
  });
  const all = raw.flatMap(({ c }) => [
    ...c.added,
    ...c.removed,
    ...c.changed.flatMap((x) => [x.from, x.to]),
  ]);
  const info = await itemInfo(db, [
    ...all.map((x) => x.itemId),
    ...all.flatMap((x) => x.costs.map((k) => k.itemId).filter((n): n is number => n !== null)),
  ]);
  const costs = (x: VendorEntry) =>
    x.costs.map((k) => ({
      ...k,
      name: (k.itemId === null ? null : info.get(k.itemId)?.name) ?? k.name,
    }));
  const price = (x: VendorEntry) => ({ price: x.price, stack: x.stack, costs: costs(x) });
  const entry = (x: VendorEntry) => ({ itemId: x.itemId, ...itemRef(info, x.itemId), ...price(x) });
  return raw.map(({ v, c }) => ({
    npcId: v.npc_id,
    name: v.name,
    title: v.title,
    added: c.added.map(entry),
    removed: c.removed.map(entry),
    changed: c.changed.map((x) => ({
      itemId: x.to.itemId,
      ...itemRef(info, x.to.itemId),
      from: price(x.from),
      to: price(x.to),
    })),
  }));
}

const npcEntities = (table: 'vendors' | 'trainers') => (build: number) => sql`
  select npc_id as id, name from ${sql.raw(table)} where build = ${build}`;

async function trainerDiff(db: Db, from: number, to: number) {
  const rs = await rows<{
    npc_id: number;
    name: string | null;
    title: string | null;
    a_complete: boolean;
    b_complete: boolean;
    a_services: unknown;
    b_services: unknown;
  }>(
    db,
    sql`
    select a.npc_id, coalesce(b.name, a.name) as name, coalesce(b.title, a.title) as title,
           a.complete as a_complete, b.complete as b_complete,
           a.services as a_services, b.services as b_services
    from trainers a join trainers b on b.npc_id = a.npc_id and b.build = ${to}
    where a.build = ${from} and a.services is distinct from b.services
    order by a.npc_id`,
  );
  return rs.flatMap((t) => {
    const c = keyedChanges(servicesOf(t.a_services), servicesOf(t.b_services), (a, b) =>
      TRAINER_FIELDS.every((f) => a[f] === b[f]),
    );
    if (c.added.length + c.removed.length + c.changed.length === 0) return [];
    return [
      {
        npcId: t.npc_id,
        name: t.name,
        title: t.title,
        complete: { from: t.a_complete, to: t.b_complete },
        added: c.added,
        removed: c.removed,
        changed: c.changed.map((x) => ({
          name: x.key,
          fields: fieldChanges(TRAINER_FIELDS, x.from, x.to),
        })),
      },
    ];
  });
}

async function dropDiff(db: Db, from: number, to: number, minCorpses: number) {
  const ctes = sql`
    ${ratesCtes(null, sql`build in (${from}, ${to})`)},
    ca as (select npc_id, corpses from c where build = ${from}),
    cb as (select npc_id, corpses from c where build = ${to}),
    both_npcs as (
      select npc_id, ca.corpses as a_corpses, cb.corpses as b_corpses
      from ca join cb using (npc_id)
    )`;
  const [changes, below] = await Promise.all([
    rows<{
      npc_id: number;
      item_id: number;
      name: string | null;
      quality: number | null;
      a_corpses: number;
      a_dropped: number;
      a_rate: number;
      b_corpses: number;
      b_dropped: number;
      b_rate: number;
    }>(
      db,
      sql`
      with ${ctes},
      pairs as (
        select distinct d.npc_id, d.item_id from d
        join both_npcs n using (npc_id)
        where d.build in (${from}, ${to}) and n.a_corpses >= ${minCorpses} and n.b_corpses >= ${minCorpses}
      ), r as (
        select p.npc_id, p.item_id, n.a_corpses, n.b_corpses,
               coalesce(da.dropped, 0) as a_dropped, coalesce(db.dropped, 0) as b_dropped,
               round(coalesce(da.dropped, 0)::numeric / n.a_corpses, 4)::float8 as a_rate,
               round(coalesce(db.dropped, 0)::numeric / n.b_corpses, 4)::float8 as b_rate
        from pairs p
        join both_npcs n using (npc_id)
        left join d da on da.build = ${from} and da.npc_id = p.npc_id and da.item_id = p.item_id
        left join d db on db.build = ${to} and db.npc_id = p.npc_id and db.item_id = p.item_id
      )
      select r.*, i.name, i.quality from r left join items i using (item_id)
      where r.a_rate <> r.b_rate
      order by r.npc_id, r.item_id`,
    ),
    rows<{ n: number }>(
      db,
      sql`with ${ctes}
          select count(*)::int as n from both_npcs
          where a_corpses < ${minCorpses} or b_corpses < ${minCorpses}`,
    ),
  ]);
  return {
    changes: changes.map((r) => ({
      npcId: r.npc_id,
      npcName: null as string | null,
      itemId: r.item_id,
      name: r.name,
      quality: r.quality,
      from: { corpses: r.a_corpses, dropped: r.a_dropped, rate: r.a_rate },
      to: { corpses: r.b_corpses, dropped: r.b_dropped, rate: r.b_rate },
    })),
    belowThreshold: below[0]?.n ?? 0,
  };
}

const lootedNpcs = (build: number) => sql`
  select distinct npc_id as id, null::text as name from corpses where session <> '' and build = ${build}`;

export function registerAdminBuildsRoutes(app: FastifyInstance, db: Db, preHandler: ReadGuard) {
  /**
   * Client builds, newest first: version, interface, first/last seen (Chicago), uploads made by that client build,
   * characters seen in its records, and how many items, quests, recipes, vendors, trainers, looted npcs and API
   * samples were observed in it.
   */
  app.get('/admin/api/builds', { preHandler }, async () => {
    const rs = await rows<
      BuildRow & {
        uploads: number;
        characters: number;
        items: number;
        quests: number;
        recipes: number;
        vendors: number;
        trainers: number;
        npcs_looted: number;
        api_samples: number;
      }
    >(
      db,
      sql`
      with per as (
        select build, count(*)::int as n, 'items' as k from item_snapshots group by build
        union all select build, count(distinct quest_id)::int, 'quests' from quest_observations group by build
        union all select build, count(*)::int, 'recipes' from recipe_snapshots group by build
        union all select build, count(*)::int, 'vendors' from vendors group by build
        union all select build, count(*)::int, 'trainers' from trainers group by build
        union all select build, count(distinct npc_id)::int, 'npcs' from corpses where session <> '' group by build
        union all select build, count(*)::int, 'samples' from api_samples group by build
        union all select client_build, count(*)::int, 'uploads' from raw_uploads group by client_build
        union all select build, count(distinct char)::int, 'chars' from (
          select build, char from quest_observations
          union all select build, char from turn_ins
          union all select build, char from runs
          union all select build, char from recipe_status
          union all select build, char from recipes_learned
          union all select build, char from skill_ups
        ) c group by build
      )
      select b.build, b.version, b.interface, b.first_seen, b.last_seen,
             coalesce(sum(p.n) filter (where p.k = 'uploads'), 0)::int as uploads,
             coalesce(sum(p.n) filter (where p.k = 'chars'), 0)::int as characters,
             coalesce(sum(p.n) filter (where p.k = 'items'), 0)::int as items,
             coalesce(sum(p.n) filter (where p.k = 'quests'), 0)::int as quests,
             coalesce(sum(p.n) filter (where p.k = 'recipes'), 0)::int as recipes,
             coalesce(sum(p.n) filter (where p.k = 'vendors'), 0)::int as vendors,
             coalesce(sum(p.n) filter (where p.k = 'trainers'), 0)::int as trainers,
             coalesce(sum(p.n) filter (where p.k = 'npcs'), 0)::int as npcs_looted,
             coalesce(sum(p.n) filter (where p.k = 'samples'), 0)::int as api_samples
      from builds b left join per p on p.build = b.build
      group by b.build
      order by b.build desc`,
    );
    return rs.map((b) => ({
      ...buildInfo(b),
      uploads: b.uploads,
      characters: b.characters,
      counts: {
        items: b.items,
        quests: b.quests,
        recipes: b.recipes,
        vendors: b.vendors,
        trainers: b.trainers,
        npcsLooted: b.npcs_looted,
        apiSamples: b.api_samples,
      },
    }));
  });

  /**
   * What changed from build `?from=` to build `?to=` for entities observed in both: items (fields, stats, tooltip
   * lines), quests (XP and money offered, reward options), recipes (reagents, output, max trivial), vendors (items,
   * prices), trainers (services, cost and requirements) and drop rates (npcs looted ≥ `?minCorpses=` times in both,
   * default 5). Each list is capped at `?limit=` (≤ 500) with its total; entities only one build saw are counted with
   * a sample of 50. Defaults: the two newest builds; a missing `to` is the newest other build, a missing `from` the
   * newest build older than `to` (else the newest other one).
   */
  app.get('/admin/api/build-diff', { preHandler }, async (req) => {
    const q = req.query;
    const fromParam = strictInt(q, 'from', 1, INT4_MAX);
    const toParam = strictInt(q, 'to', 1, INT4_MAX);
    const limit = strictInt(q, 'limit', 1, BUILD_DIFF_LIMIT, true) ?? BUILD_DIFF_LIMIT;
    const minCorpses = strictInt(q, 'minCorpses', 1, MIN_CORPSES_MAX) ?? MIN_CORPSES_DEFAULT;
    if (fromParam !== null && fromParam === toParam)
      throw badRequest('?from= and ?to= must be different builds');

    const known = await rows<BuildRow>(
      db,
      sql`select build, version, interface, first_seen, last_seen from builds order by build desc`,
    );
    const find = (b: number | null) => (b === null ? undefined : known.find((k) => k.build === b));
    for (const b of [fromParam, toParam])
      if (b !== null && !find(b)) throw notFound(`build ${b} not seen`);
    const to = find(toParam) ?? known.find((k) => k.build !== fromParam) ?? null;
    const from =
      find(fromParam) ??
      (to && (known.find((k) => k.build < to.build) ?? known.find((k) => k.build !== to.build))) ??
      null;
    if (!from || !to) throw notFound('need two builds to compare');
    const [a, b] = [from.build, to.build];

    const [items, itemsOnly, quests, questsOnly, recipes, recipesOnly] = await Promise.all([
      itemDiff(db, a, b),
      bothWays(db, itemEntities, a, b),
      questDiff(db, a, b),
      bothWays(db, questEntities, a, b),
      recipeDiff(db, a, b),
      bothWays(db, recipeEntities, a, b),
    ]);
    const [vendors, vendorsOnly, trainers, trainersOnly, drops, dropsOnly] = await Promise.all([
      vendorDiff(db, a, b),
      bothWays(db, npcEntities('vendors'), a, b),
      trainerDiff(db, a, b),
      bothWays(db, npcEntities('trainers'), a, b),
      dropDiff(db, a, b, minCorpses),
      bothWays(db, lootedNpcs, a, b),
    ]);

    // Mobs are named from quest givers, vendors and trainers when one of those recorded the npc.
    const dropsCapped = capped(drops.changes, limit);
    const names = await npcNames(db, [
      ...new Set([
        ...dropsCapped.changes.map((c) => c.npcId),
        ...dropsOnly.onlyInFrom.sample.map((x) => x.id),
        ...dropsOnly.onlyInTo.sample.map((x) => x.id),
      ]),
    ]);
    const named = (xs: { id: number; name: string | null }[]) =>
      xs.map((x) => ({ id: x.id, name: names.get(x.id) ?? null }));

    return {
      from: buildInfo(from),
      to: buildInfo(to),
      limit,
      sampleLimit: ONLY_IN_SAMPLE,
      minCorpses,
      items: { ...capped(items, limit), ...itemsOnly },
      quests: { ...capped(quests, limit), ...questsOnly },
      recipes: { ...capped(recipes, limit), ...recipesOnly },
      vendors: { ...capped(vendors, limit), ...vendorsOnly },
      trainers: { ...capped(trainers, limit), ...trainersOnly },
      drops: {
        total: dropsCapped.total,
        changes: dropsCapped.changes.map((c) => ({ ...c, npcName: names.get(c.npcId) ?? null })),
        belowThreshold: drops.belowThreshold,
        onlyInFrom: { ...dropsOnly.onlyInFrom, sample: named(dropsOnly.onlyInFrom.sample) },
        onlyInTo: { ...dropsOnly.onlyInTo, sample: named(dropsOnly.onlyInTo.sample) },
      },
    };
  });
}
