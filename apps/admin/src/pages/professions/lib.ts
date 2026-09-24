// Pure helpers and ECharts option mappers for the Professions page. Names come from uploads (untrusted): tooltips
// either use ECharts' escaped defaults or build DOM with textContent, never HTML strings.
import { CHART_PALETTES, SERIES_COLORS } from '../../lib/charts';
import type { ChartPalette } from '../../lib/charts';
import { formatNumber } from '../../lib/format';
import type { MapPoint } from '../../lib/zoneMap';
import { formatChicagoShort, TIME_ZONE } from '../../lib/time';
import type { GatherMap, GatheringNode, SkillHistory, Threshold } from './types';

// ---- difficulty bands ----

/** The game's recipe colors for each `Enum.TradeskillRelativeDifficulty` key the addon records. */
export const DIFFICULTIES: Readonly<
  Record<string, { label: string; color: string; order: number }>
> = {
  optimal: { label: 'Orange', color: '#e8702a', order: 0 },
  medium: { label: 'Yellow', color: '#d9b300', order: 1 },
  easy: { label: 'Green', color: '#3fa34d', order: 2 },
  trivial: { label: 'Gray', color: '#9aa0a6', order: 3 },
};
const UNKNOWN_DIFFICULTY = '#6b7280';

export interface Band {
  /** null for a stretch no character was seen at. */
  difficulty: string | null;
  label: string;
  color: string | null;
  /** Skill ranks [from, to). */
  from: number;
  to: number;
  observed: boolean;
}

/**
 * Observed thresholds (per difficulty the lowest and highest rank any character saw it at) as bands on the skill
 * axis: each difficulty from its lowest rank to its highest + 1, clipped where the next one starts; a stretch between
 * two bands that nobody saw is its own unobserved band.
 */
export function difficultyBands(thresholds: Threshold[]): Band[] {
  const sorted = [...thresholds].sort(
    (a, b) =>
      a.minRank - b.minRank ||
      (DIFFICULTIES[a.difficulty]?.order ?? 9) - (DIFFICULTIES[b.difficulty]?.order ?? 9),
  );
  const out: Band[] = [];
  sorted.forEach((t, i) => {
    const known = DIFFICULTIES[t.difficulty];
    const next = sorted[i + 1];
    let to = t.maxRank + 1;
    if (next && next.minRank > t.minRank && next.minRank < to) to = next.minRank;
    out.push({
      difficulty: t.difficulty,
      label: known?.label ?? t.difficulty,
      color: known?.color ?? UNKNOWN_DIFFICULTY,
      from: t.minRank,
      to,
      observed: true,
    });
    if (next && next.minRank > to)
      out.push({
        difficulty: null,
        label: 'Not seen',
        color: null,
        from: to,
        to: next.minRank,
        observed: false,
      });
  });
  return out;
}

/** The skill-rank scale shared by every band bar in a table: at least 75, rounded up to a multiple of 25. */
export function bandScale(all: Threshold[][]) {
  const top = Math.max(75, ...all.flat().map((t) => t.maxRank + 1));
  return Math.ceil(top / 25) * 25;
}

// ---- labels ----

/** `trainer:1103` → `Trainer #1103`, `item:2598` → `Item #2598`. */
export function viaLabel(via: string) {
  const m = /^(trainer|item):(\d+)$/.exec(via);
  if (m) return `${m[1] === 'trainer' ? 'Trainer' : 'Item'} #${m[2]}`;
  return via === 'unknown' ? 'Unknown' : via;
}

export const zoneLabel = (m: { mapId: number; zone: string | null }) => m.zone ?? `Map ${m.mapId}`;

export const nodeLabel = (n: { objectId: number; name: string | null }) =>
  n.name ?? (n.objectId === 0 ? 'Fishing' : `Object ${n.objectId}`);

/** `17%`; a dash without a denominator. */
export const percent = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—';

