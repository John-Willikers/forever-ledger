import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  dropRows,
  formatDelta,
  itemRows,
  overlapCount,
  pairFromParams,
  questRows,
  recipeRows,
  summaryTiles,
  toneOf,
  trainerRows,
  vendorRows,
} from './buildsLib';
import type { BuildDiff, BuildRow, Category } from './types';

const build = (b: number, counts: Partial<BuildRow['counts']> = {}): BuildRow => ({
  build: b,
  version: null,
  interface: null,
  firstSeen: null,
  lastSeen: null,
  uploads: 0,
  characters: 0,
  counts: {
    items: 0,
    quests: 0,
    recipes: 0,
    vendors: 0,
    trainers: 0,
    npcsLooted: 0,
    apiSamples: 0,
    ...counts,
  },
});
const empty = <T>(): Category<T> => ({
  total: 0,
  changes: [],
  onlyInFrom: { total: 0, sample: [] },
  onlyInTo: { total: 0, sample: [] },
});

describe('formatDelta', () => {
  it('signs plain numbers', () => {
    expect(formatDelta(850, 890, 'number')).toBe('+40');
    expect(formatDelta(7, 5, 'number')).toBe('−2');
    expect(formatDelta(1.5, 2.25, 'number')).toBe('+0.75');
    expect(formatDelta(5, 5, 'number')).toBeNull();
    expect(formatDelta(null, 5, 'number')).toBeNull();
    expect(formatDelta(5, null, 'number')).toBeNull();
  });

  it('shows money as coins with the relative change', () => {
    expect(formatDelta(1000, 1100, 'money')).toBe('+1s (+10%)');
    expect(formatDelta(500, 450, 'money')).toBe('−50c (−10%)');
    expect(formatDelta(2600, 2800, 'money')).toBe('+2s (+7.7%)');
    // No percentage from zero.
    expect(formatDelta(0, 25, 'money')).toBe('+25c');
  });

  it('shows rates in percentage points', () => {
    expect(formatDelta(0.2, 0.1, 'rate')).toBe('−10 pp');
    expect(formatDelta(0, 0.2, 'rate')).toBe('+20 pp');
    expect(formatDelta(0.3333, 0.35, 'rate')).toBe('+1.7 pp');
  });
});

describe('toneOf', () => {
  it('colors by which direction is good', () => {
    expect(toneOf(850, 890, 'up')).toBe('good');
    expect(toneOf(890, 850, 'up')).toBe('bad');
    expect(toneOf(10, 11, 'down')).toBe('bad');
    expect(toneOf(11, 10, 'down')).toBe('good');
    expect(toneOf(1, 2, 'none')).toBe('neutral');
    expect(toneOf(null, 2, 'up')).toBe('neutral');
    expect(toneOf(2, 2, 'up')).toBe('neutral');
  });
});

describe('pairFromParams', () => {
  const builds = [build(70100), build(69977), build(61600)];
  const pair = (q: string) => pairFromParams(new URLSearchParams(q), builds);

  it('defaults to the two newest builds', () => {
    expect(pair('')).toEqual({ from: 69977, to: 70100 });
  });

  it('keeps valid picks and fills a missing or unknown side', () => {
    expect(pair('from=61600&to=69977')).toEqual({ from: 61600, to: 69977 });
    expect(pair('from=70100&to=61600')).toEqual({ from: 70100, to: 61600 });
    expect(pair('to=69977')).toEqual({ from: 61600, to: 69977 });
    expect(pair('to=61600')).toEqual({ from: 70100, to: 61600 });
    expect(pair('from=61600')).toEqual({ from: 61600, to: 70100 });
    expect(pair('from=1&to=abc')).toEqual({ from: 69977, to: 70100 });
    // The same build twice keeps `to` and picks another `from`.
    expect(pair('from=69977&to=69977')).toEqual({ from: 61600, to: 69977 });
  });

  it('needs two builds', () => {
    expect(pairFromParams(new URLSearchParams(''), [build(1)])).toBeNull();
    expect(pairFromParams(new URLSearchParams(''), [])).toBeNull();
  });
});

