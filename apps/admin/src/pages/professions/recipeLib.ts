// Pure helpers for recipe details and the links to them (Professions, Vendors & trainers and Item pages). Names and
// tooltip lines come from uploads, cleaned by the server: rendered as text only.
import type { LearnSource, RecipeDetail } from './types';

const INT4_MAX = 2147483647;

/** The Professions page with a recipe's details open. */
export const recipeHref = (recipeId: number) => `/professions?recipe=${recipeId}`;

/** The Item page. */
export const itemHref = (itemId: number) => `/items/${itemId}`;

/** `?recipe=` as a positive int4 recipe id, else null. */
export function recipeParam(params: URLSearchParams) {
  const raw = params.get('recipe');
  if (raw === null || !/^\d{1,10}$/.test(raw)) return null;
  const n = Number(raw);
  return n > 0 && n <= INT4_MAX ? n : null;
}

/** A tooltip line's left and right columns (the game right-aligns the part after a tab: "Wrist\tMail"). */
export function tooltipColumns(line: string): [string, string | null] {
  const at = line.indexOf('\t');
  if (at < 0) return [line, null];
  return [line.slice(0, at), line.slice(at + 1).replace(/\t/g, ' ')];
}

/**
 * What a recipe makes, in words: the output item's tooltip without its name line, else the tooltip of the first recipe
 * item that has one (its name line dropped: enchants make no item, their recipe item says what they do).
 */
export function descriptionLines(
  output: { name: string | null; tooltip: string[] } | null,
  recipeItems: { name: string | null; tooltip: string[] }[],
): { from: 'output' | 'recipeItem' | null; lines: string[] } {
  const body = (t: { name: string | null; tooltip: string[] }) =>
    t.tooltip[0] !== undefined && t.tooltip[0] === t.name ? t.tooltip.slice(1) : t.tooltip;
  if (output && output.tooltip.length > 0) return { from: 'output', lines: body(output) };
  const item = recipeItems.find((i) => i.tooltip.length > 0);
  return item ? { from: 'recipeItem', lines: body(item) } : { from: null, lines: [] };
}

type Requirements = RecipeDetail['requirements'];

/** `Learn at Engineering 230`; rank 0 means no minimum. */
export function skillRankText(r: Requirements['skillRank'], profession: string | null) {
  if (!r) return 'Skill rank to learn it not seen yet';
  if (r.rank === 0) return profession ? `Learn at any ${profession} rank` : 'Learn at any rank';
  return profession ? `Learn at ${profession} ${r.rank}` : `Learn at skill rank ${r.rank}`;
}

/** Where a requirement was read: `trainer Gnome Engineer`, `recipe item Schematic: Bombs`. */
export function sourceHint(s: LearnSource) {
  return s.source === 'trainer'
    ? `trainer ${s.npcName ?? `NPC ${s.npcId}`}`
    : `recipe item ${s.itemName ?? `Item ${s.itemId}`}`;
}

export const charLevelText = (r: Requirements['charLevel']) =>
  r ? `Character level ${r.level}` : 'No character level required (none seen)';

export const useLevelText = (u: Requirements['useLevel']) =>
  u ? `Requires Level ${u.level} to use` : null;

/** `×2`, `×1–3`; nothing for a single item. */
export function qtyText(min: number | null, max: number | null) {
  const lo = min ?? 1;
  const hi = max ?? lo;
  if (lo === 1 && hi === 1) return '';
  return lo === hi ? `×${lo}` : `×${lo}–${hi}`;
}

/** A maker's profession and rank to learn it: `Engineering 230`, `Engineering`, `rank 50`, or nothing. */
export function makerRank(m: {
  profession: { skillLineId: number; name: string | null } | null;
  skillRank: number | null;
}) {
  const name = m.profession?.name ?? null;
  const rank = m.skillRank ?? null;
  if (name && rank !== null) return `${name} ${rank}`;
  if (name) return name;
  return rank !== null ? `rank ${rank}` : '';
}
