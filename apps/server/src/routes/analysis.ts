import { RULES_VERSION, specsWanting } from '@forever-ledger/contracts';
import { sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyBearer } from '../auth.js';
import type { Db } from '../db/client.js';
import { chicagoIso } from '../time.js';

/** Read routes need any valid token: the data includes contributors' character names. */
export function requireToken(db: Db) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if ((await verifyBearer(db, req.headers.authorization)) === null) {
      return reply.status(401).send({ error: 'invalid or revoked token' });
    }
  };
}

/** `?<key>=` as a positive integer, else null. */
const positiveInt = (q: unknown, key: string) => {
  const raw = (q as Record<string, string | undefined>)[key];
  const n = Number(raw);
  return raw !== undefined && Number.isInteger(n) && n > 0 ? n : null;
};

/** `?build=` as a positive integer, else null (no filter). */
export const buildFilter = (q: unknown) => positiveInt(q, 'build');

async function rows<T>(db: Db, query: ReturnType<typeof sql>) {
  const res = await db.execute(query);
  return res.rows as T[];
}

/** A JS number list as one `int[]` parameter (usable with `= any(...)`, empty included). */
const intArray = (xs: number[]) => sql`${sql.param(xs)}::int[]`;

export function registerAnalysisRoutes(app: FastifyInstance, db: Db) {
  const preHandler = requireToken(db);
  registerProfessionRoutes(app, db, preHandler);

  /** Offered vs paid XP per quest and build. */
  app.get('/v1/quests/xp', { preHandler }, async (req) => {
    const build = buildFilter(req.query);
    return rows(
      db,
      sql`
      with offered as (
        select quest_id, build, max(xp)::int as xp_offered, max(money)::int as money_offered
        from quest_observations where stage in ('detail', 'complete', 'log')
        group by quest_id, build
      ), paid as (
        select quest_id, build, count(*)::int as turn_ins, round(avg(xp))::int as avg_xp_paid,
               min(level)::int as min_level, max(level)::int as max_level
        from turn_ins group by quest_id, build
      )
      select coalesce(o.quest_id, p.quest_id) as "questId", coalesce(o.build, p.build) as build,
             q.title, q.level, q.category, q.suggested_group as "suggestedGroup",
             o.xp_offered as "xpOffered", o.money_offered as "moneyOffered",
             coalesce(p.turn_ins, 0) as "turnIns", p.avg_xp_paid as "avgXpPaid",
             p.min_level as "minLevel", p.max_level as "maxLevel"
      from offered o
      full join paid p on p.quest_id = o.quest_id and p.build = o.build
      left join quests q on q.quest_id = coalesce(o.quest_id, p.quest_id)
      where ${build}::int is null or coalesce(o.build, p.build) = ${build}::int
      order by build desc, "questId"`,
    );
  });

  /** Clear times, XP per minute and boss splits per dungeon and build. */
  app.get('/v1/runs/summary', { preHandler }, async (req) => {
    const build = buildFilter(req.query);
    const summary = await rows<Record<string, unknown> & { instanceId: number; build: number }>(
      db,
      sql`
      select instance_id as "instanceId", max(instance) as instance, build,
             count(*)::int as runs,
             count(finished_at)::int as "finishedRuns",
             percentile_cont(0.5) within group (order by active_secs)::float8 as "medianActiveSecs",
             min(active_secs)::int as "bestActiveSecs",
             round(avg(deaths)::numeric, 2)::float8 as "avgDeaths",
             round(avg(char_level)::numeric, 1)::float8 as "avgCharLevel",
             round((sum(xp_total)::numeric / nullif(sum(active_secs), 0)) * 60, 1)::float8 as "xpPerMinute",
             round((sum(xp_total - quest_xp)::numeric / nullif(sum(active_secs), 0)) * 60, 1)::float8
               as "mobXpPerMinute",
             round((sum(quest_xp)::numeric / nullif(sum(active_secs), 0)) * 60, 1)::float8 as "questXpPerMinute"
      from runs
      where finished_at is not null and active_secs > 0
        and (${build}::int is null or build = ${build}::int)
      group by instance_id, build
      order by build desc, "xpPerMinute" desc nulls last`,
    );
    const bosses = await rows<{
      instanceId: number;
      build: number;
      name: string;
      kills: number;
      medianAtSecs: number;
      firstOrd: number;
    }>(
      db,
      sql`
      select r.instance_id as "instanceId", r.build, b.name,
             count(*) filter (where b.killed)::int as kills,
             percentile_cont(0.5) within group (order by b.at_secs)::float8 as "medianAtSecs",
             min(b.ord)::int as "firstOrd"
      from run_bosses b join runs r on r.id = b.run_id
      where r.finished_at is not null and (${build}::int is null or r.build = ${build}::int)
      group by r.instance_id, r.build, b.name
      order by "medianAtSecs"`,
    );
    return summary.map((s) => ({
      ...s,
      bosses: bosses
        .filter((b) => b.instanceId === s.instanceId && b.build === s.build)
        .map(({ name, kills, medianAtSecs }) => ({ name, kills, medianAtSecs })),
    }));
  });

  /**
   * Drop rates per build, npc and item from schema 3 sessions: corpses looted, sources that dropped the item,
   * rate = dropped / corpses, stack quantity and average copper per corpse. Summed over sessions, uploaders and
   * accounts; only drops from sessions that recorded corpses count, so npcs without corpse data are left out. The
   * legacy '' session (running totals from before schema 3) never counts. Known skew: a rate is per corpse *looted*
   * (empty corpses aren't counted), and pick-pocketing or skinning a mob attributes those items to it.
   */
  app.get('/v1/drops/rates', { preHandler }, async (req) => {
    const build = buildFilter(req.query);
    return rows(
      db,
      sql`
      with c as (
        select build, npc_id, sum(count)::int as corpses, sum(copper)::bigint as copper
        from corpses
        where session <> '' and (${build}::int is null or build = ${build}::int)
        group by build, npc_id
      ), d as (
        select d.build, d.npc_id, d.item_id, sum(d.count)::int as dropped, sum(d.quantity)::int as quantity
        from drops d
        join corpses k on k.npc_id = d.npc_id and k.build = d.build and k.uploader_id = d.uploader_id
          and k.account = d.account and k.session = d.session and k.session <> ''
        where ${build}::int is null or d.build = ${build}::int
        group by d.build, d.npc_id, d.item_id
      )
      select d.build, d.npc_id as "npcId", d.item_id as "itemId", i.name as "itemName",
             c.corpses, d.dropped,
             round(d.dropped::numeric / nullif(c.corpses, 0), 4)::float8 as rate,
             d.quantity,
             round(c.copper::numeric / nullif(c.corpses, 0), 1)::float8 as "avgCopper"
      from d
      join c on c.build = d.build and c.npc_id = d.npc_id
      left join items i on i.item_id = d.item_id
      order by d.build desc, "npcId", rate desc nulls last, "itemId"`,
    );
  });

  /** One item across builds: snapshots, drop and node-loot sources, quest rewards and which specs want it. */
  app.get<{ Params: { id: string } }>('/v1/items/:id', { preHandler }, async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return reply.status(400).send({ error: 'bad item id' });
    const [item] = await rows<Record<string, unknown>>(
      db,
      sql`select item_id as "itemId", name, quality, type, subtype, equip_loc as "equipLoc"
          from items where item_id = ${id}`,
    );
    if (!item) return reply.status(404).send({ error: 'item not seen yet' });
    const snapshots = await rows<{
      build: number;
      reqLevel: number | null;
      stats: Record<string, number>;
    }>(
      db,
      sql`select build, link, ilvl, req_level as "reqLevel", sell_price as "sellPrice", stats, tooltip
          from item_snapshots where item_id = ${id} order by build desc`,
    );
    const dropSources = await rows(
      db,
      sql`select build, npc_id as "npcId", sum(count)::int as count, count(*)::int as contributors
          from drops where item_id = ${id} group by build, npc_id order by build desc, count desc`,
    );
    const questRewards = await rows(
      db,
      sql`select o.quest_id as "questId", q.title, o.build, o.kind, o.count
          from quest_reward_options o left join quests q on q.quest_id = o.quest_id
          where o.item_id = ${id} order by o.build desc, o.quest_id`,
    );
    // Game objects (veins, herbs, chests, fishing = object 0) whose loot held it, summed over sessions.
    const nodeSources = await rows(
      db,
      sql`
      with l as (
        select build, object_id, sum(count)::int as count, sum(quantity)::int as quantity
        from node_loot where item_id = ${id} group by build, object_id
      ), n as (
        select build, object_id, mode() within group (order by name) as name, sum(opened)::int as opens
        from nodes where (build, object_id) in (select build, object_id from l)
        group by build, object_id
      )
      select l.build, l.object_id as "objectId", n.name, n.opens, l.count, l.quantity
      from l left join n using (build, object_id)
      order by l.build desc, l.count desc, l.object_id`,
    );
    const latest = snapshots[0];
    const level = latest?.reqLevel ?? 20;
    return {
      ...item,
      snapshots,
      dropSources,
      nodeSources,
      questRewards,
      specs: {
        rulesVersion: RULES_VERSION,
        atLevel: level,
        fits: specsWanting(
          {
            type: item.type as string | undefined,
            subtype: item.subtype as string | undefined,
            equipLoc: item.equipLoc as string | undefined,
            stats: latest?.stats,
          },
          level,
        ),
      },
    };
  });
}

