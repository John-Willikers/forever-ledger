import { z } from 'zod';

/** SavedVariables / upload schema major. Bump together with `SCHEMA_VERSION` in the addon. */
export const SCHEMA_VERSION = 5;

/**
 * Schema majors this code reads. Each one is additive, so older files and queued older batches stay valid:
 * 2 adds `turnIns[].choice` (addon 0.2.3); 3 adds `meta.session`, `dropQty`, `corpses` and run loot details
 * (addon 0.2.4); 4 adds professions — skills, recipes, crafts, gathering nodes, trainers, vendors, API samples and
 * `items[].classID/subclassID` (addon 0.3.0); 5 adds vendor and trainer `title` (the NPC's subtitle) and vendor item
 * `costs` (extended costs paid in items or currencies) (addon 0.3.3).
 */
export const SUPPORTED_SCHEMA_VERSIONS = [1, 2, 3, 4, 5] as const;
export type SchemaVersion = (typeof SUPPORTED_SCHEMA_VERSIONS)[number];

export const isSupportedSchemaVersion = (v: unknown): v is SchemaVersion =>
  (SUPPORTED_SCHEMA_VERSIONS as readonly unknown[]).includes(v);

const schemaVersion = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

/** Schema 3 `meta.session`: `<epoch>-<4 hex>`, one per SavedVariables table. '' for older files. */
const session = z.string().max(64);

const int = z.number().int();
const nonNegInt = int.nonnegative();
const epochSecs = nonNegInt;
const build = nonNegInt;
/** `Name-Realm`, the addon's character key. */
const charKey = z.string().min(1).max(128);

export const Location = z.object({
  zone: z.string().optional(),
  subzone: z.string().optional(),
  mapID: int.optional(),
  x: z.number().optional(),
  y: z.number().optional(),
});
export type Location = z.infer<typeof Location>;

export const Npc = z.object({
  name: z.string().optional(),
  id: nonNegInt.optional(),
  loc: Location.optional(),
});
export type Npc = z.infer<typeof Npc>;

export const RewardItem = z.object({
  itemID: nonNegInt,
  count: nonNegInt.optional(),
});
export type RewardItem = z.infer<typeof RewardItem>;

export const Meta = z.object({
  schemaVersion,
  addonVersion: z.string(),
  build,
  version: z.string().optional(),
  buildDate: z.string().optional(),
  interface: nonNegInt.optional(),
  /** Schema 3: identifies this SavedVariables table. Per-session counters (drops, corpses) are totals for it. */
  session: session.optional(),
});
export type Meta = z.infer<typeof Meta>;

export const Character = z.object({
  key: charKey,
  name: z.string(),
  realm: z.string(),
  class: z.string().optional(),
  race: z.string().optional(),
  faction: z.string().optional(),
  level: nonNegInt.optional(),
  lastSeen: epochSecs.optional(),
});
export type Character = z.infer<typeof Character>;

export const Quest = z.object({
  questId: nonNegInt,
  title: z.string().optional(),
  level: int.optional(),
  category: z.string().optional(),
  suggestedGroup: nonNegInt.optional(),
  objectives: z.array(z.string()).optional(),
});
export type Quest = z.infer<typeof Quest>;

export const QuestStage = z.enum(['detail', 'accept', 'complete', 'log']);
export type QuestStage = z.infer<typeof QuestStage>;

export const QuestObservation = z.object({
  questId: nonNegInt,
  build,
  stage: QuestStage,
  char: charKey,
  level: nonNegInt.optional(),
  time: epochSecs.optional(),
  xp: nonNegInt.optional(),
  money: nonNegInt.optional(),
  npc: Npc.optional(),
  loc: Location.optional(),
  choices: z.array(RewardItem).optional(),
  rewards: z.array(RewardItem).optional(),
});
export type QuestObservation = z.infer<typeof QuestObservation>;

/** Derived server-side from observations: one row per quest, build and reward item. */
export const QuestRewardOption = z.object({
  questId: nonNegInt,
  build,
  itemId: nonNegInt,
  kind: z.enum(['choice', 'reward']),
  count: nonNegInt,
});
export type QuestRewardOption = z.infer<typeof QuestRewardOption>;

