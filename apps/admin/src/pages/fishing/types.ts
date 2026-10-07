export interface FishingCatch {
  itemId: number;
  name: string | null;
  times: number;
  qty: number;
  perCast: number | null;
}

export interface FishingGroup {
  zone: string | null;
  subzone: string | null;
  casts: number;
  outcomes: { loot: number; escaped: number; notHooked: number; none: number };
  luredCasts: number;
  effectiveSkill: { min: number | null; max: number | null };
  firstAt: string;
  lastAt: string;
  catches: FishingCatch[];
}

export interface WhereRow {
  zone: string | null;
  subzone: string | null;
  casts: number;
  times: number;
  qty: number;
  perCast: number | null;
}

export interface CastRow {
  id: string;
  char: string;
  build: number;
  castAt: string;
  zone: string | null;
  subzone: string | null;
  x: number | null;
  y: number | null;
  skill: number | null;
  modifier: number | null;
  lure: number | null;
  outcome: 'loot' | 'escaped' | 'notHooked' | 'none';
  secs: number | null;
  money: number;
  loot: { itemId: number; qty: number; name: string | null }[];
}

export interface ZoneRow {
  zone: string | null;
  subzone: string | null;
  casts: number;
}
