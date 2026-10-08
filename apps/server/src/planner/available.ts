// Planner availability: which quests a character can pick up at a given level. Pure.
import { isGrey } from './xp.js';
import type { Atlas, AtlasQuest, CharacterState } from './types.js';

/** The part of a character's state availability reads. */
export type Taker = Pick<
  CharacterState,
  'level' | 'className' | 'race' | 'faction' | 'completed' | 'log'
>;

/** Further than this many levels above the character, a quest waits (it would be red and slow). */
export const MAX_LEVELS_UP = 3;

/** A quest for some classes only; a list of all nine Classic classes counts as "any class". */
export const isClassQuest = (q: AtlasQuest): boolean => q.classes !== null && q.classes.length < 9;

/**
 * Whether `ch` can take `q` at `level` (the planner's projected level, not necessarily `ch.level`). A
 * prerequisite the atlas knows as the other faction's quest (a faction-split series step) is not needed.
 */
export function canTake(q: AtlasQuest, ch: Taker, level: number, atlas: Atlas): boolean {
  if (q.side !== 'both' && q.side !== ch.faction) return false;
  if (q.classes !== null && !q.classes.includes(ch.className)) return false;
  if (q.races !== null && !q.races.includes(ch.race)) return false;
  if (ch.completed.has(q.id) || ch.log.has(q.id)) return false;
  const otherSide = (id: number) => {
    const side = atlas.quests.get(id)?.side;
    return side !== undefined && side !== 'both' && side !== ch.faction;
  };
  if (!q.prereqs.every((id) => ch.completed.has(id) || otherSide(id))) return false;
  if (level < q.reqLevel) return false;
  // Harlan: class quests always (they pay in spells and gear): never too grey, never too high once allowed.
  if (isClassQuest(q)) return true;
  if (isGrey(q.level, level)) return false;
  return q.level <= level + MAX_LEVELS_UP;
}
