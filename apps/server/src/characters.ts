// Character identity: build 70009 dropped the surname from UnitName, so addon 0.3.4 keyed "Sam Willikers" as
// "Sam-Realm". Addon 0.4.0 keys by full name again and sends the GUID. Aliases map old keys to their character;
// `mergeCharacter` moves an old key's rows onto the canonical key (characters-cli merge, or ingest when two keys
// share a GUID).
import type { Records } from '@forever-ledger/contracts';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from './db/client.js';
import { characterAliases, characters } from './db/schema.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Conn = Db | Tx;

/**
 * Tables with a `char` column, their primary key, and the column that says which of two colliding rows is newer.
 * When both keys have the same row (same skill line, same recipe and build), the newer one is kept: the short key's
 * rows are usually the newer ones (written after build 70009 dropped the surname). Without a `newer` column the
 * canonical row stays.
 */
export const CHAR_TABLES: readonly {
  table: string;
  pk: readonly string[];
  newer?: string;
  /** Columns the kept (newer) row takes from the other when its own is null, as ingest keeps stored sections. */
  fill?: readonly string[];
}[] = [
  { table: 'quest_observations', pk: ['quest_id', 'build', 'stage', 'char'], newer: 'observed_at' },
  { table: 'turn_ins', pk: ['id'] },
  { table: 'fishing_casts', pk: ['id'] },
  { table: 'character_gear', pk: ['char', 'build'], newer: 'seen_at' },
  { table: 'quest_objective_progress', pk: ['char', 'quest_id', 'idx', 'have', 'at'] },
  {
    table: 'character_state',
    pk: ['char'],
    newer: 'observed_at',
    fill: [
      'level',
      'xp',
      'xp_max',
      'completed',
      'completed_at',
      'log',
      'pos',
      'bind',
      'hearth_ready_at',
      'taxi',
      'mount',
    ],
  },
  { table: 'trips', pk: ['char', 'kind', 'started_at'] },
  { table: 'skills', pk: ['char', 'skill_line_id'], newer: 'last_seen' },
  { table: 'skill_ups', pk: ['char', 'skill_line_id', 'observed_at', 'to_rank'] },
  { table: 'recipe_status', pk: ['recipe_id', 'build', 'char'], newer: 'seen_at' },
  {
    table: 'recipe_difficulty',
    pk: ['recipe_id', 'build', 'char', 'difficulty'],
    newer: 'updated_at',
  },
  { table: 'recipes_learned', pk: ['char', 'recipe_id', 'learned_at'] },
  { table: 'runs', pk: ['id'] },
];

/** alias key → canonical key, for one uploading account. */
export async function loadAliases(conn: Conn, account: string): Promise<Map<string, string>> {
  const rows = await conn
    .select()
    .from(characterAliases)
    .where(eq(characterAliases.account, account));
  return new Map(rows.map((r) => [r.aliasKey, r.canonicalKey]));
}

/** Accounts whose uploads carried a character record with this key (raw_uploads keeps every batch). */
export async function accountsOf(conn: Conn, key: string): Promise<string[]> {
  const res = await conn.execute<{ account: string }>(sql`
    select distinct account from raw_uploads
     where payload->'records'->'characters' @> ${JSON.stringify([{ key }])}::jsonb
     order by account`);
  return res.rows.map((r) => r.account);
}

/** "Name Surname-Realm" → "Name Surname", given the record's realm (a surname may hold a hyphen). */
export function nameOfKey(key: string, realm: string | undefined): string {
  if (realm && key.endsWith(`-${realm}`)) return key.slice(0, -(realm.length + 1));
  const i = key.lastIndexOf('-');
  return i < 0 ? key : key.slice(0, i);
}

/** Whether a key's name carries a surname (a space after the first name). */
export const hasSurname = (key: string, realm?: string) => nameOfKey(key, realm).includes(' ');

/**
 * The batch's records with every character key mapped through `aliases`. Acks are computed from the original records,
 * so the uploader's bookkeeping never sees the mapping.
 */
