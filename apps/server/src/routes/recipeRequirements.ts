// What it takes to learn and use a recipe, read from uploaded tooltips and trainer services. Tooltip lines are
// untrusted text: they are cleaned of WoW escape codes and parsed by pattern, never interpreted. Forever's recipe items
// (items.class_id = 9) embed the output item's tooltip: after the recipe's own header comes a "\n<output name>" line,
// the output's lines (its own "Requires Level N" = the level to *use* the item) and then the recipe's "Use: Teaches…"
// line, the reagents and the recipe's own "Requires <Profession> (N)".

/** Coin icons (atlas or texture) as the letter the panel's money uses. */
const COINS: readonly [RegExp, string][] = [
  [/\|A:coin-gold[^|]*\|a/gi, 'g'],
  [/\|A:coin-silver[^|]*\|a/gi, 's'],
  [/\|A:coin-copper[^|]*\|a/gi, 'c'],
  [/\|T[^|]*GoldIcon[^|]*\|t/gi, 'g'],
  [/\|T[^|]*SilverIcon[^|]*\|t/gi, 's'],
  [/\|T[^|]*CopperIcon[^|]*\|t/gi, 'c'],
];

/**
 * One tooltip line as plain text: coin icons become g/s/c; colors (`|cAARRGGBB`, `|cn<NAME>:`, `|r`), links (`|H…|h`),
 * textures (`|T…|t`), atlases (`|A…|a`) and `|K…|k` are dropped; `|n` is a space and `||` a bar. A tab (the right-hand
 * column, "Wrist\tMail") is kept. Trimmed; the panel renders it as text only.
 */
