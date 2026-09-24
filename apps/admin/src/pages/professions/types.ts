// Shapes of the profession routes: /admin/api/professions/* (apps/server/src/routes/adminProfessions.ts) and the
// /v1/professions/* reads the panel reuses (apps/server/src/routes/analysis.ts). Times are America/Chicago ISO strings;
// money is copper. Names come from uploads: untrusted text, rendered as text only.

export interface ProfessionCharacter {
  char: string;
  rank: number;
  maxRank: number;
  lastSeen: string | null;
  recipesKnown: number;
}

export interface ProfessionSummary {
  skillLineId: number;
  name: string | null;
  skillLineIds: number[];
  characters: ProfessionCharacter[];
  recipes: { known: number; seen: number };
  crafts: { casts: number; qty: number; procs: number; skillUps: number };
  gathering: { opens: number; nodes: number };
  trainers: number;
  vendors: number;
}

export interface ProfessionsOverview {
  professions: ProfessionSummary[];
}

export interface SkillPoint {
  observedAt: string;
  fromRank: number;
  rank: number;
  build: number;
  recipeId: number | null;
  recipeName: string | null;
}

export interface SkillHistory {
  items: {
    char: string;
    professions: {
      skillLineId: number;
      name: string | null;
      rank: number;
      maxRank: number | null;
      points: SkillPoint[];
    }[];
  }[];
}

export interface Threshold {
  difficulty: string;
  minRank: number;
  maxRank: number;
  chars?: number;
}

export interface Reagent {
  itemId: number;
  name: string | null;
  qty: number;
}

export interface RecipeBuild {
  build: number;
  outputItemId?: number | null;
  outputItemName?: string | null;
  qtyMin?: number | null;
  qtyMax?: number | null;
  reagents: Reagent[];
  maxTrivial?: number | null;
  sourceText?: string | null;
  difficulty: Threshold[];
}

export interface Recipe {
  recipeId: number;
  name: string;
  skillLineId: number | null;
  categoryId: number | null;
  profession: { skillLineId: number; name: string | null } | null;
  learnedBy: number;
  learnedVia: { via: string; count: number }[];
  builds: RecipeBuild[];
}

export interface CraftRow {
  recipeId: number;
  name: string | null;
  build: number;
  profession: { skillLineId: number; name: string | null } | null;
  outputItemId: number | null;
  outputItemName: string | null;
  casts: number;
  qty: number;
  procs: number;
  skillUps: number;
  sessions: number;
}

export interface Spot {
  x: number;
  y: number;
  opens: number;
}

export interface MapNode {
  objectId: number;
  name: string | null;
  skillLineId: number | null;
  skillLineName: string | null;
  opens: number;
  rankMin: number | null;
  spots: Spot[];
}

export interface GatherMap {
  mapId: number;
  zone: string | null;
  opens: number;
  nodes: MapNode[];
}

export interface GatheringMap {
  build: number | null;
  builds: number[];
  maps: GatherMap[];
}

export interface GatheringNode {
  build: number;
  objectId: number;
  name: string | null;
  skillLineId: number | null;
  skillLineName: string | null;
  opens: number;
  rankMin: number | null;
  zones: { mapId: number; spots: number }[];
  loot: {
    itemId: number;
    name: string | null;
    count: number;
    quantity: number;
    perOpen: number | null;
    qtyPerOpen: number | null;
  }[];
}

export interface CostReagent extends Reagent {
  unitPrice: number | null;
  cost: number | null;
  vendor: {
    npcId: number;
    name: string | null;
    title: string | null;
    build: number;
    price: number | null;
    stack: number | null;
  } | null;
  extendedOnly: boolean;
}

export interface RecipeCost {
  recipeId: number;
  name: string;
  build: number | null;
  builds: number[];
  reagents: CostReagent[];
  total: { known: number; complete: boolean; unknownItemIds: number[] };
  output: {
    itemId: number;
    name: string | null;
    qtyMin: number | null;
    qtyMax: number | null;
    unitSellPrice: number | null;
    value: number | null;
  } | null;
  profit: number | null;
}

export interface RecipeSources {
  recipeItems: { itemId: number; name: string | null }[];
  trainers: {
    npcId: number;
    npcName: string | null;
    npcTitle: string | null;
    build: number;
    service: string;
    cost: number | null;
    skillRank: number | null;
  }[];
  vendors: {
    npcId: number;
    npcName: string | null;
    npcTitle: string | null;
    build: number;
    itemId: number;
    itemName: string | null;
    price: number | null;
    costs: { amount: number; itemId?: number; currencyId?: number; name?: string }[] | null;
  }[];
  drops: {
    itemId: number;
    itemName: string | null;
    build: number;
    npcId: number | null;
    objectId: number | null;
    count: number;
  }[];
}
