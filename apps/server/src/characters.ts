// Character identity: build 70009 dropped the surname from UnitName, so addon 0.3.4 keyed "Sam Willikers" as
// "Sam-Realm". Addon 0.4.0 keys by full name again and sends the GUID. Aliases map old keys to their character;
// `mergeCharacter` moves an old key's rows onto the canonical key (characters-cli merge, or ingest when two keys
// share a GUID).
import type { Records } from '@forever-ledger/contracts';
import { eq, sql } from 'drizzle-orm';
import type { Db } from './db/client.js';
import { characterAliases, characters } from './db/schema.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Conn = Db | Tx;

/** Tables with a `char` column and their primary key (rows whose key would collide stay with the canonical row). */
export const CHAR_TABLES: readonly { table: string; pk: readonly string[] }[] = [
  { table: 'quest_observations', pk: ['quest_id', 'build', 'stage', 'char'] },
  { table: 'turn_ins', pk: ['id'] },
  { table: 'fishing_casts', pk: ['id'] },
  { table: 'skills', pk: ['char', 'skill_line_id'] },
  { table: 'skill_ups', pk: ['char', 'skill_line_id', 'observed_at', 'to_rank'] },
  { table: 'recipe_status', pk: ['recipe_id', 'build', 'char'] },
  { table: 'recipe_difficulty', pk: ['recipe_id', 'build', 'char', 'difficulty'] },
  { table: 'recipes_learned', pk: ['char', 'recipe_id', 'learned_at'] },
  { table: 'runs', pk: ['id'] },
];

/** alias key → canonical key. */
export async function loadAliases(conn: Conn): Promise<Map<string, string>> {
  const rows = await conn.select().from(characterAliases);
  return new Map(rows.map((r) => [r.aliasKey, r.canonicalKey]));
}

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
    const i = key.indexOf('-');
    const mapped = key === c.key ? c : { ...c, key, name: i < 0 ? key : key.slice(0, i) };
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
    runs: withChar(r.runs),
  };
}

export interface MergeResult {
  from: string;
  into: string;
  /** Rows moved to `into`, per table. */
  moved: Record<string, number>;
  /** Rows dropped because `into` already had the same row, per table. */
  dropped: Record<string, number>;
}

/**
 * Moves every row of character `from` onto `into`, records `from` as an alias, and deletes the `from` character
 * (its known fields fill gaps in `into`). `into` is created from `from` when it doesn't exist yet (a rename). Safe to
 * run again: a second run finds nothing to move.
 */
export async function mergeCharacter(conn: Conn, from: string, into: string, reason: string) {
  if (from === into) throw new Error('a character cannot be merged into itself');
  const result: MergeResult = { from, into, moved: {}, dropped: {} };
  const [src] = await conn.select().from(characters).where(eq(characters.key, from));
  const [dst] = await conn.select().from(characters).where(eq(characters.key, into));
  if (!dst) {
    const i = into.indexOf('-');
    await conn.insert(characters).values({
      ...(src ?? { realm: i < 0 ? '' : into.slice(i + 1) }),
      key: into,
      name: i < 0 ? into : into.slice(0, i),
      guid: null,
    });
  }
  for (const { table, pk } of CHAR_TABLES) {
    const others = pk.filter((c) => c !== 'char');
    const clash = others.length
      ? sql.raw(others.map((c) => `x."${c}" = t."${c}"`).join(' and '))
      : sql.raw('false');
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
    // `into`'s own values win; `from` fills what it doesn't know. The GUID moves last (it is unique).
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
        updatedAt: new Date(),
      })
      .where(eq(characters.key, into));
  }
  await conn
    .update(characterAliases)
    .set({ canonicalKey: into })
    .where(eq(characterAliases.canonicalKey, from));
  await conn
    .insert(characterAliases)
    .values({ aliasKey: from, canonicalKey: into, reason })
    .onConflictDoUpdate({ target: characterAliases.aliasKey, set: { canonicalKey: into, reason } });
  return result;
}

export interface MergeSuggestion {
  from: string;
  into: string;
  why: string;
}

/**
 * Pairs that look like one character before and after build 70009: same realm, class and race, and one key's name is
 * the first word of the other's ("Sam" and "Sam Willikers").
 */
export async function suggestMerges(conn: Conn): Promise<MergeSuggestion[]> {
  const res = await conn.execute<{ from: string; into: string }>(sql`
    select s.key as from, f.key as into
      from characters s
      join characters f on f.realm = s.realm and f.key <> s.key
                       and f.class is not distinct from s.class and f.race is not distinct from s.race
                       and split_part(f.name, ' ', 1) = s.name and f.name like '% %'
     where s.name not like '% %'
       and not exists (select 1 from character_aliases a where a.alias_key = s.key)
     order by 1`);
  return res.rows.map((r) => ({
    from: r.from,
    into: r.into,
    why: 'same realm, class and race; the short name is the first word of the full name',
  }));
}