export const TurnInChoice = z.object({
  index: int.min(1),
  itemId: int.positive(),
});
export type TurnInChoice = z.infer<typeof TurnInChoice>;

export const TurnIn = z.object({
  id: z.string().min(1).max(256),
  questId: nonNegInt,
  build,
  char: charKey,
  xp: nonNegInt.optional(),
  money: nonNegInt.optional(),
  level: nonNegInt.optional(),
  time: epochSecs,
  runId: z.string().max(256).optional(),
  /** Schema 2: the reward the player picked (1-based index into the complete-stage `choices`). */
  choice: TurnInChoice.optional(),
});
export type TurnIn = z.infer<typeof TurnIn>;

export const Item = z.object({
  itemId: nonNegInt,
  name: z.string(),
  quality: nonNegInt.optional(),
  type: z.string().optional(),
  subtype: z.string().optional(),
  equipLoc: z.string().optional(),
  /** Schema 4: C_Item.GetItemInfo returns 12/13 (class 9 = Recipe). */
  classId: nonNegInt.optional(),
  subclassId: nonNegInt.optional(),
});
export type Item = z.infer<typeof Item>;

export const ItemBuildSnapshot = z.object({
  itemId: nonNegInt,
  build,
  link: z.string().optional(),
  ilvl: nonNegInt.optional(),
  reqLevel: nonNegInt.optional(),
  sellPrice: nonNegInt.optional(),
  stats: z.record(z.string(), z.number()),
  tooltip: z.array(z.string()),
  firstSeen: epochSecs.optional(),
});
export type ItemBuildSnapshot = z.infer<typeof ItemBuildSnapshot>;

/**
 * Total for one SavedVariables session (uploader + account + `session`): the server stores (sets) the count, it
 * never adds. Forever starts every /reload with an empty table, so each session is its own record.
 */
export const Drop = z.object({
  itemId: nonNegInt,
  build,
  npcId: nonNegInt,
  /** Schema 3 `meta.session`; '' for schema 1/2 files (one running total per file). */
  session: session.default(''),
  /** Loot sources (corpses) that dropped the item. */
  count: nonNegInt,
  /** Schema 3: total stack quantity over those sources. */
  quantity: nonNegInt.optional(),
});
export type Drop = z.infer<typeof Drop>;

/** Schema 3: distinct loot sources of one npc looted in a session, and the copper their money slots held. */
export const Corpse = z.object({
  npcId: nonNegInt,
  build,
  session,
  count: nonNegInt,
  copper: nonNegInt,
});
export type Corpse = z.infer<typeof Corpse>;

// ---------------------------------------------------------------------------------------------------------------
// Schema 4: professions. Field names are the addon's with `ID` spelled `Id` (professions plan, appendix).
// ---------------------------------------------------------------------------------------------------------------

/** One skill line of a character, as last seen. */
export const Skill = z.object({
  char: charKey,
  skillLineId: nonNegInt,
  name: z.string(),
  rank: nonNegInt,
  maxRank: nonNegInt,
  modifier: int.optional(),
  parentId: nonNegInt.optional(),
  lastSeen: epochSecs,
});
export type Skill = z.infer<typeof Skill>;

/** A rank change of a skill line; `recipeId` is the craft or gather within 5 s before it, if any. */
export const SkillUp = z.object({
  char: charKey,
  skillLineId: nonNegInt,
  from: nonNegInt,
  to: nonNegInt,
  build,
  time: epochSecs,
  recipeId: nonNegInt.optional(),
});
export type SkillUp = z.infer<typeof SkillUp>;

/** Static recipe facts. The server keeps known fields when a later upload leaves them blank. */
export const Recipe = z.object({
  recipeId: nonNegInt,
  name: z.string(),
  skillLineId: nonNegInt.optional(),
  categoryId: nonNegInt.optional(),
});
export type Recipe = z.infer<typeof Recipe>;