describe('itemRows', () => {
  it('maps fields, stats and tooltip lines to old → new rows', () => {
    const rows = itemRows([
      {
        itemId: 872,
        name: 'Rockslicer',
        quality: 3,
        fields: [
          { field: 'ilvl', from: 21, to: 23 },
          { field: 'reqLevel', from: 16, to: 18 },
          { field: 'sellPrice', from: 2600, to: 2800 },
        ],
        stats: [{ stat: 'ITEM_MOD_STAMINA_SHORT', from: null, to: 3 }],
        tooltip: { added: ['|cff1eff00Equip: +9 Strength.|r'], removed: ['Old line'] },
      },
    ]);
    expect(rows.map((r) => [r.what, r.from, r.to, r.delta, r.tone])).toEqual([
      ['Item level', '21', '23', '+2', 'good'],
      ['Required level', '16', '18', '+2', 'bad'],
      ['Sell price', '26s', '28s', '+2s (+7.7%)', 'good'],
      ['Stamina', '—', '3', null, 'neutral'],
      ['Tooltip', 'Old line', 'Equip: +9 Strength.', null, 'neutral'],
    ]);
    expect(rows[0]!.entity).toEqual({ kind: 'item', id: 872, name: 'Rockslicer', quality: 3 });
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });
});

describe('questRows', () => {
  it('maps XP, money and reward options', () => {
    const rows = questRows([
      {
        questId: 1234,
        title: 'Red Silk Bandanas',
        level: 17,
        xp: { from: 850, to: 890 },
        money: { from: 500, to: 450 },
        rewards: {
          added: [{ itemId: 5557, name: null, quality: null, kind: 'choice', count: 1 }],
          removed: [{ itemId: 5556, name: 'Bayou Staff', quality: 2, kind: 'reward', count: 1 }],
          changed: [{ itemId: 5555, name: 'Boots', quality: 2, kind: 'choice', from: 1, to: 2 }],
        },
      },
    ]);
    expect(
      rows.map((r) => [r.what, r.item?.itemId ?? null, r.from, r.to, r.delta, r.tone]),
    ).toEqual([
      ['XP offered', null, '850', '890', '+40', 'good'],
      ['Money offered', null, '5s', '4s 50c', '−50c (−10%)', 'bad'],
      ['Reward choice added', 5557, '—', '×1', null, 'neutral'],
      ['Reward removed', 5556, '×1', '—', null, 'neutral'],
      ['Reward choice count', 5555, '×1', '×2', '+1', 'good'],
    ]);
    expect(rows[0]!.entity).toEqual({ kind: 'quest', id: 1234, name: 'Red Silk Bandanas' });
  });
});

describe('recipeRows', () => {
  it('maps fields and reagents; more reagents is worse', () => {
    const rows = recipeRows([
      {
        recipeId: 2389,
        name: 'Red Linen Robe',
        outputItemId: 2572,
        outputName: 'Red Linen Robe',
        fields: [
          { field: 'maxTrivial', from: 90, to: 95 },
          { field: 'qtyMax', from: 1, to: 2 },
          { field: 'outputItemId', from: 2571, to: 2572 },
        ],
        reagents: {
          added: [{ itemId: 2589, name: 'Linen Cloth', qty: 1 }],
          removed: [{ itemId: 2320, name: 'Coarse Thread', qty: 2 }],
          changed: [{ itemId: 2996, name: 'Bolt of Linen Cloth', from: 3, to: 4 }],
        },
      },
    ]);
    expect(rows.map((r) => [r.what, r.from, r.to, r.delta, r.tone])).toEqual([
      ['Max trivial rank', '90', '95', '+5', 'neutral'],
      ['Output quantity (max)', '1', '2', '+1', 'good'],
      ['Output item', 'Item 2571', 'Item 2572', null, 'neutral'],
      ['Reagent added', '—', '×1', null, 'neutral'],
      ['Reagent removed', '×2', '—', null, 'neutral'],
      ['Reagent quantity', '×3', '×4', '+1', 'bad'],
    ]);
    expect(rows[0]!.entity).toEqual({ kind: 'recipe', id: 2389, name: 'Red Linen Robe' });
    expect(rows[3]!.item).toEqual({ itemId: 2589, name: 'Linen Cloth', quality: null });
  });
});

