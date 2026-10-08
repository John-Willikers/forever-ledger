import { z } from 'zod';

/**
 * In-game guides (project-plans/forever-ledger-guides.md): built on the server from one of our players' real runs,
 * delivered to the tray that uploads the target character, written into the generated ForeverLedger_Guides addon and
 * shown by the ForeverLedger addon's guide viewer. Every field here ends up as a Lua literal in the game: plain
 * strings and numbers only, never code.
 */
export const GUIDE_ACTIONS = ['accept', 'complete', 'turn_in'] as const;
export type GuideAction = (typeof GUIDE_ACTIONS)[number];

const text = (max: number) => z.string().max(max);
const coord = z.number().min(0).max(100);

export const GuideQuest = z.object({
  questId: z.number().int().positive(),
  title: text(200).nullable(),
  /** What to do, e.g. "Mindless Zombie slain: 8". */
  objectives: z.array(text(200)).max(12).optional(),
  /**
   * Pickups: the level the quest can be taken at, from Wowhead's required level when the ledger has it, else the lowest
   * level one of our characters took it at (`minLevelFrom`).
   */
  minLevel: z.number().int().min(1).max(80).optional(),
  minLevelFrom: z.enum(['wowhead', 'seen']).optional(),
});
export type GuideQuest = z.infer<typeof GuideQuest>;

export const GuideStep = z.object({
  action: z.enum(GUIDE_ACTIONS),
  npc: text(120).nullable(),
  zone: text(120).nullable(),
  subzone: text(120).nullable(),
  /** UiMapID and position (0-100) for a map pin. */
  mapId: z.number().int().positive().nullable(),
  x: coord.nullable(),
  y: coord.nullable(),
  quests: z.array(GuideQuest).min(1).max(20),
  /** Turn-ins: the level the route's character had after it. */
  levelAfter: z.number().int().min(1).max(80).nullable().optional(),
});
export type GuideStep = z.infer<typeof GuideStep>;

export const GuideDoc = z.object({
  id: z.number().int().positive(),
  /** The character key it is for (full name + realm). */
  char: text(128),
  title: text(120),
  /** ISO time it was built (America/Chicago offset). */
  createdAt: text(40),
  fromLevel: z.number().int().min(1).max(80),
  toLevel: z.number().int().min(1).max(80),
  /** Whose run it follows. */
  basedOn: text(128),
  steps: z.array(GuideStep).min(1).max(400),
});
export type GuideDoc = z.infer<typeof GuideDoc>;

/** GET /v1/guides: the guides for the characters this tray uploads, newest first. */
export const GuidesResponse = z.object({ guides: z.array(GuideDoc) });
export type GuidesResponse = z.infer<typeof GuidesResponse>;

/** POST /v1/guides/ack: the guides the tray wrote into the game. */
export const GuidesAck = z.object({ ids: z.array(z.number().int().positive()).max(200) });
export type GuidesAck = z.infer<typeof GuidesAck>;
