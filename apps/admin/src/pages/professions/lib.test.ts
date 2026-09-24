import { describe, expect, it } from 'vitest';
import { CHART_PALETTES } from '../../lib/charts';
import {
  bandScale,
  CATEGORICAL,
  difficultyBands,
  gatheringScatterOption,
  gatherPoints,
  nodeLabel,
  percent,
  skillRankOption,
  skillRankSeries,
  spotSize,
  viaLabel,
  yieldText,
  zoneLabel,
} from './lib';
import type { GatherMap, SkillHistory } from './types';

const P = CHART_PALETTES.light;

describe('difficultyBands', () => {
  it('turns observed thresholds into orange / yellow / green / gray bands', () => {
    expect(
      difficultyBands([
        { difficulty: 'medium', minRank: 51, maxRank: 51 },
        { difficulty: 'optimal', minRank: 50, maxRank: 50 },
      ]),
    ).toEqual([
      {
        difficulty: 'optimal',
        label: 'Orange',
        color: '#e8702a',
        from: 50,
        to: 51,
        observed: true,
      },
      { difficulty: 'medium', label: 'Yellow', color: '#d9b300', from: 51, to: 52, observed: true },
    ]);
    expect(difficultyBands([{ difficulty: 'trivial', minRank: 50, maxRank: 51 }])).toEqual([
      { difficulty: 'trivial', label: 'Gray', color: '#9aa0a6', from: 50, to: 52, observed: true },
    ]);
  });

  it('shows an unobserved gap between two bands, and clips an overlap to the next band', () => {
    expect(
      difficultyBands([
        { difficulty: 'optimal', minRank: 1, maxRank: 10 },
        { difficulty: 'easy', minRank: 20, maxRank: 30 },
      ]),
    ).toEqual([
      expect.objectContaining({ difficulty: 'optimal', from: 1, to: 11, observed: true }),
      { difficulty: null, label: 'Not seen', color: null, from: 11, to: 20, observed: false },
      expect.objectContaining({ difficulty: 'easy', label: 'Green', from: 20, to: 31 }),
    ]);
    // Two characters saw overlapping ranges: the band ends where the next one starts.
    expect(
      difficultyBands([
        { difficulty: 'optimal', minRank: 1, maxRank: 15 },
        { difficulty: 'medium', minRank: 12, maxRank: 20 },
      ]).map((b) => [b.difficulty, b.from, b.to]),
    ).toEqual([
      ['optimal', 1, 12],
      ['medium', 12, 21],
    ]);
  });

  it('keeps a difficulty it does not know (the enum missing on the client) with a neutral color', () => {
    expect(difficultyBands([{ difficulty: '3', minRank: 5, maxRank: 5 }])).toEqual([
      { difficulty: '3', label: '3', color: '#6b7280', from: 5, to: 6, observed: true },
    ]);
    expect(difficultyBands([])).toEqual([]);
  });

  it('bandScale: one shared scale, at least 75, rounded up to 25', () => {
    expect(bandScale([])).toBe(75);
    expect(bandScale([[{ difficulty: 'trivial', minRank: 50, maxRank: 51 }]])).toBe(75);
    expect(
      bandScale([
        [{ difficulty: 'optimal', minRank: 1, maxRank: 12 }],
        [{ difficulty: 'easy', minRank: 90, maxRank: 110 }],
      ]),
    ).toBe(125);
  });
});

describe('labels', () => {
  it('names how a recipe was learned', () => {
    expect(viaLabel('trainer:1103')).toBe('Trainer #1103');
    expect(viaLabel('item:2598')).toBe('Item #2598');
    expect(viaLabel('unknown')).toBe('Unknown');
    expect(viaLabel('quest:5')).toBe('quest:5');
  });

  it('names zones and nodes', () => {
    expect(zoneLabel({ mapId: 1429, zone: 'Elwynn Forest' })).toBe('Elwynn Forest');
    expect(zoneLabel({ mapId: 1427, zone: null })).toBe('Map 1427');
    expect(nodeLabel({ objectId: 1731, name: 'Copper Vein' })).toBe('Copper Vein');
    expect(nodeLabel({ objectId: 0, name: null })).toBe('Fishing');
    expect(nodeLabel({ objectId: 42, name: null })).toBe('Object 42');
  });

  it('formats percentages and yield per harvest', () => {
    expect(percent(1, 6)).toBe('17%');
    expect(percent(0, 0)).toBe('—');
    expect(yieldText({ itemId: 2770, name: 'Copper Ore', perOpen: 1, qtyPerOpen: 1.6667 })).toBe(
      'Copper Ore: 1.67 per harvest (in 100%)',
    );
    expect(yieldText({ itemId: 2835, name: null, perOpen: 0.25, qtyPerOpen: 0.25 })).toBe(
      'Item 2835: 0.25 per harvest (in 25%)',
    );
    expect(yieldText({ itemId: 1, name: 'X', perOpen: null, qtyPerOpen: null })).toBe(
      'X: — per harvest',
    );
  });
});

