/**
 * Helpers for WoW UI escape sequences found inside SavedVariables strings.
 * The parser keeps strings verbatim; call these when you want display text or item-link fields.
 */

/** Removes color codes, hyperlink wrappers, textures and atlas markup, keeping visible text. `||` becomes `|`. */
export function stripColorCodes(text: string): string {
  return text
    .replace(/\|c(?:[0-9a-fA-F]{8}|n[A-Za-z0-9_]+:)/g, '') // |cffRRGGBB or |cnIQ2: (named color)
    .replace(/\|r/g, '')
    .replace(/\|H[^|]*\|h(.*?)\|h/g, '$1') // |Htype:data|h[Text]|h -> [Text]
    .replace(/\|T[^|]*\|t/g, '') // textures
    .replace(/\|A[^|]*\|a/g, '') // atlases
    .replace(/\|\|/g, '|');
}

export interface ItemLink {
  itemId: number;
  /** Display name without brackets. */
  name: string;
  /** Color as written in the link: 8 hex digits (`ff1eff00`) or a named quality color (`IQ2`). */
  color: string | null;
  /** Raw colon-separated fields after `item:` (enchant, gems, suffix, unique id, level, bonus ids, ...). */
  fields: string[];
}

const ITEM_LINK =
  /(?:\|c(?<color>[0-9a-fA-F]{8}|n[A-Za-z0-9_]+):)?\|Hitem:(?<data>[^|]*)\|h\[(?<name>.*?)\]\|h/;

/** Parses the first `|Hitem:...|h[Name]|h` link in a string; returns null when there is none. */
export function parseItemLink(text: string): ItemLink | null {
  // The optional color prefix is `|cffRRGGBB` (no colon) or `|cnIQ2:`; normalize the first form for the regex.
  const normalized = text.replace(/\|c([0-9a-fA-F]{8})(?=\|H)/g, '|c$1:');
  const m = ITEM_LINK.exec(normalized);
  if (!m?.groups) return null;
  const [id = '', ...fields] = (m.groups.data ?? '').split(':');
  const itemId = Number(id);
  if (!Number.isInteger(itemId) || itemId <= 0) return null;
  const color = m.groups.color ?? null;
  return {
    itemId,
    name: m.groups.name ?? '',
    color: color?.startsWith('n') ? color.slice(1) : color,
    fields,
  };
}
