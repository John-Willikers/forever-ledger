// Shapes of /admin/api/characters/:key/timeline (apps/server/src/routes/adminQuests.ts) and the part of
// /v1/professions/skills the character page shows. Uploaded strings are rendered as text only.

export interface TimelineCharacter {
  key: string;
  name: string;
  realm: string;
  class: string | null;
  race: string | null;
  faction: string | null;
  level: number | null;
  lastSeen: string | null;
}

export interface LevelPoint {
  at: string;
  level: number;
}

export interface TimelineTurnIn {
  questId: number;
  title: string | null;
  build: number;
  level: number | null;
  xp: number | null;
  money: number | null;
  turnedInAt: string;
  cumulativeXp: number;
}

export interface DayXp {
  /** `YYYY-MM-DD`, the America/Chicago calendar day. */
  day: string;
  xp: number;
  turnIns: number;
}

export interface CharacterTimeline {
  character: TimelineCharacter | null;
  levels: LevelPoint[];
  /** Oldest first. */
  turnIns: TimelineTurnIn[];
  perDay: DayXp[];
  totals: { turnIns: number; questXp: number };
}

export interface ProfessionSkill {
  skillLineId: number;
  name: string;
  rank: number;
  maxRank: number;
  lastSeen: string | null;
}

export interface CharacterSkills {
  char: string;
  professions: ProfessionSkill[];
}
