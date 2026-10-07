export interface FishingFilter {
  zone: string;
  lure: '' | 'yes' | 'no';
}

/** The query string for the fishing routes (empty filters left out). */
export function fishingQuery(f: FishingFilter, extra: Record<string, string> = {}) {
  const p = new URLSearchParams();
  if (f.zone) p.set('zone', f.zone);
  if (f.lure) p.set('lure', f.lure);
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** `0.0590` → `5.9%`; null → `—`. */
export const percent = (v: number | null) =>
  v === null ? '—' : `${(v * 100).toFixed(v < 0.01 && v > 0 ? 2 : 1)}%`;

export const OUTCOME_LABELS = {
  loot: 'caught',
  escaped: 'got away',
  notHooked: 'not hooked',
  none: 'nothing',
} as const;

/** "Tanaris · Steamwheedle Port", or just the zone. */
export const placeName = (zone: string | null, subzone: string | null) =>
  [zone ?? 'Unknown zone', subzone].filter(Boolean).join(' · ');
