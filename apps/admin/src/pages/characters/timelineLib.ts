// Pure helpers for a character's page: level over time, quest XP over time and per day (ECharts option mappers).
// Quest titles are uploaded text: they only go into ECharts as data names (the default tooltip escapes them).
import type { ChartPalette } from '../../lib/charts';
import { formatNumber } from '../../lib/format';
import { formatChicagoShort, TIME_ZONE } from '../../lib/time';
import type { CharacterSkills, DayXp, LevelPoint, TimelineTurnIn } from './types';

const DASH = '—';
const dayFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  month: 'short',
  day: 'numeric',
});
const utcDayFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
});

/** Epoch ms → `Sep 21`, the America/Chicago calendar day (time-axis labels). */
export function formatChicagoDay(ms: number) {
  return Number.isFinite(ms) ? dayFormat.format(new Date(ms)) : DASH;
}

/** A server day key `2026-09-21` (already a Chicago day) → `Sep 21`, never shifted by the browser's zone. */
export function dayLabel(day: string) {
  const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(day);
  return m ? utcDayFormat.format(new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!))) : day;
}

/** The character page under /admin/ (keys can hold any character the realm name has). */
export const characterPath = (key: string) => `/characters/${encodeURIComponent(key)}`;

export function levelSpan(levels: LevelPoint[]) {
  if (levels.length === 0) return null;
  const ls = levels.map((l) => l.level);
  return { from: Math.min(...ls), to: Math.max(...ls) };
}

/** Skills of `char` in a /v1/professions/skills answer, by name. */
export function skillsFor(all: CharacterSkills[], char: string) {
  return [...(all.find((c) => c.char === char)?.professions ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

const tooltipStyle = (p: ChartPalette) => ({
  backgroundColor: p.surface,
  borderColor: p.grid,
  textStyle: { color: p.text },
});

function timeAxis(p: ChartPalette) {
  return {
    type: 'time',
    axisLine: { lineStyle: { color: p.grid } },
    axisTick: { show: false },
    splitLine: { show: false },
    axisLabel: { color: p.muted, hideOverlap: true, formatter: (v: number) => formatChicagoDay(v) },
  };
}

function valueAxis(p: ChartPalette, name: string) {
  return {
    type: 'value',
    name,
    scale: true,
    nameTextStyle: { color: p.muted },
    splitLine: { lineStyle: { color: p.grid, opacity: 0.6 } },
    axisLabel: { color: p.muted },
  };
}

function line(p: ChartPalette, name: string, data: { name: string; value: [number, number] }[]) {
  return {
    type: 'line',
    name,
    data,
    encode: { x: 0, y: 1, tooltip: 1 },
    symbol: 'circle',
    symbolSize: 8,
    showSymbol: data.length <= 60,
    lineStyle: { width: 2, color: p.series },
    itemStyle: { color: p.series, borderColor: p.surface, borderWidth: 2 },
  };
}

/** Level over time: a stepped line (a level holds until the next one), one point per level start/end. */
export function levelOverTimeOption(levels: LevelPoint[], p: ChartPalette) {
  return {
    animation: false,
    grid: { left: 12, right: 24, top: 32, bottom: 12, containLabel: true },
    tooltip: { trigger: 'item', ...tooltipStyle(p) },
    xAxis: timeAxis(p),
    yAxis: { ...valueAxis(p, 'Level'), minInterval: 1 },
    series: [
      {
        ...line(
          p,
          'Level',
          levels.map((l) => ({
            name: formatChicagoShort(l.at),
            value: [Date.parse(l.at), l.level],
          })),
        ),
        step: 'end',
      },
    ],
  };
}

/** Quest XP earned so far, one point per turn-in. */
export function cumulativeXpOption(turnIns: TimelineTurnIn[], p: ChartPalette) {
  return {
    animation: false,
    grid: { left: 12, right: 24, top: 32, bottom: 12, containLabel: true },
    tooltip: {
      trigger: 'item',
      ...tooltipStyle(p),
      valueFormatter: (v: unknown) => `${formatNumber(Number(v))} XP`,
    },
    xAxis: timeAxis(p),
    yAxis: valueAxis(p, 'Quest XP (total)'),
    series: [
      line(
        p,
        'Quest XP',
        turnIns.map((t) => ({
          name: `${t.title ?? `Quest ${t.questId}`} · ${formatChicagoShort(t.turnedInAt)}`,
          value: [Date.parse(t.turnedInAt), t.cumulativeXp],
        })),
      ),
    ],
  };
}

/** Quest XP per America/Chicago day: one bar per day with turn-ins. */
export function perDayXpOption(days: DayXp[], p: ChartPalette) {
  return {
    animation: false,
    grid: { left: 12, right: 12, top: 16, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      ...tooltipStyle(p),
      valueFormatter: (v: unknown) => `${formatNumber(Number(v))} XP`,
    },
    xAxis: {
      type: 'category',
      data: days.map((d) => dayLabel(d.day)),
      axisLine: { lineStyle: { color: p.grid } },
      axisTick: { show: false },
      axisLabel: { color: p.muted, hideOverlap: true },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: p.grid, opacity: 0.6 } },
      axisLabel: { color: p.muted },
    },
    series: [
      {
        type: 'bar',
        name: 'Quest XP',
        data: days.map((d) => d.xp),
        itemStyle: { color: p.series, borderRadius: [4, 4, 0, 0] },
        barMaxWidth: 24,
      },
    ],
  };
}