describe('gathering map', () => {
  const map: GatherMap = {
    mapId: 1429,
    zone: 'Elwynn Forest',
    opens: 5,
    nodes: [
      {
        objectId: 1731,
        name: 'Copper Vein',
        skillLineId: 186,
        skillLineName: 'Mining',
        opens: 3,
        rankMin: 29,
        spots: [
          { x: 45.1, y: 33.2, opens: 1.5 },
          { x: 46, y: 34.5, opens: 1.5 },
        ],
      },
      {
        objectId: 0,
        name: null,
        skillLineId: 356,
        skillLineName: 'Fishing',
        opens: 2,
        rankMin: null,
        spots: [{ x: 50, y: 60, opens: 2 }],
      },
    ],
  };

  it('turns spots into zone map points, colored per node type (object id order), sized by opens', () => {
    expect(gatherPoints(map)).toEqual([
      { x: 50, y: 60, kind: 'Fishing', label: 'Fishing', weight: 2 },
      { x: 45.1, y: 33.2, kind: 'Copper Vein', label: 'Copper Vein', weight: 1.5 },
      { x: 46, y: 34.5, kind: 'Copper Vein', label: 'Copper Vein', weight: 1.5 },
    ]);
  });

  it('spotSize grows with opens and stays readable', () => {
    expect(spotSize(0)).toBe(8);
    expect(spotSize(1)).toBe(10);
    expect(spotSize(4)).toBe(14);
    expect(spotSize(10_000)).toBe(30);
  });

  it('maps spots to one scatter series per node type on a 0–100 grid with y inverted', () => {
    const o = gatheringScatterOption(map, P);
    expect(o.xAxis).toMatchObject({ type: 'value', min: 0, max: 100 });
    expect(o.yAxis).toMatchObject({ type: 'value', min: 0, max: 100, inverse: true });
    expect(o.series.map((s) => s.name)).toEqual(['Fishing', 'Copper Vein']);
    // Colors follow the node (object id order), and each type has its own marker shape too.
    expect(o.series.map((s) => s.itemStyle.color)).toEqual([
      CATEGORICAL.light[0],
      CATEGORICAL.light[1],
    ]);
    expect(new Set(o.series.map((s) => s.symbol)).size).toBe(2);
    expect(o.series[1]!.data).toEqual([
      [45.1, 33.2, 1.5],
      [46, 34.5, 1.5],
    ]);
    expect(o.series[1]!.symbolSize([0, 0, 4])).toBe(14);
    // Tooltips use ECharts' escaped default (no HTML formatter with node names).
    expect(o.tooltip).not.toHaveProperty('formatter');
    expect(o.series[1]!.encode.tooltip).toEqual(['x', 'y', 'opens']);
    expect(o.legend.data).toEqual(['Fishing', 'Copper Vein']);
  });

  it('folds node types past the palette into one "Other" series', () => {
    const many: GatherMap = {
      ...map,
      nodes: Array.from({ length: 10 }, (_, i) => ({
        ...map.nodes[0]!,
        objectId: 100 + i,
        name: `Node ${i}`,
        spots: [{ x: i, y: i, opens: 1 }],
      })),
    };
    const o = gatheringScatterOption(many, CHART_PALETTES.dark);
    expect(o.series).toHaveLength(8);
    expect(o.series[7]!.name).toBe('Other');
    expect(o.series[7]!.data).toHaveLength(3);
    expect(o.series[0]!.itemStyle.color).toBe(CATEGORICAL.dark[0]);
  });
});

