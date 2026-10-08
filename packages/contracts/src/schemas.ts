import { z } from 'zod';

/** SavedVariables / upload schema major. Bump together with `SCHEMA_VERSION` in the addon. */
export const SCHEMA_VERSION = 10;

/**
 * Schema majors this code reads. Each one is additive, so older files and queued older batches stay valid:
 * 2 adds `turnIns[].choice` (addon 0.2.3); 3 adds `meta.session`, `dropQty`, `corpses` and run loot details
 * (addon 0.2.4); 4 adds professions — skills, recipes, crafts, gathering nodes, trainers, vendors, API samples and
 * `items[].classID/subclassID` (addon 0.3.0); 5 adds vendor and trainer `title` (the NPC's subtitle) and vendor item
 * `costs` (extended costs paid in items or currencies) (addon 0.3.3); 6 adds container opens and container loot —
 * what opened items (clams, lockboxes, a Message in a Bottle) held, per session (addon 0.3.4); 7 adds fishing casts
 * (one per cast: zone, spot, skill, lure, outcome, catch) and the character's `firstName` / `guid`, with characters
 * keyed by full name, first name + Forever surname (addon 0.4.0); 8 adds gear: what each character wears, per slot
 * (item, link with enchant and suffix, stats) (addon 0.5.0); 9 adds objective progress: where each quest objective's
 * count went up (addon 0.6.0); 10 adds character state, xp curve and trips — where each character stands for the
 * route planner (level, completed quests, quest log, position, hearth, flight paths, mount), XP needed per level, and
 * timed flights, boat / zeppelin rides and hearths (addon 0.8.0).
 */
export const SUPPORTED_SCHEMA_VERSIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export type SchemaVersion = (typeof SUPPORTED_SCHEMA_VERSIONS)[number];
/** The newest schema this code reads: what the tray sends as `?schema=` when it asks for an addon manifest. */
export const MAX_SUPPORTED_SCHEMA: SchemaVersion = Math.max(
  ...SUPPORTED_SCHEMA_VERSIONS,
) as SchemaVersion;

export const isSupportedSchemaVersion = (v: unknown): v is SchemaVersion =>
  (SUPPORTED_SCHEMA_VERSIONS as readonly unknown[]).includes(v);

const schemaVersion = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
  z.literal(8),
  z.literal(9),
  z.literal(10),
]);

/** Schema 3 `meta.session`: `<epoch>-<4 hex>`, one per SavedVariables table. '' for older files. */
const session = z.string().max(64);

/** Postgres `integer` (int4) maximum. Ids, builds, counts and prices are stored (or read back) as int4. */
export const INT4_MAX = 2_147_483_647;

/** An int4: out of range is an invalid record (refused on its own, like any other), never a database error. */
const int = z
  .number()
  .int()
  .min(-INT4_MAX - 1)
  .max(INT4_MAX);
const nonNegInt = int.nonnegative();
/** Epoch seconds are stored as timestamptz, not int4: no int4 cap (they pass it in 2038). */
const epochSecs = z.number().int().nonnegative();
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
  /** Schema 7: `name` is the full name (first + surname); this is the first name alone. */
  firstName: z.string().max(64).optional(),
  /** Schema 7: `Player-<server>-<id>`, stable across renames. Any other shape is dropped, not the character. */
  guid: z
    .string()
    .regex(/^Player-\d+-[0-9A-Fa-f]+$/)
    .optional()
    .catch(undefined),
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

// ---------------------------------------------------------------------------------------------------------------
// Schema 6: opened items (container loot plan). Container 0 is an opened item the client could not name.
// ---------------------------------------------------------------------------------------------------------------

/** Per session: how often an item was opened (one loot window each) and the copper its money slots held. */
export const ContainerOpen = z.object({
  containerId: nonNegInt,
  build,
  session,
  opened: nonNegInt,
  copper: nonNegInt,
});
export type ContainerOpen = z.infer<typeof ContainerOpen>;

/** Per session: opens of a container that held the item (`count`) and their total stack quantity. */
export const ContainerLoot = z.object({
  itemId: nonNegInt,
  containerId: nonNegInt,
  build,
  session,
  count: nonNegInt,
  quantity: nonNegInt,
});
export type ContainerLoot = z.infer<typeof ContainerLoot>;

// ---------------------------------------------------------------------------------------------------------------
// Schema 7: fishing casts (0.4.0 plan). One record per cast, so fishing is searchable by zone, spot, skill and lure.
// ---------------------------------------------------------------------------------------------------------------

export const FISHING_OUTCOMES = ['loot', 'escaped', 'notHooked', 'none'] as const;
export type FishingOutcome = (typeof FISHING_OUTCOMES)[number];

export const FishingCatch = z.object({ itemId: int.positive(), qty: nonNegInt });
export type FishingCatch = z.infer<typeof FishingCatch>;

/** A map coordinate, 0-100 with one decimal (the addon's `where()`). */
const mapCoord = z.number().min(0).max(100);

