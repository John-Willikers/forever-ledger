// Pure helpers for the Quests page: URL filters ↔ API path, formatting, and data → ECharts option mappers.
// Uploaded strings (titles, zones, NPC names) only ever go into ECharts as series/data names or category labels:
// the default tooltip escapes them and the canvas draws text. No custom HTML tooltip formatters here.
import { CHART_PALETTES } from '../../lib/charts';
import type { ChartPalette } from '../../lib/charts';
import { plural } from '../../lib/format';
import type { Loc, QuestObservationRow, QuestReward, QuestRow, RewardChoice } from './types';

/** Rows asked per page (the server caps at 500). */
export const QUESTS_PAGE_SIZE = 200;

export interface QuestFilters {
  search: string | null;
  zone: string | null;
  minLevel: number | null;
  maxLevel: number | null;
  build: number | null;
  forever: boolean;
  mismatch: boolean;
  offset: number;
}

const INT4_MAX = 2_147_483_647;

const posInt = (v: string | null) => {
  if (v === null || !/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n > 0 && n <= INT4_MAX ? n : null;
};

const text = (v: string | null) => {
  const t = v?.trim() ?? '';
  return t === '' ? null : t;
};

/** The table filters from the page's URL (`?search=&zone=&minLevel=&maxLevel=&build=&forever=1&mismatch=1&offset=`). */
export function filtersFromParams(p: URLSearchParams): QuestFilters {
  return {
    search: text(p.get('search')),
    zone: text(p.get('zone')),
    minLevel: posInt(p.get('minLevel')),
    maxLevel: posInt(p.get('maxLevel')),
    build: posInt(p.get('build')),
    forever: p.get('forever') === '1',
    mismatch: p.get('mismatch') === '1',
    offset: posInt(p.get('offset')) ?? 0,
  };
}

/** GET path for one page of the quest table. */
export function questsPath(f: QuestFilters, limit = QUESTS_PAGE_SIZE) {
  const q = new URLSearchParams({ limit: String(limit) });
  if (f.offset > 0) q.set('offset', String(f.offset));
  if (f.search) q.set('search', f.search);
  if (f.zone) q.set('zone', f.zone);
  if (f.minLevel !== null) q.set('minLevel', String(f.minLevel));
  if (f.maxLevel !== null) q.set('maxLevel', String(f.maxLevel));
  if (f.build !== null) q.set('build', String(f.build));
  if (f.forever) q.set('forever', '1');
  if (f.mismatch) q.set('mismatch', '1');
  return `/admin/api/quests?${q.toString()}`;
}

/** A copy of `params` with `key` set (or removed for null/''); any filter change goes back to the first page. */
export function withParam(params: URLSearchParams, key: string, value: string | null) {
  const next = new URLSearchParams(params);
  if (value === null || value === '') next.delete(key);
  else next.set(key, value);
  if (key !== 'offset' && key !== 'quest') next.delete('offset');
  return next;
}

/** `Zone · Subzone (x, y)`; parts that are missing are left out. */
export function formatLoc(loc: Loc | null | undefined) {
  if (!loc) return '—';
  const place = [loc.zone, loc.subzone].filter((x): x is string => !!x).join(' · ');
  const xy = loc.x !== null && loc.y !== null ? `(${loc.x.toFixed(1)}, ${loc.y.toFixed(1)})` : '';
  return [place, xy].filter(Boolean).join(' ') || '—';
}

const itemName = (c: { itemId: number; name: string | null }) => c.name ?? `item ${c.itemId}`;

/** `Boots ×2 · Staff ×1` (the server sends choices most picked first) and the number of picks. */
export function pickSummary(choices: RewardChoice[]) {
  return {
    text: choices.map((c) => `${itemName(c)} ×${c.picks}`).join(' · '),
    picks: choices.reduce((n, c) => n + c.picks, 0),
  };
}

/**
 * Categorical slots for scatter plots (reference palette, validated all-pairs for the first three only, so plots cap
 * at three colored series and fold the rest into a muted "Other").
 */
const CATEGORICAL: Readonly<Record<'light' | 'dark', readonly string[]>> = {
  light: ['#2a78d6', '#eb6834', '#1baf7a'],
  dark: ['#3987e5', '#d95926', '#199e70'],
};

export const categoricalColors = (p: ChartPalette) =>
  CATEGORICAL[p === CHART_PALETTES.dark ? 'dark' : 'light'];

const tooltipStyle = (p: ChartPalette) => ({
  backgroundColor: p.surface,
  borderColor: p.grid,
  textStyle: { color: p.text },
});

const axisStyle = (p: ChartPalette) => ({
  nameTextStyle: { color: p.muted },
  axisLine: { lineStyle: { color: p.grid } },
  axisLabel: { color: p.muted },
  splitLine: { lineStyle: { color: p.grid, opacity: 0.6 } },
});

const UNKNOWN_ZONE = 'Unknown zone';
const OTHER = 'Other';
const COLORED_ZONES = 3;

export interface ZoneSeries {
  zone: string;
  /** Categorical slot, null for "Other". */
  slot: number | null;
  rows: QuestRow[];
}

/** Plottable rows (level and XP known) by zone: the three biggest zones, then "Other". */
export function zoneSeriesOf(rows: QuestRow[]): ZoneSeries[] {
  const byZone = new Map<string, QuestRow[]>();
  for (const r of rows) {
    if (r.level === null || r.xpOffered === null) continue;
    const zone = r.category || UNKNOWN_ZONE;
    if (!byZone.has(zone)) byZone.set(zone, []);
    byZone.get(zone)!.push(r);
  }
  const zones = [...byZone].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const out: ZoneSeries[] = zones
    .slice(0, COLORED_ZONES)
    .map(([zone, list], slot) => ({ zone, slot, rows: list }));
  const rest = zones.slice(COLORED_ZONES).flatMap(([, list]) => list);
  if (rest.length) out.push({ zone: OTHER, slot: null, rows: rest });
  return out;
}

const DOT = 9;
const FOREVER_DOT = 14;

/** XP offered (y) against quest level (x), colored by zone; Forever-only quests are larger outlined diamonds. */
export function xpVsLevelOption(rows: QuestRow[], p: ChartPalette) {
  const colors = categoricalColors(p);
  const groups = zoneSeriesOf(rows);
  return {
    animation: false,
    grid: { left: 12, right: 24, top: 40, bottom: 32, containLabel: true },
    legend: {
      data: groups.map((g) => g.zone),
      top: 0,
      textStyle: { color: p.text },
      icon: 'circle',
    },
    tooltip: { trigger: 'item', ...tooltipStyle(p) },
    xAxis: {
      type: 'value',
      name: 'Quest level',
      nameLocation: 'middle',
      nameGap: 28,
      minInterval: 1,
      scale: true,
      ...axisStyle(p),
    },
    yAxis: {
      type: 'value',
      name: 'XP offered',
      scale: true,
      ...axisStyle(p),
    },
    series: groups.map((g) => ({
      type: 'scatter',
      name: g.zone,
      symbolSize: DOT,
      dimensions: ['Level', 'XP offered', 'Quest id'],
      encode: { x: 0, y: 1, tooltip: [0, 1, 2] },
      itemStyle: {
        color: g.slot === null ? p.muted : colors[g.slot]!,
        borderColor: p.surface,
        borderWidth: 1,
      },
      data: g.rows.map((r) => ({
        name: r.title ?? `Quest ${r.questId}`,
        value: [r.level!, r.xpOffered!, r.questId],
        ...(r.foreverOnly
          ? {
              symbol: 'diamond',
              symbolSize: FOREVER_DOT,
              itemStyle: { borderColor: p.text, borderWidth: 1.5 },
            }
          : {}),
      })),
    })),
  };
}

export interface NpcPoint {
  name: string;
  x: number;
  y: number;
}

export interface NpcLocationGroup {
  zone: string;
  givers: NpcPoint[];
  enders: NpcPoint[];
}

/**
 * Where the quest's NPCs stand, per zone: givers (detail/accept windows) and enders (complete), from the NPC's own
 * location. Points without coordinates are skipped; the same NPC at the same spot counts once.
 */
export function npcLocationGroups(observations: QuestObservationRow[]): NpcLocationGroup[] {
  const groups = new Map<
    string,
    { givers: Map<string, NpcPoint>; enders: Map<string, NpcPoint> }
  >();
  for (const o of observations) {
    const role =
      o.stage === 'complete'
        ? 'enders'
        : o.stage === 'detail' || o.stage === 'accept'
          ? 'givers'
          : null;
    const loc = o.npc?.loc;
    if (!role || !o.npc || !loc || loc.x === null || loc.y === null) continue;
    const zone = loc.zone || UNKNOWN_ZONE;
    if (!groups.has(zone)) groups.set(zone, { givers: new Map(), enders: new Map() });
    const name = o.npc.name ?? (o.npc.id !== null ? `NPC ${o.npc.id}` : 'NPC');
    const points = groups.get(zone)![role];
    points.set(`${name}\u0000${loc.x}\u0000${loc.y}`, { name, x: loc.x, y: loc.y });
  }
  return [...groups]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([zone, g]) => ({ zone, givers: [...g.givers.values()], enders: [...g.enders.values()] }));
}