const decimals = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/** `Copper Ore: 1.67 per harvest (in 100%)`: stack quantity per harvest and how often the item came. */
export function yieldText(l: {
  itemId: number;
  name: string | null;
  perOpen: number | null;
  qtyPerOpen: number | null;
}) {
  const name = l.name ?? `Item ${l.itemId}`;
  if (l.qtyPerOpen === null) return `${name}: — per harvest`;
  const qty = decimals.format(l.qtyPerOpen);
  return l.perOpen === null
    ? `${name}: ${qty} per harvest`
    : `${name}: ${qty} per harvest (in ${Math.round(l.perOpen * 100)}%)`;
}

/** Loot of a node type, most common first, as one line. */
export const lootLine = (loot: GatheringNode['loot']) => loot.map(yieldText).join(' · ');

// ---- charts ----

/** Categorical series colors (see SERIES_COLORS). Scatter marks also get a shape per series, so identity is never color alone. */
export const CATEGORICAL = SERIES_COLORS;
const SYMBOLS = ['circle', 'diamond', 'triangle', 'rect', 'roundRect', 'pin', 'arrow', 'circle'];

const modeOf = (p: ChartPalette): 'light' | 'dark' =>
  p.surface === CHART_PALETTES.dark.surface ? 'dark' : 'light';

const tooltipStyle = (p: ChartPalette) => ({
  backgroundColor: p.surface,
  borderColor: p.grid,
  textStyle: { color: p.text },
});

/** Marker size in px for a spot's opens: 8 px at least, growing with the square root, 30 px at most. */
export const spotSize = (opens: number) =>
  Math.round(Math.min(30, Math.max(8, 6 + 4 * Math.sqrt(Math.max(0, opens)))));

type ScatterPoint = [number, number, number];

/**
 * Node spots of one map as a scatter on the game map's 0–100 grid (y grows downwards, like the world map), one
 * series per node type sized by opens; colors follow object ids, and past seven types the rest fold into "Other".
 */
export function gatheringScatterOption(map: GatherMap, p: ChartPalette) {
  const colors = CATEGORICAL[modeOf(p)];
  const nodes = [...map.nodes].sort((a, b) => a.objectId - b.objectId);
  const own = nodes.length > colors.length ? nodes.slice(0, colors.length - 1) : nodes;
  const rest = nodes.slice(own.length);
  const groups = [
    ...own.map((n) => ({ name: nodeLabel(n), spots: n.spots })),
    ...(rest.length > 0 ? [{ name: 'Other', spots: rest.flatMap((n) => n.spots) }] : []),
  ];
  const axis = {
    type: 'value' as const,
    min: 0,
    max: 100,
    interval: 10,
    splitLine: { lineStyle: { color: p.grid, opacity: 0.6 } },
    axisLine: { lineStyle: { color: p.grid } },
    axisLabel: { color: p.muted },
  };
  return {
    animation: false,
    grid: { left: 36, right: 16, top: 40, bottom: 28 },
    legend: {
      data: groups.map((g) => g.name),
      top: 0,
      textStyle: { color: p.text },
      itemWidth: 12,
      itemHeight: 12,
    },
    tooltip: { trigger: 'item' as const, ...tooltipStyle(p) },
    xAxis: axis,
    yAxis: { ...axis, inverse: true },
    series: groups.map((g, i) => ({
      type: 'scatter' as const,
      name: g.name,
      symbol: SYMBOLS[i % SYMBOLS.length]!,
      symbolSize: (v: ScatterPoint) => spotSize(v[2]),
      dimensions: ['x', 'y', 'opens'],
      encode: { x: 'x', y: 'y', tooltip: ['x', 'y', 'opens'] },
      data: g.spots.map((s): ScatterPoint => [s.x, s.y, s.opens]),
      itemStyle: {
        color: g.name === 'Other' && rest.length > 0 ? p.muted : colors[i]!,
        borderColor: p.surface,
        borderWidth: 2,
        opacity: 0.9,
      },
      emphasis: { focus: 'series' as const },
    })),
  };
}

