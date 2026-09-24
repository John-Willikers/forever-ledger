// Readers for uploaded jsonb (vendor items, trainer services, recipe reagents, node spots, locations). Contracts
// validate records at ingest, but a read route must never trust the stored shape: a value of the wrong type, an int out
// of int4 range or a fraction where an id belongs reads as null, and a non-array reads as an empty array, never a cast
// error (a 500). Postgres doesn't promise to short-circuit AND, so each type test guards its cast with its own CASE.
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { INT4_MAX } from '../addon.js';

const INT4_MIN = -INT4_MAX - 1;

/** An int4 from a jsonb number that is a whole number in int4 range, else null. */
export const jint = (e: SQL) => sql`(case when jsonb_typeof(${e}) = 'number' then
  case when (${e})::numeric between ${sql.raw(String(INT4_MIN))} and ${sql.raw(String(INT4_MAX))}
        and (${e})::numeric = trunc((${e})::numeric)
  then (${e})::numeric::int end end)`;

/** A float8 from a jsonb number (a fraction kept), else null. */
export const jnum = (e: SQL) => sql`(case when jsonb_typeof(${e}) = 'number' then
  case when abs((${e})::numeric) < 1e300 then (${e})::float8 end end)`;

/** Text from the jsonb string at `e->key`, else null. */
export const jtext = (e: SQL, key: string) => {
  if (!/^[A-Za-z]+$/.test(key)) throw new Error(`bad jsonb key ${key}`);
  const k = sql.raw(`'${key}'`);
  return sql`(case when jsonb_typeof(${e}->${k}) = 'string' then ${e}->>${k} end)`;
};

/** The jsonb array, or an empty one when the value is anything else (for `jsonb_array_elements`). */
export const jarr = (e: SQL) =>
  sql`(case when jsonb_typeof(${e}) = 'array' then ${e} else '[]'::jsonb end)`;

/** The length of a jsonb array, 0 for anything else. */
export const jlen = (e: SQL) =>
  sql`(case when jsonb_typeof(${e}) = 'array' then jsonb_array_length(${e}) else 0 end)`;

/** The item id of a `recipes_learned.via` of `item:<id>` when it fits int4, else null. */
export const viaItemId = (via: SQL) => sql`(case when ${via} ~ '^item:[0-9]{1,10}$' then
  case when substring(${via} from 6)::bigint <= ${sql.raw(String(INT4_MAX))}
  then substring(${via} from 6)::int end end)`;