/** One zone's givers and enders on the 0–100 map grid (y grows downwards, like the game's map coordinates). */
export function npcLocationOption(g: NpcLocationGroup, p: ChartPalette) {
  const colors = categoricalColors(p);
  const axis = (extra: object) => ({
    type: 'value',
    min: 0,
    max: 100,
    interval: 25,
    ...axisStyle(p),
    ...extra,
  });
  const series = (name: string, points: NpcPoint[], color: string, symbol: string) => ({
    type: 'scatter',
    name,
    symbol,
    symbolSize: 12,
    itemStyle: { color, borderColor: p.surface, borderWidth: 2 },
    data: points.map((pt) => ({ name: pt.name, value: [pt.x, pt.y] })),
  });
  return {
    animation: false,
    grid: { left: 8, right: 16, top: 32, bottom: 8, containLabel: true },
    legend: { data: ['Givers', 'Enders'], top: 0, textStyle: { color: p.text } },
    tooltip: { trigger: 'item', ...tooltipStyle(p) },
    xAxis: axis({}),
    yAxis: axis({ inverse: true }),
    series: [
      series('Givers', g.givers, colors[0]!, 'circle'),
      series('Enders', g.enders, colors[1]!, 'triangle'),
    ],
  };
}

export interface PickShare {
  itemId: number;
  name: string;
  picks: number;
  share: number;
}

