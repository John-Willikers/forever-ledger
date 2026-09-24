// Drizzle schema for the Forever Ledger database. Keep this file free of relative imports: drizzle-kit loads it
// directly. Times are timestamptz (converted from the addon's epoch seconds); sessions use America/Chicago.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const updatedAt = () => tz('updated_at').notNull().defaultNow();

/** Admin panel users (Battle.net login). `bnet_sub` is the stable account id; BattleTags can change. */
export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    bnetSub: text('bnet_sub').notNull().unique(),
    battletag: text('battletag').notNull(),
    role: text('role', { enum: ['admin', 'member'] })
      .notNull()
      .default('member'),
    createdAt: tz('created_at').notNull().defaultNow(),
    lastLoginAt: tz('last_login_at'),
  },
  (t) => [check('users_role_check', sql`${t.role} in ('admin', 'member')`)],
);

/** Admin panel sessions. `id` is the sha256 of the random cookie value; the value itself is never stored. */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: tz('created_at').notNull().defaultNow(),
    expiresAt: tz('expires_at').notNull(),
    lastSeenAt: tz('last_seen_at').notNull().defaultNow(),
    userAgent: text('user_agent'),
    ip: text('ip'),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const apiTokens = pgTable('api_tokens', {
  id: serial('id').primaryKey(),
  label: text('label').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: tz('created_at').notNull().defaultNow(),
  revokedAt: tz('revoked_at'),
  lastUsedAt: tz('last_used_at'),
  /** Owner of the token (characters uploaded with it belong to this user). */
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  /**
   * Read scope: may also read every /v1 read route (analysis, export, diagnostics) with this token. Off by default:
   * an upload token only ingests, reports errors and fetches the addon manifest.
   */
  canRead: boolean('can_read').notNull().default(false),
});

export const rawUploads = pgTable(
  'raw_uploads',
  {
    id: serial('id').primaryKey(),
    tokenId: integer('token_id').references(() => apiTokens.id),
    uploaderId: text('uploader_id').notNull(),
    account: text('account').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    clientBuild: integer('client_build').notNull(),
    recordCount: integer('record_count').notNull(),
    receivedAt: tz('received_at').notNull().defaultNow(),
    payload: jsonb('payload').notNull(),
  },
  (t) => [index('raw_uploads_received_idx').on(t.receivedAt)],
);

export const builds = pgTable('builds', {
  build: integer('build').primaryKey(),
  version: text('version'),
  interface: integer('interface'),
  firstSeen: tz('first_seen').notNull().defaultNow(),
  lastSeen: tz('last_seen').notNull().defaultNow(),
});

export const characters = pgTable('characters', {
  key: text('key').primaryKey(), // Name-Realm
  name: text('name').notNull(),
  realm: text('realm').notNull(),
  class: text('class'),
  race: text('race'),
  faction: text('faction'),
  level: integer('level'),
  lastSeen: tz('last_seen'),
  updatedAt: updatedAt(),
});

export const quests = pgTable('quests', {
  questId: integer('quest_id').primaryKey(),
  title: text('title'),
  level: integer('level'),
  category: text('category'),
  suggestedGroup: integer('suggested_group'),
  objectives: jsonb('objectives').$type<string[]>(),
  updatedAt: updatedAt(),
});

export const questObservations = pgTable(
  'quest_observations',
  {
    questId: integer('quest_id').notNull(),
    build: integer('build').notNull(),
    stage: text('stage').notNull(),
    char: text('char').notNull(),
    level: integer('level'),
    observedAt: tz('observed_at'),
    xp: integer('xp'),
    money: integer('money'),
    npcId: integer('npc_id'),
    npcName: text('npc_name'),
    npcLoc: jsonb('npc_loc'),
    loc: jsonb('loc'),
    choices: jsonb('choices'),
    rewards: jsonb('rewards'),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.questId, t.build, t.stage, t.char] })],
);

export const questRewardOptions = pgTable(
  'quest_reward_options',
  {
    questId: integer('quest_id').notNull(),
    build: integer('build').notNull(),
    itemId: integer('item_id').notNull(),
    kind: text('kind').notNull(), // 'choice' | 'reward'
    count: integer('count').notNull(),
  },
  (t) => [primaryKey({ columns: [t.questId, t.build, t.itemId, t.kind] })],
);

export const turnIns = pgTable(
  'turn_ins',
  {
    id: text('id').primaryKey(),
    questId: integer('quest_id').notNull(),
    build: integer('build').notNull(),
    char: text('char').notNull(),
    xp: integer('xp'),
    money: integer('money'),
    level: integer('level'),
    turnedInAt: tz('turned_in_at').notNull(),
    runId: text('run_id'),
    /** Schema 2: the picked reward (1-based index into the complete-stage choices). Null when none or unknown. */
    choiceIndex: integer('choice_index'),
    choiceItemId: integer('choice_item_id'),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('turn_ins_quest_idx').on(t.questId, t.build),
    index('turn_ins_run_idx').on(t.runId),
  ],
);

