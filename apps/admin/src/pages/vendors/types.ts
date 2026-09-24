// Shapes of /admin/api/vendors and /admin/api/trainers (apps/server/src/routes/adminProfessions.ts). Names, titles and
// locations come from uploads: untrusted text, rendered as text only. Money is copper; times America/Chicago ISO.
import type { Cost } from '../../lib/money';

export interface Location {
  zone: string | null;
  subzone: string | null;
  mapId: number | null;
  x: number | null;
  y: number | null;
}

interface NpcBase {
  npcId: number;
  name: string | null;
  /** The subtitle under the NPC's name ("Tailoring Trainer"), without the <>. */
  title: string | null;
  /** npc id at or above the Forever-only threshold. */
  forever: boolean;
  build: number;
  builds: number[];
  location: Location | null;
  seenAt: string | null;
}

export interface VendorRow extends NpcBase {
  itemCount: number;
  recipeItemCount: number;
  extendedCostCount: number;
}

export interface TrainerRow extends NpcBase {
  skillLineId: number | null;
  skillLineName: string | null;
  complete: boolean;
  serviceCount: number;
}

export interface NpcList<T> {
  total: number;
  limit: number;
  offset: number;
  foreverNpcMin: number;
  titles: { title: string; count: number }[];
  items: T[];
}

export interface VendorItem {
  itemId: number | null;
  name: string | null;
  quality: number | null;
  classId: number | null;
  type: string | null;
  subtype: string | null;
  price: number | null;
  stack: number | null;
  numAvailable: number | null;
  currencyId: number | null;
  extendedCost: boolean;
  costs: Cost[] | null;
}

export interface VendorDetail extends NpcBase {
  items: VendorItem[];
}

export interface TrainerService {
  name: string | null;
  type: string | null;
  cost: number | null;
  skill: string | null;
  skillRank: number | null;
  level: number | null;
  itemId: number | null;
  itemName: string | null;
}

export interface TrainerDetail extends NpcBase {
  complete: boolean;
  skillLineId: number | null;
  skillLineName: string | null;
  services: TrainerService[];
}