/**
 * One fishing cast. `outcome`: `loot` (its loot window), `escaped` ("Your fish got away!"), `notHooked` (clicked too
 * early), `none` (the channel ended or the next cast began with no window). `lure` is the main-hand enchant id (a
 * lure), `modifier` the skill bonus at the cast (lure and gear). A pool can't be told apart on build 70245, so there
 * is no pool field.
 */
export const FishingCast = z.object({
  id: z.string().min(1).max(256),
  char: charKey,
  build,
  time: epochSecs,
  spellId: nonNegInt.optional(),
  mapId: nonNegInt.optional(),
  zone: z.string().max(128).optional(),
  subzone: z.string().max(128).optional(),
  x: mapCoord.optional(),
  y: mapCoord.optional(),
  skill: nonNegInt.optional(),
  skillMax: nonNegInt.optional(),
  modifier: int.optional(),
  lure: nonNegInt.optional(),
  lureSecs: nonNegInt.optional(),
  outcome: z.enum(FISHING_OUTCOMES),
  secs: nonNegInt.optional(),
  loot: z.array(FishingCatch).max(16).default([]),
  money: nonNegInt.default(0),
});
export type FishingCast = z.infer<typeof FishingCast>;

/** Inventory slots the addon reads: 1 head … 19 tabard (INVSLOT_*). */
export const GEAR_SLOT_MAX = 19;

/** One worn item: the link keeps enchant and random suffix; stats are GetItemStats(link), absent until cached. */
export const GearSlot = z.object({
  slot: z.number().int().min(1).max(GEAR_SLOT_MAX),
  itemId: nonNegInt,
  link: z.string().max(512).optional(),
  stats: z.record(z.string().max(64), z.number()).optional(),
});
export type GearSlot = z.infer<typeof GearSlot>;

/** Schema 8: what a character wore when last read on a build (login, or after an equipment change). */
export const CharacterGear = z.object({
  char: charKey,
  build,
  at: epochSecs,
  slots: z.array(GearSlot).max(GEAR_SLOT_MAX),
});
export type CharacterGear = z.infer<typeof CharacterGear>;

/**
 * Schema 9: one quest objective's count going up (a kill, an item looted, an event), with where the player stood, so
 * guides can say where an objective gets done.
 */
export const ObjectiveProgress = z.object({
  char: charKey,
  build,
  questId: nonNegInt,
  /** The objective's place in the quest's list, from 1. */
  index: z.number().int().min(1).max(32),
  text: z.string().max(256).optional(),
  have: nonNegInt,
  need: nonNegInt.optional(),
  time: epochSecs,
  mapId: nonNegInt.optional(),
  zone: z.string().max(128).optional(),
  subzone: z.string().max(128).optional(),
  x: z.number().min(0).max(100).optional(),
  y: z.number().min(0).max(100).optional(),
});
export type ObjectiveProgress = z.infer<typeof ObjectiveProgress>;

// ---------------------------------------------------------------------------------------------------------------
// Schema 10: character state for the route planner, the XP curve and timed trips (addon 0.8.0 plan).
// ---------------------------------------------------------------------------------------------------------------

/**
 * Schema 10 coordinates are a 0..1 map fraction (C_Map position, 4 places), not the 0..100 of older records. Anything
 * else is dropped by normalize (that coordinate only).
 */
const spotCoord = z.number().min(0).max(1);
const placeName = z.string().max(128);

/**
 * Where a character stood: `pos`, a trip's ends. x/y are a 0..1 map fraction. Every field optional; an off-map
 * coordinate is dropped alone.
 */
export const StateSpot = z.object({
  mapId: nonNegInt.optional(),
  x: spotCoord.optional(),
  y: spotCoord.optional(),
  zone: placeName.optional(),
  subzone: placeName.optional(),
  at: epochSecs.optional(),
});
export type StateSpot = z.infer<typeof StateSpot>;

/**
 * Longest lists accepted; longer ones are junk. `completed` is the addon's own cap (COMPLETED_CAP 10000, exactly);
 * the rest leave headroom over the addon's caps (log 35, taxi 4 maps × 80 nodes).
 */
export const CHAR_STATE_LIMITS = {
  completed: 10_000,
  log: 50,
  objectives: 32,
  taxiMaps: 8,
  taxiNodes: 200,
} as const;

export const StateLogQuest = z.object({
  questId: nonNegInt,
  /** Count done per objective, in the quest's order. */
  done: z.array(nonNegInt).max(CHAR_STATE_LIMITS.objectives),
});
export type StateLogQuest = z.infer<typeof StateLogQuest>;

export const StateBind = z.object({
  /** GetBindLocation(). */
  zone: placeName.optional(),
  /** Where the character stood when HEARTHSTONE_BOUND fired (at the innkeeper). */
  spot: StateSpot.pick({ mapId: true, x: true, y: true }).optional(),
  at: epochSecs.optional(),
});
export type StateBind = z.infer<typeof StateBind>;