export const items = pgTable('items', {
  itemId: integer('item_id').primaryKey(),
  name: text('name').notNull(),
  quality: integer('quality'),
  type: text('type'),
  subtype: text('subtype'),
  equipLoc: text('equip_loc'),
  /** Schema 4: C_Item.GetItemInfo item class (9 = Recipe) and subclass. */
  classId: integer('class_id'),
  subclassId: integer('subclass_id'),
  updatedAt: updatedAt(),
});

export const itemSnapshots = pgTable(
  'item_snapshots',
  {
    itemId: integer('item_id').notNull(),
    build: integer('build').notNull(),
    link: text('link'),
    ilvl: integer('ilvl'),
    reqLevel: integer('req_level'),
    sellPrice: integer('sell_price'),
    stats: jsonb('stats').$type<Record<string, number>>().notNull(),
    tooltip: jsonb('tooltip').$type<string[]>().notNull(),
    firstSeen: tz('first_seen'),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.build] })],
);

/**
 * Totals per SavedVariables session (uploader + WoW account + session): upserts set the count, never add.
 * Schema 1/2 files have session '' (one running total per file).
 */
export const drops = pgTable(
  'drops',
  {
    itemId: integer('item_id').notNull(),
    build: integer('build').notNull(),
    npcId: integer('npc_id').notNull(),
    uploaderId: text('uploader_id').notNull(),
    account: text('account').notNull(),
    session: text('session').notNull().default(''),
    count: integer('count').notNull(),
    /** Schema 3: total stack quantity. Null for older files. */
    quantity: integer('quantity'),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.build, t.npcId, t.uploaderId, t.account, t.session] }),
    index('drops_npc_idx').on(t.npcId),
  ],
);

/** Schema 3: loot sources looted per npc and session, with the copper their money slots held. Set, never added. */
export const corpses = pgTable(
  'corpses',
  {
    npcId: integer('npc_id').notNull(),
    build: integer('build').notNull(),
    uploaderId: text('uploader_id').notNull(),
    account: text('account').notNull(),
    session: text('session').notNull(),
    count: integer('count').notNull(),
    copper: integer('copper').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.npcId, t.build, t.uploaderId, t.account, t.session] }),
    index('corpses_build_idx').on(t.build),
  ],
);

// Schema 4: professions.

/** A character's skill line as last seen (upload with the newest `last_seen` wins). */
export const skills = pgTable(
  'skills',
  {
    char: text('char').notNull(),
    skillLineId: integer('skill_line_id').notNull(),
    name: text('name').notNull(),
    rank: integer('rank').notNull(),
    maxRank: integer('max_rank').notNull(),
    modifier: integer('modifier'),
    parentId: integer('parent_id'),
    lastSeen: tz('last_seen').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.char, t.skillLineId] })],
);

export const skillUps = pgTable(
  'skill_ups',
  {
    char: text('char').notNull(),
    skillLineId: integer('skill_line_id').notNull(),
    fromRank: integer('from_rank').notNull(),
    toRank: integer('to_rank').notNull(),
    build: integer('build').notNull(),
    observedAt: tz('observed_at').notNull(),
    /** The craft or gather within 5 s before the rank change, if any. */
    recipeId: integer('recipe_id'),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.char, t.skillLineId, t.observedAt, t.toRank] })],
);

/** Static recipe facts; ingest keeps known values when a later upload leaves them blank. */
export const recipes = pgTable(
  'recipes',
  {
    recipeId: integer('recipe_id').primaryKey(),
    name: text('name').notNull(),
    skillLineId: integer('skill_line_id'),
    categoryId: integer('category_id'),
    updatedAt: updatedAt(),
  },
  (t) => [index('recipes_skill_line_idx').on(t.skillLineId)],
);

export const recipeSnapshots = pgTable(
  'recipe_snapshots',
  {
    recipeId: integer('recipe_id').notNull(),
    build: integer('build').notNull(),
    outputItemId: integer('output_item_id'),
    qtyMin: integer('qty_min'),
    qtyMax: integer('qty_max'),
    reagents: jsonb('reagents').$type<{ itemId: number; qty: number }[]>().notNull(),
    maxTrivial: integer('max_trivial'),
    sourceText: text('source_text'),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.recipeId, t.build] })],
);

