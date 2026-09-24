// Zone map overlay math and marker styling. The game places a map pin at (canvas width · x, canvas height · y) with x, y
// from C_Map.GetPlayerMapPosition (0–1); the addon stores them as 0–100 per uiMapID. So the overlay is an SVG with
// viewBox 0 0 100 100 stretched over the image (preserveAspectRatio="none"): a point's coordinates are its viewBox
// coordinates. Labels come from uploads (untrusted) and are only ever rendered as React text.
import { paletteMode, SERIES_COLORS } from './charts';
import type { ChartPalette } from './charts';

/** A point to draw: 0–100 map coordinates, a kind (colors + legend), a label (tooltip) and an optional weight (size). */
export interface MapPoint {
  x: number;
  y: number;
  kind: string;
  label: string;
  weight?: number;
}

/** An uploaded zone map (GET /admin/api/map-images). */
export interface MapImage {
  uiMapId: number;
  name: string | null;
  width: number;
  height: number;
  sha256: string;
}

/** wow.export's canvas for a Classic zone map (UiMapArtStyleLayer LayerWidth × LayerHeight). */
export const ZONE_CANVAS = { width: 1002, height: 668 } as const;

/** Relative drift from 1002:668 the server also warns about. */
const ASPECT_TOLERANCE = 0.02;

/** Blizzard owns the map art: shown under every map image. */
export const MAP_NOTICE =
  'Map art © Blizzard Entertainment, exported from our own game client with wow.export; shown in this private panel ' +
  'for personal, non-commercial use.';

const clamp = (v: number) => Math.min(100, Math.max(0, v));

/** Overlay (viewBox 0 0 100 100) coordinates of a point, clamped to the map; null when x or y isn't a finite number. */
export function toViewBox(p: { x: number; y: number }): { cx: number; cy: number } | null {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  return { cx: clamp(p.x), cy: clamp(p.y) };
}

/** Where the browser draws a point on a width × height render of the map (what the game does on its canvas). */
export function toPixels(p: { x: number; y: number }, width: number, height: number) {
  const v = toViewBox(p);
  return v ? { left: (v.cx / 100) * width, top: (v.cy / 100) * height } : null;
}

/** Marker diameter in CSS px: 10 without a weight, else 8 at least, growing with the square root, 30 at most. */
export function markerSize(weight: number | undefined) {
  if (weight === undefined) return 10;
  return Math.round(Math.min(30, Math.max(8, 6 + 4 * Math.sqrt(Math.max(0, weight)))));
}

export interface PlacedPoint extends MapPoint {
  cx: number;
  cy: number;
  size: number;
}

/** The drawable points (bad coordinates dropped) with their overlay position and marker size. */
export function placePoints(points: readonly MapPoint[]): PlacedPoint[] {
  return points.flatMap((p) => {
    const v = toViewBox(p);
    return v ? [{ ...p, ...v, size: markerSize(p.weight) }] : [];
  });
}

/**
 * The index of the placed point under the pointer at (px, py) on a width × height render: the nearest one whose marker
 * (plus `slop` px) covers the pointer, else null.
 */
export function nearestPoint(
  placed: readonly PlacedPoint[],
  px: number,
  py: number,
  width: number,
  height: number,
  slop = 4,
): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  placed.forEach((p, i) => {
    const d = Math.hypot((p.cx / 100) * width - px, (p.cy / 100) * height - py);
    if (d <= p.size / 2 + slop && d < bestDist) {
      best = i;
      bestDist = d;
    }
  });
  return best;
}

/** CSS aspect-ratio of the map box: the image's natural size, else wow.export's 1002:668 canvas. */
export function aspectRatio(image: { width: number; height: number } | null | undefined) {
  const { width, height } = image ?? ZONE_CANVAS;
  return `${width} / ${height}`;
}

/** The image isn't ≈ 1002:668: points would be off by the stretch. */
export function aspectOff(width: number, height: number) {
  const want = ZONE_CANVAS.width / ZONE_CANVAS.height;
  return Math.abs(width / height / want - 1) > ASPECT_TOLERANCE;
}

/** Known marker kinds, in color-slot order, with their legend labels. */
const KNOWN_KINDS: readonly (readonly [string, string])[] = [
  ['giver', 'Quest giver'],
  ['ender', 'Quest ender'],
  ['vendor', 'Vendor'],
  ['trainer', 'Trainer'],
  ['node', 'Gathering spot'],
];
const KNOWN = new Map(KNOWN_KINDS.map(([k], i) => [k, i]));

export const kindLabel = (kind: string) => KNOWN_KINDS.find(([k]) => k === kind)?.[1] ?? kind;

/**
 * A color per kind: known kinds keep their slot (givers, enders, vendors, trainers, node spots); other kinds (node
 * types on the gathering map) take the free slots in order of first appearance, and past the palette fold into muted.
 */
export function kindColors(kinds: readonly string[], p: ChartPalette): Map<string, string> {
  const colors = SERIES_COLORS[paletteMode(p)];
  const out = new Map<string, string>();
  const used = new Set<number>();
  for (const k of kinds) {
    const slot = KNOWN.get(k);
    if (slot !== undefined && !out.has(k)) {
      out.set(k, colors[slot]!);
      used.add(slot);
    }
  }
  let next = 0;
  for (const k of kinds) {
    if (out.has(k)) continue;
    while (used.has(next)) next++;
    if (next < colors.length) {
      out.set(k, colors[next]!);
      used.add(next);
    } else {
      out.set(k, p.muted);
    }
  }
  return out;
}

export interface LegendEntry {
  kind: string;
  label: string;
  color: string;
  count: number;
}

/** One legend entry per colored kind (in color-slot order) with its point count; muted kinds fold into "Other". */
export function legendOf(
  points: readonly MapPoint[],
  colors: Map<string, string>,
  p: ChartPalette,
): LegendEntry[] {
  const counts = new Map<string, number>();
  let other = 0;
  for (const pt of points) {
    const color = colors.get(pt.kind);
    if (color === undefined || color === p.muted) other++;
    else counts.set(pt.kind, (counts.get(pt.kind) ?? 0) + 1);
  }
  const palette = SERIES_COLORS[paletteMode(p)];
  const entries = [...counts]
    .map(([kind, count]) => ({ kind, label: kindLabel(kind), color: colors.get(kind)!, count }))
    .sort((a, b) => palette.indexOf(a.color) - palette.indexOf(b.color));
  return other > 0
    ? [...entries, { kind: '', label: 'Other', color: p.muted, count: other }]
    : entries;
}

/** The uploaded map of a uiMapID, else null (the views fall back to the grid). */
export function findImage(images: readonly MapImage[] | undefined, uiMapId: number | null) {
  if (!images || uiMapId === null) return null;
  return images.find((i) => i.uiMapId === uiMapId) ?? null;
}

/** The image, versioned by its hash: the server caches it a day, so a re-upload gets a new URL. */
export const mapImageUrl = (uiMapId: number, sha256: string) =>
  `/admin/maps/${uiMapId}?v=${sha256.slice(0, 16)}`;

/** The Maps page (router path), on one map's row when given. */
export const mapsPath = (uiMapId?: number) =>
  uiMapId === undefined ? '/maps' : `/maps?map=${uiMapId}`;
