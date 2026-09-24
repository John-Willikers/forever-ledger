// Record kinds as the upload payload names them (camelCase), shown to humans.
import { formatNumber } from './format';

export interface KindCount {
  kind: string;
  label: string;
  count: number;
}

/** `itemSnapshots` → `item snapshots`, `nodeLoot` → `node loot`. */
export function kindLabel(kind: string) {
  return kind
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .toLowerCase();
}

/** Non-empty kinds, biggest first (ties by name). */
export function sortKinds(records: Record<string, number>): KindCount[] {
  return Object.entries(records)
    .filter(([, n]) => n > 0)
    .map(([kind, count]) => ({ kind, label: kindLabel(kind), count }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
}

export interface RecordSummary {
  total: number;
  top: KindCount[];
  /** Kinds beyond `top`. */
  more: number;
  /** `12 items · 11 item snapshots · 3 recipes +18 more`, or `no records`. */
  text: string;
}

/** A one-line summary of an upload's record counts. */
export function summarizeRecords(records: Record<string, number>, max = 3): RecordSummary {
  const kinds = sortKinds(records);
  const total = kinds.reduce((n, k) => n + k.count, 0);
  const top = kinds.slice(0, max);
  const more = kinds.length - top.length;
  const text =
    kinds.length === 0
      ? 'no records'
      : top.map((k) => `${formatNumber(k.count)} ${k.label}`).join(' · ') +
        (more > 0 ? ` +${more} more` : '');
  return { total, top, more, text };
}