/** A character's recipe list entry, the last time it was scanned in a build (newest `seen_at` wins). */
export const recipeStatus = pgTable(
  'recipe_status',
  {
    recipeId: integer('recipe_id').notNull(),
    build: integer('build').notNull(),
    char: text('char').notNull(),
    learned: boolean('learned').notNull(),
    difficulty: text('difficulty'),
    rank: integer('rank'),
    seenAt: tz('seen_at').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.recipeId, t.build, t.char] })],
);

/**
 * Skill ranks at which a character saw a recipe at a difficulty. Every SavedVariables session starts empty, so ingest
 * widens the stored range (least/greatest) instead of replacing it.
 */
export const recipeDifficulty = pgTable(
  'recipe_difficulty',
  {
    recipeId: integer('recipe_id').notNull(),
    build: integer('build').notNull(),
    char: text('char').notNull(),
    difficulty: text('difficulty').notNull(),
    minRank: integer('min_rank').notNull(),
    maxRank: integer('max_rank').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.recipeId, t.build, t.char, t.difficulty] })],
);

export const recipesLearned = pgTable(
  'recipes_learned',
  {
    char: text('char').notNull(),
    recipeId: integer('recipe_id').notNull(),
    build: integer('build').notNull(),
    learnedAt: tz('learned_at').notNull(),
    /** `trainer:<npcID>`, `item:<itemID>` or `unknown`. */
    via: text('via').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.char, t.recipeId, t.learnedAt] }),
    index('recipes_learned_recipe_idx').on(t.recipeId),
  ],
);

/** Craft counters per recipe and SavedVariables session (uploader + account + session). Set, never added. */
export const crafts = pgTable(
  'crafts',
  {
    recipeId: integer('recipe_id').notNull(),
    build: integer('build').notNull(),
    uploaderId: text('uploader_id').notNull(),
    account: text('account').notNull(),
    session: text('session').notNull(),
    casts: integer('casts').notNull(),
    qty: integer('qty').notNull(),
    procs: integer('procs').notNull(),
    skillUps: integer('skill_ups').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.recipeId, t.build, t.uploaderId, t.account, t.session] })],
);

/** Gathering per game object and session (fishing = object 0). `spots` is NodeSpots[]. Set, never added. */
export const nodes = pgTable(
  'nodes',
  {
    objectId: integer('object_id').notNull(),
    build: integer('build').notNull(),
    uploaderId: text('uploader_id').notNull(),
    account: text('account').notNull(),
    session: text('session').notNull(),
    opened: integer('opened').notNull(),
    name: text('name'),
    rankMin: integer('rank_min'),
    skillLineId: integer('skill_line_id'),
    spots: jsonb('spots').$type<{ mapId: number; points: [number, number][] }[]>().notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.objectId, t.build, t.uploaderId, t.account, t.session] }),
    index('nodes_build_idx').on(t.build),
  ],
);

/** Per session: loot windows of an object that held the item, and their total stack quantity. */
export const nodeLoot = pgTable(
  'node_loot',
  {
    itemId: integer('item_id').notNull(),
    objectId: integer('object_id').notNull(),
    build: integer('build').notNull(),
    uploaderId: text('uploader_id').notNull(),
    account: text('account').notNull(),
    session: text('session').notNull(),
    count: integer('count').notNull(),
    quantity: integer('quantity').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({
      columns: [t.itemId, t.objectId, t.build, t.uploaderId, t.account, t.session],
    }),
    index('node_loot_object_idx').on(t.objectId, t.build),
  ],
);

/**
 * A trainer's services (TrainerService[]) in one build. A complete scan replaces the list, any other merges into it by
 * service name; `complete` says some scan saw the whole list. An older scan never overwrites a newer one. `title` is
 * the subtitle under the NPC's name (schema 5); a scan without one keeps the known title.
 */
export const trainers = pgTable(
  'trainers',
  {
    npcId: integer('npc_id').notNull(),
    build: integer('build').notNull(),
    name: text('name'),
    title: text('title'),
    loc: jsonb('loc'),
    skillLineId: integer('skill_line_id'),
    seenAt: tz('seen_at').notNull(),
    complete: boolean('complete').notNull().default(false),
    services: jsonb('services').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.npcId, t.build] })],
);

/**
 * A vendor's items (VendorItem[], schema 5 items carry their extended `costs`) in one build; the newest scan replaces
 * the row, except `title` (the NPC's subtitle, schema 5): a scan without one keeps the known title.
 */
export const vendors = pgTable(
  'vendors',
  {
    npcId: integer('npc_id').notNull(),
    build: integer('build').notNull(),
    name: text('name'),
    title: text('title'),
    loc: jsonb('loc'),
    seenAt: tz('seen_at').notNull(),
    items: jsonb('items').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.npcId, t.build] })],
);