export function canonicalize(r: Records, aliases: Map<string, string>): Records {
  if (aliases.size === 0) return r;
  const map = (k: string) => aliases.get(k) ?? k;
  const withChar = <T extends { char: string }>(list: T[]) =>
    list.map((x) => (aliases.has(x.char) ? { ...x, char: map(x.char) } : x));
  // Two records of one character (a 0.3.4 short key and its full name in the same file) become one: known fields
  // fill each other, the full-name record's own values win.
  const byKey = new Map<string, Records['characters'][number]>();
  for (const c of r.characters) {
    const key = map(c.key);
    const mapped = key === c.key ? c : { ...c, key, name: nameOfKey(key, c.realm) };
    const prev = byKey.get(key);
    const own = key === c.key;
    const defined = (o: object) =>
      Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
    byKey.set(
      key,
      prev ? (own ? { ...prev, ...defined(mapped) } : { ...mapped, ...defined(prev) }) : mapped,
    );
  }
  return {
    ...r,
    characters: [...byKey.values()] as Records['characters'],
    questObservations: withChar(r.questObservations),
    turnIns: withChar(r.turnIns),
    skills: withChar(r.skills),
    skillUps: withChar(r.skillUps),
    recipeStatus: withChar(r.recipeStatus),
    recipeDifficulty: withChar(r.recipeDifficulty),
    recipesLearned: withChar(r.recipesLearned),
    fishingCasts: withChar(r.fishingCasts),
    gear: withChar(r.gear),
    objectiveProgress: withChar(r.objectiveProgress),
    charState: withChar(r.charState),
    trips: withChar(r.trips),
    runs: withChar(r.runs),
  };
}

export interface MergeResult {
  from: string;
  into: string;
  /** Rows moved to `into`, per table. */
  moved: Record<string, number>;
  /** Rows dropped because `into` already had the same row and it was as new, per table. */
  dropped: Record<string, number>;
  /** `into`'s own rows replaced by a newer row of `from`, per table. */
  replaced: Record<string, number>;
}

export class MergeRefused extends Error {}

/**
 * Moves every row of character `from` onto `into`, records `from` as an alias of `into` for `accounts` (the accounts
 * whose uploads used `from`), and deletes the `from` character (its known fields fill gaps in `into`). `into` is
 * created from `from` when it doesn't exist yet (a rename). Refused when `into` is itself an alias for one of those
 * accounts. The caller takes the run-group lock first (lockRunGroups), before writing anything: a merge moves runs.
 * Safe to run again: a second run finds nothing to move.
 */