/**
 * A flight master node on a taxi map. `state`: 0 current, 1 learned (reachable), 2 not learned. x/y: 0..1 fraction of
 * the taxi map.
 */
export const StateTaxiNode = z.object({
  nodeId: nonNegInt,
  name: z.string().max(200).optional(),
  x: spotCoord.optional(),
  y: spotCoord.optional(),
  state: z.number().int().min(0).max(16).optional(),
});
export type StateTaxiNode = z.infer<typeof StateTaxiNode>;

export const StateTaxiMap = z.object({
  taxiMapId: nonNegInt,
  at: epochSecs.optional(),
  nodes: z.array(StateTaxiNode).max(CHAR_STATE_LIMITS.taxiNodes),
});
export type StateTaxiMap = z.infer<typeof StateTaxiMap>;

export const StateMount = z.object({
  /** Mounts collected (C_MountJournal). */
  owned: nonNegInt.optional(),
  mounted: z.boolean().optional(),
});
export type StateMount = z.infer<typeof StateMount>;

/** Sections of a character state, each validated on its own: a bad one is dropped and reported, the rest kept. */
export const CharStateSections = {
  level: nonNegInt,
  xp: nonNegInt,
  xpMax: nonNegInt,
  /** Every quest the character has completed (C_QuestLog.GetAllCompletedQuestIDs), sorted. */
  completed: z.array(nonNegInt).max(CHAR_STATE_LIMITS.completed),
  completedAt: epochSecs,
  /** How many completed ids the addon cut by its cap (absent when none were). */
  completedTruncated: nonNegInt,
  log: z.array(StateLogQuest).max(CHAR_STATE_LIMITS.log),
  /** Last position (written at logout / reload). */
  pos: StateSpot,
  bind: StateBind,
  /** Epoch seconds when the hearthstone is ready; 0 = ready. */
  hearthReadyAt: epochSecs,
  taxi: z.array(StateTaxiMap).max(CHAR_STATE_LIMITS.taxiMaps),
  mount: StateMount,
} as const;

/**
 * Schema 10: where a character stands, for the route planner. One record per character and build; the addon replaces
 * fields, never appends, so the newest `observedAt` wins. Everything but the character is optional.
 */
export const CharState = z.object({
  char: charKey,
  build,
  /** When the addon last wrote this state (SV `at`): an older batch never overwrites newer state. */
  observedAt: epochSecs.optional(),
  level: CharStateSections.level.optional(),
  xp: CharStateSections.xp.optional(),
  xpMax: CharStateSections.xpMax.optional(),
  completed: CharStateSections.completed.optional(),
  completedAt: CharStateSections.completedAt.optional(),
  completedTruncated: CharStateSections.completedTruncated.optional(),
  log: CharStateSections.log.optional(),
  pos: CharStateSections.pos.optional(),
  bind: CharStateSections.bind.optional(),
  hearthReadyAt: CharStateSections.hearthReadyAt.optional(),
  taxi: CharStateSections.taxi.optional(),
  mount: CharStateSections.mount.optional(),
});
export type CharState = z.infer<typeof CharState>;

/** Schema 10: XP needed to finish `level` (UnitXPMax) in a build. */
export const XpCurveEntry = z.object({
  build,
  level: z.number().int().min(1).max(255),
  xpMax: nonNegInt,
});
export type XpCurveEntry = z.infer<typeof XpCurveEntry>;

export const TRIP_KINDS = ['flight', 'transport', 'hearth'] as const;
export type TripKind = (typeof TRIP_KINDS)[number];

/** A taxi node at either end of a flight. */
export const TripNode = z.object({
  nodeId: nonNegInt.optional(),
  name: z.string().max(200).optional(),
});
export type TripNode = z.infer<typeof TripNode>;

/**
 * Schema 10: a timed trip — a flight (TakeTaxiNode → control regained), a boat / zeppelin ride, or a hearth (cast →
 * arrival). `seconds` is the measured duration; a trip over a day is junk.
 */
export const Trip = z.object({
  kind: z.enum(TRIP_KINDS),
  char: charKey,
  build,
  startedAt: epochSecs,
  seconds: z.number().nonnegative().max(86_400),
  from: StateSpot.optional(),
  to: StateSpot.optional(),
  fromNode: TripNode.optional(),
  toNode: TripNode.optional(),
});
export type Trip = z.infer<typeof Trip>;

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
  containerOpens: z.array(ContainerOpen).default([]),
  containerLoot: z.array(ContainerLoot).default([]),
  fishingCasts: z.array(FishingCast).default([]),
  gear: z.array(CharacterGear).default([]),
  objectiveProgress: z.array(ObjectiveProgress).default([]),
  charState: z.array(CharState).default([]),
  xpCurve: z.array(XpCurveEntry).default([]),
  trips: z.array(Trip).default([]),
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