/** A build's reward choices, most picked first, with each one's share of the picks. */
export function picksFor(rewards: QuestReward[], build: number): PickShare[] {
  const list = rewards.filter((r) => r.build === build && r.kind === 'choice');
  const total = list.reduce((n, r) => n + r.picks, 0);
  return list
    .map((r) => ({
      itemId: r.itemId,
      name: itemName(r),
      picks: r.picks,
      share: total > 0 ? r.picks / total : 0,
    }))
    .sort((a, b) => b.picks - a.picks || a.itemId - b.itemId);
}

/** Pixel height for the pick chart: one row per choice. */
export const pickChartHeight = (choices: number) => Math.max(100, choices * 28 + 32);

/** Pick popularity: horizontal bars, most picked on top, the count at the end of each bar. */
export function pickBarOption(picks: PickShare[], p: ChartPalette) {
  const rows = [...picks].reverse();
  return {
    animation: false,
    grid: { left: 8, right: 48, top: 8, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'item',
      ...tooltipStyle(p),
      valueFormatter: (v: unknown) => plural(Number(v), 'pick'),
    },
    xAxis: { type: 'value', show: false, minInterval: 1 },
    yAxis: {
      type: 'category',
      data: rows.map((r) => r.name),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: p.text },
    },
    series: [
      {
        type: 'bar',
        name: 'Picks',
        data: rows.map((r) => r.picks),
        itemStyle: { color: p.series, borderRadius: [0, 4, 4, 0] },
        barMaxWidth: 16,
        label: { show: true, position: 'right', color: p.muted },
      },
    ],
  };
}
