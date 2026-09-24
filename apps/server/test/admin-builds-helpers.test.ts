// Pure helpers behind /admin/api/build-diff (no database): uploaded jsonb read defensively, keyed list comparison.
import { describe, expect, it } from 'vitest';
import {
  keyedChanges,
  lineChanges,
  linesOf,
  reagentsOf,
  servicesOf,
  statsOf,
  vendorItemsOf,
} from '../src/routes/adminBuilds.js';

describe('statsOf / linesOf', () => {
  it('keeps numeric stats and string lines only', () => {
    expect(statsOf({ a: 1, b: 'x', c: null, d: 2.5, e: Infinity })).toEqual({ a: 1, d: 2.5 });
    expect(statsOf([1, 2])).toEqual({});
    expect(statsOf('x')).toEqual({});
    expect(statsOf(null)).toEqual({});
    expect(linesOf(['a', 1, null, 'b'])).toEqual(['a', 'b']);
    expect(linesOf('a')).toEqual([]);
  });
});

describe('lineChanges', () => {
  it('lists added and removed lines in their own order, once each', () => {
    expect(lineChanges(['n', 'a', 'b'], ['n', 'c', 'a', 'c'])).toEqual({
      added: ['c'],
      removed: ['b'],
    });
    expect(lineChanges([], [])).toEqual({ added: [], removed: [] });
  });
});

describe('keyedChanges', () => {
  it('splits into added, removed and changed', () => {
    const from = new Map([
      [1, { v: 1 }],
      [2, { v: 2 }],
    ]);
    const to = new Map([
      [2, { v: 3 }],
      [3, { v: 4 }],
    ]);
    expect(keyedChanges(from, to, (a, b) => a.v === b.v)).toEqual({
      added: [{ v: 4 }],
      removed: [{ v: 1 }],
      changed: [{ key: 2, from: { v: 2 }, to: { v: 3 } }],
    });
  });
});

describe('jsonb list readers', () => {
  it('reagents: int4 ids only, first entry per item, junk qty as null', () => {
    const m = reagentsOf([
      { itemId: 5, qty: 2 },
      { itemId: 5, qty: 9 },
      { itemId: 3e9, qty: 1 },
      { itemId: 1.5, qty: 1 },
      { itemId: 7, qty: 'x' },
      'junk',
    ]);
    expect([...m.values()]).toEqual([
      { itemId: 5, qty: 2 },
      { itemId: 7, qty: null },
    ]);
    expect(reagentsOf({ itemId: 5 }).size).toBe(0);
  });

  it('vendor items: prices, stacks and extended costs typed', () => {
    const m = vendorItemsOf([
      { itemId: 1, price: 10, stack: 5, costs: [{ amount: 3, itemId: 2, name: 'Mark' }, 7] },
      { itemId: 2, price: 'x', costs: 'junk' },
      { price: 3 },
    ]);
    expect([...m.values()]).toEqual([
      {
        itemId: 1,
        price: 10,
        stack: 5,
        costs: [{ amount: 3, itemId: 2, currencyId: null, name: 'Mark' }],
      },
      { itemId: 2, price: null, stack: null, costs: [] },
    ]);
  });

  it('trainer services: keyed by name, fields typed', () => {
    const m = servicesOf([
      { name: 'A', cost: 10, skill: 'Tailoring', skillRank: 5, level: 3, itemId: 9 },
      { name: 'A', cost: 99 },
      { name: 7, cost: 1 },
      { name: 'B', cost: 'x', skill: 4 },
    ]);
    expect([...m.values()]).toEqual([
      { name: 'A', cost: 10, skill: 'Tailoring', skillRank: 5, level: 3, itemId: 9 },
      { name: 'B', cost: null, skill: null, skillRank: null, level: null, itemId: null },
    ]);
  });
});
