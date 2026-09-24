import { describe, expect, it } from 'vitest';
import { CHART_PALETTES, SERIES_COLORS } from './charts';
import {
  aspectOff,
  aspectRatio,
  findImage,
  kindColors,
  kindLabel,
  legendOf,
  mapImageUrl,
  markerSize,
  mapsPath,
  nearestPoint,
  placePoints,
  toPixels,
  toViewBox,
  ZONE_CANVAS,
} from './zoneMap';

const L = CHART_PALETTES.light;
const D = CHART_PALETTES.dark;

describe('toViewBox / toPixels', () => {
  it('maps the game’s 0–100 map coordinates 1:1 onto the 0 0 100 100 overlay', () => {
    expect(toViewBox({ x: 0, y: 0 })).toEqual({ cx: 0, cy: 0 });
    expect(toViewBox({ x: 100, y: 100 })).toEqual({ cx: 100, cy: 100 });
    expect(toViewBox({ x: 43.2, y: 68.5 })).toEqual({ cx: 43.2, cy: 68.5 });
  });

  it('clamps to the map and drops what is not a number', () => {
    expect(toViewBox({ x: -5, y: 120 })).toEqual({ cx: 0, cy: 100 });
    expect(toViewBox({ x: Number.NaN, y: 5 })).toBeNull();
    expect(toViewBox({ x: 5, y: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it('lands where the game draws a pin: x% of the width, y% of the height (aspect kept)', () => {
    const { width, height } = ZONE_CANVAS;
    expect(toPixels({ x: 50, y: 50 }, width, height)).toEqual({ left: 501, top: 334 });
    expect(toPixels({ x: 0, y: 100 }, width, height)).toEqual({ left: 0, top: 668 });
    expect(toPixels({ x: 100, y: 0 }, width, height)).toEqual({ left: 1002, top: 0 });
    // Same point on a half-size render: the same relative place.
    const half = toPixels({ x: 43.2, y: 68.5 }, width / 2, height / 2)!;
    const full = toPixels({ x: 43.2, y: 68.5 }, width, height)!;
    expect(half.left * 2).toBeCloseTo(full.left);
    expect(half.top * 2).toBeCloseTo(full.top);
    expect(toPixels({ x: Number.NaN, y: 1 }, width, height)).toBeNull();
  });

  it('places points with their size, dropping bad coordinates', () => {
    const placed = placePoints([
      { x: 10, y: 20, kind: 'giver', label: 'A' },
      { x: Number.NaN, y: 20, kind: 'giver', label: 'bad' },
      { x: 30, y: 40, kind: 'node', label: 'Copper Vein', weight: 9 },
    ]);
    expect(placed.map((p) => [p.label, p.cx, p.cy, p.size])).toEqual([
      ['A', 10, 20, markerSize(undefined)],
      ['Copper Vein', 30, 40, markerSize(9)],
    ]);
  });
});

describe('nearestPoint', () => {
  const placed = placePoints([
    { x: 50, y: 50, kind: 'node', label: 'center' },
    { x: 51, y: 50, kind: 'node', label: 'next door' },
    { x: 0, y: 100, kind: 'node', label: 'corner', weight: 100 },
  ]);

  it('finds the nearest marker under the pointer in px (aspect kept)', () => {
    // 1002×668: center at (501, 334), next door at (511.02, 334).
    expect(nearestPoint(placed, 501, 334, 1002, 668)).toBe(0);
    expect(nearestPoint(placed, 509, 335, 1002, 668)).toBe(1);
    expect(nearestPoint(placed, 5, 660, 1002, 668)).toBe(2);
  });

  it('is null away from every marker', () => {
    expect(nearestPoint(placed, 700, 100, 1002, 668)).toBeNull();
    expect(nearestPoint([], 1, 1, 10, 10)).toBeNull();
  });
});

describe('aspectRatio / aspectOff', () => {
  it('uses the image’s natural size, else wow.export’s 1002:668 canvas', () => {
    expect(aspectRatio({ width: 1002, height: 668 })).toBe('1002 / 668');
    expect(aspectRatio({ width: 512, height: 512 })).toBe('512 / 512');
    expect(aspectRatio(null)).toBe('1002 / 668');
  });

  it('flags an image more than 2% off 1002:668', () => {
    expect(aspectOff(1002, 668)).toBe(false);
    expect(aspectOff(2004, 1336)).toBe(false);
    expect(aspectOff(1000, 668)).toBe(false);
    expect(aspectOff(1024, 1024)).toBe(true);
    expect(aspectOff(668, 1002)).toBe(true);
  });
});

describe('markerSize', () => {
  it('is 10 px without a weight, else 8–30 px growing with the square root', () => {
    expect(markerSize(undefined)).toBe(10);
    expect(markerSize(0)).toBe(8);
    expect(markerSize(1)).toBe(10);
    expect(markerSize(9)).toBe(18);
    expect(markerSize(10_000)).toBe(30);
    expect(markerSize(-3)).toBe(8);
  });
});

describe('kindColors / kindLabel / legendOf', () => {
  it('gives quest givers, enders, vendors, trainers and node spots fixed colors', () => {
    const c = kindColors(['trainer', 'giver', 'ender', 'vendor', 'node'], L);
    const s = SERIES_COLORS.light;
    expect(Object.fromEntries(c)).toEqual({
      giver: s[0],
      ender: s[1],
      vendor: s[2],
      trainer: s[3],
      node: s[4],
    });
    expect(kindColors(['giver'], D).get('giver')).toBe(SERIES_COLORS.dark[0]);
    expect(kindLabel('giver')).toBe('Quest giver');
    expect(kindLabel('node')).toBe('Gathering spot');
    expect(kindLabel('Copper Vein')).toBe('Copper Vein');
  });

  it('colors other kinds (node types) in order, folding the ninth and later into muted', () => {
    const kinds = Array.from({ length: 10 }, (_, i) => `Node ${i}`);
    const c = kindColors(kinds, L);
    expect(kinds.slice(0, 8).map((k) => c.get(k))).toEqual([...SERIES_COLORS.light]);
    expect(c.get('Node 8')).toBe(L.muted);
    expect(c.get('Node 9')).toBe(L.muted);
  });

  it('never gives an unknown kind a known kind’s color', () => {
    const c = kindColors(['giver', 'Peacebloom'], L);
    expect(c.get('Peacebloom')).not.toBe(c.get('giver'));
    expect(c.get('Peacebloom')).toBe(SERIES_COLORS.light[1]);
  });

  it('lists each kind once, with its count, folding the muted ones into “Other”', () => {
    const points = [
      { x: 1, y: 1, kind: 'ender', label: 'a' },
      { x: 1, y: 1, kind: 'giver', label: 'b' },
      { x: 2, y: 2, kind: 'giver', label: 'c' },
    ];
    const colors = kindColors(['ender', 'giver'], L);
    expect(legendOf(points, colors, L)).toEqual([
      { kind: 'giver', label: 'Quest giver', color: SERIES_COLORS.light[0], count: 2 },
      { kind: 'ender', label: 'Quest ender', color: SERIES_COLORS.light[1], count: 1 },
    ]);
    const many = Array.from({ length: 10 }, (_, i) => ({ x: 1, y: 1, kind: `N${i}`, label: '' }));
    const legend = legendOf(
      many,
      kindColors(
        many.map((p) => p.kind),
        L,
      ),
      L,
    );
    expect(legend).toHaveLength(9);
    expect(legend[8]).toEqual({ kind: '', label: 'Other', color: L.muted, count: 2 });
  });
});

describe('findImage / mapImageUrl / mapsPath', () => {
  const images = [
    { uiMapId: 1411, name: 'Durotar', width: 1002, height: 668, sha256: 'a'.repeat(64) },
  ];

  it('finds the uploaded map of a uiMapID, else null (→ grid fallback)', () => {
    expect(findImage(images, 1411)).toBe(images[0]);
    expect(findImage(images, 1413)).toBeNull();
    expect(findImage(undefined, 1411)).toBeNull();
    expect(findImage(images, null)).toBeNull();
  });

  it('versions the image URL by its hash so a re-upload shows at once', () => {
    expect(mapImageUrl(1411, 'abcdef0123456789ffff')).toBe('/admin/maps/1411?v=abcdef0123456789');
  });

  it('links to the Maps page, on a map’s row when given', () => {
    expect(mapsPath()).toBe('/maps');
    expect(mapsPath(1411)).toBe('/maps?map=1411');
  });
});