export async function mergeCharacter(
  conn: Conn,
  from: string,
  into: string,
  reason: string,
  accounts: string[],
) {
  if (from === into) throw new MergeRefused('a character cannot be merged into itself');
  if (accounts.length === 0) throw new MergeRefused(`no account ever uploaded ${from}`);
  const intoIsAlias = await conn
    .select({ account: characterAliases.account })
    .from(characterAliases)
    .where(and(eq(characterAliases.aliasKey, into), inArray(characterAliases.account, accounts)));
  if (intoIsAlias.length > 0) throw new MergeRefused(`${into} is itself an alias`);
  const result: MergeResult = { from, into, moved: {}, dropped: {}, replaced: {} };
  const [src] = await conn.select().from(characters).where(eq(characters.key, from));
  const [dst] = await conn.select().from(characters).where(eq(characters.key, into));
  if (!dst) {
    const realm = src?.realm ?? into.slice(into.lastIndexOf('-') + 1);
    await conn.insert(characters).values({
      ...(src ?? {}),
      realm,
      key: into,
      name: nameOfKey(into, realm),
      guid: null,
    });
  }
  for (const { table, pk, newer, fill } of CHAR_TABLES) {
    const others = pk.filter((c) => c !== 'char');
    // A table keyed by the character alone (character_state) clashes on any row of `into`.
    const clash = others.length
      ? sql.raw(others.map((c) => `x."${c}" = t."${c}"`).join(' and '))
      : sql.raw('true');
    // A row without a time is the older one (as at ingest).
    const fromIsNewer = newer
      ? sql`coalesce(t.${sql.identifier(newer)}, '-infinity') > coalesce(x.${sql.identifier(newer)}, '-infinity')`
      : sql`false`;
    // The copy that stays keeps its own values and takes the other's where it has none.
    if (fill?.length) {
      const fillFrom = (keep: string, other: string) =>
        sql.raw(fill.map((c) => `"${c}" = coalesce(${keep}."${c}", ${other}."${c}")`).join(', '));
      await conn.execute(
        sql`update ${sql.identifier(table)} t set ${fillFrom('t', 'x')} from ${sql.identifier(table)} x
             where t.char = ${from} and x.char = ${into} and ${clash} and ${fromIsNewer}`,
      );
      await conn.execute(
        sql`update ${sql.identifier(table)} x set ${fillFrom('x', 't')} from ${sql.identifier(table)} t
             where t.char = ${from} and x.char = ${into} and ${clash} and not (${fromIsNewer})`,
      );
    }
    // Where `from` has the newer copy of a row, `into`'s older copy goes and `from`'s moves in its place.
    let replaced = 0;
    if (newer) {
      const res = await conn.execute(
        sql`delete from ${sql.identifier(table)} x using ${sql.identifier(table)} t
             where t.char = ${from} and x.char = ${into} and ${clash} and ${fromIsNewer}`,
      );
      replaced = res.rowCount ?? 0;
    }
    result.replaced[table] = replaced;
    const moved = await conn.execute(
      sql`update ${sql.identifier(table)} t set char = ${into}
           where t.char = ${from}
             and not exists (select 1 from ${sql.identifier(table)} x where x.char = ${into} and ${clash})`,
    );
    const dropped = await conn.execute(
      sql`delete from ${sql.identifier(table)} where char = ${from}`,
    );
    result.moved[table] = moved.rowCount ?? 0;
    result.dropped[table] = dropped.rowCount ?? 0;
  }
  if (src) {
    // `into`'s own values win; `from` fills what it doesn't know. The GUID moves after the delete (it is unique).
    await conn.delete(characters).where(eq(characters.key, from));
    await conn
      .update(characters)
      .set({
        class: sql`coalesce(${characters.class}, ${src.class})`,
        race: sql`coalesce(${characters.race}, ${src.race})`,
        faction: sql`coalesce(${characters.faction}, ${src.faction})`,
        level: sql`greatest(${characters.level}, ${src.level})`,
        lastSeen: sql`greatest(${characters.lastSeen}, ${src.lastSeen})`,
        guid: sql`coalesce(${characters.guid}, ${src.guid})`,
        firstName: sql`coalesce(${characters.firstName}, ${src.firstName})`,
        updatedAt: new Date(),
      })
      .where(eq(characters.key, into));
  }
  for (const account of accounts) {
    await conn
      .update(characterAliases)
      .set({ canonicalKey: into })
      .where(and(eq(characterAliases.account, account), eq(characterAliases.canonicalKey, from)));
    await conn
      .insert(characterAliases)
      .values({ account, aliasKey: from, canonicalKey: into, reason })
      .onConflictDoUpdate({
        target: [characterAliases.account, characterAliases.aliasKey],
        set: { canonicalKey: into, reason },
      });
  }
  return result;
}

export interface MergeSuggestion {
  from: string;
  into: string;
  why: string;
}

/**
 * Pairs that look like one character before and after build 70009: same realm, class and race, the short key's name is
 * the first word of the full one ("Sam" and "Sam Willikers"), and every account that uploaded the short key also
 * uploaded the full one. A short key that fits more than one full name, or two rows with different GUIDs, is left
 * out: that needs a person to decide.
 */
export async function suggestMerges(conn: Conn): Promise<MergeSuggestion[]> {
  const res = await conn.execute<{ from: string; into: string }>(sql`
    with pairs as (
      select s.key as from_key, f.key as into_key
        from characters s
        join characters f on f.realm = s.realm and f.key <> s.key
                         and f.class is not distinct from s.class and f.race is not distinct from s.race
                         and split_part(f.name, ' ', 1) = s.name and f.name like '% %'
                         and (s.guid is null or f.guid is null or s.guid = f.guid)
       where s.name not like '% %'),
    uploads as (
      select u.account, c->>'key' as key
        from raw_uploads u cross join lateral jsonb_array_elements(u.payload->'records'->'characters') c
       group by 1, 2)
    select p.from_key as from, p.into_key as into
      from pairs p
     where (select count(*) from pairs q where q.from_key = p.from_key) = 1
       and not exists (select 1 from uploads a where a.key = p.from_key
                         and not exists (select 1 from uploads b where b.key = p.into_key
                                           and b.account = a.account))
       and not exists (select 1 from character_aliases x where x.alias_key = p.from_key)
     order by 1`);
  return res.rows.map((r) => ({
    from: r.from,
    into: r.into,
    why: 'same realm, class and race, uploaded by the same accounts; the short name is the first word of the full name',
  }));
}
