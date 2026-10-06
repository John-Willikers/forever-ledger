/**
 * Balanced-bracket scanning over inline JavaScript, so embedded JSON can be cut out and handed to JSON.parse. Page
 * scripts are never evaluated (the same rule as SavedVariables: data is parsed, never executed).
 */

/** Longest bracketed value we cut out (one Listview's data); longer is treated as unbalanced. */
export const MAX_BRACKETED = 4 * 1024 * 1024;

/** Index just past the bracket that closes the one at `open`, or -1. Skips string literals. */
export function matchBracket(src: string, open: number, maxLen = MAX_BRACKETED): number {
  const pairs: Record<string, string> = { '{': '}', '[': ']', '(': ')' };
  const stack: string[] = [];
  let quote: string | null = null;
  const end = Math.min(src.length, open + maxLen);
  for (let i = open; i < end; i++) {
    const c = src[i]!;
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (pairs[c]) stack.push(pairs[c]);
    else if (c === '}' || c === ']' || c === ')') {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return i + 1;
    }
  }
  return -1;
}

/** JSON.parse of `text`, or undefined when it isn't JSON (a JS literal with bare keys, a function call, …). */
export function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The bracketed value (`{…}` or `[…]`) that starts at the first `{`/`[` at or after `from`, as text. */
export function bracketedAfter(src: string, from: number): string | null {
  const m = /[[{]/.exec(src.slice(from));
  if (!m) return null;
  const start = from + m.index;
  const end = matchBracket(src, start);
  return end === -1 ? null : src.slice(start, end);
}

/**
 * Positions just past each `marker` that sits in code, not inside a string literal or a comment, in one pass. A
 * comment body quoting `new Listview(` (inside a JSON string) is not a Listview. At most `maxHits` positions.
 */
export function codeMarkers(src: string, marker: string, maxHits = 200): number[] {
  const hits: number[] = [];
  let quote: string | null = null;
  for (let i = 0; i < src.length && hits.length < maxHits; i++) {
    const c = src[i]!;
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      i = nl === -1 ? src.length : nl;
    } else if (c === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2);
      i = close === -1 ? src.length : close + 1;
    } else if (c === marker[0] && src.startsWith(marker, i)) {
      hits.push(i + marker.length);
      i += marker.length - 1;
    }
  }
  return hits;
}

/**
 * `obj` (an object literal's text) with everything nested deeper than its own keys blanked to spaces, same length:
 * the keys and short values of the top level stay, so `id:` inside a data row can't be mistaken for the object's.
 */
export function topLevel(obj: string): string {
  const out = obj.split('');
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < obj.length; i++) {
    const c = obj[i]!;
    const blank = depth >= 2;
    if (quote) {
      if (c === '\\') {
        if (blank) out[i] = out[i + 1] = ' ';
        i++;
      } else if (c === quote) quote = null;
      if (blank) out[i] = ' ';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
    if (blank && depth >= 2) out[i] = ' ';
  }
  return out.join('');
}
