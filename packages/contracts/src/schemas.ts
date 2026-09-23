import { z } from 'zod';

/** SavedVariables / upload schema major. Bump together with `SCHEMA_VERSION` in the addon. */
export const SCHEMA_VERSION = 2;

/**
 * Schema majors this code reads. 2 only adds `turnIns[].choice` (addon 0.2.3), so schema 1 files and queued
 * schema 1 batches stay valid as they are.
 */
export const SUPPORTED_SCHEMA_VERSIONS = [1, 2] as const;
export type SchemaVersion = (typeof SUPPORTED_SCHEMA_VERSIONS)[number];

export const isSupportedSchemaVersion = (v: unknown): v is SchemaVersion =>
  (SUPPORTED_SCHEMA_VERSIONS as readonly unknown[]).includes(v);

const schemaVersion = z.union([z.literal(1), z.literal(2)]);

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

/** Running total for one account file: the server stores (sets) the count, it never adds. */
export const Drop = z.object({
  itemId: nonNegInt,
  build,
  npcId: nonNegInt,
  count: nonNegInt,
});
export type Drop = z.infer<typeof Drop>;

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
