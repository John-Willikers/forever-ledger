// Planner XP: Classic 1.12 numbers (Forever uploads may override them later). The beta's level cap is 30 (CLAUDE.md):
// at the cap a character earns no XP.

/** Level cap on the beta (build 70235+). */
export const LEVEL_CAP = 30;

/** XP from level n to n + 1, n = 1 … 29 (index n - 1). */
const XP_TO_NEXT = [
  400, 900, 1400, 2100, 2800, 3600, 4500, 5400, 6500, 7600, 8800, 10100, 11400, 12900, 14400, 16000,
  17700, 19400, 21300, 23200, 25200, 27300, 29400, 31700, 34000, 36400, 38900, 41400, 44300,
];

/** XP needed to leave `level`; 0 at (or past) the cap or beyond the table. */
export function xpToNext(level: number, cap = LEVEL_CAP): number {
  if (level >= cap) return 0;
  return XP_TO_NEXT[level - 1] ?? 0;
}

/**
 * Quest XP for a player `playerLevel - questLevel` levels above the quest: full up to 5 levels, then 80 / 60 / 40 /
 * 20 %, and 10 % from 10 levels on. Rounded down to 5 XP.
 */
export function questXp(baseXp: number, questLevel: number, playerLevel: number): number {
  const d = playerLevel - questLevel;
  // Whole percents, so 40 % of 1000 is exactly 400 (no float noise before the rounding down).
  const percent = d <= 5 ? 100 : d >= 10 ? 10 : 100 - (d - 5) * 20;
  return Math.floor((baseXp * percent) / 100 / 5) * 5;
}

/** How many levels below the player a quest may be before it goes grey. */
function greyGap(level: number): number {
  if (level <= 5) return 5;
  // Classic: 5 + floor(level / 10) through 39; from 40 the gap is 1 + floor(level / 5) (unused while the cap is 30).
  if (level <= 39) return 5 + Math.floor(level / 10);
  return 1 + Math.floor(level / 5);
}

/** A grey quest (or mob) gives the player little or nothing. */
export const isGrey = (questLevel: number, playerLevel: number): boolean =>
  questLevel < playerLevel - greyGap(playerLevel);

/** Kill XP of a same-level mob in Azeroth; a planning estimate (the quest level stands in for the mob level). */
export const mobXp = (mobLevel: number): number => 45 + 5 * mobLevel;

/** `state` after gaining `xp`, levelling up as often as it pays for; at the cap the level stays and XP is 0. Pure. */
export function gain(
  state: { level: number; xp: number },
  xp: number,
  cap = LEVEL_CAP,
): { level: number; xp: number } {
  let { level } = state;
  let into = state.xp + xp;
  while (level < cap) {
    const need = xpToNext(level, cap);
    if (need <= 0 || into < need) break;
    into -= need;
    level++;
  }
  return { level, xp: level >= cap ? 0 : into };
}
