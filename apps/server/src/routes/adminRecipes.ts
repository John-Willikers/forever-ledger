// Recipe details for the admin panel (/admin/api/professions/recipes/:recipeId): what a recipe makes (the output item
// with its cleaned tooltip), what it takes to learn and use it, and where it comes from; plus the batch lookups the
// vendor, trainer and item routes use to link to it. Every jsonb read goes through sqlJson; tooltips are cleaned and
// parsed as text (see recipeRequirements.ts).
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client.js';
import type { ReadGuard } from './analysis.js';
import { buildFilter, skillBase } from './analysis.js';
import { rows } from './adminData.js';
import {
  cleanTooltip,
  cleanTooltipLine,
  learnRequirements,
  useLevel,
} from './recipeRequirements.js';
import type { RecipeItemInfo, TrainerOffer } from './recipeRequirements.js';
import { idParam } from './shared.js';
import { jarr, jint, jlen, jnum, jtext, viaItemId } from './sqlJson.js';

const intArray = (xs: number[]) => sql`${sql.param(xs)}::int[]`;

/** A stored stats object (jsonb, untrusted) with only its finite number values. */
function numericStats(stats: unknown): Record<string, number> {
  if (typeof stats !== 'object' || stats === null || Array.isArray(stats)) return {};
  return Object.fromEntries(
    Object.entries(stats).filter(
      (e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1]),
    ),
  );
}

/**
 * `recipe_ids(recipe_id, name, base_id, base_name)`: the recipes of `ids` with their base profession (child lines
 * folded). Needs `skillBase` before it in the `with`.
 */
const recipeIdsCte = (ids: number[]) => sql`recipe_ids as (
  select r.recipe_id, r.name, coalesce(b.base_id, r.skill_line_id) as base_id, b.base_name
  from recipes r left join skill_base b on b.id = r.skill_line_id
  where r.recipe_id = any(${intArray(ids)})
)`;

/**
 * `taught(recipe_id, item_id, pref)`: the items that teach the recipes of `ids` — learned from (`recipes_learned.via` =
 * `item:<id>`, pref 0) or a Recipe-class item named "<Prefix>: <recipe name>" (pref 1).
 */
const taughtCte = (ids: number[]) => sql`taught as (
  select recipe_id, item_id, min(pref) as pref from (
    select recipe_id, ${viaItemId(sql`via`)} as item_id, 0 as pref from recipes_learned
    where recipe_id = any(${intArray(ids)}) and ${viaItemId(sql`via`)} is not null
    union all
    select r.recipe_id, i.item_id, 1 from recipes r
    join items i on i.class_id = 9 and right(i.name, length(r.name) + 2) = ': ' || r.name
    where r.recipe_id = any(${intArray(ids)})
  ) t group by recipe_id, item_id
)`;

interface TrainerRow extends TrainerOffer {
  recipeId: number;
  npcTitle: string | null;
  build: number;
  skillLineId: number | null;
  skillLineName: string | null;
  cost: number | null;
  skill: string | null;
}

interface RecipeItemRow extends RecipeItemInfo {
  recipeId: number;
  quality: number | null;
  build: number | null;
}

/** The skill line id of the recipe's base profession and its name. */
interface Profession {
  skillLineId: number;
  name: string | null;
}

/**
 * Per recipe of `ids`: its base profession, the trainer services of the same name (trainers of another profession
 * left out; preferred: `build`, then newer builds, then lower npc ids) and its recipe items with their snapshot of
 * `build`, else the newest (learned-from items first).
 */
