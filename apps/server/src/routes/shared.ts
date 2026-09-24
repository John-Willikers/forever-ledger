// Shared by the read routes: the "Forever-only" id thresholds, the 400 error, query/path parameter parsers and the
// LIKE escape. Query text is trimmed and refused (400) when longer than its cap, never silently cut.
import { INT4_MAX } from '../addon.js';

/**
 * "Forever-only" heuristic, shown as a badge: ids from these up are new in Forever (above the Classic ranges).
 * Tunable in this one place.
 */
export const FOREVER_ID_THRESHOLDS = { quest: 90_000, item: 200_000, npc: 200_000 } as const;

/** Longest `?search=` (and other free-text filters) accepted. */
export const SEARCH_MAX = 100;
/** The addon's character key (`Name-Realm`) is at most this long (contracts `charKey`). */
export const CHAR_KEY_MAX = 128;

/** A 400 thrown from a handler (the app's error handler answers `{ error: message }`). */
export const badRequest = (message: string) =>
  Object.assign(new Error(message), { statusCode: 400 });

/** `?<key>=` as trimmed text up to `max` chars (400 above), null when absent or empty. */
export function textParam(q: unknown, key: string, max: number) {
  const raw = (q as Record<string, unknown>)[key];
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (v === '') return null;
  if (v.length > max) throw badRequest(`?${key}= too long (max ${max})`);
  return v;
}

/** `?search=` (or `?<key>=`): trimmed, at most SEARCH_MAX characters (400 above), null when absent or empty. */
export const searchParam = (q: unknown, key = 'search') => textParam(q, key, SEARCH_MAX);

/** `?<key>=` naming a character (exact match): trimmed, at most CHAR_KEY_MAX characters (400 above). */
export const charKeyParam = (q: unknown, key = 'char') => textParam(q, key, CHAR_KEY_MAX);

/** `?<key>=1|true` → true; anything else → false. */
export const flagParam = (q: unknown, key: string) => {
  const raw = (q as Record<string, unknown>)[key];
  return raw === '1' || raw === 'true';
};

/** A LIKE pattern matching `text` anywhere, with `%`, `_` and `\` taken literally (use with `escape '\'`). */
export const containsPattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** A search term that is an int4 id (digits only), else null. */
export const idTerm = (s: string | null) =>
  s !== null && /^\d{1,10}$/.test(s) && Number(s) <= INT4_MAX ? Number(s) : null;

/** A route's `:id` as a positive int4, else a 400 `bad <what> id`. */
export function idParam(raw: string, what: string) {
  if (!/^\d{1,10}$/.test(raw)) throw badRequest(`bad ${what} id`);
  const n = Number(raw);
  if (n < 1 || n > INT4_MAX) throw badRequest(`bad ${what} id`);
  return n;
}
