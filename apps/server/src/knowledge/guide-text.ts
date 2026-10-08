// Text that ends up in an in-game guide (knowledge/guides.ts, knowledge/plan-guide.ts).

/**
 * Text shown in the game: control characters (newlines included) become spaces and WoW's "|" escape character is
 * dropped, so an uploaded name can't color text, add links or textures, or fake a chat line. The viewer escapes "|"
 * again before showing anything.
 */
export const clean = (s: string) =>
  s
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\|/g, '')
    .trim();

/** `clean`, cut to `max` characters; null stays null. */
export const clip = (s: string | null | undefined, max: number) => {
  if (s === null || s === undefined) return null;
  const c = clean(s);
  return c.length > max ? c.slice(0, max) : c;
};
