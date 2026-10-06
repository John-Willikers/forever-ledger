/**
 * Balanced-bracket scanning over inline JavaScript, so embedded JSON can be cut out and handed to JSON.parse. Page
 * scripts are never evaluated (the same rule as SavedVariables: data is parsed, never executed).
 */

/** Index just past the bracket that closes the one at `open`, or -1. Skips string literals. */
export function matchBracket(src: string, open: number): number {
  const pairs: Record<string, string> = { '{': '}', '[': ']', '(': ')' };
  const stack: string[] = [];
  let quote: string | null = null;
  for (let i = open; i < src.length; i++) {
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