export const RecipeReagent = z.object({
  itemId: nonNegInt,
  qty: nonNegInt,
});
export type RecipeReagent = z.infer<typeof RecipeReagent>;

/** A recipe's schematic in one build. */
export const RecipeSnapshot = z.object({
  recipeId: nonNegInt,
  build,
  outputItemId: nonNegInt.optional(),
  qtyMin: nonNegInt.optional(),
  qtyMax: nonNegInt.optional(),
  reagents: z.array(RecipeReagent).max(100),
  maxTrivial: nonNegInt.optional(),
  sourceText: z.string().max(2000).optional(),
});
export type RecipeSnapshot = z.infer<typeof RecipeSnapshot>;

/**
 * Lower-cased Enum.TradeskillRelativeDifficulty key (`optimal`, `medium`, `easy`, `trivial`), or the raw number as a
 * string when the enum is missing.
 */
const difficulty = z.string().min(1).max(32);

/** What a character's recipe list showed for one recipe, the last time it was scanned in a build. */
export const RecipeStatus = z.object({
  recipeId: nonNegInt,
  build,
  char: charKey,
  learned: z.boolean(),
  difficulty: difficulty.optional(),
  rank: nonNegInt.optional(),
  seenAt: epochSecs,
});
export type RecipeStatus = z.infer<typeof RecipeStatus>;

/** Skill ranks at which a character saw a recipe at one difficulty; over time they give the colour thresholds. */
export const RecipeDifficulty = z.object({
  recipeId: nonNegInt,
  build,
  char: charKey,
  difficulty,
  minRank: nonNegInt,
  maxRank: nonNegInt,
});
export type RecipeDifficulty = z.infer<typeof RecipeDifficulty>;

/** NEW_RECIPE_LEARNED. `via` is `trainer:<npcID>`, `item:<itemID>` or `unknown`. */
export const RecipeLearned = z.object({
  char: charKey,
  recipeId: nonNegInt,
  build,
  time: epochSecs,
  via: z.string().min(1).max(64),
});
export type RecipeLearned = z.infer<typeof RecipeLearned>;

/** Craft counters of one recipe for one SavedVariables session (set, never added, like drops). */
export const Craft = z.object({
  recipeId: nonNegInt,
  build,
  session,
  casts: nonNegInt,
  qty: nonNegInt,
  procs: nonNegInt,
  skillUps: nonNegInt,
});
export type Craft = z.infer<typeof Craft>;

export const NodeSpots = z.object({
  mapId: int,
  /** Player positions (0–100 map coordinates) when the node was looted; the addon keeps ≤ 50 per map. */
  points: z.array(z.tuple([z.number(), z.number()])).max(50),
});
export type NodeSpots = z.infer<typeof NodeSpots>;

/** Gathering counters of one game object for one session. Fishing is object 0. */
export const GatherNode = z.object({
  objectId: nonNegInt,
  build,
  session,
  opened: nonNegInt,
  name: z.string().optional(),
  /** Lowest gathering skill rank seen looting it this session. */
  rankMin: nonNegInt.optional(),
  skillLineId: nonNegInt.optional(),
  spots: z.array(NodeSpots).max(500),
});
export type GatherNode = z.infer<typeof GatherNode>;

/** Per session: loot windows of an object that held the item (`count`) and their total stack quantity. */
export const NodeLoot = z.object({
  itemId: nonNegInt,
  objectId: nonNegInt,
  build,
  session,
  count: nonNegInt,
  quantity: nonNegInt,
});
export type NodeLoot = z.infer<typeof NodeLoot>;

export const TrainerService = z.object({
  name: z.string(),
  /** GetTrainerServiceInfo type, e.g. 'available', 'unavailable', 'used'. */
  type: z.string().max(32).optional(),
  cost: nonNegInt.optional(),
  skill: z.string().optional(),
  skillRank: nonNegInt.optional(),
  level: nonNegInt.optional(),
  itemId: nonNegInt.optional(),
});
export type TrainerService = z.infer<typeof TrainerService>;

