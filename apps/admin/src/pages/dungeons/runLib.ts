// Pure helpers for the Dungeons and Run pages: durations, boss splits and the ECharts options. Tooltips stay ECharts'
// default (which escapes names) with value formatters only: instance, boss and item names are uploaded data.
import { CHART_PALETTES } from '../../lib/charts';
import type { ChartPalette } from '../../lib/charts';

const DASH = '—';

/**
 * The second categorical slot (orange), stepped per mode next to the accent blue; validated with the dataviz
 * palette checks on both surfaces (CVD ΔE ≥ 28, contrast ≥ 3:1).
 */
export const SECOND_SERIES = { light: '#eb6834', dark: '#d95926' } as const;

export const secondSeries = (p: ChartPalette) =>
  p === CHART_PALETTES.dark ? SECOND_SERIES.dark : SECOND_SERIES.light;

/** Seconds as `15:30`, or `1:02:03` from an hour; a dash when missing or negative. */
export function formatDuration(secs: number | null | undefined) {
  if (typeof secs !== 'number' || !Number.isFinite(secs) || secs < 0) return DASH;
  const t = Math.round(secs);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = String(t % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** `xp` per active minute (one decimal), null without active time. */
export function perMinute(xp: number, activeSecs: number | null | undefined) {
  if (!activeSecs || activeSecs <= 0) return null;
  return Math.round((xp / activeSecs) * 600) / 10;
}

export function median(xs: number[]) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export const instanceLabel = (instanceId: number, instance: string | null | undefined) =>
  instance ? instance : `Instance ${instanceId}`;

export interface BossLike {
  ord: number;
  encounterId: number | null;
  name: string | null;
  killed: boolean;
  atSecs: number;
}

export interface BossSplit {
  ord: number;
  name: string;
  killed: boolean;
  /** When the split started (the previous boss, or the run's start). */
  startSecs: number;
  atSecs: number;
  splitSecs: number;
}

/** Bosses in order with the time since the previous one (the first counts from the run's start). */
export function bossSplits(bosses: BossLike[]): BossSplit[] {
  let prev = 0;
  return [...bosses]
    .sort((a, b) => a.ord - b.ord)
    .map((b) => {
      const split = {
        ord: b.ord,
        name: b.name || `Boss ${b.ord}`,
        killed: b.killed,
        startSecs: prev,
        atSecs: b.atSecs,
        splitSecs: Math.max(0, b.atSecs - prev),
      };
      prev = Math.max(prev, b.atSecs);
      return split;
    });
}

const TIME_STEPS = [30, 60, 120, 300, 600, 900, 1800, 3600];

/** A round tick step (30 s … 1 h) giving at most 6 intervals up to `maxSecs`. */
export function timeAxisInterval(maxSecs: number) {
  return TIME_STEPS.find((s) => maxSecs / s <= 6) ?? Math.ceil(maxSecs / 6 / 3600) * 3600;
}

const tooltipStyle = (p: ChartPalette) => ({
  backgroundColor: p.surface,
  borderColor: p.grid,
  textStyle: { color: p.text },
});

/** Pixel height for a chart with one row per category. */
export const rowsChartHeight = (rows: number) => Math.max(120, rows * 28 + 48);

/**
 * The boss split timeline: one row per boss (first on top), a bar from the previous kill to this one on a run-time
 * axis. Built as a stacked bar: an invisible offset under the visible split.
 */
export function bossTimelineOption(splits: BossSplit[], p: ChartPalette) {
  const rows = [...splits].reverse();
  return {
    animation: false,
    grid: { left: 8, right: 24, top: 8, bottom: 28, containLabel: true },
    tooltip: {
      trigger: 'item',
      ...tooltipStyle(p),
      valueFormatter: (v: unknown) => formatDuration(Number(v)),
    },
    xAxis: {
      type: 'value',
      min: 0,
      interval: timeAxisInterval(Math.max(0, ...splits.map((s) => s.atSecs))),
      splitLine: { lineStyle: { color: p.grid, opacity: 0.6 } },
      axisLabel: { color: p.muted, formatter: (v: number) => formatDuration(v) },
    },
    yAxis: {
      type: 'category',
      data: rows.map((s) => (s.killed ? s.name : `${s.name} (not killed)`)),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: p.text, width: 180, overflow: 'truncate' },
    },
    series: [
      {
        type: 'bar',
        name: 'Before',
        stack: 'run',
        data: rows.map((s) => s.startSecs),
        itemStyle: { color: 'transparent' },
        tooltip: { show: false },
        emphasis: { disabled: true },
        barMaxWidth: 16,
      },
      {
        type: 'bar',
        name: 'Split',
        stack: 'run',
        data: rows.map((s) => s.splitSecs),
        itemStyle: { color: p.series, borderRadius: 4 },
        barMaxWidth: 16,
      },
    ],
  };
}

export interface ClearTimes {
  instanceId: number;
  instance: string | null;
  runs: { id: string; build: number; activeSecs: number }[];
}

/** Clear-time distribution: a dot per finished run (active minutes) on one row per instance. */
export function clearTimeOption(instances: ClearTimes[], p: ChartPalette) {
  const minutes = (secs: number) => Math.round((secs / 60) * 100) / 100;
  return {
    animation: false,
    grid: { left: 8, right: 24, top: 8, bottom: 28, containLabel: true },
    tooltip: {
      trigger: 'item',
      ...tooltipStyle(p),
      valueFormatter: (v: unknown) => formatDuration(Number(v) * 60),
    },
    xAxis: {
      type: 'value',
      name: 'minutes',
      nameLocation: 'end',
      nameTextStyle: { color: p.muted },
      splitLine: { lineStyle: { color: p.grid, opacity: 0.6 } },
      axisLabel: { color: p.muted },
    },
    yAxis: {
      type: 'category',
      data: instances.map((i) => instanceLabel(i.instanceId, i.instance)),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: p.text, width: 180, overflow: 'truncate' },
    },
    series: [
      {
        type: 'scatter',
        name: 'Clear time',
        data: instances.flatMap((i, row) => i.runs.map((r) => [minutes(r.activeSecs), row])),
        symbolSize: 10,
        itemStyle: { color: p.series, opacity: 0.75, borderColor: p.surface, borderWidth: 2 },
        // Only the x value is a time: the tooltip shows it.
        encode: { x: 0, y: 1, tooltip: 0 },
      },
    ],
  };
}

