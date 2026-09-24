// Run groups: one shared dungeon run uploaded by several characters (each addon records its own run) is one group.
// `runs.group_id` is the id of the group's earliest run; a run nobody else matched is its own group (group_id = id).
// The rule is pure (`sameRun`, `groupRuns`); `regroupRuns` applies it inside the ingest transaction and
// `backfillRunGroups` fills group_id for runs stored before migration 0010.
import { sql } from 'drizzle-orm';
import type { Db } from './db/client.js';
import { RUN_GROUPS_LOCK } from './locks.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Two members enter the instance within this many seconds of each other (inclusive). */
export const GROUP_WINDOW_SECS = 180;

export interface GroupableRun {
  id: string;
  /** Character key (Name-Realm). */
  char: string;
  /** Class token of the character (from `characters`), e.g. 'DRUID'. */
  charClass: string | null;
  charLevel: number | null;
  instanceId: number;
  build: number;
  /** Epoch seconds. */
  startedAt: number;
  /** The other party members at the run's start, by class and level. */
  party: { class: string | null; level: number | null }[];
}

const norm = (cls: string | null) => (cls === null ? null : cls.toUpperCase());

/** `a`'s party lists a member with `b`'s class and level. */
function lists(a: GroupableRun, b: GroupableRun) {
  const cls = norm(b.charClass);
  if (cls === null || b.charLevel === null) return false;
  return a.party.some((p) => norm(p.class) === cls && p.level === b.charLevel);
}

/**
 * Two runs are the same dungeon run seen by two characters: same instance and build, starts at most
 * GROUP_WINDOW_SECS apart, different characters, and each one's party (recorded at the start) lists the other's class
 * and level. The evidence must be mutual: every addon version (schema 1 on) records the party at the start, so an
 * empty party means the character entered alone, and a solo run is never grouped on the other side's listing alone.
 */
export function sameRun(a: GroupableRun, b: GroupableRun) {
  if (a.char === b.char) return false;
  if (a.instanceId !== b.instanceId || a.build !== b.build) return false;
  if (Math.abs(a.startedAt - b.startedAt) > GROUP_WINDOW_SECS) return false;
  return lists(a, b) && lists(b, a);
}

const earlier = (a: GroupableRun, b: GroupableRun) =>
  a.startedAt !== b.startedAt ? a.startedAt - b.startedAt : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * Run id → group id (the id of the group's earliest run, ties by id). Transitive: a run joins a group when it matches
 * any member. Matching pairs merge closest starts first and never merge two groups that share a character, so one
 * character's two runs never end up in one group. The result does not depend on the input order.
 */
export function groupRuns(runs: GroupableRun[]): Map<string, string> {
  const sorted = [...runs].sort(earlier);
  const parent = sorted.map((_, i) => i);
  const chars = sorted.map((r) => new Set([r.char]));
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!;
    return i;
  };
  const pairs: [number, number][] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j]!.startedAt - sorted[i]!.startedAt > GROUP_WINDOW_SECS) break;
      if (sameRun(sorted[i]!, sorted[j]!)) pairs.push([i, j]);
    }
  }
  const gap = ([i, j]: [number, number]) => sorted[j]!.startedAt - sorted[i]!.startedAt;
  pairs.sort((p, q) => gap(p) - gap(q) || p[0] - q[0] || p[1] - q[1]);
  for (const [i, j] of pairs) {
    const a = find(i);
    const b = find(j);
    if (a === b || [...chars[b]!].some((c) => chars[a]!.has(c))) continue;
    // The root is always the earliest member (the lower sorted index).
    const [root, child] = a < b ? [a, b] : [b, a];
    parent[child] = root;
    for (const c of chars[child]!) chars[root]!.add(c);
  }
  const byId = new Map(sorted.map((r, i) => [r.id, sorted[find(i)]!.id]));
  return new Map(runs.map((r) => [r.id, byId.get(r.id)!]));
}

/** Rounds of candidate search (a chain of members is at most a raid long); a safety cap, never reached by real data. */
export const MAX_ROUNDS = 20;

/** The part of a pino / Fastify logger regrouping uses. */
export interface RegroupLog {
  warn(obj: object, msg: string): void;
}

export interface RegroupOptions {
  /** Candidate search rounds before giving up on the chain (tests lower it). */
  maxRounds?: number;
  log?: RegroupLog;
}

async function rowsOf<T>(tx: Tx | Db, query: ReturnType<typeof sql>) {
  return (await tx.execute(query)).rows as T[];
}