/** Schema 5: the subtitle under an NPC's name ("Enchanting", "Blacksmithing Supplies"), without the "<>". */
const npcTitle = z.string().min(1).max(200);

/**
 * A profession trainer's services in one build. `complete`: the scan saw every service (all type filters on, no
 * collapsed header) and replaces the stored list; otherwise its services are merged into it by name. A newer scan wins.
 */
export const Trainer = z.object({
  npcId: nonNegInt,
  build,
  name: z.string().optional(),
  title: npcTitle.optional(),
  loc: Location.optional(),
  skillLineId: nonNegInt.optional(),
  seenAt: epochSecs,
  complete: z.boolean().optional(),
  services: z.array(TrainerService).max(1000),
});
export type Trainer = z.infer<typeof Trainer>;

/**
 * Schema 5: one part of an extended cost (GetMerchantItemCostItem) — `amount` of an item (`itemId`) or a currency
 * (`currencyId`); `name` is the currency's name or the item link's.
 */
export const VendorCost = z.object({
  amount: nonNegInt,
  itemId: nonNegInt.optional(),
  currencyId: nonNegInt.optional(),
  name: z.string().max(200).optional(),
});
export type VendorCost = z.infer<typeof VendorCost>;

export const VendorItem = z.object({
  itemId: nonNegInt,
  price: nonNegInt.optional(),
  stack: nonNegInt.optional(),
  /** -1 = unlimited. */
  numAvailable: int.optional(),
  currencyId: nonNegInt.optional(),
  /** MerchantItemInfo.hasExtendedCost (a number is tolerated too). */
  extendedCost: z.union([z.boolean(), z.number()]).optional(),
  /** Schema 5: what an extended cost is paid in, besides `price` (the gold part). */
  costs: z.array(VendorCost).max(10).optional(),
});
export type VendorItem = z.infer<typeof VendorItem>;

/** A vendor's items in one build; a scan replaces the row unless the stored one is newer. */
export const Vendor = z.object({
  npcId: nonNegInt,
  build,
  name: z.string().optional(),
  title: npcTitle.optional(),
  loc: Location.optional(),
  seenAt: epochSecs,
  items: z.array(VendorItem).max(1000),
});
export type Vendor = z.infer<typeof Vendor>;

/** Largest API sample accepted, as UTF-8 JSON; a bigger one is dropped (that record only). */
export const API_SAMPLE_MAX_BYTES = 16 * 1024;

/** The first result of a client API in a build (a trimmed table), so real field names can be checked server-side. */
export const ApiSample = z.object({
  api: z.string().min(1).max(128),
  build,
  time: epochSecs,
  sample: z
    .json()
    .refine((v) => new TextEncoder().encode(JSON.stringify(v)).length <= API_SAMPLE_MAX_BYTES, {
      message: `sample is over ${API_SAMPLE_MAX_BYTES} bytes of JSON`,
    }),
});
export type ApiSample = z.infer<typeof ApiSample>;

export const RunBoss = z.object({
  id: int.optional(),
  name: z.string().optional(),
  killed: z.boolean(),
  atSecs: int,
});
export type RunBoss = z.infer<typeof RunBoss>;

export const RunLoot = z.object({
  itemID: nonNegInt,
  npcID: nonNegInt,
});
export type RunLoot = z.infer<typeof RunLoot>;

/** Schema 3: one C_LootHistory roll. Never a player name. */
export const RunLootRoll = z.object({
  class: z.string().max(32).optional(),
  roll: nonNegInt.optional(),
  /** Enum.EncounterLootDropRollState key, lower-cased (e.g. 'needmainspec', 'greed', 'pass'), or the raw number. */
  state: z.string().max(32).optional(),
});
export type RunLootRoll = z.infer<typeof RunLootRoll>;

/** Schema 3: one boss drop from C_LootHistory, updated as rolls resolve. */
export const RunBossLoot = z.object({
  encounterId: int,
  lootListKey: int.optional(),
  itemId: nonNegInt,
  qty: nonNegInt.optional(),
  winnerClass: z.string().max(32).optional(),
  winnerIsSelf: z.boolean().optional(),
  allPassed: z.boolean().optional(),
  rolls: z.array(RunLootRoll).max(40),
});
export type RunBossLoot = z.infer<typeof RunBossLoot>;

