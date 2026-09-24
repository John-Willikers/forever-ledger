// Pure helpers for the Builds page: which builds to compare, delta text and color, and the build diff flattened into
// one "old → new" row per change. Names and tooltip lines are uploaded data: rendered as text only.
import { formatCosts, formatMoney } from '../../lib/money';
import { formatRate, itemLabel } from '../loot/lootLib';
import { statLabel, tooltipText } from '../items/itemLib';
import type {
  BuildCounts,
  BuildDiff,
  BuildRow,
  CategoryKey,
  DropChange,
  ItemChange,
  ItemRef,
  QuestChange,
  RecipeChange,
  Service,
  ServiceField,
  TrainerChange,
  VendorChange,
  VendorPrice,
} from './types';

const DASH = '—';
const MINUS = '−';

export const CATEGORIES: readonly {
  key: CategoryKey;
  label: string;
  /** What `BuildRow.counts` counts for this category. */
  count: keyof BuildCounts;
}[] = [
  { key: 'items', label: 'Items', count: 'items' },
  { key: 'quests', label: 'Quests', count: 'quests' },
  { key: 'recipes', label: 'Recipes', count: 'recipes' },
  { key: 'vendors', label: 'Vendors', count: 'vendors' },
  { key: 'trainers', label: 'Trainers', count: 'trainers' },
  { key: 'drops', label: 'Drop rates', count: 'npcsLooted' },
];

export const isCategory = (v: string | null): v is CategoryKey =>
  CATEGORIES.some((c) => c.key === v);

// ---- which builds ----------------------------------------------------------------------------------------------

/**
 * The builds to compare from `?from=` / `?to=` (builds newest first): picks that name a known build are kept; a
 * missing `to` is the newest other build, a missing `from` the newest build older than `to` (else the newest other).
 * The same build twice keeps `to`. Null with fewer than two builds.
 */
export function pairFromParams(params: URLSearchParams, builds: BuildRow[]) {
  if (builds.length < 2) return null;
  const known = (key: string) => {
    const raw = params.get(key);
    if (raw === null || !/^\d{1,10}$/.test(raw)) return null;
    return builds.find((b) => b.build === Number(raw))?.build ?? null;
  };
  const fromPick = known('from');
  const toPick = known('to');
  const to = toPick ?? builds.find((b) => b.build !== fromPick)!.build;
  const from =
    fromPick !== null && fromPick !== to
      ? fromPick
      : (builds.find((b) => b.build < to) ?? builds.find((b) => b.build !== to)!).build;
  return { from, to };
}

// ---- deltas ----------------------------------------------------------------------------------------------------

export type Tone = 'good' | 'bad' | 'neutral';
/** Which way is better for the player: `up` (XP, stats), `down` (prices paid, requirements) or neither. */
export type Polarity = 'up' | 'down' | 'none';
export type DeltaKind = 'number' | 'money' | 'rate';

const decimals = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const fmt = (n: number) => decimals.format(n);
const signed = (n: number, text: string) => (n > 0 ? `+${text}` : n < 0 ? `${MINUS}${text}` : text);
const trim1 = (n: number) => String(Number(n.toFixed(1)));

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** `+40`, `−2`; money `+2s (+7.7%)`; rates in percentage points `−10 pp`. Null when a side is missing or equal. */
export function formatDelta(from: unknown, to: unknown, kind: DeltaKind): string | null {
  if (!isNum(from) || !isNum(to) || from === to) return null;
  const d = to - from;
  if (kind === 'rate') return `${signed(d, trim1(Math.abs(d) * 100))} pp`;
  if (kind === 'money') {
    const coins = signed(d, formatMoney(Math.abs(d)));
    return from > 0 ? `${coins} (${signed(d, trim1(Math.abs(d / from) * 100))}%)` : coins;
  }
  return signed(d, fmt(Math.abs(d)));
}

/** Green when the change goes the good way for the player, red the other way; neutral when unknown or equal. */
export function toneOf(from: unknown, to: unknown, polarity: Polarity): Tone {
  if (!isNum(from) || !isNum(to) || from === to || polarity === 'none') return 'neutral';
  return to > from === (polarity === 'up') ? 'good' : 'bad';
}

// ---- rows ------------------------------------------------------------------------------------------------------

/** What changed: a link target when the page has one (item, quest, mob), else plain text with the id. */
export type Entity =
  | { kind: 'item'; id: number; name: string | null; quality: number | null }
  | { kind: 'quest'; id: number; name: string | null }
  | { kind: 'recipe'; id: number; name: string | null }
  | { kind: 'vendor' | 'trainer'; id: number; name: string | null; title: string | null }
  | { kind: 'mob'; id: number; name: string | null };

