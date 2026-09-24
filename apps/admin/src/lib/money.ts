// WoW money: prices are copper (100 copper = 1 silver, 100 silver = 1 gold). Vendor extended costs are items or
// currencies paid besides the gold part.

const DASH = '—';
const MINUS = '−';

/** `123g 45s 67c`, `12s 50c`, `0c`; fractional copper (a stack's unit price) keeps two decimals; a dash for none. */
export function formatMoney(copper: number | null | undefined) {
  if (typeof copper !== 'number' || !Number.isFinite(copper)) return DASH;
  const sign = copper < 0 ? MINUS : '';
  const abs = Math.round(Math.abs(copper) * 100) / 100;
  const g = Math.floor(abs / 10000);
  const s = Math.floor((abs - g * 10000) / 100);
  const c = Math.round((abs - g * 10000 - s * 100) * 100) / 100;
  const parts = [g ? `${g}g` : '', s ? `${s}s` : '', c ? `${c}c` : ''].filter(Boolean);
  return sign + (parts.length ? parts.join(' ') : '0c');
}

export interface Cost {
  amount: number;
  itemId?: number | null;
  currencyId?: number | null;
  name?: string | null;
}

/** One part of an extended cost: `3× [Mark of the Barrens]` (an item) or `25 [Honor Points]` (a currency). */
export function formatCost(c: Cost) {
  const isItem = typeof c.itemId === 'number';
  const name =
    c.name ??
    (isItem
      ? `Item ${c.itemId}`
      : typeof c.currencyId === 'number'
        ? `Currency ${c.currencyId}`
        : 'unknown');
  return isItem ? `${c.amount}× [${name}]` : `${c.amount} [${name}]`;
}

/** A vendor price: the gold part (when there is one, or nothing else) then each extended cost, joined by ` + `. */
export function formatCosts(price: number | null | undefined, costs: Cost[] | null | undefined) {
  const list = costs ?? [];
  if (list.length === 0) return formatMoney(price);
  const parts = list.map(formatCost);
  return typeof price === 'number' && price > 0
    ? [formatMoney(price), ...parts].join(' + ')
    : parts.join(' + ');
}