/** Epoch seconds (selected as `extract(epoch from col)`) → America/Chicago ISO. */
const iso = (secs: unknown) => (secs === null ? null : chicagoIso(Number(secs) * 1000));

/** Schema 4 profession routes: recipes, where recipes and items come from, gathering nodes. */
function registerProfessionRoutes(
  app: FastifyInstance,
  db: Db,
  preHandler: ReturnType<typeof requireToken>,
) {
  /**
   * Recipes (optionally of one skill line / build) with, per build, the schematic (output item, quantity range,
   * reagents with item names) and the observed difficulty thresholds: per difficulty the lowest and highest skill rank
   * any character saw it at. `learnedBy` counts characters that know it; `learnedVia` counts learn events by source.
   */
  app.get('/v1/professions/recipes', { preHandler }, async (req) => {
    const skillLine = positiveInt(req.query, 'skillLine');
    const build = buildFilter(req.query);
    const inScope = sql`(select recipe_id from recipes
      where ${skillLine}::int is null or skill_line_id = ${skillLine}::int)`;
    const inBuild = sql`(${build}::int is null or build = ${build}::int)`;

    const recipes = await rows<{ recipeId: number }>(
      db,
      sql`
      select recipe_id as "recipeId", name, skill_line_id as "skillLineId", category_id as "categoryId"
      from recipes
      where recipe_id in ${inScope}
        and (${build}::int is null
             or recipe_id in (select recipe_id from recipe_snapshots where build = ${build}::int)
             or recipe_id in (select recipe_id from recipe_status where build = ${build}::int))
      order by skill_line_id nulls last, name, recipe_id`,
    );
    const snapshots = await rows<{ recipeId: number; build: number }>(
      db,
      sql`
      select s.recipe_id as "recipeId", s.build,
             s.output_item_id as "outputItemId", o.name as "outputItemName",
             s.qty_min as "qtyMin", s.qty_max as "qtyMax",
             coalesce((
               select jsonb_agg(jsonb_build_object(
                        'itemId', (e.reagent->>'itemId')::int, 'name', i.name, 'qty', (e.reagent->>'qty')::int)
                      order by e.ord)
               from jsonb_array_elements(s.reagents) with ordinality as e(reagent, ord)
               left join items i on i.item_id = (e.reagent->>'itemId')::int
             ), '[]'::jsonb) as reagents,
             s.max_trivial as "maxTrivial", s.source_text as "sourceText"
      from recipe_snapshots s
      left join items o on o.item_id = s.output_item_id
      where s.recipe_id in ${inScope} and ${inBuild}
      order by s.build desc`,
    );
    const thresholds = await rows<{ recipeId: number; build: number }>(
      db,
      sql`
      select recipe_id as "recipeId", build, difficulty,
             min(min_rank)::int as "minRank", max(max_rank)::int as "maxRank",
             count(distinct char)::int as chars
      from recipe_difficulty
      where recipe_id in ${inScope} and ${inBuild}
      group by recipe_id, build, difficulty
      order by "minRank", difficulty`,
    );
    const learnedBy = await rows<{ recipeId: number; chars: number }>(
      db,
      sql`
      select recipe_id as "recipeId", count(distinct char)::int as chars
      from (
        select recipe_id, char, build from recipe_status where learned
        union
        select recipe_id, char, build from recipes_learned
      ) known
      where recipe_id in ${inScope} and ${inBuild}
      group by recipe_id`,
    );
    const via = await rows<{ recipeId: number; via: string; count: number }>(
      db,
      sql`
      select recipe_id as "recipeId", via, count(*)::int as count
      from recipes_learned
      where recipe_id in ${inScope} and ${inBuild}
      group by recipe_id, via
      order by count desc, via`,
    );

    return recipes.map((r) => {
      const builds = new Map<number, Record<string, unknown>>();
      for (const { recipeId: _r, ...s } of snapshots.filter((x) => x.recipeId === r.recipeId))
        builds.set(s.build, { ...s, difficulty: [] });
      for (const { recipeId: _r, build: b, ...t } of thresholds.filter(
        (x) => x.recipeId === r.recipeId,
      )) {
        if (!builds.has(b)) builds.set(b, { build: b, reagents: [], difficulty: [] });
        (builds.get(b)!.difficulty as unknown[]).push(t);
      }
      return {
        ...r,
        learnedBy: learnedBy.find((x) => x.recipeId === r.recipeId)?.chars ?? 0,
        learnedVia: via
          .filter((x) => x.recipeId === r.recipeId)
          .map(({ via: v, count }) => ({ via: v, count })),
        builds: [...builds.values()].sort((a, b) => (b.build as number) - (a.build as number)),
      };
    });
  });

  /**
   * Where a recipe (`?recipeId=`) or an item (`?itemId=`) comes from. An item stands for the recipes that create it or
   * that it teaches (learned from it, or a Recipe-class item named "<Pattern|Plans|…>: <recipe name>"). Trainers:
   * services named like the recipe or creating its output item. Vendors: listings of the recipe items (items the recipe
   * was learned from, or Recipe-class items named "<Prefix>: <recipe name>"), or of the item itself. Drops: those items
   * when they are Recipe-class (items.class_id = 9), from creatures (npcId) or game objects such as chests (objectId).
   */
  app.get('/v1/professions/sources', { preHandler }, async (req, reply) => {
    const itemId = positiveInt(req.query, 'itemId');
    const recipeId = positiveInt(req.query, 'recipeId');
    if ((itemId === null) === (recipeId === null))
      return reply.status(400).send({ error: 'pass exactly one of ?itemId= or ?recipeId=' });

    const recipes = await rows<{ recipeId: number; name: string }>(
      db,
      sql`
      select recipe_id as "recipeId", name from recipes
      where recipe_id = ${recipeId}::int
         or recipe_id in (select recipe_id from recipe_snapshots where output_item_id = ${itemId}::int)
         or recipe_id in (select recipe_id from recipes_learned where via = 'item:' || ${itemId}::int)
         or name = (select substring(i.name from position(': ' in i.name) + 2) from items i
                    where i.item_id = ${itemId}::int and i.class_id = 9 and position(': ' in i.name) > 0)
      order by recipe_id`,
    );
    if (recipeId !== null && recipes.length === 0)
      return reply.status(404).send({ error: 'recipe not seen yet' });
    const ids = recipes.map((r) => r.recipeId);
    const names = recipes.map((r) => r.name);
    const self = itemId === null ? [] : [itemId];

    const outputs = (
      await rows<{ itemId: number }>(
        db,
        sql`select distinct output_item_id as "itemId" from recipe_snapshots
            where recipe_id = any(${intArray(ids)}) and output_item_id is not null`,
      )
    ).map((o) => o.itemId);
    const recipeItems = await rows<{ itemId: number; name: string | null }>(
      db,
      sql`
      with taught as (
        select substring(via from 6)::int as item_id from recipes_learned
        where recipe_id = any(${intArray(ids)}) and via ~ '^item:[0-9]+$'
        union
        select item_id from items
        where class_id = 9 and exists (
          select 1 from unnest(${sql.param(names)}::text[]) as n(name)
          where right(items.name, length(n.name) + 2) = ': ' || n.name)
      )
      select t.item_id as "itemId", i.name from taught t left join items i using (item_id)
      order by t.item_id`,
    );
    const sold = [...new Set([...recipeItems.map((i) => i.itemId), ...self])];

    const trainers = await rows<Record<string, unknown>>(
      db,
      sql`
      select t.npc_id as "npcId", t.name as "npcName", t.build, t.loc, t.skill_line_id as "skillLineId",
             extract(epoch from t.seen_at) as "seenAt",
             svc->>'name' as service, svc->>'type' as type, (svc->>'cost')::int as cost,
             svc->>'skill' as skill, (svc->>'skillRank')::int as "skillRank", (svc->>'level')::int as level,
             (svc->>'itemId')::int as "itemId"
      from trainers t
      cross join lateral jsonb_array_elements(t.services) as svc
      where svc->>'name' = any(${sql.param(names)}::text[])
         or (svc->>'itemId')::int = any(${intArray([...outputs, ...self])})
      order by t.build desc, t.npc_id, service`,
    );
    const vendors = await rows<Record<string, unknown>>(
      db,
      sql`
      select v.npc_id as "npcId", v.name as "npcName", v.build, v.loc,
             extract(epoch from v.seen_at) as "seenAt",
             (it->>'itemId')::int as "itemId", i.name as "itemName",
             (it->>'price')::int as price, (it->>'stack')::int as stack,
             (it->>'numAvailable')::int as "numAvailable", (it->>'currencyId')::int as "currencyId",
             it->'extendedCost' as "extendedCost"
      from vendors v
      cross join lateral jsonb_array_elements(v.items) as it
      left join items i on i.item_id = (it->>'itemId')::int
      where (it->>'itemId')::int = any(${intArray(sold)})
      order by v.build desc, v.npc_id, "itemId"`,
    );
    const drops = await rows(
      db,
      sql`
      select d.item_id as "itemId", i.name as "itemName", d.build, d.npc_id as "npcId", null::int as "objectId",
             sum(d.count)::int as count, sum(d.quantity)::int as quantity, count(*)::int as contributors
      from drops d
      join items i on i.item_id = d.item_id and i.class_id = 9
      where d.item_id = any(${intArray(sold)})
      group by d.item_id, i.name, d.build, d.npc_id
      union all
      select l.item_id, i.name, l.build, null::int, l.object_id,
             sum(l.count)::int, sum(l.quantity)::int, count(*)::int
      from node_loot l
      join items i on i.item_id = l.item_id and i.class_id = 9
      where l.item_id = any(${intArray(sold)})
      group by l.item_id, i.name, l.build, l.object_id
      order by build desc, count desc, "npcId" nulls last, "objectId"`,
    );

    return {
      ...(recipeId === null ? { itemId } : { recipeId }),
      recipes,
      recipeItems,
      trainers: trainers.map((t) => ({ ...t, seenAt: iso(t.seenAt) })),
      vendors: vendors.map((v) => ({ ...v, seenAt: iso(v.seenAt) })),
      drops,
    };
  });

  /**
   * Gathering per build and game object (object 0 = fishing): the name most sessions gave it, opens summed over
   * sessions, uploaders and accounts, the lowest skill rank seen, the maps it was gathered on (distinct spots) and the top 10 loot items with count and
   * stack quantity per open.
   */
  app.get('/v1/professions/gathering', { preHandler }, async (req) => {
    const build = buildFilter(req.query);
    const inBuild = sql`(${build}::int is null or build = ${build}::int)`;

    const nodes = await rows<{ build: number; objectId: number }>(
      db,
      sql`
      select build, object_id as "objectId", mode() within group (order by name) as name,
             max(skill_line_id) as "skillLineId",
             sum(opened)::int as opens, min(rank_min)::int as "rankMin"
      from nodes
      where ${inBuild}
      group by build, object_id
      order by build desc, opens desc, "objectId"`,
    );
    const zones = await rows<{ build: number; objectId: number; mapId: number; spots: number }>(
      db,
      sql`
      select n.build, n.object_id as "objectId", (spot->>'mapId')::int as "mapId",
             count(distinct point)::int as spots
      from nodes n
      cross join lateral jsonb_array_elements(n.spots) as spot
      left join lateral jsonb_array_elements(spot->'points') as point on true
      where ${inBuild}
      group by n.build, n.object_id, "mapId"
      order by spots desc, "mapId"`,
    );
    const loot = await rows<{ build: number; objectId: number }>(
      db,
      sql`
      with opens as (
        select build, object_id, sum(opened) as opens from nodes where ${inBuild} group by build, object_id
      ), totals as (
        select build, object_id, item_id, sum(count)::int as count, sum(quantity)::int as quantity
        from node_loot where ${inBuild}
        group by build, object_id, item_id
      ), ranked as (
        select t.*, o.opens, row_number() over (
          partition by t.build, t.object_id order by t.count desc, t.quantity desc, t.item_id) as pos
        from totals t left join opens o using (build, object_id)
      )
      select r.build, r.object_id as "objectId", r.item_id as "itemId", i.name,
             r.count, r.quantity,
             round(r.count::numeric / nullif(r.opens, 0), 4)::float8 as "perOpen",
             round(r.quantity::numeric / nullif(r.opens, 0), 4)::float8 as "qtyPerOpen"
      from ranked r left join items i on i.item_id = r.item_id
      where r.pos <= 10
      order by r.pos`,
    );

    type Keyed = { build: number; objectId: number };
    const of = <T extends Keyed>(list: T[], n: Keyed) =>
      list
        .filter((x) => x.build === n.build && x.objectId === n.objectId)
        .map(({ build: _b, objectId: _o, ...rest }) => rest);
    return nodes.map((n) => ({ ...n, zones: of(zones, n), loot: of(loot, n) }));
  });
}
