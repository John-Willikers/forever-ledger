import type { z } from 'zod';
import {
  Character,
  Drop,
  Item,
  ItemBuildSnapshot,
  Meta,
  Quest,
  QuestObservation,
  Run,
  SCHEMA_VERSION,
  TurnIn,
} from './schemas.js';
import type { Records, RecordKind } from './schemas.js';

/** Name of the addon's SavedVariables global. */
export const SAVED_VARIABLE = 'ForeverLedgerDB';

export class UnsupportedSchemaError extends Error {
  readonly found: unknown;
  constructor(found: unknown) {
    super(
      found === undefined
        ? 'SavedVariables has no schemaVersion (addon v0.1.0 data): log in once with Forever Ledger v0.2.0+ to migrate it'
        : `SavedVariables schemaVersion ${String(found)} is not supported (expected ${SCHEMA_VERSION})`,
    );
    this.name = 'UnsupportedSchemaError';
    this.found = found;
  }
}

export interface NormalizeProblem {
  kind: RecordKind;
  path: string;
  issues: string[];
}

export interface Normalized {
  meta: Meta;
  records: Records;
  problems: NormalizeProblem[];
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Entries of a Lua table keyed by id. The parser turns tables whose keys happen to be 1..n into arrays,
 * so arrays are read back as `{ "1": ..., "2": ... }`.
 */
function entries(v: unknown): [string, unknown][] {
  if (Array.isArray(v)) return v.map((x, i) => [String(i + 1), x]);
  if (isObj(v)) return Object.entries(v);
  return [];
}

/** Values of a Lua list. An empty table parses as `{}`; a sparse one as an object with numeric keys. */
function list(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (isObj(v)) {
    return Object.entries(v)
      .filter(([k]) => /^\d+$/.test(k))
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, x]) => x);
  }
  return [];
}

const num = (k: string) => {
  const n = Number(k);
  return Number.isFinite(n) ? n : undefined;
};

function splitCharKey(key: string) {
  const i = key.indexOf('-');
  return i < 0 ? { name: key, realm: '' } : { name: key.slice(0, i), realm: key.slice(i + 1) };
}

/**
 * Turns a parsed ForeverLedgerDB table into flat, validated records with natural keys.
 * Pass the value of `ForeverLedgerDB` (not the whole parse result). Records that fail validation are
 * reported in `problems` instead of failing the whole file.
 */
export function normalize(db: unknown): Normalized {
  if (!isObj(db)) throw new TypeError('ForeverLedgerDB is not a table');
  const rawMeta = isObj(db.meta) ? db.meta : {};
  if (rawMeta.schemaVersion !== SCHEMA_VERSION)
    throw new UnsupportedSchemaError(rawMeta.schemaVersion);
  const meta = Meta.parse(rawMeta);

  const records: Records = {
    characters: [],
    quests: [],
    questObservations: [],
    turnIns: [],
    items: [],
    itemSnapshots: [],
    drops: [],
    runs: [],
  };
  const problems: NormalizeProblem[] = [];

  function add<K extends RecordKind>(
    kind: K,
    schema: z.ZodType<Records[K][number]>,
    path: string,
    raw: unknown,
  ) {
    const res = schema.safeParse(raw);
    if (res.success) (records[kind] as unknown[]).push(res.data);
    else
      problems.push({
        kind,
        path,
        issues: res.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
      });
  }

  for (const [key, c] of entries(db.chars)) {
    const who = splitCharKey(key);
    add('characters', Character, `chars.${key}`, { ...who, ...(isObj(c) ? c : {}), key });
  }

  for (const [qid, q] of entries(db.quests)) {
    if (!isObj(q)) continue;
    const questId = num(qid);
    const { obs, id: _id, ...fields } = q;
    add('quests', Quest, `quests.${qid}`, { ...fields, questId });
    for (const [okey, o] of entries(obs)) {
      if (!isObj(o)) continue;
      add('questObservations', QuestObservation, `quests.${qid}.obs.${okey}`, {
        ...o,
        questId,
        choices: o.choices === undefined ? undefined : list(o.choices),
        rewards: o.rewards === undefined ? undefined : list(o.rewards),
      });
    }
  }

  list(db.turnIns).forEach((t, i) => {
    if (!isObj(t)) return;
    const { questID, runID, ...rest } = t;
    add('turnIns', TurnIn, `turnIns.${i + 1}`, { ...rest, questId: questID, runId: runID });
  });

  for (const [iid, it] of entries(db.items)) {
    if (!isObj(it)) continue;
    const itemId = num(iid);
    const { byBuild, id: _id, ...fields } = it;
    add('items', Item, `items.${iid}`, { ...fields, itemId });
    for (const [b, snap] of entries(byBuild)) {
      if (!isObj(snap)) continue;
      add('itemSnapshots', ItemBuildSnapshot, `items.${iid}.byBuild.${b}`, {
        ...snap,
        itemId,
        build: num(b),
        stats: isObj(snap.stats) ? snap.stats : {},
        tooltip: list(snap.tooltip),
      });
    }
  }

  for (const [iid, byBuild] of entries(db.drops)) {
    for (const [b, bySrc] of entries(byBuild)) {
      for (const [npc, count] of entries(bySrc)) {
        add('drops', Drop, `drops.${iid}.${b}.${npc}`, {
          itemId: num(iid),
          build: num(b),
          npcId: num(npc),
          count,
        });
      }
    }
  }

  list(db.runs).forEach((r, i) => {
    if (!isObj(r)) return;
    add('runs', Run, `runs.${i + 1}`, {
      ...r,
      bosses: list(r.bosses),
      loot: list(r.loot),
      party: list(r.party),
    });
  });

  return { meta, records, problems };
}
