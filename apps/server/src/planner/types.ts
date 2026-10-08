// The route planner's shared vocabulary: an atlas of quests, one character's state, and the plan it gets. Pure data,
// no database rows: the planner (src/planner) never does I/O.

/** A point in the world: continent instance (0 Eastern Kingdoms, 1 Kalimdor, …) and world yards (x north, y west). */
export interface WorldPos {
  continent: number;
  x: number;
  y: number;
}

/** A spot on a client map: uiMapID and percent coordinates (0-100), as guides and the atlas store them. */
export interface MapSpot {
  mapId: number;
  x: number;
  y: number;
}

export type ObjectiveKind = 'kill' | 'collect' | 'object' | 'explore' | 'talk' | 'other';

export interface AtlasObjective {
  index: number;
  kind: ObjectiveKind;
  /** What the quest log says, e.g. "Mindless Zombie slain: 8". */
  text: string;
  count: number;
  /** Where it is done (mob spawns, objects, areas). Empty when unknown. */
  spots: MapSpot[];
  /** Seconds per unit when our players' progress timestamps say so; else the planner's default. */
  secondsEach?: number;
}

export interface QuestPoint {
  /** Absent = 'npc'. NPC, object and item ids are separate number spaces. */
  kind?: 'npc' | 'object' | 'item';
  id: number;
  name: string;
  spots: MapSpot[];
}

export interface AtlasQuest {
  id: number;
  title: string;
  level: number;
  reqLevel: number;
  side: 'Alliance' | 'Horde' | 'both';
  /** null = any class / race. Class and race names as the client's English tokens ('WARLOCK', 'Scourge'). */
  classes: string[] | null;
  races: string[] | null;
  /** Who starts / ends the quest: an NPC (default), a game object (a wanted poster) or an item that starts it. */
  giver: QuestPoint | null;
  ender: QuestPoint | null;
  /** Quests that must be turned in first (from the Wowhead series). */
  prereqs: number[];
  objectives: AtlasObjective[];
  xp: number;
}

export interface Atlas {
  quests: Map<number, AtlasQuest>;
}

export interface CharacterState {
  level: number;
  /** XP into the current level. */
  xp: number;
  className: string;
  race: string;
  faction: 'Alliance' | 'Horde';
  completed: Set<number>;
  /** Quests in the log now, with objective counts done. */
  log: Map<number, number[]>;
  position: MapSpot;
  /** Flight master node ids the character has learned. */
  flightPaths: Set<number>;
  /** Hearthstone: where it goes (a spot) and when it is ready, on the planner clock (seconds from the plan start). */
  hearth: { spot: MapSpot; readyAt: number } | null;
  mounted: boolean;
}

export type PlanAction = 'travel' | 'accept' | 'complete' | 'turn_in';

export interface PlanStep {
  action: PlanAction;
  /** travel: how ('walk' | 'fly' | 'boat' | 'hearth' | 'learn_flight' | 'set_hearth'). */
  how?: string;
  npc: string | null;
  zone: string | null;
  spot: MapSpot | null;
  quests: { questId: number; title: string; objectives?: string[] }[];
  /** Planned clock at the end of the step (seconds from the start) and the level then. */
  at: number;
  level: number;
  note?: string;
}
