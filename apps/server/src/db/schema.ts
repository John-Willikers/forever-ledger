// Drizzle schema for the Forever Ledger database. Keep this file free of relative imports: drizzle-kit loads it
// directly. Times are timestamptz (converted from the addon's epoch seconds); sessions use America/Chicago.
import {
  boolean,
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

export const apiTokens = pgTable('api_tokens', {
  id: serial('id').primaryKey(),
  label: text('label').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: tz('created_at').notNull().defaultNow(),
  revokedAt: tz('revoked_at'),
  lastUsedAt: tz('last_used_at'),
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
    updatedAt: updatedAt(),
  },
  (t) => [index('runs_instance_idx').on(t.instanceId, t.build)],
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
