// Anonymize a ForeverLedger SavedVariables file before committing it as a fixture.
// Usage: pnpm anonymize <in.lua> <out.lua>
// Character names and realms become Player1/Realm1… wherever the addon stores identities (keys, ids, char fields).
// The output is written in the same Lua table format WoW uses, so parser tests exercise it directly.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseSavedVariables } from '@forever-ledger/lua-sv-parser';
import type { LuaValue } from '@forever-ledger/lua-sv-parser';

type Obj = Record<string, LuaValue>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Every `Name-Realm` character key the addon recorded (chars table, `char` fields, meta.lastChar). */
function collectCharKeys(db: Obj) {
  const keys = new Set<string>();
  if (isObj(db.chars)) Object.keys(db.chars).forEach((k) => keys.add(k));
  const meta = isObj(db.meta) ? db.meta : {};
  if (isObj(meta.lastChar) && typeof meta.lastChar.name === 'string') {
    keys.add(`${meta.lastChar.name}-${String(meta.lastChar.realm ?? '')}`);
  }
  const walk = (v: LuaValue) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (isObj(v)) {
      if (typeof v.char === 'string' && v.char.includes('-')) keys.add(v.char);
      Object.values(v).forEach(walk);
    }
  };
  walk(db);
  return [...keys];
}

/**
 * Replaces character identities only where the addon stores them: `Name-Realm` compounds (keys, ids, `char`
 * fields) and the name/realm fields of character records. Free text is left alone, because realm names are
 * often ordinary words that also appear in item and zone names.
 */
export function anonymize(db: Obj): Obj {
  const aliases = new Map<string, { key: string; name: string; realm: string }>();
  const realmAlias = new Map<string, string>();
  collectCharKeys(db)
    .sort((a, b) => b.length - a.length)
    .forEach((key, i) => {
      const cut = key.indexOf('-');
      const realm = key.slice(cut + 1);
      if (!realmAlias.has(realm)) realmAlias.set(realm, `Realm${realmAlias.size + 1}`);
      const name = `Player${i + 1}`;
      aliases.set(key, {
        key: `${name}-${realmAlias.get(realm)}`,
        name,
        realm: realmAlias.get(realm)!,
      });
    });
  const byName = new Map([...aliases].map(([key, a]) => [key.slice(0, key.indexOf('-')), a]));

  // A `Name-Realm` token starts the string or follows ':' (quest observation keys are `build:stage:Name-Realm`),
  // and ends the string or is followed by '-' or ':' (run and turn-in ids append `-instance-epoch`).
  const patterns = [...aliases].map(
    ([from, a]) =>
      [
        new RegExp(`(^|:)${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[-:])`, 'g'),
        a.key,
      ] as const,
  );
  const scrub = (s: string) => patterns.reduce((acc, [re, to]) => acc.replace(re, `$1${to}`), s);
  const scrubIdentity = (c: Obj): Obj => {
    const a = typeof c.name === 'string' ? byName.get(c.name) : undefined;
    if (!a) return c;
    return { ...c, name: a.name, realm: a.realm };
  };
  const walk = (v: LuaValue, parentKey?: string): LuaValue => {
    if (typeof v === 'string') return scrub(v);
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (isObj(v)) {
      const out: Obj = {};
      for (const [k, x] of Object.entries(v)) out[scrub(k)] = walk(x, k);
      return parentKey === 'lastChar' || (isObj(db.chars) && Object.values(db.chars).includes(v))
        ? scrubIdentity(out)
        : out;
    }
    return v;
  };
  return walk(db) as Obj;
}

/** WoW-style SavedVariables writer: tabs, ["key"] = value, trailing commas, `-- [n]` on array items. */
export function toLua(name: string, value: LuaValue): string {
  const str = (s: string) =>
    '"' +
    s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r') +
    '"';
  const key = (k: string) => (/^-?\d+(\.\d+)?$/.test(k) ? `[${k}]` : `[${str(k)}]`);
  const write = (v: LuaValue, depth: number): string => {
    if (typeof v === 'string') return str(v);
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    const pad = '\t'.repeat(depth + 1);
    const close = '\t'.repeat(depth) + '}';
    if (Array.isArray(v)) {
      return `{\n${v.map((x, i) => `${pad}${write(x, depth + 1)}, -- [${i + 1}]\n`).join('')}${close}`;
    }
    return `{\n${Object.entries(v)
      .map(([k, x]) => `${pad}${key(k)} = ${write(x, depth + 1)},\n`)
      .join('')}${close}`;
  };
  return `\n${name} = ${write(value, 0)}\n`;
}

const [input, output] = process.argv.slice(2);
if (input && output) {
  const parsed = parseSavedVariables(readFileSync(input));
  const text = Object.entries(parsed)
    .map(([name, value]) => toLua(name, isObj(value) ? anonymize(value) : value))
    .join('');
  writeFileSync(output, text);
  console.log(`anonymized ${input} -> ${output}`);
} else if (process.argv[1]?.endsWith('anonymize-sv.ts')) {
  console.error('usage: pnpm anonymize <in.lua> <out.lua>');
  process.exitCode = 2;
}
