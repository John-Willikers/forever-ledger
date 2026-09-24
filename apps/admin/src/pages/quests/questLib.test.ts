import { describe, expect, it } from 'vitest';
import { CHART_PALETTES } from '../../lib/charts';
import {
  categoricalColors,
  filtersFromParams,
  formatLoc,
  formatMoney,
  npcLocationGroups,
  npcLocationOption,
  pickBarOption,
  picksFor,
  pickSummary,
  QUESTS_PAGE_SIZE,
  questsPath,
  withParam,
  xpVsLevelOption,
  zoneSeriesOf,
} from './questLib';
import type { QuestObservationRow, QuestReward, QuestRow } from './types';

const P = CHART_PALETTES.light;

function row(over: Partial<QuestRow>): QuestRow {
  return {
    questId: 1,
    build: 61582,
    builds: [61582],
    title: 'A quest',
    level: 10,
    category: 'Elwynn Forest',
    suggestedGroup: null,
    xpOffered: 500,
    moneyOffered: null,
    turnIns: 0,
    avgXpPaid: null,
    xpMismatch: false,
    foreverOnly: false,
    rewardChoices: [],
    givers: [],
    enders: [],
    lastSeen: null,
    ...over,
  };
}

describe('filtersFromParams / questsPath', () => {
  it('reads sanitized filters from the page URL', () => {
    const f = filtersFromParams(
      new URLSearchParams(
        'search=%20hog%20&zone=The%20Barrens&minLevel=5&maxLevel=abc&build=61582&forever=1&mismatch=0&offset=200&quest=9',
      ),
    );
    expect(f).toEqual({
      search: 'hog',
      zone: 'The Barrens',
      minLevel: 5,
      maxLevel: null,
      build: 61582,
      forever: true,
      mismatch: false,
      offset: 200,
    });
    expect(filtersFromParams(new URLSearchParams('offset=-5&minLevel=0'))).toMatchObject({
      offset: 0,
      minLevel: null,
    });
  });

  it('builds the API path with only the set filters, URL-encoded', () => {
    expect(questsPath(filtersFromParams(new URLSearchParams()))).toBe(
      `/admin/api/quests?limit=${QUESTS_PAGE_SIZE}`,
    );
    expect(
      questsPath(
        filtersFromParams(
          new URLSearchParams('search=a&b&zone=Z+Z&minLevel=3&forever=1&mismatch=1&offset=200'),
        ),
      ),
    ).toBe(
      `/admin/api/quests?limit=${QUESTS_PAGE_SIZE}&offset=200&search=a&zone=Z+Z&minLevel=3&forever=1&mismatch=1`,
    );
    expect(questsPath(filtersFromParams(new URLSearchParams('search=%26x%3D1')))).toContain(
      'search=%26x%3D1',
    );
  });
});

describe('withParam', () => {
  it('sets or clears one key; changing a filter resets the page offset', () => {
    const base = new URLSearchParams('zone=Z&offset=200&quest=5');
    expect(withParam(base, 'search', 'hog').toString()).toBe('zone=Z&quest=5&search=hog');
    expect(withParam(base, 'zone', null).toString()).toBe('quest=5');
    // Paging and the open quest keep the other keys.
    expect(withParam(base, 'offset', '400').toString()).toBe('zone=Z&offset=400&quest=5');
    expect(withParam(base, 'quest', null).toString()).toBe('zone=Z&offset=200');
    // The input isn't changed.
    expect(base.toString()).toBe('zone=Z&offset=200&quest=5');
  });
});

describe('formatMoney', () => {
  it('splits copper into gold, silver and copper', () => {
    expect(formatMoney(123456)).toBe('12g 34s 56c');
    expect(formatMoney(500)).toBe('5s');
    expect(formatMoney(10005)).toBe('1g 5c');
    expect(formatMoney(0)).toBe('0c');
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney(-1)).toBe('—');
  });
});