describe('skill rank over time', () => {
  const history: SkillHistory = {
    items: [
      {
        char: 'Fontenot-Bayou',
        professions: [
          {
            skillLineId: 164,
            name: 'Blacksmithing',
            rank: 60,
            maxRank: 75,
            points: [
              {
                observedAt: '2026-09-23T10:00:00-05:00',
                fromRank: 58,
                rank: 59,
                build: 1,
                recipeId: null,
                recipeName: null,
              },
              {
                observedAt: '2026-09-23T11:00:00-05:00',
                fromRank: 59,
                rank: 60,
                build: 1,
                recipeId: 3115,
                recipeName: 'Rough Weightstone',
              },
            ],
          },
        ],
      },
      {
        char: 'Guidry-Bayou',
        professions: [
          { skillLineId: 164, name: 'Blacksmithing', rank: 10, maxRank: 75, points: [] },
        ],
      },
      {
        char: 'Thibodeaux-Bayou',
        professions: [{ skillLineId: 197, name: 'Tailoring', rank: 12, maxRank: 75, points: [] }],
      },
    ],
  };

  it('picks one profession: a series per character that has rises', () => {
    expect(skillRankSeries(history, 164)).toEqual([
      {
        char: 'Fontenot-Bayou',
        data: [
          [Date.parse('2026-09-23T15:00:00Z'), 59],
          [Date.parse('2026-09-23T16:00:00Z'), 60],
        ],
      },
    ]);
    expect(skillRankSeries(history, 197)).toEqual([]);
  });

  it('draws step lines on a time axis in a fixed color order, with a legend', () => {
    const o = skillRankOption(skillRankSeries(history, 164), P);
    expect(o.xAxis.type).toBe('time');
    expect(o.series).toHaveLength(1);
    expect(o.series[0]).toMatchObject({ type: 'line', step: 'end', name: 'Fontenot-Bayou' });
    expect(o.series[0]!.lineStyle.color).toBe(CATEGORICAL.light[0]);
    expect(o.legend.show).toBe(false);
    // Axis labels are Chicago dates (canvas text, not HTML).
    // Rises within 3 days: hour ticks; further apart: day ticks.
    expect(o.xAxis.axisLabel.formatter(Date.parse('2026-09-23T16:00:00Z'))).toBe('Sep 23, 11 AM');
    const long = skillRankOption(
      [
        {
          char: 'A',
          data: [
            [Date.parse('2026-09-01T16:00:00Z'), 1],
            [Date.parse('2026-09-23T16:00:00Z'), 2],
          ],
        },
        { char: 'B', data: [[Date.parse('2026-09-02T16:00:00Z'), 5]] },
      ],
      CHART_PALETTES.dark,
    );
    expect(long.xAxis.axisLabel.formatter(Date.parse('2026-09-23T16:00:00Z'))).toBe('Sep 23');
    expect(long.legend.show).toBe(true);
    expect(long.series.map((s) => s.lineStyle.color)).toEqual(CATEGORICAL.dark.slice(0, 2));
  });

  it('shows every character: past the palette, colors cycle with a dashed, then dotted line', () => {
    const n = CATEGORICAL.light.length * 2 + 1;
    const many = Array.from({ length: n }, (_, i) => ({
      char: `Char${i}-Bayou`,
      data: [[Date.parse('2026-09-01T16:00:00Z') + i * 1000, i + 1] as [number, number]],
    }));
    const o = skillRankOption(many, P);
    expect(o.series).toHaveLength(n);
    expect(o.series.map((s) => s.name)).toEqual(many.map((m) => m.char));
    expect(o.legend.show).toBe(true);
    const k = CATEGORICAL.light.length;
    expect(o.series[k]!.lineStyle.color).toBe(CATEGORICAL.light[0]);
    expect(o.series[k]!.itemStyle.color).toBe(CATEGORICAL.light[0]);
    expect(o.series[0]!.lineStyle.type).toBe('solid');
    expect(o.series[k]!.lineStyle.type).toBe('dashed');
    expect(o.series[2 * k]!.lineStyle.type).toBe('dotted');
    expect(o.series[2 * k]!.lineStyle.color).toBe(CATEGORICAL.light[0]);
  });
});
