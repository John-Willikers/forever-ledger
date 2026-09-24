// Shapes of /admin/api/quests and /admin/api/quests/:id (apps/server/src/routes/adminQuests.ts). Every string came
// from an uploaded SavedVariables file: render it as text only.

export interface RewardChoice {
  itemId: number;
  name: string | null;
  quality: number | null;
  picks: number;
}

export interface QuestRow {
  questId: number;
  /** The build all numbers are for (`?build=` or the newest build the quest was seen in). */
  build: number;
  builds: number[];
  title: string | null;
  level: number | null;
  category: string | null;
  suggestedGroup: number | null;
  xpOffered: number | null;
  moneyOffered: number | null;
  turnIns: number;
  avgXpPaid: number | null;
  xpMismatch: boolean;
  foreverOnly: boolean;
  rewardChoices: RewardChoice[];
  givers: string[];
  enders: string[];
  lastSeen: string | null;
}

export interface QuestList {
  total: number;
  limit: number;
  offset: number;
  zones: { zone: string; quests: number }[];
  builds: number[];
  items: QuestRow[];
}

export interface Loc {
  zone: string | null;
  subzone: string | null;
  mapID: number | null;
  x: number | null;
  y: number | null;
}

export type QuestStage = 'detail' | 'accept' | 'complete' | 'log';

export interface QuestObservationRow {
  build: number;
  stage: QuestStage | string;
  char: string;
  class: string | null;
  level: number | null;
  observedAt: string | null;
  xp: number | null;
  money: number | null;
  npc: { id: number | null; name: string | null; loc: Loc | null } | null;
  loc: Loc | null;
}

export interface QuestTurnIn {
  build: number;
  char: string;
  class: string | null;
  level: number | null;
  xp: number | null;
  money: number | null;
  turnedInAt: string;
  choice: { itemId: number; name: string | null; quality: number | null } | null;
}

export interface QuestReward {
  build: number;
  kind: 'choice' | 'reward' | string;
  itemId: number;
  name: string | null;
  quality: number | null;
  count: number | null;
  picks: number;
}

export interface QuestDetail {
  quest: {
    questId: number;
    title: string | null;
    level: number | null;
    category: string | null;
    suggestedGroup: number | null;
    objectives: string[];
    foreverOnly: boolean;
  };
  builds: number[];
  observations: QuestObservationRow[];
  turnInsTotal: number;
  turnIns: QuestTurnIn[];
  rewards: QuestReward[];
}