async function learnSources(db: Db, ids: number[], build: number | null) {
  const [recipes, trainers, items] = await Promise.all([
    rows<{ recipeId: number; baseId: number | null; baseName: string | null }>(
      db,
      sql`with ${skillBase}, ${recipeIdsCte(ids)}
          select recipe_id as "recipeId", base_id as "baseId", base_name as "baseName" from recipe_ids`,
    ),
    rows<TrainerRow>(
      db,
      sql`with ${skillBase}, ${recipeIdsCte(ids)}
          select r.recipe_id as "recipeId", t.npc_id as "npcId", t.name as "npcName", t.title as "npcTitle",
                 t.build, coalesce(tb.base_id, t.skill_line_id) as "skillLineId", tb.base_name as "skillLineName",
                 ${jnum(sql`svc->'cost'`)} as cost, ${jtext(sql`svc`, 'skill')} as skill,
                 ${jnum(sql`svc->'skillRank'`)} as "skillRank", ${jnum(sql`svc->'level'`)} as level
          from recipe_ids r
          join trainers t on true
          cross join lateral jsonb_array_elements(${jarr(sql`t.services`)}) with ordinality as e(svc, ord)
          left join skill_base tb on tb.id = t.skill_line_id
          where ${jtext(sql`svc`, 'name')} = r.name
            and (r.base_id is null or coalesce(tb.base_id, t.skill_line_id) is null
                 or coalesce(tb.base_id, t.skill_line_id) = r.base_id)
          order by r.recipe_id, coalesce(t.build = ${build}::int, false) desc, t.build desc, t.npc_id, e.ord`,
    ),
    rows<RecipeItemRow>(
      db,
      sql`with ${taughtCte(ids)}
          select t.recipe_id as "recipeId", t.item_id as "itemId", i.name as "itemName", i.quality,
                 x.build, x.req_level as "reqLevel", x.tooltip
          from taught t
          left join items i on i.item_id = t.item_id
          left join lateral (
            select build, req_level, tooltip from item_snapshots s where s.item_id = t.item_id
            order by coalesce(s.build = ${build}::int, false) desc, s.build desc limit 1
          ) x on true
          order by t.recipe_id, t.pref, t.item_id`,
    ),
  ]);
  const out = new Map<
    number,
    { profession: Profession | null; trainers: TrainerRow[]; recipeItems: RecipeItemRow[] }
  >();
  for (const r of recipes)
    out.set(r.recipeId, {
      profession: r.baseId === null ? null : { skillLineId: r.baseId, name: r.baseName },
      trainers: trainers.filter((t) => t.recipeId === r.recipeId),
      recipeItems: items.filter((i) => i.recipeId === r.recipeId),
    });
  return out;
}

/** Per recipe of `ids`: its base profession and the skill rank to learn it (see `learnRequirements`), or null. */
export async function learnRanks(db: Db, ids: number[]) {
  if (ids.length === 0)
    return new Map<number, { profession: Profession | null; skillRank: number | null }>();
  const sources = await learnSources(db, [...new Set(ids)], null);
  return new Map(
    [...sources].map(([id, s]) => {
      const { skillRank } = learnRequirements({
        profession: s.profession?.name ?? null,
        trainers: s.trainers,
        recipeItems: s.recipeItems,
      });
      return [id, { profession: s.profession, skillRank: skillRank?.rank ?? null }];
    }),
  );
}

/**
 * The recipe each item of `itemIds` teaches: one learned from it, else a recipe named like the Recipe-class item
 * ("Plans: Rough Weightstone" → "Rough Weightstone"); the lowest recipe id on a tie. Items teaching nothing are absent.
 */
export async function recipesTaughtBy(db: Db, itemIds: number[]) {
  const ids = [...new Set(itemIds)];
  if (ids.length === 0) return new Map<number, { recipeId: number; name: string }>();
  const found = await rows<{ itemId: number; recipeId: number; name: string }>(
    db,
    sql`select distinct on (item_id) item_id as "itemId", recipe_id as "recipeId", name from (
          select ${viaItemId(sql`l.via`)} as item_id, r.recipe_id, r.name, 0 as pref
          from recipes_learned l join recipes r using (recipe_id)
          where ${viaItemId(sql`l.via`)} = any(${intArray(ids)})
          union all
          select i.item_id, r.recipe_id, r.name, 1 from items i
          join recipes r on right(i.name, length(r.name) + 2) = ': ' || r.name
          where i.class_id = 9 and i.item_id = any(${intArray(ids)})
        ) t
        order by item_id, pref, recipe_id`,
  );
  return new Map(found.map((f) => [f.itemId, { recipeId: f.recipeId, name: f.name }]));
}

/** SQL: the costs of vendor listing `it` (jsonb) named from `items` when known, null when none. */
const costsOf = (it: SQL) => sql`case when ${jlen(sql`${it}->'costs'`)} > 0 then (
  select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'amount', ${jnum(sql`c->'amount'`)},
           'itemId', ${jint(sql`c->'itemId'`)},
           'currencyId', ${jint(sql`c->'currencyId'`)},
           'name', coalesce(ci.name, ${jtext(sql`c`, 'name')})))
         order by o)
  from jsonb_array_elements(${it}->'costs') with ordinality as k(c, o)
  left join items ci on ci.item_id = ${jint(sql`c->'itemId'`)}
) end`;