describe('formatLoc', () => {
  it('reads zone · subzone (x, y)', () => {
    expect(
      formatLoc({ zone: 'Elwynn Forest', subzone: 'Goldshire', mapID: 1, x: 42.1, y: 65.9 }),
    ).toBe('Elwynn Forest · Goldshire (42.1, 65.9)');
    expect(formatLoc({ zone: 'Z', subzone: null, mapID: null, x: null, y: null })).toBe('Z');
    expect(formatLoc({ zone: null, subzone: null, mapID: 5, x: 1, y: 2.25 })).toBe('(1.0, 2.3)');
    expect(formatLoc(null)).toBe('—');
  });
});

describe('pickSummary', () => {
  it('lists choices by picks with the total', () => {
    expect(
      pickSummary([
        { itemId: 1, name: 'Boots', quality: 2, picks: 2 },
        { itemId: 2, name: null, quality: null, picks: 1 },
        { itemId: 3, name: 'Staff', quality: 2, picks: 0 },
      ]),
    ).toEqual({ text: 'Boots ×2 · item 2 ×1 · Staff ×0', picks: 3 });
    expect(pickSummary([])).toEqual({ text: '', picks: 0 });
  });
});

describe('zoneSeriesOf / xpVsLevelOption', () => {
  const rows = [
    row({ questId: 1, category: 'A', level: 5, xpOffered: 100 }),
    row({ questId: 2, category: 'A', level: 6, xpOffered: 120 }),
    row({ questId: 3, category: 'B', level: 7, xpOffered: 140 }),
    row({ questId: 4, category: 'C', level: 8, xpOffered: 160 }),
    row({ questId: 5, category: 'D', level: 9, xpOffered: 180 }),
    row({ questId: 6, category: null, level: 9, xpOffered: 180 }),
    row({ questId: 7, category: 'A', level: null, xpOffered: 100 }),
    row({ questId: 8, category: 'B', level: 12, xpOffered: null }),
    row({
      questId: 90001,
      category: 'B',
      level: 9,
      xpOffered: 400,
      foreverOnly: true,
      title: '<b>x</b>',
    }),
  ];

  it('keeps the three biggest zones and folds the rest into Other; skips unplottable rows', () => {
    const groups = zoneSeriesOf(rows);
    expect(groups.map((g) => [g.zone, g.slot, g.rows.map((r) => r.questId)])).toEqual([
      ['A', 0, [1, 2]],
      ['B', 1, [3, 90001]],
      ['C', 2, [4]],
      ['Other', null, [5, 6]],
    ]);
  });

  it('maps rows to scatter series: color by zone, Forever-only as a larger outlined diamond', () => {
    const o = xpVsLevelOption(rows, P);
    const colors = categoricalColors(P);
    expect(o.series.map((s) => s.name)).toEqual(['A', 'B', 'C', 'Other']);
    expect(o.series.map((s) => s.itemStyle.color)).toEqual([
      colors[0],
      colors[1],
      colors[2],
      P.muted,
    ]);
    expect(o.legend.data).toEqual(['A', 'B', 'C', 'Other']);
    const b = o.series[1]!;
    expect(b.data[0]).toEqual({ name: 'A quest', value: [7, 140, 3] });
    // Untrusted titles go in as data names (ECharts' default tooltip escapes them); no custom formatter.
    expect(b.data[1]).toMatchObject({
      name: '<b>x</b>',
      value: [9, 400, 90001],
      symbol: 'diamond',
    });
    expect((b.data[1] as { symbolSize: number }).symbolSize).toBeGreaterThan(
      o.series[0]!.symbolSize,
    );
    expect(o.tooltip).not.toHaveProperty('formatter');
    expect(o.xAxis.name).toBe('Quest level');
    expect(o.yAxis.name).toBe('XP offered');
  });

  it('names untitled quests by id and uses the dark palette', () => {
    const o = xpVsLevelOption([row({ questId: 42, title: null })], CHART_PALETTES.dark);
    expect(o.series[0]!.data[0]).toMatchObject({ name: 'Quest 42' });
    expect(o.series[0]!.itemStyle.color).toBe(categoricalColors(CHART_PALETTES.dark)[0]);
  });
});

const obs = (over: Partial<QuestObservationRow>): QuestObservationRow => ({
  build: 1,
  stage: 'detail',
  char: 'A-B',
  class: null,
  level: 10,
  observedAt: null,
  xp: null,
  money: null,
  npc: null,
  loc: null,
  ...over,
});
const at = (zone: string | null, x: number | null, y: number | null) => ({
  zone,
  subzone: null,
  mapID: null,
  x,
  y,
});

