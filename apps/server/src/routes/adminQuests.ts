// Admin panel quest pages and character timelines: the quest table (one row per quest at one build), a quest's
// detail (observations, turn-ins, reward picks) and a character's level / quest XP over time. Every string here was
// uploaded by someone's PC: it is returned as data and the panel renders it as text only.
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client.js';
import { chicagoIso } from '../time.js';
import type { ReadGuard } from './analysis.js';
import { buildFilter, int4Param } from './analysis.js';
import { intParam, iso, rows } from './adminData.js';
import {
  CHAR_KEY_MAX,
  containsPattern,
  FOREVER_ID_THRESHOLDS,
  flagParam,
  idParam,
  searchParam,
  textParam,
} from './shared.js';

export const QUESTS_DEFAULT_LIMIT = 100;
export const QUESTS_MAX_LIMIT = 500;
const OFFSET_MAX = 1_000_000;
const ZONE_MAX = 200;
/** Newest turn-ins listed on a quest's detail (`turnInsTotal` counts them all). */
const DETAIL_TURN_INS = 500;

export interface Loc {
  zone: string | null;
  subzone: string | null;
  mapID: number | null;
  x: number | null;
  y: number | null;
}

const str = (v: unknown) => (typeof v === 'string' ? v : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A stored location (jsonb) with only the known fields, each of the right type; null when there is none. */
export function locOf(v: unknown): Loc | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const loc = {
    zone: str(o.zone),
    subzone: str(o.subzone),
    mapID: num(o.mapID),
    x: num(o.x),
    y: num(o.y),
  };
  return Object.values(loc).every((x) => x === null) ? null : loc;
}

/**
 * Level points sorted by time → only the first and last point of each run at one level (a character sits at a level
 * for many observations; the chart only needs where each level starts and ends).
 */
export function compressLevelRuns<T extends { level: number }>(points: T[]): T[] {
  return points.filter(
    (p, i) =>
      i === 0 ||
      i === points.length - 1 ||
      points[i - 1]!.level !== p.level ||
      points[i + 1]!.level !== p.level,
  );
}

/** Running total of `xp` (missing counts as 0). */
export function withCumulativeXp<T extends { xp: number | null }>(list: T[]) {
  let total = 0;
  return list.map((t) => {
    total += t.xp ?? 0;
    return { ...t, cumulativeXp: total };
  });
}

/** Every (quest, build) the ledger saw: observations and turn-ins. */
const SEEN = sql`seen as (
  select quest_id, build from quest_observations
  union all
  select quest_id, build from turn_ins
)`;

interface ListRow {
  quest_id: number;
  build: number;
  builds: number[];
  title: string | null;
  level: number | null;
  category: string | null;
  suggested_group: number | null;
  xp_offered: number | null;
  money_offered: number | null;
  turn_ins: number;
  avg_xp_paid: number | null;
  xp_mismatch: boolean;
  forever_only: boolean;
  last_seen: Date | null;
}

