// Planner availability: which quests a character can pick up at a given level. Pure.
import { startAreaOf } from './start-areas.js';
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
 * Harlan (2026-10-09): a character uses its own race's starter class quests. A class quest whose giver stands in
 * another race's start area is not for it, though Wowhead's race list (the races that can be the class) includes it:
 * 1485 Vile Familiars (Valley of Trials) lists Undead, 1470 Piercing the Veil (Deathknell) lists Orc. Quests for any
 * class there are still anyone's.
 */
function inOtherStartArea(q: AtlasQuest, race: string): boolean {
  const spot = q.giver?.spots[0];
  const area = spot ? startAreaOf(spot) : null;
  return area !== null && !area.races.includes(race);
}

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
  if (isClassQuest(q) && inOtherStartArea(q, ch.race)) return false;
  // Harlan: class quests always (they pay in spells and gear): never too grey, never too high once allowed.
  if (isClassQuest(q)) return true;
  if (isGrey(q.level, level)) return false;
  return q.level <= level + MAX_LEVELS_UP;
}
