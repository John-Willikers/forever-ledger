import { describe, expect, it } from 'vitest';
import {
  CHART_PALETTES,
  dayStarts,
  hourlySummary,
  hourlyUploadsOption,
  recordsByKindOption,
  recordsChartHeight,
} from './charts';

const P = CHART_PALETTES.light;

const buckets = [
  { hour: '2026-09-22T22:00:00-05:00', count: 0 },
  { hour: '2026-09-22T23:00:00-05:00', count: 2 },
  { hour: '2026-09-23T00:00:00-05:00', count: 5 },
  { hour: '2026-09-23T01:00:00-05:00', count: 1 },
];

describe('hourlyUploadsOption', () => {
  it('maps buckets to one bar series with Chicago hour labels', () => {
    const o = hourlyUploadsOption(buckets, P);
    expect(o.xAxis.data).toEqual([
      'Sep 22, 10 PM',
      'Sep 22, 11 PM',
      'Sep 23, 12 AM',
      'Sep 23, 1 AM',
    ]);
    expect(o.series).toHaveLength(1);
    expect(o.series[0]!.data).toEqual([0, 2, 5, 1]);
    expect(o.series[0]!.itemStyle.color).toBe(P.series);
    // A tick on the first bucket and at each Chicago midnight, labelled with the day only.
    const interval = o.xAxis.axisLabel.interval;
    expect([0, 1, 2, 3].filter((i) => interval(i))).toEqual([0, 2]);
    expect(o.xAxis.axisLabel.formatter('Sep 23, 12 AM')).toBe('Sep 23');
    expect(o.tooltip.valueFormatter(1234)).toBe('1,234 uploads');
  });

  it('uses the dark palette when asked', () => {
    const o = hourlyUploadsOption(buckets, CHART_PALETTES.dark);
    expect(o.series[0]!.itemStyle.color).toBe(CHART_PALETTES.dark.series);
    expect(o.yAxis.axisLabel.color).toBe(CHART_PALETTES.dark.muted);
  });
});

describe('dayStarts', () => {
  it('finds midnights', () => {
    expect(dayStarts(buckets.map((b) => b.hour))).toEqual([0, 2]);
    expect(dayStarts([])).toEqual([]);
  });
});

describe('hourlySummary', () => {
  it('totals and finds the busiest hour', () => {
    expect(hourlySummary(buckets)).toEqual({ total: 8, peak: buckets[2] });
    expect(hourlySummary([{ hour: buckets[0]!.hour, count: 0 }])).toEqual({ total: 0, peak: null });
  });
});

describe('recordsByKindOption', () => {
  it('puts the biggest kind on top (ECharts draws categories bottom-up) with readable labels', () => {
    const o = recordsByKindOption(
      [
        { kind: 'items', count: 10 },
        { kind: 'itemSnapshots', count: 30 },
        { kind: 'runs', count: 1 },
        { kind: 'quests', count: 0 },
      ],
      P,
    );
    expect(o.yAxis.data).toEqual(['runs', 'items', 'item snapshots']);
    expect(o.series[0]!.data).toEqual([1, 10, 30]);
    expect(o.series[0]!.label.formatter({ value: 1234 })).toBe('1,234');
  });

  it('sizes the chart by kinds', () => {
    expect(recordsChartHeight(0)).toBe(120);
    expect(recordsChartHeight(22)).toBe(22 * 24 + 40);
  });
});