describe('npcLocationGroups / npcLocationOption', () => {
  const list = [
    obs({ stage: 'detail', npc: { id: 1, name: 'Giver', loc: at('Elwynn', 10, 20) } }),
    obs({ stage: 'accept', npc: { id: 1, name: 'Giver', loc: at('Elwynn', 10, 20) } }),
    obs({ stage: 'complete', npc: { id: 2, name: 'Ender', loc: at('Barrens', 50, 60) } }),
    obs({ stage: 'complete', npc: { id: 3, name: null, loc: at('Elwynn', 11, 21) } }),
    // No npc location, a player location only, a log observation, or no coordinates: skipped.
    obs({ stage: 'accept', loc: at('Elwynn', 1, 1) }),
    obs({ stage: 'log', npc: { id: 4, name: 'Log', loc: at('Elwynn', 1, 1) } }),
    obs({ stage: 'detail', npc: { id: 5, name: 'Nowhere', loc: at('Elwynn', null, 5) } }),
  ];

  it('groups giver and ender locations by zone, deduped', () => {
    expect(npcLocationGroups(list)).toEqual([
      { zone: 'Barrens', givers: [], enders: [{ name: 'Ender', x: 50, y: 60 }] },
      {
        zone: 'Elwynn',
        givers: [{ name: 'Giver', x: 10, y: 20 }],
        enders: [{ name: 'NPC 3', x: 11, y: 21 }],
      },
    ]);
    expect(npcLocationGroups([obs({ npc: { id: 1, name: 'N', loc: at(null, 1, 2) } })])).toEqual([
      { zone: 'Unknown zone', givers: [{ name: 'N', x: 1, y: 2 }], enders: [] },
    ]);
  });

  it('plots 0–100 map coordinates with y pointing down', () => {
    const [g] = npcLocationGroups(list).slice(1);
    const o = npcLocationOption(g!, P);
    expect(o.xAxis).toMatchObject({ min: 0, max: 100 });
    expect(o.yAxis).toMatchObject({ min: 0, max: 100, inverse: true });
    expect(o.series.map((s) => [s.name, s.data])).toEqual([
      ['Givers', [{ name: 'Giver', value: [10, 20] }]],
      ['Enders', [{ name: 'NPC 3', value: [11, 21] }]],
    ]);
    const colors = categoricalColors(P);
    expect(o.series.map((s) => s.itemStyle.color)).toEqual([colors[0], colors[1]]);
    expect(o.tooltip).not.toHaveProperty('formatter');
  });
});

describe('picksFor / pickBarOption', () => {
  const rewards: QuestReward[] = [
    { build: 2, kind: 'choice', itemId: 5, name: 'New', quality: 2, count: 1, picks: 0 },
    { build: 1, kind: 'choice', itemId: 5, name: 'Boots', quality: 2, count: 1, picks: 2 },
    { build: 1, kind: 'choice', itemId: 6, name: null, quality: 2, count: 1, picks: 1 },
    { build: 1, kind: 'reward', itemId: 7, name: 'Fixed', quality: 1, count: 1, picks: 0 },
  ];

  it('keeps the choices of one build, most picked first, with shares', () => {
    expect(picksFor(rewards, 1)).toEqual([
      { itemId: 5, name: 'Boots', picks: 2, share: 2 / 3 },
      { itemId: 6, name: 'item 6', picks: 1, share: 1 / 3 },
    ]);
    expect(picksFor(rewards, 2)).toEqual([{ itemId: 5, name: 'New', picks: 0, share: 0 }]);
  });

  it('draws one horizontal bar per choice, most picked on top', () => {
    const o = pickBarOption(picksFor(rewards, 1), P);
    expect(o.yAxis.data).toEqual(['item 6', 'Boots']);
    expect(o.series[0]!.data).toEqual([1, 2]);
    expect(o.series[0]!.itemStyle.color).toBe(P.series);
    expect(o.tooltip.valueFormatter(2)).toBe('2 picks');
    expect(o.tooltip.valueFormatter(1)).toBe('1 pick');
  });
});