describe('vendorRows', () => {
  it('maps listings; a higher price is worse for the buyer', () => {
    const rows = vendorRows([
      {
        npcId: 1347,
        name: 'Alexandra Bolero',
        title: 'Tailoring Supplies',
        added: [
          {
            itemId: 6270,
            name: null,
            quality: null,
            price: 0,
            stack: 1,
            costs: [{ amount: 3, itemId: 250001, currencyId: null, name: 'Mark' }],
          },
        ],
        removed: [{ itemId: 2598, name: 'Pattern', quality: 1, price: 1200, stack: 1, costs: [] }],
        changed: [
          {
            itemId: 2320,
            name: 'Coarse Thread',
            quality: 1,
            from: { price: 10, stack: 5, costs: [] },
            to: { price: 11, stack: 5, costs: [] },
          },
        ],
      },
    ]);
    expect(rows.map((r) => [r.what, r.from, r.to, r.delta, r.tone])).toEqual([
      ['Now sold', '—', '3× [Mark]', null, 'neutral'],
      ['No longer sold', '12s', '—', null, 'neutral'],
      ['Price', '10c for 5', '11c for 5', '+1c (+10%)', 'bad'],
    ]);
    expect(rows[0]!.entity).toEqual({
      kind: 'vendor',
      id: 1347,
      name: 'Alexandra Bolero',
      title: 'Tailoring Supplies',
    });
  });
});

describe('trainerRows', () => {
  it('maps services; cost and requirements going up is worse; flags partial scans', () => {
    const rows = trainerRows([
      {
        npcId: 1103,
        name: 'Eldrin',
        title: null,
        complete: { from: false, to: true },
        added: [
          {
            name: 'Blue Linen Vest',
            cost: 300,
            skill: 'Tailoring',
            skillRank: 70,
            level: 5,
            itemId: null,
          },
        ],
        removed: [
          { name: 'Old', cost: null, skill: null, skillRank: null, level: null, itemId: null },
        ],
        changed: [
          {
            name: 'Brown Linen Vest',
            fields: [
              { field: 'cost', from: 100, to: 120 },
              { field: 'skillRank', from: 45, to: 40 },
            ],
          },
        ],
      },
    ]);
    expect(rows.map((r) => [r.what, r.detail, r.from, r.to, r.delta, r.tone])).toEqual([
      ['Service added', 'Blue Linen Vest', '—', '3s · Tailoring 70 · level 5', null, 'neutral'],
      ['Service removed', 'Old', '—', '—', null, 'neutral'],
      ['Cost', 'Brown Linen Vest', '1s', '1s 20c', '+20c (+20%)', 'bad'],
      ['Skill rank', 'Brown Linen Vest', '45', '40', '−5', 'good'],
    ]);
    expect(rows.every((r) => r.note === 'partial scan in one build')).toBe(true);
  });
});

describe('dropRows', () => {
  it('maps rate changes with the counts behind them', () => {
    const rows = dropRows([
      {
        npcId: 644,
        npcName: null,
        itemId: 872,
        name: 'Rockslicer',
        quality: 3,
        from: { corpses: 10, dropped: 2, rate: 0.2 },
        to: { corpses: 20, dropped: 2, rate: 0.1 },
      },
    ]);
    expect(rows.map((r) => [r.what, r.from, r.to, r.delta, r.tone])).toEqual([
      ['Drop rate', '20% (2/10)', '10% (2/20)', '−10 pp', 'bad'],
    ]);
    expect(rows[0]!.entity).toEqual({ kind: 'mob', id: 644, name: null });
    expect(rows[0]!.item).toEqual({ itemId: 872, name: 'Rockslicer', quality: 3 });
  });
});

describe('overlap and summary', () => {
  const diff: BuildDiff = {
    from: { build: 1, version: null, interface: null, firstSeen: null, lastSeen: null },
    to: { build: 2, version: null, interface: null, firstSeen: null, lastSeen: null },
    limit: 500,
    sampleLimit: 50,
    minCorpses: 5,
    items: { ...empty(), total: 2, onlyInFrom: { total: 1, sample: [] } },
    quests: empty(),
    recipes: empty(),
    vendors: empty(),
    trainers: empty(),
    drops: { ...empty(), belowThreshold: 0 },
  };

  it('counts entities seen in both builds from the from-build counts', () => {
    expect(overlapCount(build(1, { items: 12 }), diff, 'items')).toBe(11);
    expect(overlapCount(build(1, { npcsLooted: 3 }), diff, 'drops')).toBe(3);
    expect(overlapCount(undefined, diff, 'items')).toBeNull();
    // Never below zero (counts may be a little stale).
    expect(overlapCount(build(1, { items: 0 }), diff, 'items')).toBe(0);
  });

  it('builds one tile per category', () => {
    const tiles = summaryTiles(diff, build(1, { items: 12 }));
    expect(tiles.map((t) => t.key)).toEqual(CATEGORIES.map((c) => c.key));
    expect(tiles[0]).toEqual({
      key: 'items',
      label: 'Items',
      changed: 2,
      onlyInFrom: 1,
      onlyInTo: 0,
      overlap: 11,
    });
  });
});
