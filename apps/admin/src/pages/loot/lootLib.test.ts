import { describe, expect, it } from 'vitest';
import { CHART_PALETTES } from '../../lib/charts';
import {
  formatCopper,
  formatRate,
  mobDropChartHeight,
  mobDropOption,
  mobLabel,
  qualityLabel,
  rateWidth,
} from './lootLib';

const P = CHART_PALETTES.light;

describe('formatRate', () => {
  it('shows a percentage with sensible precision', () => {
    expect(formatRate(0.5)).toBe('50%');
    expect(formatRate(0.125)).toBe('12.5%');
    expect(formatRate(0.0034)).toBe('0.34%');
    expect(formatRate(1)).toBe('100%');
    expect(formatRate(0)).toBe('0%');
    expect(formatRate(null)).toBe('—');
  });
});

describe('rateWidth', () => {
  it('maps a rate to a clamped bar width in percent', () => {
    expect(rateWidth(0.5)).toBe(50);
    expect(rateWidth(1.4)).toBe(100);
    expect(rateWidth(-1)).toBe(0);
    expect(rateWidth(null)).toBe(0);
  });
});

describe('formatCopper', () => {
  it('splits copper into gold, silver and copper', () => {
    expect(formatCopper(211.3)).toBe('2s 11c');
    expect(formatCopper(12_345)).toBe('1g 23s 45c');
    expect(formatCopper(10_000)).toBe('1g');
    expect(formatCopper(0)).toBe('0c');
    expect(formatCopper(null)).toBe('—');
  });
});

describe('mobLabel', () => {
  it('uses the name when known, else the id', () => {
    expect(mobLabel(644, 'Defias Miner')).toBe('Defias Miner');
    expect(mobLabel(644, null)).toBe('NPC 644');
  });
});

describe('qualityLabel', () => {
  it('names item qualities', () => {
    expect(qualityLabel(0)).toBe('Poor');
    expect(qualityLabel(3)).toBe('Rare');
    expect(qualityLabel(null)).toBe('Unknown');
    expect(qualityLabel(42)).toBe('Quality 42');
  });
});

describe('mobDropOption', () => {
  const items = [
    { itemId: 2589, name: 'Linen Cloth', quality: 1, dropped: 2, quantity: 3, rate: 0.5 },
    { itemId: 872, name: null, quality: 3, dropped: 2, quantity: 2, rate: 0.25 },
    { itemId: 1, name: 'Nothing', quality: 0, dropped: 0, quantity: 0, rate: null },
  ];

  it('draws rates as horizontal bars, highest on top, in percent', () => {
    const o = mobDropOption(items, 4, P);
    // ECharts draws categories bottom-up: the highest rate is last.
    expect(o.yAxis.data).toEqual(['Nothing', 'Item 872', 'Linen Cloth']);
    expect(o.series[0]!.data).toEqual([0, 25, 50]);
    expect(o.series[0]!.itemStyle.color).toBe(P.series);
    expect(o.xAxis.max).toBe(100);
    expect(o.tooltip.valueFormatter(12.5)).toBe('12.5% of corpses');
    expect(o.series[0]!.label.formatter({ value: 50 })).toBe('50%');
  });

  it('keeps the top 20 by rate', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      itemId: i + 1,
      name: `Item ${i + 1}`,
      quality: 1,
      dropped: i,
      quantity: i,
      rate: i / 100,
    }));
    const o = mobDropOption(many, 100, P);
    expect(o.yAxis.data).toHaveLength(20);
    expect(o.yAxis.data.at(-1)).toBe('Item 30');
    expect(mobDropChartHeight(20)).toBe(20 * 24 + 40);
    expect(mobDropChartHeight(1)).toBe(120);
  });

  it('stretches the axis past 100% when a rate is above it', () => {
    const over = [
      { itemId: 2589, name: 'Linen Cloth', quality: 1, dropped: 5, quantity: 9, rate: 1.25 },
    ];
    expect(mobDropOption(over, 4, P).xAxis.max).toBe(125);
    expect(mobDropOption([{ ...over[0]!, rate: 0.9 }], 4, P).xAxis.max).toBe(100);
    expect(mobDropOption([], 0, P).xAxis.max).toBe(100);
  });
});
