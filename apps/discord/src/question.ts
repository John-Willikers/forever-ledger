// Turning a Discord message into a question, and an answer into Discord messages. Pure: tested without Discord.

/** Discord's limit per message. */
export const DISCORD_MAX = 2000;
/** An answer never takes more than this many messages (a wall of text helps nobody). */
export const MAX_PARTS = 3;
/** Longest question passed on (a pasted essay is cut, and the cut is said). */
export const QUESTION_MAX = 1500;

export interface Question {
  text: string;
  /** `--opus` asked for Claude Opus 5.5 on this answer. */
  opus: boolean;
  truncated: boolean;
}

/** The question in a message: mentions removed, `--opus` taken out as a flag. Null when nothing is left to answer. */
export function parseQuestion(content: string): Question | null {
  let text = content.replace(/<@[!&]?\d+>/g, ' ');
  const opus = /(^|\s)--opus(\s|$)/i.test(text);
  text = text
    .replace(/(^|\s)--opus(?=\s|$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  const truncated = text.length > QUESTION_MAX;
  return { text: truncated ? text.slice(0, QUESTION_MAX) : text, opus, truncated };
}

/** A thread name from the question (Discord allows 100 characters). */
export function threadName(question: string): string {
  const name = question.replace(/[\r\n]+/g, ' ').trim();
  return name.length > 90 ? `${name.slice(0, 89)}…` : name || 'Ledger question';
}

/**
 * Splits an answer into Discord messages at paragraph or line breaks, never mid-word when it can help it, at most
 * `MAX_PARTS` messages (the last one says when the rest was cut).
 */
export function splitForDiscord(text: string, max = DISCORD_MAX, maxParts = MAX_PARTS): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > 0 && parts.length < maxParts) {
    if (rest.length <= max) {
      parts.push(rest);
      rest = '';
      break;
    }
    const window = rest.slice(0, max);
    const cut = Math.max(
      window.lastIndexOf('\n\n'),
      window.lastIndexOf('\n'),
      window.lastIndexOf(' '),
    );
    const at = cut > max / 2 ? cut : max;
    parts.push(rest.slice(0, at).trimEnd());
    rest = rest.slice(at).trimStart();
  }
  if (rest.length > 0) {
    const note = '\n…(answer cut short: ask a narrower question for the rest)';
    const last = parts[parts.length - 1]!;
    parts[parts.length - 1] = last.slice(0, max - note.length) + note;
  }
  return parts.length > 0 ? parts : ['(no answer)'];
}

export interface Limits {
  /** Questions per user per hour, and how many of those may use Opus. */
  perHour: number;
  opusPerHour: number;
  /** Questions per hour for everyone together (the API bill's ceiling), and Opus answers among them. */
  allPerHour: number;
  allOpusPerHour: number;
}

const HOUR = 3_600_000;

/** Per-user and bot-wide hourly limits. */
export function rateLimiter(limits: Limits, now: () => number = Date.now) {
  const asked = new Map<string, { at: number; opus: boolean }[]>();
  let all: { at: number; opus: boolean }[] = [];
  return {
    /** Null when the question may go ahead (and counts it), else why not. */
    take(userId: string, opus: boolean): string | null {
      const t = now();
      all = all.filter((q) => t - q.at < HOUR);
      const recent = (asked.get(userId) ?? []).filter((q) => t - q.at < HOUR);
      if (recent.length === 0) asked.delete(userId);
      if (all.length >= limits.allPerHour) {
        return "I've answered all the questions I can this hour; try again later";
      }
      if (opus && all.filter((q) => q.opus).length >= limits.allOpusPerHour) {
        return 'Opus is out of answers for this hour; ask without --opus, or wait a bit';
      }
      if (recent.length >= limits.perHour) {
        return `you've asked ${limits.perHour} questions this hour; try again a bit later`;
      }
      if (opus && recent.filter((q) => q.opus).length >= limits.opusPerHour) {
        return `that's ${limits.opusPerHour} Opus answers this hour; ask without --opus, or wait a bit`;
      }
      const q = { at: t, opus };
      recent.push(q);
      all.push(q);
      asked.set(userId, recent);
      return null;
    },
  };
}

/** A limit from the environment: a whole number of at least 1, else the default (a typo never removes a limit). */
export function limitFrom(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return raw !== undefined && raw.trim() !== '' && Number.isInteger(n) && n >= 1 ? n : fallback;
}
