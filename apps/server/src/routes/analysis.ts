import { RULES_VERSION, specsWanting } from '@forever-ledger/contracts';
import { sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyBearer } from '../auth.js';
import type { Db } from '../db/client.js';

/** Read routes need any valid token: the data includes contributors' character names. */
export function requireToken(db: Db) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if ((await verifyBearer(db, req.headers.authorization)) === null) {
      return reply.status(401).send({ error: 'invalid or revoked token' });
    }
  };
}

const buildFilter = (q: unknown) => {
  const b = Number((q as { build?: string }).build);
  return Number.isInteger(b) && b > 0 ? b : null;
};

async function rows<T>(db: Db, query: ReturnType<typeof sql>) {
  const res = await db.execute(query);
  return res.rows as T[];
}

export function registerAnalysisRoutes(app: FastifyInstance, db: Db) {
  const preHandler = requireToken(db);

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

  /** One item across builds: snapshots, drop sources, quest rewards and which specs want it. */
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
    const latest = snapshots[0];
    const level = latest?.reqLevel ?? 20;
    return {
      ...item,
      snapshots,
      dropSources,
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
