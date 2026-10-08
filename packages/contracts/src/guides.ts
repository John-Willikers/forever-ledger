import { z } from 'zod';

/**
 * In-game guides (project-plans/forever-ledger-guides.md): built on the server from one of our players' real runs,
 * delivered to the tray that uploads the target character, written into the generated ForeverLedger_Guides addon and
 * shown by the ForeverLedger addon's guide viewer. Every field here ends up as a Lua literal in the game: plain
 * strings and numbers only, never code.
 */
export const GUIDE_ACTIONS = ['accept', 'complete', 'turn_in', 'travel'] as const;
export type GuideAction = (typeof GUIDE_ACTIONS)[number];
/**
 * The guide format GET /v1/guides?format=2 serves. Format 1 (trays up to v0.3.2, no `format` param) has no travel
 * steps, no `how` / `note` and needs a quest on every step: the server sends those trays `toFormat1(doc)`.
 */
export const GUIDE_FORMAT = 2;
/** How a travel step goes: on foot (or mounted, or a travel form), a flight, a boat / zeppelin, the hearthstone. */
export const GUIDE_TRAVEL = ['walk', 'fly', 'boat', 'hearth'] as const;

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

export const GuideStep = z
  .object({
    action: z.enum(GUIDE_ACTIONS),
    /** Travel steps only. */
    how: z.enum(GUIDE_TRAVEL).optional(),
    /**
     * Arrows are ASCII. "Travel Form", "Ghost Wolf", "class quest", "Hearthstone", "wait 300 s", a flight
     * "Orgrimmar, Durotar -> Crossroads, The Barrens", a transport "<kind>: <route>" ("zeppelin: Tirisfal Glades to
     * Durotar", kind zeppelin or boat).
     */
    note: text(120).optional(),
    npc: text(120).nullable(),
    zone: text(120).nullable(),
    subzone: text(120).nullable(),
    /** UiMapID and position (0-100) for a map pin. */
    mapId: z.number().int().positive().nullable(),
    x: coord.nullable(),
    y: coord.nullable(),
    /** Empty only on travel steps. */
    quests: z.array(GuideQuest).max(20),
    /** Turn-ins: the level the route's character had after it. */
    levelAfter: z.number().int().min(1).max(80).nullable().optional(),
  })
  .superRefine((s, ctx) => {
    if (s.action !== 'travel' && s.quests.length === 0)
      ctx.addIssue({
        code: 'custom',
        path: ['quests'],
        message: `a ${s.action} step needs a quest`,
      });
    if (s.action !== 'travel' && s.how !== undefined)
      ctx.addIssue({ code: 'custom', path: ['how'], message: 'only travel steps say how' });
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
  /** Whose run it follows ("the route planner" for a planned guide). */
  basedOn: text(128),
  /** Built by the route planner for the character (else it replays one of our players' runs). */
  planned: z.boolean().optional(),
  steps: z.array(GuideStep).min(1).max(400),
});
export type GuideDoc = z.infer<typeof GuideDoc>;

/**
 * A guide as a format-1 tray (v0.3.2 and older) reads it: travel steps, `how`, `note` and `planned` dropped. Null when
 * no step is left (that tray would reject the whole response over it).
 */
export function toFormat1(doc: GuideDoc): GuideDoc | null {
  const steps = doc.steps
    .filter((s) => s.action !== 'travel' && s.quests.length > 0)
    .map(({ how: _how, note: _note, ...s }) => s);
  if (steps.length === 0) return null;
  const { planned: _planned, ...rest } = doc;
  return { ...rest, steps };
}

/** GET /v1/guides: the guides for the characters this tray uploads, newest first. */
export const GuidesResponse = z.object({ guides: z.array(GuideDoc) });
export type GuidesResponse = z.infer<typeof GuidesResponse>;

/** POST /v1/guides/ack: the guides the tray wrote into the game. */
export const GuidesAck = z.object({ ids: z.array(z.number().int().positive()).max(200) });
export type GuidesAck = z.infer<typeof GuidesAck>;