export interface ChangeRow {
  key: string;
  entity: Entity;
  /** The change: `Item level`, `Reagent added`, `Price`… */
  what: string;
  /** An item the change is about (a reagent, a listing, a reward), linked. */
  item?: ItemRef;
  /** Text naming what the change is about when it isn't an item (a trainer service). */
  detail?: string;
  from: string;
  to: string;
  delta: string | null;
  tone: Tone;
  note?: string;
}

const numText = (v: number | string | null | undefined) =>
  isNum(v) ? fmt(v) : typeof v === 'string' && v !== '' ? v : DASH;
const moneyText = (v: number | null | undefined) => (isNum(v) ? formatMoney(v) : DASH);
const countText = (v: number | null | undefined) => (isNum(v) ? `×${fmt(v)}` : DASH);

/** One numeric old → new row. */
function valueRow(
  base: Omit<ChangeRow, 'from' | 'to' | 'delta' | 'tone'>,
  from: number | string | null,
  to: number | string | null,
  kind: DeltaKind,
  polarity: Polarity,
  text: (v: number | string | null) => string = kind === 'money'
    ? (v) => moneyText(v as number | null)
    : numText,
): ChangeRow {
  return {
    ...base,
    from: text(from),
    to: text(to),
    delta: formatDelta(from, to, kind),
    tone: toneOf(from, to, polarity),
  };
}

const ITEM_FIELDS: Readonly<Record<string, { kind: DeltaKind; polarity: Polarity }>> = {
  ilvl: { kind: 'number', polarity: 'up' },
  reqLevel: { kind: 'number', polarity: 'down' },
  sellPrice: { kind: 'money', polarity: 'up' },
};

export function itemRows(changes: ItemChange[]): ChangeRow[] {
  return changes.flatMap((c) => {
    const entity: Entity = { kind: 'item', id: c.itemId, name: c.name, quality: c.quality };
    const k = `item:${c.itemId}`;
    const rows: ChangeRow[] = [
      ...c.fields.map((f) => {
        const spec = ITEM_FIELDS[f.field] ?? { kind: 'number' as const, polarity: 'none' as const };
        return valueRow(
          { key: `${k}:f:${f.field}`, entity, what: statLabel(f.field) },
          f.from,
          f.to,
          spec.kind,
          spec.polarity,
        );
      }),
      ...c.stats.map((s) =>
        valueRow(
          { key: `${k}:s:${s.stat}`, entity, what: statLabel(s.stat) },
          s.from,
          s.to,
          'number',
          'up',
        ),
      ),
    ];
    if (c.tooltip.added.length + c.tooltip.removed.length > 0) {
      const lines = (xs: string[]) => xs.map(tooltipText).filter(Boolean).join(' · ') || DASH;
      rows.push({
        key: `${k}:tooltip`,
        entity,
        what: 'Tooltip',
        from: lines(c.tooltip.removed),
        to: lines(c.tooltip.added),
        delta: null,
        tone: 'neutral',
      });
    }
    return rows;
  });
}

const rewardLabel = (kind: string) => (kind === 'choice' ? 'Reward choice' : 'Reward');
const ref = (r: { itemId: number; name: string | null; quality?: number | null }): ItemRef => ({
  itemId: r.itemId,
  name: r.name,
  quality: r.quality ?? null,
});

export function questRows(changes: QuestChange[]): ChangeRow[] {
  return changes.flatMap((q) => {
    const entity: Entity = { kind: 'quest', id: q.questId, name: q.title };
    const k = `quest:${q.questId}`;
    const rows: ChangeRow[] = [];
    if (q.xp)
      rows.push(
        valueRow(
          { key: `${k}:xp`, entity, what: 'XP offered' },
          q.xp.from,
          q.xp.to,
          'number',
          'up',
        ),
      );
    if (q.money)
      rows.push(
        valueRow(
          { key: `${k}:money`, entity, what: 'Money offered' },
          q.money.from,
          q.money.to,
          'money',
          'up',
        ),
      );
    for (const o of q.rewards.added)
      rows.push({
        key: `${k}:add:${o.kind}:${o.itemId}`,
        entity,
        what: `${rewardLabel(o.kind)} added`,
        item: ref(o),
        from: DASH,
        to: countText(o.count),
        delta: null,
        tone: 'neutral',
      });
    for (const o of q.rewards.removed)
      rows.push({
        key: `${k}:rm:${o.kind}:${o.itemId}`,
        entity,
        what: `${rewardLabel(o.kind)} removed`,
        item: ref(o),
        from: countText(o.count),
        to: DASH,
        delta: null,
        tone: 'neutral',
      });
    for (const o of q.rewards.changed)
      rows.push(
        valueRow(
          {
            key: `${k}:count:${o.kind}:${o.itemId}`,
            entity,
            what: `${rewardLabel(o.kind)} count`,
            item: ref(o),
          },
          o.from,
          o.to,
          'number',
          'up',
          (v) => countText(v as number | null),
        ),
      );
    return rows;
  });
}