export function registerAdminQuestRoutes(app: FastifyInstance, db: Db, preHandler: ReadGuard) {
  /**
   * Quests, one row per quest at one build: `?build=` or, without it, the newest build the quest was seen in. All
   * numbers are that build's: XP/money offered (max over detail/complete/log observations), turn-ins and the average
   * XP paid, `xpMismatch` when both are known and differ, reward choices with how often each was picked, quest givers
   * (detail/accept) and enders (complete). Filters: `search` (title or id), `zone`, `minLevel`/`maxLevel` (quest
   * level), `forever=1`, `mismatch=1`. Ordered by quest id; `limit` (≤ 500) / `offset` page it.
   */
  app.get('/admin/api/quests', { preHandler }, async (req) => {
    const q = req.query;
    const build = buildFilter(q);
    const search = searchParam(q);
    const zone = textParam(q, 'zone', ZONE_MAX);
    const minLevel = int4Param(q, 'minLevel');
    const maxLevel = int4Param(q, 'maxLevel');
    const forever = flagParam(q, 'forever');
    const mismatch = flagParam(q, 'mismatch');
    const limit = intParam(q, 'limit', QUESTS_DEFAULT_LIMIT, QUESTS_MAX_LIMIT);
    const offset = intParam(q, 'offset', 0, OFFSET_MAX);
    const pattern = search === null ? null : containsPattern(search);

    const filtered: SQL = sql`
      with ${SEEN}, qb as (
        select quest_id, coalesce(${build}::int, max(build)) as build,
               array_agg(distinct build order by build desc) as builds
        from seen
        group by quest_id
        having ${build}::int is null or bool_or(build = ${build}::int)
      ), base as (
        select qb.quest_id, qb.build, qb.builds, q.title, q.level, q.category, q.suggested_group,
               o.xp_offered, o.money_offered, p.turn_ins, p.avg_xp_paid,
               (o.xp_offered is not null and p.avg_xp_paid is not null
                 and o.xp_offered <> p.avg_xp_paid) as xp_mismatch,
               qb.quest_id >= ${FOREVER_ID_THRESHOLDS.quest}::int as forever_only,
               greatest(
                 (select max(observed_at) from quest_observations x
                  where x.quest_id = qb.quest_id and x.build = qb.build),
                 (select max(turned_in_at) from turn_ins x where x.quest_id = qb.quest_id and x.build = qb.build)
               ) as last_seen
        from qb
        left join quests q on q.quest_id = qb.quest_id
        cross join lateral (
          select max(xp)::int as xp_offered, max(money)::int as money_offered
          from quest_observations o
          where o.quest_id = qb.quest_id and o.build = qb.build and o.stage in ('detail', 'complete', 'log')
        ) o
        cross join lateral (
          select count(*)::int as turn_ins, round(avg(xp))::int as avg_xp_paid
          from turn_ins t where t.quest_id = qb.quest_id and t.build = qb.build
        ) p
      ), filtered as (
        select * from base
        where (${search}::text is null
               or title ilike ${pattern}::text escape '\\'
               or quest_id::text = ${search}::text)
          and (${zone}::text is null or category = ${zone}::text)
          and (${minLevel}::int is null or level >= ${minLevel}::int)
          and (${maxLevel}::int is null or level <= ${maxLevel}::int)
          and (not ${forever}::boolean or forever_only)
          and (not ${mismatch}::boolean or xp_mismatch)
      )`;

    const [count, page, zones, builds] = await Promise.all([
      rows<{ n: number }>(db, sql`${filtered} select count(*)::int as n from filtered`),
      rows<ListRow>(
        db,
        sql`${filtered} select * from filtered order by quest_id limit ${limit} offset ${offset}`,
      ),
      rows<{ zone: string; quests: number }>(
        db,
        sql`select category as zone, count(*)::int as quests from quests
            where category is not null and category <> '' group by category order by category`,
      ),
      rows<{ build: number }>(
        db,
        sql`select build from quest_observations union select build from turn_ins order by build desc`,
      ),
    ]);

    const ids = page.map((r) => r.quest_id);
    const pageBuilds = page.map((r) => r.build);
    const pageSql = sql`page as (
      select * from unnest(${sql.param(ids)}::int[], ${sql.param(pageBuilds)}::int[]) as p(quest_id, build)
    )`;
    const [choices, npcs] = ids.length
      ? await Promise.all([
          rows<{
            quest_id: number;
            item_id: number;
            name: string | null;
            quality: number | null;
            picks: number;
          }>(
            db,
            sql`
            with ${pageSql}, opts as (
              select o.quest_id, o.build, o.item_id from quest_reward_options o
              join page using (quest_id, build) where o.kind = 'choice'
            ), picks as (
              select t.quest_id, t.build, t.choice_item_id as item_id, count(*)::int as picks
              from turn_ins t join page using (quest_id, build)
              where t.choice_item_id is not null
              group by t.quest_id, t.build, t.choice_item_id
            )
            select coalesce(o.quest_id, p.quest_id) as quest_id, coalesce(o.item_id, p.item_id) as item_id,
                   i.name, i.quality, coalesce(p.picks, 0)::int as picks
            from opts o
            full join picks p on p.quest_id = o.quest_id and p.build = o.build and p.item_id = o.item_id
            left join items i on i.item_id = coalesce(o.item_id, p.item_id)
            order by 1, picks desc, 2`,
          ),
          rows<{ quest_id: number; role: 'giver' | 'ender'; name: string }>(
            db,
            sql`
            with ${pageSql}
            select distinct o.quest_id,
                   case when o.stage = 'complete' then 'ender' else 'giver' end as role,
                   o.npc_name as name
            from quest_observations o join page using (quest_id, build)
            where o.stage in ('detail', 'accept', 'complete') and o.npc_name is not null and o.npc_name <> ''
            order by 1, 2, 3`,
          ),
        ])
      : [[], []];

    return {
      total: count[0]!.n,
      limit,
      offset,
      zones,
      builds: builds.map((b) => b.build),
      items: page.map((r) => ({
        questId: r.quest_id,
        build: r.build,
        builds: r.builds,
        title: r.title,
        level: r.level,
        category: r.category,
        suggestedGroup: r.suggested_group,
        xpOffered: r.xp_offered,
        moneyOffered: r.money_offered,
        turnIns: r.turn_ins,
        avgXpPaid: r.avg_xp_paid,
        xpMismatch: r.xp_mismatch,
        foreverOnly: r.forever_only,
        rewardChoices: choices
          .filter((c) => c.quest_id === r.quest_id)
          .map((c) => ({ itemId: c.item_id, name: c.name, quality: c.quality, picks: c.picks })),
        givers: npcs
          .filter((n) => n.quest_id === r.quest_id && n.role === 'giver')
          .map((n) => n.name),
        enders: npcs
          .filter((n) => n.quest_id === r.quest_id && n.role === 'ender')
          .map((n) => n.name),
        lastSeen: iso(r.last_seen),
      })),
    };
  });

  /**
   * One quest across builds: its static facts, every observation (build, stage, character, level, XP, money, NPC and
   * where), the newest 500 turn-ins with the picked reward, and per build its reward options with pick counts.
   */
  app.get<{ Params: { id: string } }>(
    '/admin/api/quests/:id',
    { preHandler },
    async (req, reply) => {
      const id = idParam(req.params.id, 'quest');
      const [quest, observations, turnIns, total, rewards] = await Promise.all([
        rows<{
          title: string | null;
          level: number | null;
          category: string | null;
          suggested_group: number | null;
          objectives: unknown;
        }>(
          db,
          sql`select title, level, category, suggested_group, objectives from quests where quest_id = ${id}`,
        ),
        rows<{
          build: number;
          stage: string;
          char: string;
          class: string | null;
          level: number | null;
          observed_at: Date | null;
          xp: number | null;
          money: number | null;
          npc_id: number | null;
          npc_name: string | null;
          npc_loc: unknown;
          loc: unknown;
        }>(
          db,
          sql`
          select o.build, o.stage, o.char, c.class, o.level, o.observed_at, o.xp, o.money,
                 o.npc_id, o.npc_name, o.npc_loc, o.loc
          from quest_observations o
          left join characters c on c.key = o.char
          where o.quest_id = ${id}
          order by o.build desc, o.observed_at nulls last,
                   array_position(array['detail', 'accept', 'log', 'complete'], o.stage), o.char`,
        ),
        rows<{
          build: number;
          char: string;
          class: string | null;
          level: number | null;
          xp: number | null;
          money: number | null;
          turned_in_at: Date;
          choice_item_id: number | null;
          choice_name: string | null;
          choice_quality: number | null;
        }>(
          db,
          sql`
          select t.build, t.char, c.class, t.level, t.xp, t.money, t.turned_in_at,
                 t.choice_item_id, i.name as choice_name, i.quality as choice_quality
          from turn_ins t
          left join characters c on c.key = t.char
          left join items i on i.item_id = t.choice_item_id
          where t.quest_id = ${id}
          order by t.turned_in_at desc, t.id
          limit ${DETAIL_TURN_INS}`,
        ),
        rows<{ n: number; builds: number[] | null }>(
          db,
          sql`
          select (select count(*)::int from turn_ins where quest_id = ${id}) as n,
                 (select array_agg(build order by build desc) from (
                    select build from quest_observations where quest_id = ${id}
                    union select build from turn_ins where quest_id = ${id}) b) as builds`,
        ),
        rows<{
          build: number;
          kind: string;
          item_id: number;
          name: string | null;
          quality: number | null;
          count: number | null;
          picks: number;
        }>(
          db,
          sql`
          with opts as (
            select build, kind, item_id, count from quest_reward_options where quest_id = ${id}
          ), picks as (
            select build, choice_item_id as item_id, count(*)::int as picks
            from turn_ins where quest_id = ${id} and choice_item_id is not null
            group by build, choice_item_id
          )
          select coalesce(o.build, p.build) as build, coalesce(o.kind, 'choice') as kind,
                 coalesce(o.item_id, p.item_id) as item_id, i.name, i.quality, o.count,
                 case when coalesce(o.kind, 'choice') = 'choice' then coalesce(p.picks, 0) else 0 end::int as picks
          from opts o
          full join picks p on p.build = o.build and p.item_id = o.item_id and o.kind = 'choice'
          left join items i on i.item_id = coalesce(o.item_id, p.item_id)
          order by 1 desc, 2, picks desc, 3`,
        ),
      ]);
      const q = quest[0];
      const builds = total[0]!.builds ?? [];
      if (!q && builds.length === 0) return reply.status(404).send({ error: 'quest not seen yet' });
      return {
        quest: {
          questId: id,
          title: q?.title ?? null,
          level: q?.level ?? null,
          category: q?.category ?? null,
          suggestedGroup: q?.suggested_group ?? null,
          objectives: Array.isArray(q?.objectives)
            ? q.objectives.filter((x): x is string => typeof x === 'string')
            : [],
          foreverOnly: id >= FOREVER_ID_THRESHOLDS.quest,
        },
        builds,
        observations: observations.map((o) => ({
          build: o.build,
          stage: o.stage,
          char: o.char,
          class: o.class,
          level: o.level,
          observedAt: iso(o.observed_at),
          xp: o.xp,
          money: o.money,
          npc:
            o.npc_id === null && o.npc_name === null
              ? null
              : { id: o.npc_id, name: o.npc_name, loc: locOf(o.npc_loc) },
          loc: locOf(o.loc),
        })),
        turnInsTotal: total[0]!.n,
        turnIns: turnIns.map((t) => ({
          build: t.build,
          char: t.char,
          class: t.class,
          level: t.level,
          xp: t.xp,
          money: t.money,
          turnedInAt: chicagoIso(t.turned_in_at),
          choice:
            t.choice_item_id === null
              ? null
              : { itemId: t.choice_item_id, name: t.choice_name, quality: t.choice_quality },
        })),
        rewards: rewards.map((r) => ({
          build: r.build,
          kind: r.kind,
          itemId: r.item_id,
          name: r.name,
          quality: r.quality,
          count: r.count,
          picks: r.picks,
        })),
      };
    },
  );

  /**
   * A character's level over time (levels seen in quest observations, turn-ins and the character record; the same
   * time+level once; runs at one level cut to their first and last point), its quest turn-ins oldest first with the
   * running XP total, and quest XP per America/Chicago day.
   */
  app.get<{ Params: { key: string } }>(
    '/admin/api/characters/:key/timeline',
    { preHandler },
    async (req, reply) => {
      const key = req.params.key;
      if (key.length === 0 || key.length > CHAR_KEY_MAX)
        return reply.status(400).send({ error: 'bad character key' });
      const [character, levels, turnIns, perDay] = await Promise.all([
        rows<{
          key: string;
          name: string;
          realm: string;
          class: string | null;
          race: string | null;
          faction: string | null;
          level: number | null;
          last_seen: Date | null;
        }>(
          db,
          sql`select key, name, realm, class, race, faction, level, last_seen from characters where key = ${key}`,
        ),
        rows<{ at: Date; level: number }>(
          db,
          sql`
          select at, level from (
            select observed_at as at, level from quest_observations
            where char = ${key} and observed_at is not null and level is not null
            union
            select turned_in_at, level from turn_ins where char = ${key} and level is not null
            union
            select last_seen, level from characters
            where key = ${key} and last_seen is not null and level is not null
          ) x
          order by at, level`,
        ),
        rows<{
          quest_id: number;
          title: string | null;
          build: number;
          level: number | null;
          xp: number | null;
          money: number | null;
          turned_in_at: Date;
        }>(
          db,
          sql`
          select t.quest_id, q.title, t.build, t.level, t.xp, t.money, t.turned_in_at
          from turn_ins t left join quests q on q.quest_id = t.quest_id
          where t.char = ${key}
          order by t.turned_in_at, t.id`,
        ),
        rows<{ day: string; xp: number; turn_ins: number }>(
          db,
          sql`
          select to_char(turned_in_at at time zone 'America/Chicago', 'YYYY-MM-DD') as day,
                 coalesce(sum(xp), 0)::int as xp, count(*)::int as turn_ins
          from turn_ins where char = ${key}
          group by 1 order by 1`,
        ),
      ]);
      const c = character[0];
      if (!c && levels.length === 0 && turnIns.length === 0)
        return reply.status(404).send({ error: 'character not seen yet' });
      const list = withCumulativeXp(turnIns);
      return {
        character: c
          ? {
              key: c.key,
              name: c.name,
              realm: c.realm,
              class: c.class,
              race: c.race,
              faction: c.faction,
              level: c.level,
              lastSeen: iso(c.last_seen),
            }
          : null,
        levels: compressLevelRuns(levels).map((p) => ({ at: chicagoIso(p.at), level: p.level })),
        turnIns: list.map((t) => ({
          questId: t.quest_id,
          title: t.title,
          build: t.build,
          level: t.level,
          xp: t.xp,
          money: t.money,
          turnedInAt: chicagoIso(t.turned_in_at),
          cumulativeXp: t.cumulativeXp,
        })),
        perDay: perDay.map((d) => ({ day: d.day, xp: d.xp, turnIns: d.turn_ins })),
        totals: { turnIns: list.length, questXp: list.at(-1)?.cumulativeXp ?? 0 },
      };
    },
  );
}