export interface XpRate {
  instanceId: number;
  instance: string | null;
  build: number;
  mobXpPerMinute: number | null;
  questXpPerMinute: number | null;
}

/** XP per active minute per instance and build: mob XP and quest XP stacked, with a legend. */
export function xpRateOption(rows: XpRate[], p: ChartPalette) {
  const names = ['Mob XP', 'Quest XP'];
  return {
    animation: false,
    grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
    legend: { data: names, top: 0, textStyle: { color: p.text } },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      ...tooltipStyle(p),
      valueFormatter: (v: unknown) => `${Number(v)} XP/min`,
    },
    xAxis: {
      type: 'category',
      data: rows.map((r) => `${instanceLabel(r.instanceId, r.instance)} · ${r.build}`),
      axisLine: { lineStyle: { color: p.grid } },
      axisTick: { show: false },
      axisLabel: { color: p.muted, width: 140, overflow: 'truncate' },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: p.grid, opacity: 0.6 } },
      axisLabel: { color: p.muted },
    },
    series: [
      {
        type: 'bar',
        name: names[0],
        stack: 'xp',
        data: rows.map((r) => r.mobXpPerMinute ?? 0),
        itemStyle: { color: p.series, borderColor: p.surface, borderWidth: 1 },
        barMaxWidth: 28,
      },
      {
        type: 'bar',
        name: names[1],
        stack: 'xp',
        data: rows.map((r) => r.questXpPerMinute ?? 0),
        itemStyle: {
          color: secondSeries(p),
          borderColor: p.surface,
          borderWidth: 1,
          borderRadius: [4, 4, 0, 0],
        },
        barMaxWidth: 28,
      },
    ],
  };
}