export function cleanTooltipLine(line: string) {
  let out = line;
  for (const [re, letter] of COINS) out = out.replace(re, letter);
  return out
    .replace(/\|T[^|]*\|t/g, '')
    .replace(/\|A[^|]*\|a/g, '')
    .replace(/\|K[^|]*\|k/g, '')
    .replace(/\|c[0-9a-fA-F]{8}/g, '')
    .replace(/\|cn[A-Za-z0-9_]*:/g, '')
    .replace(/\|r/g, '')
    .replace(/\|H[^|]*\|h/g, '')
    .replace(/\|h/g, '')
    .replace(/\|n/g, ' ')
    .replace(/\|\|/g, '|')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

const lines = (tooltip: unknown): string[] =>
  Array.isArray(tooltip) ? tooltip.filter((l): l is string => typeof l === 'string') : [];

/** A stored tooltip (jsonb, untrusted) as cleaned lines: strings only, empty lines dropped; not an array → none. */
export const cleanTooltip = (tooltip: unknown) =>
  lines(tooltip)
    .map(cleanTooltipLine)
    .filter((l) => l !== '');

/**
 * The output item's tooltip embedded in a recipe item's: [start, end) from the first "\n<name>" line (never the first
 * line) to the last "Use:" line after it (the recipe's "Use: Teaches…"), or to the end without one. Null when none.
 */
export function embeddedRange(tooltip: string[]): [number, number] | null {
  const start = tooltip.findIndex((l, i) => i > 0 && typeof l === 'string' && l.startsWith('\n'));
  if (start < 0) return null;
  for (let j = tooltip.length - 1; j > start; j--)
    if (/^\s*Use:/.test(tooltip[j] ?? '')) return [start, j];
  return [start, tooltip.length];
}

/** A recipe item's own lines (the embedded output block left out), cleaned. */
function ownLines(tooltip: unknown) {
  const all = lines(tooltip);
  const range = embeddedRange(all);
  const own = range ? [...all.slice(0, range[0]), ...all.slice(range[1])] : all;
  return own.map(cleanTooltipLine);
}

const RANK_MAX = 1000;
const LEVEL_MAX = 200;

/**
 * The skill rank a recipe item asks for: the last of its own lines that names the profession (any case) and has a
 * "(N)", N being the line's last "(N)". Locale-light: only the profession name and the "(N)" are matched.
 */
export function parseSkillRank(tooltip: unknown, profession: string | null) {
  if (!profession) return null;
  const prof = profession.toLowerCase();
  const own = ownLines(tooltip);
  for (let i = own.length - 1; i >= 0; i--) {
    const line = own[i]!;
    if (!line.toLowerCase().includes(prof)) continue;
    const m = /\((\d{1,4})\)[^(]*$/.exec(line);
    if (m && Number(m[1]) <= RANK_MAX) return Number(m[1]);
  }
  return null;
}

/** "Requires Level N" (any line ending in "Level N") among `candidates`, the first one. */
function levelLine(candidates: string[]) {
  for (const line of candidates) {
    const m = /\bLevel\s+(\d{1,3})\s*$/i.exec(line);
    if (m && Number(m[1]) <= LEVEL_MAX) return Number(m[1]);
  }
  return null;
}

/** The character level a recipe item asks for: a "Level N" line of its own (the output's is the level to use it). */
export const parseCharLevel = (tooltip: unknown) => levelLine(ownLines(tooltip));

/** The level to use an item: its snapshot's req_level above 1, else its tooltip's "Requires Level N", else null. */
export function useLevel(reqLevel: number | null, tooltip: unknown) {
  if (typeof reqLevel === 'number' && reqLevel > 1) return { level: reqLevel, source: 'reqLevel' };
  const level = levelLine(cleanTooltip(tooltip));
  return level === null ? null : { level, source: 'tooltip' };
}

export interface TrainerOffer {
  npcId: number;
  npcName: string | null;
  skillRank: number | null;
  level: number | null;
}

export interface RecipeItemInfo {
  itemId: number;
  itemName: string | null;
  reqLevel: number | null;
  tooltip: unknown;
}

type Source =
  | { source: 'trainer'; npcId: number; npcName: string | null }
  | { source: 'recipeItem'; itemId: number; itemName: string | null };

const fromTrainer = (t: TrainerOffer): Source => ({
  source: 'trainer',
  npcId: t.npcId,
  npcName: t.npcName,
});
const fromItem = (i: RecipeItemInfo): Source => ({
  source: 'recipeItem',
  itemId: i.itemId,
  itemName: i.itemName,
});

/**
 * What it takes to learn a recipe, best source first (each list in preference order).
 * Skill rank: a trainer service of the same name with a skill rank (0 = no minimum), else a recipe item's
 * "Requires <Profession> (N)", else null. Character level: a recipe item's own "Requires Level N" line, else its
 * snapshot req_level above 1, else a trainer service level above 0, else null.
 */
export function learnRequirements(input: {
  profession: string | null;
  trainers: TrainerOffer[];
  recipeItems: RecipeItemInfo[];
}) {
  let skillRank: ({ rank: number } & Source) | null = null;
  const trainer = input.trainers.find((t) => typeof t.skillRank === 'number' && t.skillRank >= 0);
  if (trainer) skillRank = { rank: trainer.skillRank!, ...fromTrainer(trainer) };
  else
    for (const item of input.recipeItems) {
      const rank = parseSkillRank(item.tooltip, input.profession);
      if (rank !== null) {
        skillRank = { rank, ...fromItem(item) };
        break;
      }
    }

  let charLevel: ({ level: number } & Source) | null = null;
  for (const item of input.recipeItems) {
    const level = parseCharLevel(item.tooltip);
    if (level !== null) {
      charLevel = { level, ...fromItem(item) };
      break;
    }
  }
  if (!charLevel) {
    const item = input.recipeItems.find((i) => typeof i.reqLevel === 'number' && i.reqLevel > 1);
    if (item) charLevel = { level: item.reqLevel!, ...fromItem(item) };
  }
  if (!charLevel) {
    const t = input.trainers.find((x) => typeof x.level === 'number' && x.level > 0);
    if (t) charLevel = { level: t.level!, ...fromTrainer(t) };
  }
  return { skillRank, charLevel };
}

/** The recipe a Recipe-class item teaches, by name: "Plans: Rough Weightstone" → "Rough Weightstone". */
export function recipeNameOf(itemName: string | null) {
  if (typeof itemName !== 'string') return null;
  const m = /^([^:]+): (.+)$/.exec(itemName);
  return m && m[1]!.trim() !== '' ? m[2]!.trim() || null : null;
}