const RECIPE_FIELDS: Readonly<
  Record<string, { label: string; polarity: Polarity; item?: boolean }>
> = {
  outputItemId: { label: 'Output item', polarity: 'none', item: true },
  qtyMin: { label: 'Output quantity (min)', polarity: 'up' },
  qtyMax: { label: 'Output quantity (max)', polarity: 'up' },
  maxTrivial: { label: 'Max trivial rank', polarity: 'none' },
};

export function recipeRows(changes: RecipeChange[]): ChangeRow[] {
  return changes.flatMap((r) => {
    const entity: Entity = { kind: 'recipe', id: r.recipeId, name: r.name };
    const k = `recipe:${r.recipeId}`;
    const rows: ChangeRow[] = r.fields.map((f) => {
      const spec = RECIPE_FIELDS[f.field] ?? { label: f.field, polarity: 'none' as const };
      const base = { key: `${k}:f:${f.field}`, entity, what: spec.label };
      if (spec.item) {
        const label = (v: number | string | null) => (isNum(v) ? itemLabel(v, null) : DASH);
        return { ...base, from: label(f.from), to: label(f.to), delta: null, tone: 'neutral' };
      }
      return valueRow(base, f.from, f.to, 'number', spec.polarity);
    });
    for (const x of r.reagents.added)
      rows.push({
        key: `${k}:add:${x.itemId}`,
        entity,
        what: 'Reagent added',
        item: ref(x),
        from: DASH,
        to: countText(x.qty),
        delta: null,
        tone: 'neutral',
      });
    for (const x of r.reagents.removed)
      rows.push({
        key: `${k}:rm:${x.itemId}`,
        entity,
        what: 'Reagent removed',
        item: ref(x),
        from: countText(x.qty),
        to: DASH,
        delta: null,
        tone: 'neutral',
      });
    for (const x of r.reagents.changed)
      rows.push(
        valueRow(
          { key: `${k}:qty:${x.itemId}`, entity, what: 'Reagent quantity', item: ref(x) },
          x.from,
          x.to,
          'number',
          'down',
          (v) => countText(v as number | null),
        ),
      );
    return rows;
  });
}

/** A vendor price: gold part and extended costs, then the stack it buys (`10c for 5`). */
export function priceText(p: VendorPrice) {
  const costs = p.costs.filter((c): c is typeof c & { amount: number } => isNum(c.amount));
  const text = formatCosts(p.price, costs);
  return isNum(p.stack) && p.stack > 1 ? `${text} for ${fmt(p.stack)}` : text;
}

export function vendorRows(changes: VendorChange[]): ChangeRow[] {
  return changes.flatMap((v) => {
    const entity: Entity = { kind: 'vendor', id: v.npcId, name: v.name, title: v.title };
    const k = `vendor:${v.npcId}`;
    return [
      ...v.added.map((x): ChangeRow => ({
        key: `${k}:add:${x.itemId}`,
        entity,
        what: 'Now sold',
        item: ref(x),
        from: DASH,
        to: priceText(x),
        delta: null,
        tone: 'neutral',
      })),
      ...v.removed.map((x): ChangeRow => ({
        key: `${k}:rm:${x.itemId}`,
        entity,
        what: 'No longer sold',
        item: ref(x),
        from: priceText(x),
        to: DASH,
        delta: null,
        tone: 'neutral',
      })),
      ...v.changed.map((x): ChangeRow => ({
        key: `${k}:price:${x.itemId}`,
        entity,
        what: 'Price',
        item: ref(x),
        from: priceText(x.from),
        to: priceText(x.to),
        // The gold part, per the same stack only: a changed stack makes the prices incomparable.
        delta: x.from.stack === x.to.stack ? formatDelta(x.from.price, x.to.price, 'money') : null,
        tone: x.from.stack === x.to.stack ? toneOf(x.from.price, x.to.price, 'down') : 'neutral',
      })),
    ];
  });
}

const SERVICE_FIELDS: Readonly<
  Record<ServiceField, { label: string; kind: DeltaKind; polarity: Polarity }>