/**
 * Node spots of one map as zone map points: one kind per node type, in object id order like the scatter (so colors
 * match), sized by the spot's opens.
 */
export function gatherPoints(map: GatherMap): MapPoint[] {
  return [...map.nodes]
    .sort((a, b) => a.objectId - b.objectId)
    .flatMap((n) =>
      n.spots.map((s) => ({
        x: s.x,
        y: s.y,
        kind: nodeLabel(n),
        label: nodeLabel(n),
        weight: s.opens,
      })),
    );
}

/** One profession's rises: a series per character with at least one, as [epoch ms, rank]. */
export function skillRankSeries(history: SkillHistory, skillLineId: number) {
  return history.items.flatMap((c) => {
    const prof = c.professions.find((p) => p.skillLineId === skillLineId);
    if (!prof || prof.points.length === 0) return [];
    return [
      {
        char: c.char,
        data: prof.points.map((pt): [number, number] => [Date.parse(pt.observedAt), pt.rank]),
      },
    ];
  });
}

const dayFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  month: 'short',
  day: 'numeric',
});
const hourFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
});
/** Rises within 3 days of each other get hour ticks, else day ticks. */
const HOUR_TICKS_MS = 3 * 24 * 3600 * 1000;

/** A tooltip as DOM (text nodes only): the first line bold. */
function tooltipNode(lines: string[]) {
  const div = document.createElement('div');
  lines.forEach((line, i) => {
    const row = document.createElement('div');
    row.textContent = line;
    if (i === 0) row.style.fontWeight = '600';
    div.appendChild(row);
  });
  return div;
}

/** Line dash per trip through the palette. */
const LINE_TYPES = ['solid', 'dashed', 'dotted'] as const;

/** Skill rank over time: a step line per character on a Chicago time axis; a legend from two characters on. */
export function skillRankOption(series: ReturnType<typeof skillRankSeries>, p: ChartPalette) {
  const colors = CATEGORICAL[modeOf(p)];
  const times = series.flatMap((s) => s.data.map((d) => d[0]));
  const ticks =
    times.length > 0 && Math.max(...times) - Math.min(...times) < HOUR_TICKS_MS
      ? hourFormat
      : dayFormat;
  return {
    animation: false,
    grid: { left: 40, right: 16, top: series.length > 1 ? 36 : 12, bottom: 28 },
    legend: { show: series.length > 1, top: 0, textStyle: { color: p.text } },
    tooltip: {
      trigger: 'item' as const,
      ...tooltipStyle(p),
      formatter: (x: { seriesName: string; value: [number, number] }) =>
        tooltipNode([
          x.seriesName,
          formatChicagoShort(x.value[0]),
          `Rank ${formatNumber(x.value[1])}`,
        ]),
    },
    xAxis: {
      type: 'time' as const,
      axisLine: { lineStyle: { color: p.grid } },
      axisLabel: {
        color: p.muted,
        formatter: (v: number) => ticks.format(v),
        hideOverlap: true,
      },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value' as const,
      name: 'rank',
      minInterval: 1,
      nameTextStyle: { color: p.muted },
      splitLine: { lineStyle: { color: p.grid, opacity: 0.6 } },
      axisLabel: { color: p.muted },
    },
    // Every character is drawn: past the palette the colors cycle, told apart by a dashed, then dotted line.
    series: series.map((s, i) => {
      const color = colors[i % colors.length]!;
      return {
        type: 'line' as const,
        name: s.char,
        step: 'end' as const,
        data: s.data,
        showSymbol: true,
        symbolSize: 8,
        lineStyle: {
          color,
          width: 2,
          type: LINE_TYPES[Math.floor(i / colors.length) % LINE_TYPES.length]!,
        },
        itemStyle: { color, borderColor: p.surface, borderWidth: 2 },
      };
    }),
  };
}
