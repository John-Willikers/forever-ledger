import type { z } from 'zod';
import {
  ApiSample,
  Character,
  Corpse,
  Craft,
  Drop,
  GatherNode,
  Item,
  ItemBuildSnapshot,
  Meta,
  NodeLoot,
  Quest,
  QuestObservation,
  Recipe,
  RecipeDifficulty,
  RecipeLearned,
  RecipeSnapshot,
  RecipeStatus,
  Run,
  isSupportedSchemaVersion,
  Skill,
  SkillUp,
  SUPPORTED_SCHEMA_VERSIONS,
  Trainer,
  TurnIn,
  Vendor,
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
        : `SavedVariables schemaVersion ${String(found)} is not supported (expected ${SUPPORTED_SCHEMA_VERSIONS.join(' or ')})`,
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

/** `t[k]` for a Lua table read back as an object or (keys 1..n) an array. */
function child(t: unknown, k: string): unknown {
  if (Array.isArray(t)) return /^\d+$/.test(k) ? t[Number(k) - 1] : undefined;
  return isObj(t) ? t[k] : undefined;
}

const num = (k: string) => {
  const n = Number(k);
  return Number.isFinite(n) ? n : undefined;
};

/** Addon spells ids `itemID` / `encounterID`; records use `itemId` / `encounterId`. */
function toBossLoot(v: unknown) {
  if (!isObj(v)) return v;
  const { encounterID, itemID, rolls, ...rest } = v;
  return { ...rest, encounterId: encounterID, itemId: itemID, rolls: list(rolls) };
}

function toGroupLoot(v: unknown) {
  if (!isObj(v)) return v;
  const { itemID, ...rest } = v;
  return { ...rest, itemId: itemID };
}

/** Rename `<x>ID` fields to `<x>Id` (one level), the contracts spelling. */
function idsToCamel(v: unknown) {
  if (!isObj(v)) return v;
  const out: Obj = {};
  for (const [k, x] of Object.entries(v)) out[k.endsWith('ID') ? `${k.slice(0, -2)}Id` : k] = x;
  return out;
}

/** Node spots `{ [mapID] = { "x,y", ... } }` → `[{ mapId, points: [[x, y], ...] }]`; unreadable points are skipped. */
function toSpots(v: unknown) {
  return entries(v).map(([mapId, pts]) => ({
    mapId: num(mapId),
    points: list(pts)
      .map((p) => (typeof p === 'string' ? p.split(',').map(Number) : []))
      .filter((xy): xy is [number, number] => xy.length === 2 && xy.every(Number.isFinite))
      // The addon caps spots at 50 per map; a longer list keeps its first 50 instead of losing the node.
      .slice(0, 50),
  }));
}

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
  if (!isSupportedSchemaVersion(rawMeta.schemaVersion))
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
    corpses: [],
    skills: [],
    skillUps: [],
    recipes: [],
    recipeSnapshots: [],
    recipeStatus: [],
    recipeDifficulty: [],
    recipesLearned: [],
    crafts: [],
    nodes: [],
    nodeLoot: [],
    trainers: [],
    vendors: [],
    apiSamples: [],
    runs: [],
  };
  // Schema 3 sessions; schema 1/2 files are one running total per file, keyed by session ''.
  const session = meta.session ?? '';
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
    const { questID, runID, choice, ...rest } = t;
    add('turnIns', TurnIn, `turnIns.${i + 1}`, {
      ...rest,
      questId: questID,
      runId: runID,
      // SV spells it itemID like every other addon field; records use itemId.
      choice: isObj(choice) ? { index: choice.index, itemId: choice.itemID } : undefined,
    });
  });

  for (const [iid, it] of entries(db.items)) {
    if (!isObj(it)) continue;
    const itemId = num(iid);
    const { byBuild, id: _id, ...fields } = it;
    // Schema 4 adds classID / subclassID.
    add('items', Item, `items.${iid}`, { ...(idsToCamel(fields) as Obj), itemId });
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
          session,
          count,
          quantity: child(child(child(db.dropQty, iid), b), npc),
        });
      }
    }
  }

  for (const [b, byNpc] of entries(db.corpses)) {
    for (const [npc, c] of entries(byNpc)) {
      if (!isObj(c)) continue;
      add('corpses', Corpse, `corpses.${b}.${npc}`, {
        npcId: num(npc),
        build: num(b),
        session,
        count: c.n,
        copper: c.copper ?? 0,
      });
    }
  }

  // Schema 4: professions. Older files simply have none of these tables.
  for (const [char, byLine] of entries(db.skills)) {
    for (const [line, sk] of entries(byLine)) {
      if (!isObj(sk)) continue;
      add('skills', Skill, `skills.${char}.${line}`, {
        ...(idsToCamel(sk) as Obj),
        char,
        skillLineId: num(line),
      });
    }
  }

  list(db.skillUps).forEach((u, i) => {
    if (isObj(u)) add('skillUps', SkillUp, `skillUps.${i + 1}`, idsToCamel(u));
  });

  for (const [rid, rec] of entries(db.recipes)) {
    if (!isObj(rec)) continue;
    const recipeId = num(rid);
    const { byBuild, id: _id, ...fields } = rec;
    add('recipes', Recipe, `recipes.${rid}`, { ...(idsToCamel(fields) as Obj), recipeId });
    for (const [b, snap] of entries(byBuild)) {
      if (!isObj(snap)) continue;
      const { reagents, ...rest } = snap;
      add('recipeSnapshots', RecipeSnapshot, `recipes.${rid}.byBuild.${b}`, {
        ...(idsToCamel(rest) as Obj),
        recipeId,
        build: num(b),
        reagents: list(reagents).map(idsToCamel),
      });
    }
  }

  for (const [b, byChar] of entries(db.recipeSeen)) {
    for (const [char, byRecipe] of entries(byChar)) {
      for (const [rid, seen] of entries(byRecipe)) {
        if (!isObj(seen)) continue;
        const path = `recipeSeen.${b}.${char}.${rid}`;
        const ids = { recipeId: num(rid), build: num(b), char };
        const { byDifficulty, ...status } = seen;
        add('recipeStatus', RecipeStatus, path, { ...status, ...ids });
        for (const [difficulty, range] of entries(byDifficulty)) {
          if (!isObj(range)) continue;
          add('recipeDifficulty', RecipeDifficulty, `${path}.byDifficulty.${difficulty}`, {
            ...ids,
            difficulty,
            minRank: range.minRank,
            maxRank: range.maxRank,
          });
        }
      }
    }
  }

  list(db.learned).forEach((l, i) => {
    if (isObj(l)) add('recipesLearned', RecipeLearned, `learned.${i + 1}`, idsToCamel(l));
  });

  // Per-session counters: a counter the addon never bumped reads as 0.
  for (const [b, byRecipe] of entries(db.crafts)) {
    for (const [rid, c] of entries(byRecipe)) {
      if (!isObj(c)) continue;
      add('crafts', Craft, `crafts.${b}.${rid}`, {
        recipeId: num(rid),
        build: num(b),
        session,
        casts: c.casts ?? 0,
        qty: c.qty ?? 0,
        procs: c.procs ?? 0,
        skillUps: c.skillUps ?? 0,
      });
    }
  }

  for (const [b, byObject] of entries(db.nodes)) {
    for (const [oid, n] of entries(byObject)) {
      if (!isObj(n)) continue;
      const { spots, ...rest } = n;
      add('nodes', GatherNode, `nodes.${b}.${oid}`, {
        ...(idsToCamel(rest) as Obj),
        objectId: num(oid),
        build: num(b),
        session,
        opened: n.opened ?? 0,
        spots: toSpots(spots),
      });
    }
  }

  for (const [iid, byBuild] of entries(db.nodeLoot)) {
    for (const [b, byObject] of entries(byBuild)) {
      for (const [oid, l] of entries(byObject)) {
        if (!isObj(l)) continue;
        add('nodeLoot', NodeLoot, `nodeLoot.${iid}.${b}.${oid}`, {
          itemId: num(iid),
          objectId: num(oid),
          build: num(b),
          session,
          count: l.n,
          quantity: l.qty,
        });
      }
    }
  }

  for (const [b, byNpc] of entries(db.trainers)) {
    for (const [npc, t] of entries(byNpc)) {
      if (!isObj(t)) continue;
      const { services, ...rest } = t;
      add('trainers', Trainer, `trainers.${b}.${npc}`, {
        ...(idsToCamel(rest) as Obj),
        npcId: num(npc),
        build: num(b),
        services: list(services).map(idsToCamel),
      });
    }
  }

  for (const [b, byNpc] of entries(db.vendors)) {
    for (const [npc, v] of entries(byNpc)) {
      if (!isObj(v)) continue;
      const { items, ...rest } = v;
      add('vendors', Vendor, `vendors.${b}.${npc}`, {
        ...rest,
        npcId: num(npc),
        build: num(b),
        items: list(items).map(idsToCamel),
      });
    }
  }

  for (const [api, s] of entries(db.apiSamples)) {
    if (!isObj(s)) continue;
    add('apiSamples', ApiSample, `apiSamples.${api}`, {
      api,
      build: s.build,
      time: s.time,
      sample: s.sample,
    });
  }

  list(db.runs).forEach((r, i) => {
    if (!isObj(r)) return;
    const { bossLoot, groupLoot, ...rest } = r;
    add('runs', Run, `runs.${i + 1}`, {
      ...rest,
      bosses: list(r.bosses),
      loot: list(r.loot),
      party: list(r.party),
      bossLoot: bossLoot === undefined ? undefined : list(bossLoot).map(toBossLoot),
      groupLoot: groupLoot === undefined ? undefined : list(groupLoot).map(toGroupLoot),
    });
  });

  return { meta, records, problems };
}
