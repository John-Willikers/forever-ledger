import type { ClaimLabel } from './types';

/** Source tiers, most trusted first (contracts SOURCE_TIERS). */
export const TIER_NAMES: Readonly<Record<number, string>> = {
  1: 'first-party',
  2: 'Blizzard',
  3: 'datamined',
  4: 'Forever guide',
  5: 'Classic-era',
  6: 'forum / comment',
  7: 'low trust',
};

export const tierName = (tier: number) => TIER_NAMES[tier] ?? `tier ${tier}`;

export const LABELS: readonly ClaimLabel[] = [
  'VERIFIED',
  'CLASSIC',
  'ANECDOTE',
  'UNVERIFIED',
  'FALSE',
];

export const VALUE_MAX = 240;

/**
 * A claim value as one line of plain text: `{min, max}` as a range, lists joined, objects as `key: value` pairs. The
 * values come from web pages, so they are only ever rendered as text.
 */
export function formatValue(v: unknown): string {
  const text = (x: unknown): string => {
    if (x === null || x === undefined) return '—';
    if (typeof x === 'string') return x;
    if (typeof x === 'number') return String(x);
    if (typeof x === 'boolean') return x ? 'yes' : 'no';
    if (Array.isArray(x)) return x.map(text).join(', ');
    if (typeof x === 'object') {
      const o = x as Record<string, unknown>;
      const keys = Object.keys(o);
      if (keys.length === 2 && typeof o.min === 'number' && typeof o.max === 'number') {
        return o.min === o.max ? String(o.min) : `${o.min}–${o.max}`;
      }
      return keys.map((k) => `${k}: ${text(o[k])}`).join(' · ');
    }
    return String(x);
  };
  const out = text(v);
  return out.length > VALUE_MAX ? `${out.slice(0, VALUE_MAX - 1)}…` : out;
}

/** The claim's entity as shown: its name when it has one, else `type id`. */
export function entityLabel(c: {
  entityType: string;
  entityKey: string;
  entityName?: string | null;
}) {
  return c.entityName ?? `${c.entityType} ${c.entityKey}`;
}

/** Only http(s) links are rendered as links. */
export const safeHref = (url: string | null) =>
  url !== null && /^https?:\/\//i.test(url) ? url : null;
