// Admin panel dungeon reads (/admin/api/runs*, /admin/api/dungeons/clear-times) for the Dungeons and Run pages.
// Runs are listed per run group (src/runGroups.ts): one shared dungeon run uploaded by several party members is one
// row, its members are the characters' own runs (perspectives). A group's clear time is the median active time of its
// members, whole seconds. Everything here is uploaded data: the panel renders it as text.
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { INT4_MAX } from '../addon.js';
import type { Db } from '../db/client.js';
import { chicagoIso } from '../time.js';
import type { ReadGuard } from './analysis.js';
import { buildFilter, int4Param } from './analysis.js';
import { iso, rows } from './adminData.js';
import { itemInfo, npcNames, pageParams } from './adminLoot.js';

const RUN_ID_MAX = 256;
/** Clear times listed per instance (fastest first). */
const CLEAR_TIMES_MAX = 1000;

const str = (v: unknown) => (typeof v === 'string' ? v : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bool = (v: unknown) => (typeof v === 'boolean' ? v : null);
const list = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v)
    ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    : [];
const textArray = (xs: string[]) => sql`${sql.param(xs)}::text[]`;

/** The rounded median of the known values, null without any. */
export function medianOf(xs: (number | null)[]) {
  const s = xs.filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (s.length === 0) return null;
  const mid = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2);
}

export interface Boss {
  ord: number;
  encounterId: number | null;
  name: string | null;
  killed: boolean;
  atSecs: number;
}

/**
 * One group's bosses from every member's list: one per encounter id (else per name), at the earliest member's time,
 * killed when any member saw the kill, numbered again in time order.
 */
export function mergeBosses(perMember: Boss[][]): Boss[] {
  const byKey = new Map<string, Boss>();
  for (const bosses of perMember) {
    for (const b of bosses) {
      const key = b.encounterId !== null ? `e${b.encounterId}` : `n${b.name ?? b.ord}`;
      const known = byKey.get(key);
      if (!known) byKey.set(key, { ...b });
      else {
        known.killed ||= b.killed;
        if (b.atSecs < known.atSecs) known.atSecs = b.atSecs;
      }
    }
  }
  return [...byKey.values()]
    .sort((a, b) => a.atSecs - b.atSecs || a.ord - b.ord)
    .map((b, i) => ({ ...b, ord: i + 1 }));
}

interface BossLootLike {
  encounterId: number | null;
  lootListKey: number | null;
  itemId: number | null;
  winnerClass: string | null;
  winnerIsSelf: boolean | null;
  rolls: unknown[];
}

/**
 * One group's boss loot from every member's C_LootHistory: the same drop seen by two members is one entry, keyed by
 * encounter, item, winner class and loot list key (when recorded). A key a member saw n times counts n times (the
 * most any member saw it), so two copies of one item from one boss stay two. The entry with the most rolls is kept,
 * and `winnerChar` names the member who saw itself win (null when the winner ran no addon).
 */
export function mergeBossLoot<T extends BossLootLike>(
  perMember: { char: string; bossLoot: T[] }[],
) {
  const merged = new Map<string, Omit<T, 'winnerIsSelf'> & { winnerChar: string | null }>();
  for (const { char, bossLoot } of perMember) {
    const seen = new Map<string, number>();
    for (const { winnerIsSelf, ...drop } of bossLoot) {
      const key = [
        drop.encounterId,
        drop.itemId,
        drop.winnerClass ?? '',
        drop.lootListKey ?? '',
      ].join('|');
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      const slot = `${key}#${n}`;
      const known = merged.get(slot);
      const winnerChar = winnerIsSelf ? char : (known?.winnerChar ?? null);
      if (!known || drop.rolls.length > known.rolls.length)
        merged.set(slot, { ...drop, winnerChar });
      else known.winnerChar = winnerChar;
    }
  }
  return [...merged.values()];
}

