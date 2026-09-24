// A zone map with our points on it: the uploaded map art (natural aspect) under an SVG overlay whose viewBox is the
// game's 0–100 map coordinates, stretched over the image. Markers are zero-length round-capped strokes with
// non-scaling-stroke, so they stay round px dots however the box is stretched. Labels come from uploads (untrusted):
// tooltips and the legend are React text only. Without an uploaded map it falls back to the grid (the caller's chart,
// or a plain 0–100 grid) with a link to the Maps page.
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useAdminQuery } from '../api';
import {
  aspectRatio,
  findImage,
  kindColors,
  legendOf,
  MAP_NOTICE,
  mapImageUrl,
  mapsPath,
  nearestPoint,
  placePoints,
} from '../lib/zoneMap';
import type { MapImage, MapPoint } from '../lib/zoneMap';
import { formatNumber } from '../lib/format';
import { useChartPalette } from './Chart';

export const MAP_IMAGES_KEY = ['map-images'] as const;

/** The uploaded maps (metadata only), shared by every map view and refreshed by the Maps page after a change. */
export function useMapImages() {
  return useAdminQuery<{ images: MapImage[] }>(MAP_IMAGES_KEY, '/admin/api/map-images', {
    staleTime: 5 * 60_000,
  });
}

/**
 * The map of `uiMapId` with `points`. `fallback` is what to show when no map is uploaded (or it fails to load): the
 * view's existing grid chart; without one, a plain 0–100 grid with the same markers.
 */
export function ZoneMap({
  uiMapId,
  points,
  label,
  fallback,
  weightUnit,
  className = '',
}: {
  uiMapId: number | null;
  points: readonly MapPoint[];
  /** Accessible name (the data is also in a table or text next to the map). */
  label: string;
  fallback?: ReactNode;
  /** Shown after a point's weight in its tooltip ("opens"). */
  weightUnit?: string;
  className?: string;
}) {
  const images = useMapImages();
  const image = findImage(images.data?.images, uiMapId);
  const [failed, setFailed] = useState<string | null>(null);
  if (images.isPending) {
    return (
      <div
        className={`zone-map-box pending ${className}`}
        style={{ aspectRatio: aspectRatio(null) }}
        role="status"
        aria-label="Loading the map"
      />
    );
  }
  if (!image || failed === image.sha256) {
    return (
      <div className={`zone-map-fallback ${className}`}>
        {fallback ?? <MapView src={null} points={points} label={label} weightUnit={weightUnit} />}
        <p className="muted small">
          {uiMapId === null
            ? 'No map id recorded for these points.'
            : failed === image?.sha256
              ? `The zone map for map ${uiMapId} didn't load. `
              : `No zone map uploaded for map ${uiMapId} yet. `}
          {uiMapId !== null && <Link to={mapsPath(uiMapId)}>Upload it on the Maps page</Link>}
        </p>
      </div>
    );
  }
  return (
    <MapView
      className={className}
      src={mapImageUrl(image.uiMapId, image.sha256)}
      size={image}
      points={points}
      label={label}
      weightUnit={weightUnit}
      onError={() => setFailed(image.sha256)}
    />
  );
}

/**
 * The map box: an image (`src`, e.g. /admin/maps/1411 or a local preview's object URL) or, with `src` null, a 0–100
 * grid; the points on top; the legend; the Blizzard notice under an image.
 */
export function MapView({
  src,
  size,
  points,
  label,
  onError,
  weightUnit,
  className = '',
}: {
  src: string | null;
  /** The image's natural size (sets the box's aspect ratio before it loads). */
  size?: { width: number; height: number } | null;
  points: readonly MapPoint[];
  label: string;
  onError?: () => void;
  weightUnit?: string;
  className?: string;
}) {
  const palette = useChartPalette();
  const placed = useMemo(() => placePoints(points), [points]);
  const colors = useMemo(
    () =>
      kindColors(
        placed.map((p) => p.kind),
        palette,
      ),
    [placed, palette],
  );
  const legend = useMemo(() => legendOf(placed, colors, palette), [placed, colors, palette]);
  const [hover, setHover] = useState<number | null>(null);
  const tip = hover === null ? null : placed[hover];
  return (
    <figure className={`zone-map ${className}`}>
      <div
        className={`zone-map-box${src === null ? ' grid' : ''}`}
        style={{ aspectRatio: aspectRatio(size) }}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(nearestPoint(placed, e.clientX - r.left, e.clientY - r.top, r.width, r.height));
        }}
        onPointerLeave={() => setHover(null)}
      >
        {src !== null && (
          <img
            src={src}
            alt=""
            width={size?.width}
            height={size?.height}
            draggable={false}
            onError={onError}
          />
        )}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={label}>
          {src === null &&
            [10, 20, 30, 40, 50, 60, 70, 80, 90].map((v) => (
              <g key={v} className="zone-map-grid">
                <line x1={v} y1={0} x2={v} y2={100} vectorEffect="non-scaling-stroke" />
                <line x1={0} y1={v} x2={100} y2={v} vectorEffect="non-scaling-stroke" />
              </g>
            ))}
          {placed.map((p, i) => {
            const d = `M${p.cx} ${p.cy}h0`;
            return (
              <g key={i}>
                <path
                  d={d}
                  stroke={palette.surface}
                  strokeWidth={p.size + 4}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                />
                <path
                  d={d}
                  className="zone-map-dot"
                  stroke={colors.get(p.kind) ?? palette.muted}
                  strokeWidth={p.size}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}
        </svg>
        {tip && (
          <div
            className={`zone-map-tip${tip.cx > 70 ? ' left' : ''}${tip.cy < 20 ? ' below' : ''}`}
            style={{ left: `${tip.cx}%`, top: `${tip.cy}%` }}
            role="tooltip"
          >
            <strong>{tip.label}</strong>
            <span className="muted">
              {' '}
              ({tip.x.toFixed(1)}, {tip.y.toFixed(1)})
              {tip.weight !== undefined &&
                ` · ${formatNumber(tip.weight)}${weightUnit ? ` ${weightUnit}` : ''}`}
            </span>
          </div>
        )}
      </div>
      {legend.length > 0 && (
        <ul className="zone-map-legend small">
          {legend.map((l) => (
            <li key={l.kind || '(other)'}>
              <span className="swatch" style={{ background: l.color }} aria-hidden />
              {l.label} <span className="muted">({formatNumber(l.count)})</span>
            </li>
          ))}
        </ul>
      )}
      {src !== null && <figcaption className="muted small">{MAP_NOTICE}</figcaption>}
    </figure>
  );
}