export function registerAdminRecipesRoutes(app: FastifyInstance, db: Db, preHandler: ReadGuard) {
  /**
   * One recipe (`?build=` for a build's schematic, else the newest build it was seen in): its base profession, what it
   * makes (output item facts, its snapshot of that build or the newest one, stats and cleaned tooltip lines — the
   * item's description), reagents, the requirements — skill rank to learn it (trainer service first, else the recipe
   * item's "Requires <Profession> (N)"), character level (the recipe item's own "Requires Level N", else its req_level,
   * else a trainer's level), the level to use the output, max trivial rank and the observed difficulty bands of the
   * build — and where it comes from: trainers (same-named service, same profession), vendors selling a recipe item,
   * drops of a recipe item from creatures and objects, and learn events by source.
   */
  app.get<{ Params: { recipeId: string } }>(
    '/admin/api/professions/recipes/:recipeId',
    { preHandler },
    async (req, reply) => {
      const recipeId = idParam(req.params.recipeId, 'recipe');
      const wanted = buildFilter(req.query);
      const [recipe] = await rows<{
        name: string;
        skillLineId: number | null;
      }>(
        db,
        sql`select name, skill_line_id as "skillLineId" from recipes where recipe_id = ${recipeId}`,
      );
      if (!recipe) return reply.status(404).send({ error: 'recipe not seen yet' });

      const builds = (
        await rows<{ build: number }>(
          db,
          sql`select build from recipe_snapshots where recipe_id = ${recipeId}
              union select build from recipe_difficulty where recipe_id = ${recipeId}
              order by build desc`,
        )
      ).map((b) => b.build);
      const build = wanted === null ? (builds[0] ?? null) : builds.includes(wanted) ? wanted : null;

      const [snap] = await rows<{
        outputItemId: number | null;
        qtyMin: number | null;
        qtyMax: number | null;
        maxTrivial: number | null;
        sourceText: string | null;
      }>(
        db,
        sql`select output_item_id as "outputItemId", qty_min as "qtyMin", qty_max as "qtyMax",
                   max_trivial as "maxTrivial", source_text as "sourceText"
            from recipe_snapshots where recipe_id = ${recipeId} and build = ${build}::int`,
      );

      const outputId = snap?.outputItemId ?? null;
      const [sources, output, reagents, difficulty, known, via] = await Promise.all([
        learnSources(db, [recipeId], build).then((m) => m.get(recipeId)!),
        outputId === null
          ? Promise.resolve([])
          : rows<{
              itemId: number;
              name: string | null;
              quality: number | null;
              classId: number | null;
              subclassId: number | null;
              type: string | null;
              subtype: string | null;
              equipLoc: string | null;
              build: number | null;
              ilvl: number | null;
              reqLevel: number | null;
              sellPrice: number | null;
              stats: unknown;
              tooltip: unknown;
            }>(
              db,
              sql`select o.id as "itemId", i.name, i.quality, i.class_id as "classId",
                         i.subclass_id as "subclassId", i.type, i.subtype, i.equip_loc as "equipLoc",
                         x.build, x.ilvl, x.req_level as "reqLevel", x.sell_price as "sellPrice", x.stats,
                         x.tooltip
                  from (select ${outputId}::int as id) o
                  left join items i on i.item_id = o.id
                  left join lateral (
                    select * from item_snapshots s where s.item_id = o.id
                    order by coalesce(s.build = ${build}::int, false) desc, s.build desc limit 1
                  ) x on true`,
            ),
        rows<{ itemId: number; name: string | null; quality: number | null; qty: number }>(
          db,
          sql`select r.item_id as "itemId", i.name, i.quality, r.qty
              from recipe_snapshots s
              cross join lateral jsonb_array_elements(${jarr(sql`s.reagents`)}) with ordinality as e(g, ord)
              cross join lateral (select ${jint(sql`g->'itemId'`)} as item_id, ${jnum(sql`g->'qty'`)} as qty) r
              left join items i on i.item_id = r.item_id
              where s.recipe_id = ${recipeId} and s.build = ${build}::int
                and r.item_id is not null and r.qty is not null
              order by e.ord`,
        ),
        rows<{ difficulty: string; minRank: number; maxRank: number; chars: number }>(
          db,
          sql`select difficulty, min(min_rank)::int as "minRank", max(max_rank)::int as "maxRank",
                     count(distinct char)::int as chars
              from recipe_difficulty where recipe_id = ${recipeId} and build = ${build}::int
              group by difficulty order by "minRank", difficulty`,
        ),
        rows<{ n: number }>(
          db,
          sql`select count(distinct char)::int as n from (
                select char from recipe_status where recipe_id = ${recipeId} and learned
                union select char from recipes_learned where recipe_id = ${recipeId}
              ) k`,
        ),
        rows<{ via: string; count: number }>(
          db,
          sql`select via, count(*)::int as count from recipes_learned where recipe_id = ${recipeId}
              group by via order by count desc, via`,
        ),
      ]);

      const itemIds = sources.recipeItems.map((i) => i.itemId);
      const [vendors, drops] = await Promise.all([
        rows<Record<string, unknown>>(
          db,
          sql`select v.npc_id as "npcId", v.name as "npcName", v.title as "npcTitle", v.build,
                     l.item_id as "itemId", i.name as "itemName", i.quality,
                     ${jnum(sql`it->'price'`)} as price, ${jnum(sql`it->'stack'`)} as stack,
                     ${jnum(sql`it->'numAvailable'`)} as "numAvailable", ${costsOf(sql`it`)} as costs
              from vendors v
              cross join lateral jsonb_array_elements(${jarr(sql`v.items`)}) with ordinality as e(it, ord)
              cross join lateral (select ${jint(sql`it->'itemId'`)} as item_id) l
              left join items i on i.item_id = l.item_id
              where l.item_id = any(${intArray(itemIds)})
              order by v.build desc, v.npc_id, e.ord`,
        ),
        rows<Record<string, unknown>>(
          db,
          sql`with d as (
                select item_id, build, npc_id, null::int as object_id, sum(count)::int as count,
                       count(*)::int as contributors
                from drops where item_id = any(${intArray(itemIds)})
                group by item_id, build, npc_id
                union all
                select item_id, build, null::int, object_id, sum(count)::int, count(*)::int
                from node_loot where item_id = any(${intArray(itemIds)})
                group by item_id, build, object_id
              )
              select d.item_id as "itemId", i.name as "itemName", d.build, d.npc_id as "npcId",
                     (select mode() within group (order by n.name) from (
                        select name from vendors where npc_id = d.npc_id and name <> ''
                        union all select name from trainers where npc_id = d.npc_id and name <> ''
                        union all select npc_name from quest_observations
                        where npc_id = d.npc_id and npc_name <> '') n) as "npcName",
                     d.object_id as "objectId",
                     (select mode() within group (order by name) from nodes
                      where object_id = d.object_id and name <> '') as "objectName",
                     d.count, d.contributors
              from d join items i on i.item_id = d.item_id and i.class_id = 9
              order by d.build desc, d.count desc, d.npc_id nulls last, d.object_id`,
        ),
      ]);

      const profession = sources.profession;
      const { skillRank, charLevel } = learnRequirements({
        profession: profession?.name ?? null,
        trainers: sources.trainers,
        recipeItems: sources.recipeItems,
      });
      const o = output[0];
      return {
        recipeId,
        name: recipe.name,
        skillLineId: recipe.skillLineId,
        profession,
        build,
        builds,
        learnedBy: known[0]?.n ?? 0,
        learnedVia: via,
        sourceText:
          typeof snap?.sourceText === 'string' ? cleanTooltipLine(snap.sourceText) || null : null,
        requirements: {
          skillRank,
          charLevel,
          useLevel: o ? useLevel(o.reqLevel, o.tooltip) : null,
          maxTrivial: snap?.maxTrivial ?? null,
          difficulty,
        },
        output: o
          ? {
              itemId: o.itemId,
              name: o.name,
              quality: o.quality,
              classId: o.classId,
              subclassId: o.subclassId,
              type: o.type,
              subtype: o.subtype,
              equipLoc: o.equipLoc,
              qtyMin: snap?.qtyMin ?? null,
              qtyMax: snap?.qtyMax ?? null,
              build: o.build,
              ilvl: o.ilvl,
              reqLevel: o.reqLevel,
              sellPrice: o.sellPrice,
              stats: numericStats(o.stats),
              tooltip: cleanTooltip(o.tooltip),
            }
          : null,
        reagents,
        recipeItems: sources.recipeItems.map((i) => {
          const one = learnRequirements({
            profession: profession?.name ?? null,
            trainers: [],
            recipeItems: [{ ...i, reqLevel: null }],
          });
          return {
            itemId: i.itemId,
            name: i.itemName,
            quality: i.quality,
            build: i.build,
            reqLevel: i.reqLevel,
            skillRank: one.skillRank?.rank ?? null,
            charLevel: one.charLevel?.level ?? null,
            tooltip: cleanTooltip(i.tooltip),
          };
        }),
        sources: {
          trainers: sources.trainers.map(({ recipeId: _r, ...t }) => t),
          vendors,
          drops,
        },
      };
    },
  );
}
