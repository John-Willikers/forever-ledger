// Pure helpers for the Vendors & trainers page.
import type { MapPoint } from '../../lib/zoneMap';
import type { Location } from './types';

const DASH = '—';

/** `Elwynn Forest · Goldshire (42.1, 65.9)`; `Map 7` without a zone name. */
export function formatLocation(loc: Location | null) {
  if (!loc) return DASH;
  const place =
    [loc.zone, loc.subzone].filter(Boolean).join(' · ') ||
    (loc.mapId !== null ? `Map ${loc.mapId}` : '');
  const at = loc.x !== null && loc.y !== null ? ` (${loc.x.toFixed(1)}, ${loc.y.toFixed(1)})` : '';
  return place || at ? `${place}${at}`.trim() : DASH;
}

/** `Tailoring 10`: a trainer service's skill requirement. */
export function skillReq(skill: string | null, rank: number | null) {
  if (skill && rank) return `${skill} ${rank}`;
  if (skill) return skill;
  if (rank) return `Rank ${rank}`;
  return DASH;
}

/** A vendor listing's stock: -1 is unlimited. */
export const stockLabel = (n: number | null) =>
  n === null ? DASH : n < 0 ? 'unlimited' : String(n);

/** The gold price of one item: listings price a stack. */
export const unitPrice = (price: number | null, stack: number | null) =>
  price === null ? null : price / (stack !== null && stack > 0 ? stack : 1);

export interface ListFilters {
  search: string;
  title: string;
  foreverOnly: boolean;
}

/** The list route with its filters (the server's max page; the panel filters and sorts in the table). */
export function listPath(kind: 'vendors' | 'trainers', f: ListFilters) {
  const q = new URLSearchParams({ limit: '500' });
  if (f.search.trim()) q.set('search', f.search.trim());
  if (f.title) q.set('title', f.title);
  if (f.foreverOnly) q.set('foreverOnly', 'true');
  return `/admin/api/${kind}?${q.toString()}`;
}

/** An NPC's location as one zone map point (with its uiMapID), or null without a map id and coordinates. */
export function npcMapPoint(
  loc: Location | null,
  kind: 'vendor' | 'trainer',
  label: string,
): { uiMapId: number; point: MapPoint } | null {
  if (!loc || loc.mapId === null || loc.x === null || loc.y === null) return null;
  return { uiMapId: loc.mapId, point: { x: loc.x, y: loc.y, kind, label } };
}