> = {
  cost: { label: 'Cost', kind: 'money', polarity: 'down' },
  skill: { label: 'Skill', kind: 'number', polarity: 'none' },
  skillRank: { label: 'Skill rank', kind: 'number', polarity: 'down' },
  level: { label: 'Level', kind: 'number', polarity: 'down' },
  itemId: { label: 'Item', kind: 'number', polarity: 'none' },
};

/** `3s · Tailoring 70 · level 5`: what a trainer service asks for. */
export function serviceText(s: Service) {
  const rank = isNum(s.skillRank)
    ? s.skill
      ? `${s.skill} ${fmt(s.skillRank)}`
      : `rank ${fmt(s.skillRank)}`
    : s.skill;
  return (
    [
      isNum(s.cost) ? formatMoney(s.cost) : null,
      rank,
      isNum(s.level) ? `level ${fmt(s.level)}` : null,
    ]
      .filter(Boolean)
      .join(' · ') || DASH
  );
}

export function trainerRows(changes: TrainerChange[]): ChangeRow[] {
  return changes.flatMap((t) => {
    const entity: Entity = { kind: 'trainer', id: t.npcId, name: t.name, title: t.title };
    const k = `trainer:${t.npcId}`;
    // A partial scan lists only some services: added/removed may be what one scan didn't see.
    const note = t.complete.from && t.complete.to ? undefined : 'partial scan in one build';
    const extra = note ? { note } : {};
    return [
      ...t.added.map((s): ChangeRow => ({
        key: `${k}:add:${s.name}`,
        entity,
        what: 'Service added',
        detail: s.name,
        from: DASH,
        to: serviceText(s),
        delta: null,
        tone: 'neutral',
        ...extra,
      })),
      ...t.removed.map((s): ChangeRow => ({
        key: `${k}:rm:${s.name}`,
        entity,
        what: 'Service removed',
        detail: s.name,
        from: serviceText(s),
        to: DASH,
        delta: null,
        tone: 'neutral',
        ...extra,
      })),
      ...t.changed.flatMap((s) =>
        s.fields.map((f) => {
          const spec = SERVICE_FIELDS[f.field];
          return {
            ...valueRow(
              { key: `${k}:${s.name}:${f.field}`, entity, what: spec.label, detail: s.name },
              f.from,
              f.to,
              spec.kind,
              spec.polarity,
            ),
            ...extra,
          };
        }),
      ),
    ];
  });
}

export function dropRows(changes: DropChange[]): ChangeRow[] {
  const side = (s: DropChange['from']) =>
    `${formatRate(s.rate)} (${fmt(s.dropped)}/${fmt(s.corpses)})`;
  return changes.map((d) => ({
    key: `drop:${d.npcId}:${d.itemId}`,
    entity: { kind: 'mob', id: d.npcId, name: d.npcName },
    what: 'Drop rate',
    item: ref(d),
    from: side(d.from),
    to: side(d.to),
    delta: formatDelta(d.from.rate, d.to.rate, 'rate'),
    tone: toneOf(d.from.rate, d.to.rate, 'up'),
  }));
}

/** The diff of one category as rows. */
export function rowsFor(diff: BuildDiff, key: CategoryKey): ChangeRow[] {
  switch (key) {
    case 'items':
      return itemRows(diff.items.changes);
    case 'quests':
      return questRows(diff.quests.changes);
    case 'recipes':
      return recipeRows(diff.recipes.changes);
    case 'vendors':
      return vendorRows(diff.vendors.changes);
    case 'trainers':
      return trainerRows(diff.trainers.changes);
    case 'drops':
      return dropRows(diff.drops.changes);
  }
}

// ---- summary ---------------------------------------------------------------------------------------------------

/**
 * Entities of a category seen in both builds: the from-build's count less those only it saw (null without the
 * build's counts; never below zero).
 */
export function overlapCount(fromRow: BuildRow | undefined, diff: BuildDiff, key: CategoryKey) {
  if (!fromRow) return null;
  const cat = CATEGORIES.find((c) => c.key === key)!;
  return Math.max(0, fromRow.counts[cat.count] - diff[key].onlyInFrom.total);
}

export function summaryTiles(diff: BuildDiff, fromRow: BuildRow | undefined) {
  return CATEGORIES.map((c) => ({
    key: c.key,
    label: c.label,
    changed: diff[c.key].total,
    onlyInFrom: diff[c.key].onlyInFrom.total,
    onlyInTo: diff[c.key].onlyInTo.total,
    overlap: overlapCount(fromRow, diff, c.key),
  }));
}
