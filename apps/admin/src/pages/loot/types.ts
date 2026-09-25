// Shapes of the loot routes (apps/server/src/routes/adminLoot.ts) and /v1/items/:id (routes/analysis.ts).
// Every string here is uploaded data: render it as text.
import type {
  ContainerContent,
  ContainerOpens,
  DropRate,
  DropSource,
  OpenedFrom,
} from '../items/itemLib';
import type { Location } from '../vendors/types';
import type { RateItem } from './lootLib';

export interface Paged<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface MobRow {
  build: number;
  npcId: number;
  name: string | null;
  foreverOnly: boolean;
  corpses: number;
  avgCopper: number | null;
  items: number;
  topItems: RateItem[];
}

export interface MobDetail {
  npcId: number;
  name: string | null;
  foreverOnly: boolean;
  builds: { build: number; corpses: number; avgCopper: number | null; items: RateItem[] }[];
}

export interface ItemRow {
  itemId: number;
  name: string;
  quality: number | null;
  type: string | null;
  subtype: string | null;
  equipLoc: string | null;
  classId: number | null;
  subclassId: number | null;
  build: number | null;
  ilvl: number | null;
  reqLevel: number | null;
  sellPrice: number | null;
  foreverOnly: boolean;
  sources: { drops: number; nodes: number; vendors: number; quests: number; recipes: number };
}

export interface ItemsPage extends Paged<ItemRow> {
  classes: { name: string; count: number }[];
}

/** GET /v1/items/:id */
export interface ItemV1 {
  itemId: number;
  name: string;
  quality: number | null;
  type: string | null;
  subtype: string | null;
  equipLoc: string | null;
  snapshots: {
    build: number;
    link: string | null;
    ilvl: number | null;
    reqLevel: number | null;
    sellPrice: number | null;
    stats: Record<string, number> | null;
    tooltip: string[] | null;
  }[];
  dropSources: DropSource[];
  nodeSources: {
    build: number;
    objectId: number;
    name: string | null;
    opens: number | null;
    count: number;
    quantity: number;
  }[];
  questRewards: {
    questId: number;
    title: string | null;
    build: number;
    kind: string;
    count: number;
  }[];
  /** Estimated from stats, subtype and proficiency (Forever has no spec data); see contracts' classRules. */
  specs: {
    rulesVersion: string;
    atLevel: number;
    roles: { role: string; confidence: number }[];
    classes: ClassFit[];
  };
}

export interface ClassFit {
  cls: string;
  canEquip: boolean;
  /** When `canEquip` is false: the level the class gains the proficiency. */
  fromLevel?: number;
  bestArmor: boolean;
}

/** One extended-cost part, field by field (a field the upload got wrong is left out). */
export interface VendorCost {
  amount?: number;
  itemId?: number;
  currencyId?: number;
  name?: string;
}

/** GET /admin/api/items/:id */
export interface ItemExtra {
  itemId: number;
  foreverOnly: boolean;
  statDiffs: {
    fromBuild: number;
    toBuild: number;
    stats: { stat: string; from: number | null; to: number | null }[];
    fields: { field: string; from: number | null; to: number | null }[];
  }[];
  dropRates: DropRate[];
  /**
   * Schema 6: what the item gave when opened, or disenchanted / prospected / milled (empty lists when it never was).
   * Missing from a server older than schema 6: treat as empty.
   */
  contents?: { opens?: ContainerOpens[]; items?: ContainerContent[] } | null;
  /** Schema 6: items the item came out of, opened or processed (missing from an older server: empty). */
  openedFrom?: OpenedFrom[] | null;
  vendors: {
    npcId: number;
    npcName: string | null;
    npcTitle: string | null;
    build: number;
    location: Location | null;
    seenAt: string;
    price: number | null;
    stack: number | null;
    numAvailable: number | null;
    costs: VendorCost[] | null;
  }[];
  recipes: {
    produces: {
      recipeId: number;
      name: string | null;
      build: number;
      qtyMin: number | null;
      qtyMax: number | null;
      reagents: { itemId: number; name: string | null; qty: number }[];
      /** The recipe's base profession and the skill rank to learn it (trainer, else recipe item). */
      profession: { skillLineId: number; name: string | null } | null;
      skillRank: number | null;
    }[];
    reagentIn: {
      recipeId: number;
      name: string | null;
      build: number;
      qty: number | null;
      outputItemId: number | null;
      outputItemName: string | null;
    }[];
    /** The recipe a Recipe-class item teaches (at most one). */
    teaches: {
      recipeId: number;
      name: string;
      profession: { skillLineId: number; name: string | null } | null;
    }[];
  };
}