const textArray = (xs: string[]) => sql`${sql.param(xs)}::text[]`;

/**
 * Takes the run-group lock for the rest of the transaction. Ingest takes it before its first runs write and
 * `regroupRuns` again (re-entrant): taking it only after the runs upsert let two ingests lock a run row and the
 * advisory lock in opposite orders (a deadlock).
 */
export async function lockRunGroups(tx: Tx | Db) {
  await tx.execute(sql`select pg_advisory_xact_lock(${RUN_GROUPS_LOCK})`);
}

/**
 * Assigns group_id to the given runs and every stored run linked to them: runs of the same instance and build started
 * within the window of one of them (a range scan of runs_instance_idx on instance, build and start), repeated until
 * nothing new turns up, plus the members of their current groups (a changed run can leave its group). Writes only
 * group ids that change, so it is idempotent; the group id is the earliest member's id, so a re-uploaded run keeps
 * its group. Serialized with a transaction-level advisory lock so two members' uploads arriving together still see
 * each other. If the search hits `maxRounds` with runs still to explore, those runs are loaded as context (so the runs
 * next to them see their partners) but their own group ids are left as stored, and a warning is logged.
 */
export async function regroupRuns(tx: Tx | Db, runIds: string[], opts: RegroupOptions = {}) {
  if (runIds.length === 0) return 0;
  const maxRounds = opts.maxRounds ?? MAX_ROUNDS;
  await lockRunGroups(tx);
  const known = new Set<string>();
  let frontier = [...new Set(runIds)];
  for (let round = 0; frontier.length > 0 && round < maxRounds; round++) {
    for (const id of frontier) known.add(id);
    const found = await rowsOf<{ id: string }>(
      tx,
      sql`
      with s as (select id, instance_id, build, started_at, group_id from runs where id = any(${textArray(frontier)}))
      select r.id from s join runs r
        on r.instance_id = s.instance_id and r.build = s.build
       and r.started_at >= s.started_at - make_interval(secs => ${GROUP_WINDOW_SECS})
       and r.started_at <= s.started_at + make_interval(secs => ${GROUP_WINDOW_SECS})
      union
      select r.id from s join runs r on r.group_id = s.group_id`,
    );
    frontier = found.map((f) => f.id).filter((id) => !known.has(id));
  }
  // Runs found in the last round but never explored: their own partners are unknown, so they are context only.
  const context = frontier;
  if (context.length > 0) {
    (opts.log ?? console).warn(
      { maxRounds, runs: known.size, unexplored: context.length, sample: context.slice(0, 5) },
      'run group search hit its round cap; runs at the edge keep their stored group',
    );
  }
  const ids = [...known, ...context];
  const runs = await rowsOf<{
    id: string;
    char: string;
    char_class: string | null;
    char_level: number | null;
    instance_id: number;
    build: number;
    started: number;
    group_id: string | null;
    party: { class: string | null; level: number | null }[];
  }>(
    tx,
    sql`
    select r.id, r.char, ch.class as char_class, r.char_level, r.instance_id, r.build,
           extract(epoch from r.started_at)::float8 as started, r.group_id,
           coalesce((select jsonb_agg(jsonb_build_object('class', p.class, 'level', p.level) order by p.slot)
                     from run_party p where p.run_id = r.id), '[]'::jsonb) as party
    from runs r left join characters ch on ch.key = r.char
    where r.id = any(${textArray(ids)})`,
  );
  const groups = groupRuns(
    runs.map((r) => ({
      id: r.id,
      char: r.char,
      charClass: r.char_class,
      charLevel: r.char_level,
      instanceId: r.instance_id,
      build: r.build,
      startedAt: r.started,
      party: r.party,
    })),
  );
  const changed = runs.filter((r) => known.has(r.id) && r.group_id !== groups.get(r.id));
  if (changed.length === 0) return 0;
  await tx.execute(sql`
    update runs r set group_id = v.gid
    from unnest(${textArray(changed.map((c) => c.id))}, ${textArray(changed.map((c) => groups.get(c.id)!))})
      as v(id, gid)
    where r.id = v.id`);
  return changed.length;
}

/** Groups every run stored without a group id (runs from before migration 0010). Returns the runs updated. */
export async function backfillRunGroups(db: Db, opts: RegroupOptions = {}) {
  return db.transaction(async (tx) => {
    const pending = await rowsOf<{ id: string }>(
      tx,
      sql`select id from runs where group_id is null`,
    );
    return regroupRuns(
      tx,
      pending.map((p) => p.id),
      opts,
    );
  });
}
