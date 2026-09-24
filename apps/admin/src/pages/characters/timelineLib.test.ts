import { describe, expect, it } from 'vitest';
import { CHART_PALETTES } from '../../lib/charts';
import {
  characterPath,
  cumulativeXpOption,
  dayLabel,
  formatChicagoDay,
  levelOverTimeOption,
  levelSpan,
  perDayXpOption,
  skillsFor,
} from './timelineLib';
import type { TimelineTurnIn } from './types';

const P = CHART_PALETTES.light;

// 2026-09-21T10:13:20-05:00 and a point after midnight UTC that is still Sep 21 in Chicago.
const A = '2026-09-21T10:13:20-05:00';
const B = '2026-09-21T21:30:00-05:00';

describe('formatChicagoDay / dayLabel', () => {
  it('formats epoch ms as the Chicago calendar day', () => {
    expect(formatChicagoDay(Date.parse(B))).toBe('Sep 21');
    expect(formatChicagoDay(Number.NaN)).toBe('—');
  });

  it('reads a server day key without shifting it by the browser zone', () => {
    expect(dayLabel('2026-09-21')).toBe('Sep 21');
    expect(dayLabel('2026-01-01')).toBe('Jan 1');
    expect(dayLabel('nope')).toBe('nope');
  });
});

describe('characterPath', () => {
  it('URL-encodes the character key', () => {
    expect(characterPath('Thibodeaux-Bayou')).toBe('/characters/Thibodeaux-Bayou');
    expect(characterPath('A B/C?')).toBe('/characters/A%20B%2FC%3F');
  });
});

describe('levelSpan', () => {
  it('finds the lowest and highest level', () => {
    expect(
      levelSpan([
        { at: A, level: 10 },
        { at: B, level: 12 },
        { at: B, level: 11 },
      ]),
    ).toEqual({ from: 10, to: 12 });
    expect(levelSpan([])).toBeNull();
  });
});

describe('levelOverTimeOption', () => {
  it('draws a stepped line on a time axis with Chicago labels', () => {
    const o = levelOverTimeOption(
      [
        { at: A, level: 10 },
        { at: B, level: 11 },
      ],
      P,
    );
    expect(o.xAxis.type).toBe('time');
    expect(o.xAxis.axisLabel.formatter(Date.parse(B))).toBe('Sep 21');
    const s = o.series[0]!;
    expect(s.step).toBe('end');
    expect(s.lineStyle.width).toBe(2);
    expect(s.itemStyle.color).toBe(P.series);
    expect(s.data).toEqual([
      { name: 'Sep 21, 10:13 AM CDT', value: [Date.parse(A), 10] },
      { name: 'Sep 21, 9:30 PM CDT', value: [Date.parse(B), 11] },
    ]);
    expect(o.yAxis).toMatchObject({ minInterval: 1, name: 'Level' });
    expect(o.tooltip).not.toHaveProperty('formatter');
  });
});

describe('cumulativeXpOption', () => {
  const turnIns: TimelineTurnIn[] = [
    {
      questId: 1,
      title: '<img src=x>',
      build: 1,
      level: 10,
      xp: 400,
      money: 0,
      turnedInAt: A,
      cumulativeXp: 400,
    },
    {
      questId: 2,
      title: null,
      build: 1,
      level: 11,
      xp: 700,
      money: 0,
      turnedInAt: B,
      cumulativeXp: 1100,
    },
  ];

  it('plots the running total; quest titles are data names only (escaped by the default tooltip)', () => {
    const o = cumulativeXpOption(turnIns, P);
    expect(o.series[0]!.data).toEqual([
      { name: '<img src=x> · Sep 21, 10:13 AM CDT', value: [Date.parse(A), 400] },
      { name: 'Quest 2 · Sep 21, 9:30 PM CDT', value: [Date.parse(B), 1100] },
    ]);
    expect(o.tooltip).not.toHaveProperty('formatter');
    expect(o.tooltip.valueFormatter(1100)).toBe('1,100 XP');
    expect(o.yAxis.name).toBe('Quest XP (total)');
  });
});

describe('perDayXpOption', () => {
  it('draws one bar per Chicago day', () => {
    const o = perDayXpOption(
      [
        { day: '2026-09-21', xp: 1100, turnIns: 2 },
        { day: '2026-09-23', xp: 50, turnIns: 1 },
      ],
      CHART_PALETTES.dark,
    );
    expect(o.xAxis.data).toEqual(['Sep 21', 'Sep 23']);
    expect(o.series[0]!.data).toEqual([1100, 50]);
    expect(o.series[0]!.itemStyle.color).toBe(CHART_PALETTES.dark.series);
    expect(o.tooltip.valueFormatter(50)).toBe('50 XP');
  });
});

describe('skillsFor', () => {
  it('picks the character from /v1/professions/skills and sorts by name', () => {
    expect(
      skillsFor(
        [
          {
            char: 'A-B',
            professions: [
              { skillLineId: 2, name: 'Tailoring', rank: 75, maxRank: 150, lastSeen: null },
              { skillLineId: 1, name: 'Fishing', rank: 1, maxRank: 75, lastSeen: null },
            ],
          },
          { char: 'C-D', professions: [] },
        ],
        'A-B',
      ).map((p) => p.name),
    ).toEqual(['Fishing', 'Tailoring']);
    expect(skillsFor([], 'A-B')).toEqual([]);
  });
});
