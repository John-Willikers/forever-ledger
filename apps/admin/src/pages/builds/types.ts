// Shapes of /admin/api/builds and /admin/api/build-diff. Names, titles and tooltip lines are uploaded data.

export interface BuildCounts {
  items: number;
  quests: number;
  recipes: number;
  vendors: number;
  trainers: number;
  npcsLooted: number;
  apiSamples: number;
}

export interface BuildInfo {
  build: number;
  version: string | null;
  interface: number | null;
  firstSeen: string | null;
  lastSeen: string | null;
}

export interface BuildRow extends BuildInfo {
  uploads: number;
  characters: number;
  counts: BuildCounts;
}

export interface Change<T = number | string | null> {
  from: T;
  to: T;
}

export interface FieldChange<F extends string = string> extends Change {
  field: F;
}

export interface OnlyIn {
  total: number;
  sample: { id: number; name: string | null }[];
}

export interface Category<T> {
  total: number;
  changes: T[];
  onlyInFrom: OnlyIn;
  onlyInTo: OnlyIn;
}

export interface ItemRef {
  itemId: number;
  name: string | null;
  quality: number | null;
}

export interface ItemChange extends ItemRef {
  fields: FieldChange<'ilvl' | 'reqLevel' | 'sellPrice'>[];
  stats: { stat: string; from: number | null; to: number | null }[];
  tooltip: { added: string[]; removed: string[] };
}

export interface RewardOption extends ItemRef {
  kind: string;
  count: number;
}

export interface QuestChange {
  questId: number;
  title: string | null;
  level: number | null;
  xp: Change<number> | null;
  money: Change<number> | null;
  rewards: {
    added: RewardOption[];
    removed: RewardOption[];
    changed: (ItemRef & { kind: string; from: number; to: number })[];
  };
}

export interface Reagent {
  itemId: number;
  name: string | null;
  qty: number | null;
}

export interface RecipeChange {
  recipeId: number;
  name: string | null;
  outputItemId: number | null;
  outputName: string | null;
  fields: FieldChange<'outputItemId' | 'qtyMin' | 'qtyMax' | 'maxTrivial'>[];
  reagents: {
    added: Reagent[];
    removed: Reagent[];
    changed: { itemId: number; name: string | null; from: number | null; to: number | null }[];
  };
}

export interface VendorCost {
  amount: number | null;
  itemId: number | null;
  currencyId: number | null;
  name: string | null;
}

export interface VendorPrice {
  price: number | null;
  stack: number | null;
  costs: VendorCost[];
}

export type VendorListing = ItemRef & VendorPrice;

export interface VendorChange {
  npcId: number;
  name: string | null;
  title: string | null;
  added: VendorListing[];
  removed: VendorListing[];
  changed: (ItemRef & { from: VendorPrice; to: VendorPrice })[];
}

export interface Service {
  name: string;
  cost: number | null;
  skill: string | null;
  skillRank: number | null;
  level: number | null;
  itemId: number | null;
}

export type ServiceField = 'cost' | 'skill' | 'skillRank' | 'level' | 'itemId';

export interface TrainerChange {
  npcId: number;
  name: string | null;
  title: string | null;
  complete: Change<boolean>;
  added: Service[];
  removed: Service[];
  changed: { name: string; fields: FieldChange<ServiceField>[] }[];
}

export interface DropSide {
  corpses: number;
  dropped: number;
  rate: number;
}

export interface DropChange extends ItemRef {
  npcId: number;
  npcName: string | null;
  from: DropSide;
  to: DropSide;
}

export interface BuildDiff {
  from: BuildInfo;
  to: BuildInfo;
  limit: number;
  sampleLimit: number;
  minCorpses: number;
  items: Category<ItemChange>;
  quests: Category<QuestChange>;
  recipes: Category<RecipeChange>;
  vendors: Category<VendorChange>;
  trainers: Category<TrainerChange>;
  drops: Category<DropChange> & { belowThreshold: number };
}

export type CategoryKey = 'items' | 'quests' | 'recipes' | 'vendors' | 'trainers' | 'drops';
