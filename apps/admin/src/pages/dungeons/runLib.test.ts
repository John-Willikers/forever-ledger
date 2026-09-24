import { describe, expect, it } from 'vitest';
import { CHART_PALETTES } from '../../lib/charts';
import {
  bossSplits,
  bossTimelineOption,
  charName,
  clearTimeOption,
  formatDuration,
  median,
  perMinute,
  pickTab,
  runTabs,
  SECOND_SERIES,
  secondSeries,
  timeAxisInterval,
  xpRateOption,
} from './runLib';

const P = CHART_PALETTES.light;

describe('formatDuration', () => {
  it('shows m:ss, or h:mm:ss from an hour', () => {
    expect(formatDuration(930)).toBe('15:30');
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(3723)).toBe('1:02:03');
    expect(formatDuration(59.6)).toBe('1:00');
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(-3)).toBe('—');
  });
});

describe('perMinute', () => {
  it('divides by active minutes, one decimal', () => {
    expect(perMinute(4350, 930)).toBe(280.6);
    expect(perMinute(100, 0)).toBeNull();
    expect(perMinute(100, null)).toBeNull();
  });
});

describe('median', () => {
  it('handles odd, even and empty lists', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('bossSplits', () => {
  it('turns kill times into splits since the previous boss (or the start)', () => {
    expect(
      bossSplits([
        { ord: 2, name: 'Edwin VanCleef', killed: true, atSecs: 900, encounterId: 2 },
        { ord: 1, name: "Rhahk'Zor", killed: true, atSecs: 300, encounterId: 1 },
        { ord: 3, name: null, killed: false, atSecs: 950, encounterId: null },
      ]),
    ).toEqual([
      { ord: 1, name: "Rhahk'Zor", killed: true, startSecs: 0, atSecs: 300, splitSecs: 300 },
      { ord: 2, name: 'Edwin VanCleef', killed: true, startSecs: 300, atSecs: 900, splitSecs: 600 },
      { ord: 3, name: 'Boss 3', killed: false, startSecs: 900, atSecs: 950, splitSecs: 50 },
    ]);
  });
});

describe('bossTimelineOption', () => {
  it('stacks an invisible offset under each split, first boss on top', () => {
    const o = bossTimelineOption(
      bossSplits([
        { ord: 1, name: 'A', killed: true, atSecs: 300, encounterId: 1 },
        { ord: 2, name: 'B', killed: false, atSecs: 900, encounterId: 2 },
      ]),
      P,
    );
    expect(o.yAxis.data).toEqual(['B (not killed)', 'A']);
    expect(o.series[0]!.data).toEqual([300, 0]);
    expect(o.series[0]!.itemStyle.color).toBe('transparent');
    expect(o.series[0]!.tooltip).toEqual({ show: false });
    expect(o.series[1]!.data).toEqual([600, 300]);
    expect(o.series[1]!.itemStyle.color).toBe(P.series);
    expect(o.tooltip.valueFormatter(600)).toBe('10:00');
    expect(o.xAxis.axisLabel.formatter(900)).toBe('15:00');
    expect(o.xAxis.interval).toBe(300);
  });

  it('picks round time ticks', () => {
    expect(timeAxisInterval(900)).toBe(300);
    expect(timeAxisInterval(120)).toBe(30);
    expect(timeAxisInterval(5000)).toBe(900);
    expect(timeAxisInterval(40_000)).toBe(7200);
  });
});

describe('clearTimeOption', () => {
  it('plots each finished run as a dot per instance, in minutes', () => {
    const o = clearTimeOption(
      [
        {
          instanceId: 36,
          instance: 'The Deadmines',
          runs: [
            { id: 'a', build: 1, activeSecs: 930, members: 1 },
            { id: 'b', build: 1, activeSecs: 1200, members: 1 },
          ],
        },
        {
          instanceId: 34,
          instance: null,
          runs: [{ id: 'c', build: 1, activeSecs: 600, members: 1 }],
        },
      ],
      P,
    );
    expect(o.yAxis.data).toEqual(['The Deadmines', 'Instance 34']);
    expect(o.series[0]!.type).toBe('scatter');
    expect(o.series[0]!.data).toEqual([
      [15.5, 0],
      [20, 0],
      [10, 1],
    ]);
    expect(o.series[0]!.symbolSize).toBeGreaterThanOrEqual(8);
    expect(o.tooltip.valueFormatter(15.5)).toBe('15:30');
  });
});

describe('xpRateOption', () => {
  it('stacks mob and quest XP per minute per instance and build with a legend', () => {
    const o = xpRateOption(
      [
        {
          instanceId: 36,
          instance: 'The Deadmines',
          build: 61582,
          mobXpPerMinute: 225.8,
          questXpPerMinute: 54.8,
        },
        {
          instanceId: 34,
          instance: null,
          build: 61582,
          mobXpPerMinute: null,
          questXpPerMinute: null,
        },
      ],
      P,
    );
    expect(o.xAxis.data).toEqual(['The Deadmines · 61582', 'Instance 34 · 61582']);
    expect(o.series.map((s) => s.name)).toEqual(['Mob XP', 'Quest XP']);
    expect(o.series[0]!.data).toEqual([225.8, 0]);
    expect(o.series[1]!.data).toEqual([54.8, 0]);
    expect(o.series[0]!.stack).toBe(o.series[1]!.stack);
    expect(o.series[1]!.itemStyle.color).toBe(SECOND_SERIES.light);
    expect(o.legend.data).toEqual(['Mob XP', 'Quest XP']);
    expect(secondSeries(CHART_PALETTES.dark)).toBe(SECOND_SERIES.dark);
  });
});

describe('charName', () => {
  it('keeps the name of a Name-Realm key (realms may hold dashes and spaces)', () => {
    expect(charName('Sam Willikers-Classic Beta PvE')).toBe('Sam Willikers');
    expect(charName('Vic-Some-Realm')).toBe('Vic');
    expect(charName('NoRealm')).toBe('NoRealm');
  });
});

describe('runTabs', () => {
  const p = (id: string, char: string) => ({ id, char });
  it('has a Group tab and one tab per member, in order', () => {
    expect(runTabs([p('a', 'Sam-R'), p('b', 'Vic-R 2')])).toEqual([
      { key: 'group', label: 'Group' },
      { key: 'a', label: 'Sam' },
      { key: 'b', label: 'Vic' },
    ]);
  });
  it('has no tabs for a run nobody else uploaded', () => {
    expect(runTabs([p('a', 'Sam-R')])).toEqual([]);
  });
  it('tells same-named members apart by their key', () => {
    expect(runTabs([p('a', 'Sam-R1'), p('b', 'Sam-R2')]).map((t) => t.label)).toEqual([
      'Group',
      'Sam-R1',
      'Sam-R2',
    ]);
  });
});

describe('pickTab', () => {
  const tabs = runTabs([
    { id: 'a', char: 'Sam-R' },
    { id: 'b', char: 'Vic-R' },
  ]);
  it('keeps a known tab, else the group', () => {
    expect(pickTab(tabs, 'b')).toBe('b');
    expect(pickTab(tabs, 'zzz')).toBe('group');
    expect(pickTab(tabs, null)).toBe('group');
    expect(pickTab([], 'a')).toBe('group');
  });
});