/** First result of a client API per build, to check real field names without asking for files. */
export const apiSamples = pgTable(
  'api_samples',
  {
    api: text('api').notNull(),
    build: integer('build').notNull(),
    observedAt: tz('observed_at').notNull(),
    sample: jsonb('sample').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.api, t.build] })],
);

export const runs = pgTable(
  'runs',
  {
    id: text('id').primaryKey(),
    build: integer('build').notNull(),
    char: text('char').notNull(),
    charLevel: integer('char_level'),
    instance: text('instance'),
    instanceId: integer('instance_id').notNull(),
    difficulty: integer('difficulty'),
    maxPlayers: integer('max_players'),
    startedAt: tz('started_at').notNull(),
    finishedAt: tz('finished_at'),
    endReason: text('end_reason'),
    awaySecs: integer('away_secs').notNull(),
    activeSecs: integer('active_secs'),
    xpTotal: integer('xp_total').notNull(),
    questXp: integer('quest_xp').notNull(),
    mobXp: integer('mob_xp'),
    deaths: integer('deaths').notNull(),
    loot: jsonb('loot').$type<{ itemID: number; npcID: number }[]>().notNull(),
    /** Schema 3: lower-cased Enum.LootMethod key (or the raw value) from C_PartyInfo.GetLootMethod. */
    lootMethod: text('loot_method'),
    /** Schema 3: RunBossLoot[] (C_LootHistory drops, winners and rolls by class). */
    bossLoot: jsonb('boss_loot'),
    /** Schema 3: RunGroupLoot[] (CHAT_MSG_LOOT lines while grouped, by class). */
    groupLoot: jsonb('group_loot'),
    /**
     * The run group (one shared dungeon run uploaded by several characters): the id of the group's earliest run, its
     * own id when nobody else's run matched. Set by ingest (src/runGroups.ts); null only before the startup backfill.
     */
    groupId: text('group_id'),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('runs_instance_idx').on(t.instanceId, t.build),
    index('runs_group_idx').on(t.groupId),
  ],
);

export const runBosses = pgTable(
  'run_bosses',
  {
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    ord: integer('ord').notNull(),
    encounterId: integer('encounter_id'),
    name: text('name'),
    killed: boolean('killed').notNull(),
    atSecs: integer('at_secs').notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.ord] })],
);

export const runParty = pgTable(
  'run_party',
  {
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    slot: integer('slot').notNull(),
    class: text('class'),
    level: integer('level'),
  },
  (t) => [primaryKey({ columns: [t.runId, t.slot] })],
);

/** Addon releases the manifest route can hand out; `url` is always the GitHub release asset. */
export const addonReleases = pgTable('addon_releases', {
  version: text('version').primaryKey(),
  url: text('url').notNull(),
  sha256: text('sha256').notNull(),
  size: integer('size').notNull(),
  status: text('status', { enum: ['active', 'yanked'] })
    .notNull()
    .default('active'),
  publishedAt: tz('published_at').notNull().defaultNow(),
});

/** Client builds [buildMin, buildMax] (buildMax null = open-ended) that must run a given addon version. */
export const addonPins = pgTable('addon_pins', {
  id: serial('id').primaryKey(),
  buildMin: integer('build_min').notNull(),
  buildMax: integer('build_max'),
  version: text('version')
    .notNull()
    .references(() => addonReleases.version),
  createdAt: tz('created_at').notNull().defaultNow(),
});

/** Error reports from the tray app (POST /v1/diagnostics), one row per event. Never holds a token. */
export const diagnostics = pgTable(
  'diagnostics',
  {
    id: serial('id').primaryKey(),
    tokenId: integer('token_id').references(() => apiTokens.id),
    uploaderId: text('uploader_id').notNull(),
    appVersion: text('app_version').notNull(),
    platform: text('platform').notNull(),
    level: text('level').notNull(),
    source: text('source').notNull(),
    message: text('message').notNull(),
    detail: jsonb('detail'),
    /** When it happened on the reporting PC. */
    occurredAt: tz('occurred_at').notNull(),
    receivedAt: tz('received_at').notNull().defaultNow(),
  },
  (t) => [index('diagnostics_received_idx').on(t.receivedAt)],
);

/** Ingest requests the server refused (400 invalid batch, 409 unsupported schema). Never holds a token. */
export const ingestErrors = pgTable(
  'ingest_errors',
  {
    id: serial('id').primaryKey(),
    tokenId: integer('token_id').references(() => apiTokens.id),
    uploaderId: text('uploader_id'),
    account: text('account'),
    schemaVersion: integer('schema_version'),
    status: integer('status').notNull(),
    error: text('error').notNull(),
    issues: jsonb('issues'),
    receivedAt: tz('received_at').notNull().defaultNow(),
  },
  (t) => [index('ingest_errors_received_idx').on(t.receivedAt)],
);
