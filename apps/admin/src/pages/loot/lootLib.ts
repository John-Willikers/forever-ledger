// Pure helpers for the Loot and Item pages: rates, money, item quality, the mob drop chart option.
import type { ChartPalette } from '../../lib/charts';

const DASH = '—';

/** A drop rate (0..1) as a percentage: `50%`, `12.5%`, `0.34%`. */
export function formatRate(rate: number | null | undefined) {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return DASH;
  const pct = rate * 100;
  const digits = pct === 0 || pct >= 1 ? 1 : 2;
  return `${Number(pct.toFixed(digits))}%`;
}

/** Width in percent (0..100) of a rate bar. */
export function rateWidth(rate: number | null | undefined) {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return 0;
  return Math.min(100, Math.max(0, rate * 100));
}

/** Copper as `1g 23s 45c` (rounded to whole copper; empty parts left out). */
export function formatCopper(copper: number | null | undefined) {
  if (typeof copper !== 'number' || !Number.isFinite(copper)) return DASH;
  const c = Math.round(Math.max(0, copper));
  const g = Math.floor(c / 10_000);
  const s = Math.floor((c % 10_000) / 100);
  const r = c % 100;
  const parts = [g ? `${g}g` : '', s ? `${s}s` : '', r ? `${r}c` : ''].filter(Boolean);
  return parts.length ? parts.join(' ') : '0c';
}

/** A creature's display name: its recorded name, else its id (mobs rarely have one recorded). */
export const mobLabel = (npcId: number, name: string | null | undefined) =>
  name ? name : `NPC ${npcId}`;

/** An item's display name, else its id. */
export const itemLabel = (itemId: number | null, name: string | null | undefined) =>
  name ? name : `Item ${itemId ?? '?'}`;

const QUALITIES = [
  'Poor',
  'Common',
  'Uncommon',
  'Rare',
  'Epic',
  'Legendary',
  'Artifact',
  'Heirloom',
  'WoW Token',
];

export function qualityLabel(q: number | null | undefined) {
  if (typeof q !== 'number') return 'Unknown';
  return QUALITIES[q] ?? `Quality ${q}`;
}

/** CSS class for an item quality's text color (styles.css `.q0`…`.q8`). */
export const qualityClass = (q: number | null | undefined) =>
  typeof q === 'number' && q >= 0 && q <= 8 ? `q${q}` : 'q-unknown';

export interface RateItem {
  itemId: number;
  name: string | null;
  quality: number | null;
  dropped: number;
  quantity: number | null;
  rate: number | null;
}

const TOP_BARS = 20;

/** Pixel height of the mob drop chart: one row per item. */
export const mobDropChartHeight = (bars: number) => Math.max(120, bars * 24 + 40);

/**
 * One mob's drop rates as horizontal bars in percent of corpses, highest on top, at most 20. Tooltips stay ECharts'
 * default (escaped) with a value formatter.
 */
export function mobDropOption(items: RateItem[], corpses: number, p: ChartPalette) {
  const top = [...items]
    .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || b.dropped - a.dropped)
    .slice(0, TOP_BARS)
    .reverse();
  const pct = (r: number | null) => (r === null ? 0 : Number((r * 100).toFixed(2)));
  return {
    animation: false,
    grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'item',
      backgroundColor: p.surface,
      borderColor: p.grid,
      textStyle: { color: p.text },
      valueFormatter: (v: unknown) => `${Number(v)}% of corpses`,
    },
    // 100% unless a rate is above it (uploaded counts can disagree): a bar never runs off the chart.
    xAxis: { type: 'value', max: Math.max(100, ...top.map((i) => pct(i.rate))), show: false },
    yAxis: {
      type: 'category',
      data: top.map((i) => itemLabel(i.itemId, i.name)),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: p.text, width: 180, overflow: 'truncate' },
    },
    series: [
      {
        type: 'bar',
        name: `Drop rate (${corpses} corpses)`,
        data: top.map((i) => pct(i.rate)),
        itemStyle: { color: p.series, borderRadius: [0, 4, 4, 0] },
        barMaxWidth: 14,
        label: {
          show: true,
          position: 'right',
          color: p.muted,
          formatter: (x: { value: unknown }) => `${Number(x.value)}%`,
        },
      },
    ],
  };
}
