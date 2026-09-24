// Pure data → ECharts option mappers (single series each: one accent color, no legend, tooltips on).
import { formatNumber } from './format';
import { sortKinds } from './records';
import { formatChicagoHour, toDate } from './time';

export interface ChartPalette {
  text: string;
  muted: string;
  grid: string;
  series: string;
  surface: string;
}

/** Matches the panel's CSS variables (styles.css); the series color is the accent, validated on both surfaces. */
export const CHART_PALETTES: Readonly<Record<'light' | 'dark', ChartPalette>> = {
  light: {
    text: '#1b1f27',
    muted: '#5b6474',
    grid: '#d9dde5',
    series: '#1f6feb',
    surface: '#ffffff',
  },
  dark: {
    text: '#e6e9ee',
    muted: '#9aa4b2',
    grid: '#2b323c',
    series: '#4c8dff',
    surface: '#171b21',
  },
};

const tooltipStyle = (p: ChartPalette) => ({
  backgroundColor: p.surface,
  borderColor: p.grid,
  textStyle: { color: p.text },
});

/** Index of the buckets that start a Chicago calendar day (axis ticks), plus the first. */
export function dayStarts(hours: string[]) {
  const out: number[] = [];
  hours.forEach((h, i) => {
    if (i === 0 || /T00:00:00/.test(h)) out.push(i);
  });
  return out;
}

/** Uploads per hour: thin bars, a tick per Chicago day, hour + count on hover. */
export function hourlyUploadsOption(buckets: { hour: string; count: number }[], p: ChartPalette) {
  const hours = buckets.map((b) => b.hour);
  const labels = hours.map((h) => formatChicagoHour(h));
  const ticks = new Set(dayStarts(hours));
  return {
    animation: false,
    grid: { left: 36, right: 12, top: 16, bottom: 28 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      ...tooltipStyle(p),
      valueFormatter: (v: unknown) => `${formatNumber(Number(v))} uploads`,
    },
    xAxis: {
      type: 'category',
      data: labels,
      axisLine: { lineStyle: { color: p.grid } },
      axisTick: { show: false },
      axisLabel: {
        color: p.muted,
        interval: (i: number) => ticks.has(i),
        formatter: (v: string) => v.split(',')[0],
      },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      splitLine: { lineStyle: { color: p.grid, opacity: 0.6 } },
      axisLabel: { color: p.muted },
    },
    series: [
      {
        type: 'bar',
        name: 'Uploads',
        data: buckets.map((b) => b.count),
        itemStyle: { color: p.series, borderRadius: [4, 4, 0, 0] },
        barMaxWidth: 10,
        barCategoryGap: '20%',
      },
    ],
  };
}

/** Pixel height for the records-by-kind chart: one row per kind. */
export const recordsChartHeight = (kinds: number) => Math.max(120, kinds * 24 + 40);

/** Records by kind: horizontal bars, biggest on top, the value at the end of each bar. */
export function recordsByKindOption(rows: { kind: string; count: number }[], p: ChartPalette) {
  const kinds = sortKinds(Object.fromEntries(rows.map((r) => [r.kind, r.count]))).reverse();
  return {
    animation: false,
    grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'item',
      ...tooltipStyle(p),
      valueFormatter: (v: unknown) => `${formatNumber(Number(v))} records`,
    },
    xAxis: { type: 'value', show: false },
    yAxis: {
      type: 'category',
      data: kinds.map((k) => k.label),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: p.text },
    },
    series: [
      {
        type: 'bar',
        name: 'Records',
        data: kinds.map((k) => k.count),
        itemStyle: { color: p.series, borderRadius: [0, 4, 4, 0] },
        barMaxWidth: 14,
        label: {
          show: true,
          position: 'right',
          color: p.muted,
          formatter: (x: { value: unknown }) => formatNumber(Number(x.value)),
        },
      },
    ],
  };
}

/** Total uploads in the buckets and the busiest hour (null when there were none). */
export function hourlySummary(buckets: { hour: string; count: number }[]) {
  let total = 0;
  let peak: { hour: string; count: number } | null = null;
  for (const b of buckets) {
    total += b.count;
    if (b.count > 0 && (!peak || b.count > peak.count)) peak = b;
  }
  return { total, peak: peak && toDate(peak.hour) ? peak : null };
}