/** Schema 3: an item a group member received (CHAT_MSG_LOOT). Party members are identified by class only. */
export const RunGroupLoot = z.object({
  itemId: nonNegInt,
  qty: nonNegInt,
  by: z.enum(['self', 'party']),
  class: z.string().max(32).optional(),
  won: z.boolean().optional(),
});
export type RunGroupLoot = z.infer<typeof RunGroupLoot>;

export const RunPartyMember = z.object({
  class: z.string().optional(),
  level: nonNegInt.optional(),
});
export type RunPartyMember = z.infer<typeof RunPartyMember>;

export const Run = z.object({
  id: z.string().min(1).max(256),
  build,
  char: charKey,
  charLevel: nonNegInt.optional(),
  instance: z.string().optional(),
  instanceID: int,
  difficulty: int.optional(),
  maxPlayers: nonNegInt.optional(),
  start: epochSecs,
  finish: epochSecs.optional(),
  endReason: z.string().optional(),
  awaySecs: nonNegInt,
  activeSecs: int.optional(),
  xpTotal: nonNegInt,
  questXP: nonNegInt,
  mobXP: int.optional(),
  deaths: nonNegInt,
  bosses: z.array(RunBoss),
  loot: z.array(RunLoot),
  party: z.array(RunPartyMember),
  /** Schema 3: C_PartyInfo.GetLootMethod() as the lower-cased Enum.LootMethod key (e.g. 'group'), or the raw value. */
  lootMethod: z.string().max(32).optional(),
  bossLoot: z.array(RunBossLoot).max(500).optional(),
  groupLoot: z.array(RunGroupLoot).max(500).optional(),
});
export type Run = z.infer<typeof Run>;

export const Records = z.object({
  characters: z.array(Character).default([]),
  quests: z.array(Quest).default([]),
  questObservations: z.array(QuestObservation).default([]),
  turnIns: z.array(TurnIn).default([]),
  items: z.array(Item).default([]),
  itemSnapshots: z.array(ItemBuildSnapshot).default([]),
  drops: z.array(Drop).default([]),
  corpses: z.array(Corpse).default([]),
  skills: z.array(Skill).default([]),
  skillUps: z.array(SkillUp).default([]),
  recipes: z.array(Recipe).default([]),
  recipeSnapshots: z.array(RecipeSnapshot).default([]),
  recipeStatus: z.array(RecipeStatus).default([]),
  recipeDifficulty: z.array(RecipeDifficulty).default([]),
  recipesLearned: z.array(RecipeLearned).default([]),
  crafts: z.array(Craft).default([]),
  nodes: z.array(GatherNode).default([]),
  nodeLoot: z.array(NodeLoot).default([]),
  trainers: z.array(Trainer).default([]),
  vendors: z.array(Vendor).default([]),
  apiSamples: z.array(ApiSample).default([]),
  runs: z.array(Run).default([]),
});
export type Records = z.infer<typeof Records>;
export type RecordKind = keyof Records;
export const RECORD_KINDS = Object.keys(Records.shape) as RecordKind[];

export const UploadBatch = z.object({
  /** The SavedVariables file's `meta.schemaVersion`, so the server knows the shape. */
  schemaVersion,
  uploaderId: z.string().min(1).max(128),
  /** Which SavedVariables file this came from: the WoW account folder name on the uploader's PC. */
  account: z.string().min(1).max(128),
  meta: Meta,
  records: Records,
});
export type UploadBatch = z.infer<typeof UploadBatch>;
export type UploadBatchInput = z.input<typeof UploadBatch>;

export const Acknowledged = z.object({
  key: z.string(),
  hash: z.string(),
});
export type Acknowledged = z.infer<typeof Acknowledged>;

export const IngestResponse = z.object({
  batchId: z.number().int(),
  acknowledged: z.array(Acknowledged),
});
export type IngestResponse = z.infer<typeof IngestResponse>;