/** One member run with its counts; `gid` is its group (its own id before the backfill). */
interface RunRow {
  id: string;
  gid: string;
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
  r.id, coalesce(r.group_id, r.id) as gid, r.build, r.char, ch.class as char_class, r.char_level, r.instance,
  r.instance_id, r.difficulty, r.max_players, r.started_at, r.finished_at, r.end_reason, r.active_secs, r.away_secs,
  r.xp_total, r.quest_xp, r.mob_xp, r.deaths, r.loot_method,
  (select count(*) filter (where killed) from run_bosses b where b.run_id = r.id)::int as bosses_killed,
  (select count(*) from run_bosses b where b.run_id = r.id)::int as bosses_total,
  (case when jsonb_typeof(r.loot) = 'array' then jsonb_array_length(r.loot) else 0 end)::int as loot_count,
  (select count(*) from run_party p where p.run_id = r.id)::int as party_count`;

/** One member's run. `mobXp` is the recorded mob XP, else total minus quest XP (as /v1/runs/summary counts it). */
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

/** A run group as the runs list shows it (aggregated in SQL). */
interface GroupRow {
  gid: string;
  build: number;
  instance: string | null;
  instance_id: number;
  difficulty: number | null;
  max_players: number | null;
  loot_method: string | null;
  started_at: Date;
  finished_at: Date | null;
  active_secs: number | null;
  away_secs: number | null;
  xp_total: number;
  quest_xp: number;
  mob_xp: number;
  deaths: number;
  loot_count: number;
  party_count: number;
  bosses_killed: number;
  bosses_total: number;
  members: { id: string; char: string; charClass: string | null; charLevel: number | null }[];
}

export function registerAdminRunRoutes(app: FastifyInstance, db: Db, preHandler: ReadGuard) {
  /**
   * Run groups, newest first: `?build=`, `?instance=` (instance id), `?limit=` / `?offset=`; `instances` (groups per
   * instance) for the filter. A row is one group: earliest start, latest finish, clear time (median member active
   * time) and median away time, XP per member (average), deaths and own loot summed over members, bosses merged by
   * encounter, the largest party, and its members (character, class, level).
   */
  app.get('/admin/api/runs', { preHandler }, async (req) => {
    const build = buildFilter(req.query);
    const instance = int4Param(req.query, 'instance');
    const { limit, offset } = pageParams(req.query);
    const where = sql`(${build}::int is null or r.build = ${build}::int)
      and (${instance}::int is null or r.instance_id = ${instance}::int)`;
    const [page, count, instances] = await Promise.all([
      rows<GroupRow>(
        db,
        sql`
        with m as (
          select ${runColumns}
          from runs r left join characters ch on ch.key = r.char
          where ${where}
        ), g as (
          select gid, min(build) as build, max(instance) as instance, min(instance_id) as instance_id,
                 max(difficulty) as difficulty, max(max_players) as max_players, max(loot_method) as loot_method,
                 min(started_at) as started_at, max(finished_at) as finished_at,
                 round(percentile_cont(0.5) within group (order by active_secs))::int as active_secs,
                 round(percentile_cont(0.5) within group (order by away_secs))::int as away_secs,
                 round(avg(xp_total))::int as xp_total, round(avg(quest_xp))::int as quest_xp,
                 round(avg(coalesce(mob_xp, xp_total - quest_xp)))::int as mob_xp,
                 sum(deaths)::int as deaths, sum(loot_count)::int as loot_count,
                 max(party_count)::int as party_count,
                 jsonb_agg(jsonb_build_object('id', id, 'char', char, 'charClass', char_class,
                                              'charLevel', char_level) order by started_at, id) as members
          from m group by gid
        ), page as (
          select * from g order by started_at desc, gid limit ${limit} offset ${offset}
        )
        select page.*, coalesce(b.killed, 0) as bosses_killed, coalesce(b.total, 0) as bosses_total
        from page left join lateral (
          select count(distinct coalesce('e' || x.encounter_id, 'n' || x.name, 'o' || x.ord))
                   filter (where x.killed)::int as killed,
                 count(distinct coalesce('e' || x.encounter_id, 'n' || x.name, 'o' || x.ord))::int as total
          from run_bosses x join m on m.id = x.run_id
          where m.gid = page.gid
        ) b on true
        order by page.started_at desc, page.gid`,
      ),
      rows<{ n: number }>(
        db,
        sql`select count(distinct coalesce(r.group_id, r.id))::int as n from runs r where ${where}`,
      ),
      rows<{ instanceId: number; instance: string | null; runs: number }>(
        db,
        sql`select instance_id as "instanceId", max(instance) as instance,
                   count(distinct coalesce(group_id, id))::int as runs
            from runs group by instance_id order by instance nulls last, instance_id`,
      ),
    ]);
    return {
      items: page.map((g) => ({
        id: g.gid,
        build: g.build,
        instance: g.instance,
        instanceId: g.instance_id,
        difficulty: g.difficulty,
        maxPlayers: g.max_players,
        startedAt: chicagoIso(g.started_at),
        finishedAt: iso(g.finished_at),
        activeSecs: g.active_secs,
        awaySecs: g.away_secs,
        xpTotal: g.xp_total,
        questXp: g.quest_xp,
        mobXp: g.mob_xp,
        deaths: g.deaths,
        lootMethod: g.loot_method,
        bosses: { killed: g.bosses_killed, total: g.bosses_total },
        loot: g.loot_count,
        party: g.party_count,
        members: g.members,
      })),
      total: count[0]?.n ?? 0,
      limit,
      offset,
      instances,
    };
  });

  /**
   * Clear times of finished run groups per instance, fastest first; `?build=`. A group's clear time is the median
   * active time of its finished members; `members` counts them.
   */
  app.get('/admin/api/dungeons/clear-times', { preHandler }, async (req) => {
    const build = buildFilter(req.query);
    const rs = await rows<{
      instance_id: number;
      instance: string | null;
      runs: { id: string; build: number; activeSecs: number; members: number }[];
    }>(
      db,
      sql`
      with g as (
        select coalesce(group_id, id) as gid, instance_id, max(instance) as instance, min(build) as build,
               round(percentile_cont(0.5) within group (order by active_secs))::int as active_secs,
               count(*)::int as members
        from runs
        where finished_at is not null and active_secs > 0
          and (${build}::int is null or build = ${build}::int)
        group by coalesce(group_id, id), instance_id
      )
      select instance_id, max(instance) as instance,
             (array_agg(jsonb_build_object('id', gid, 'build', build, 'activeSecs', active_secs,
                                           'members', members)
                        order by active_secs, gid))[1:${CLEAR_TIMES_MAX}] as runs
      from g
      group by instance_id
      order by instance nulls last, instance_id`,
    );
    return rs.map((r) => ({ instanceId: r.instance_id, instance: r.instance, runs: r.runs }));
  });

  /**
   * One run group, from any member's run id: the group (earliest start, latest finish, clear time = median member
   * active time, span, deaths summed, bosses merged by encounter at the earliest time, boss loot deduped across
   * members, every member's own loot) and `perspectives`, each member's own run as its addon recorded it (times, XP,
   * deaths, bosses, loot, boss and group loot, party). Group loot stays per perspective: the loot messages carry no
   * time to match the same message across members.
   */
  app.get<{ Params: { id: string } }>('/admin/api/runs/:id', { preHandler }, async (req, reply) => {
    const id = req.params.id;
    if (id.length === 0 || id.length > RUN_ID_MAX)
      return reply.status(400).send({ error: 'bad run id' });
    const [found] = await rows<{ gid: string }>(
      db,
      sql`select coalesce(group_id, id) as gid from runs where id = ${id}`,
    );
    if (!found) return reply.status(404).send({ error: 'no such run' });
    const gid = found.gid;
    const members = await rows<RunRow & { loot: unknown; boss_loot: unknown; group_loot: unknown }>(
      db,
      sql`
      select ${runColumns}, r.loot, r.boss_loot, r.group_loot
      from runs r left join characters ch on ch.key = r.char
      where r.group_id = ${gid} or (r.group_id is null and r.id = ${gid})
      order by r.started_at, r.id`,
    );
    const ids = members.map((m) => m.id);
    const [bossRows, partyRows] = await Promise.all([
      rows<Boss & { runId: string }>(
        db,
        sql`select run_id as "runId", ord, encounter_id as "encounterId", name, killed, at_secs as "atSecs"
            from run_bosses where run_id = any(${textArray(ids)}) order by run_id, ord`,
      ),
      rows<{ runId: string; slot: number; class: string | null; level: number | null }>(
        db,
        sql`select run_id as "runId", slot, class, level
            from run_party where run_id = any(${textArray(ids)}) order by run_id, slot`,
      ),
    ]);
    const raw = members.map((m) => ({
      run: m,
      loot: list(m.loot).map((l) => ({ itemId: num(l.itemID), npcId: num(l.npcID) })),
      bossLoot: list(m.boss_loot),
      groupLoot: list(m.group_loot),
    }));
    const valid = (n: number | null): n is number => n !== null && n <= INT4_MAX;
    const items = await itemInfo(
      db,
      raw
        .flatMap((r) => [
          ...r.loot.map((l) => l.itemId),
          ...r.bossLoot.map((b) => num(b.itemId)),
          ...r.groupLoot.map((g) => num(g.itemId)),
        ])
        .filter(valid),
    );
    const names = await npcNames(db, [
      ...new Set(raw.flatMap((r) => r.loot.map((l) => l.npcId)).filter(valid)),
    ]);
    const item = (itemId: number | null) => {
      const known = itemId === null ? undefined : items.get(itemId);
      return { itemId, name: known?.name ?? null, quality: known?.quality ?? null };
    };
    const bossName = (bosses: Boss[], encounterId: number | null) =>
      bosses.find((x) => x.encounterId !== null && x.encounterId === encounterId)?.name ?? null;

    const perspectives = raw.map(({ run, loot, bossLoot, groupLoot }) => {
      const bosses = bossRows.filter((b) => b.runId === run.id).map(({ runId: _, ...b }) => b);
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
            bossName: bossName(bosses, encounterId),
            lootListKey: num(b.lootListKey),
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
        party: partyRows.filter((p) => p.runId === run.id).map(({ runId: _, ...p }) => p),
      };
    });

    const bosses = mergeBosses(perspectives.map((p) => p.bosses));
    const first = members[0]!;
    // Raw query rows carry timestamps as text.
    const ms = (d: Date | string) => new Date(d).getTime();
    const finished = members.map((m) => m.finished_at).filter((d) => d !== null);
    const start = Math.min(...members.map((m) => ms(m.started_at)));
    const end = finished.length > 0 ? Math.max(...finished.map(ms)) : null;
    return {
      id: gid,
      build: first.build,
      instance: members.find((m) => m.instance)?.instance ?? null,
      instanceId: first.instance_id,
      difficulty: first.difficulty,
      maxPlayers: first.max_players,
      lootMethod: members.find((m) => m.loot_method)?.loot_method ?? null,
      startedAt: chicagoIso(new Date(start)),
      finishedAt: end === null ? null : chicagoIso(new Date(end)),
      activeSecs: medianOf(members.map((m) => m.active_secs)),
      spanSecs: end === null ? null : Math.round((end - start) / 1000),
      deaths: members.reduce((n, m) => n + m.deaths, 0),
      members: members.length,
      bosses,
      bossLoot: mergeBossLoot(perspectives).map((b) => ({
        ...b,
        bossName: bossName(bosses, b.encounterId),
      })),
      loot: perspectives.flatMap((p) => p.loot.map((l) => ({ ...l, char: p.char }))),
      perspectives,
    };
  });
}
