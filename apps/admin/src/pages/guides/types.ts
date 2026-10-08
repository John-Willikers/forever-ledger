/** A step of an in-game guide (contracts GuideStep). */
export interface GuideStep {
  action: 'accept' | 'complete' | 'turn_in' | 'travel';
  /** Travel steps (guide format 2). */
  how?: 'walk' | 'fly' | 'boat' | 'hearth';
  note?: string;
  npc: string | null;
  zone: string | null;
  subzone: string | null;
  mapId: number | null;
  x: number | null;
  y: number | null;
  quests: { questId: number; title: string | null; objectives?: string[] }[];
  levelAfter?: number | null;
}

/** POST /admin/api/guides (preview or send). */
export interface BuiltGuide {
  id: number | null;
  character: string;
  title: string;
  steps: number;
  basedOn: string;
  /** Planned for the character by the route planner (else it follows basedOn's run). */
  planned?: boolean;
  /** Planned play time (planned guides). */
  minutes?: number;
  reachedTarget: boolean;
  gaps: string[];
  tray: boolean;
  doc: { steps: GuideStep[] };
}

/** GET /admin/api/guides item. */
export interface GuideRow {
  id: number;
  char: string;
  title: string;
  steps: number;
  planned?: boolean;
  requestedBy: string;
  createdAt: string | null;
  deliveredAt: string | null;
  deletedAt: string | null;
  tray: string | null;
}

export interface GuideForm {
  character: string;
  start: string;
  basedOn: string;
  toLevel: string;
  fromLevel: string;
}
