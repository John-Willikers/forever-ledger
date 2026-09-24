import { describe, expect, it } from 'vitest';
import { formatCosts, formatMoney } from './money';

describe('formatMoney', () => {
  it('splits copper into gold, silver and copper, dropping empty parts', () => {
    expect(formatMoney(0)).toBe('0c');
    expect(formatMoney(5)).toBe('5c');
    expect(formatMoney(100)).toBe('1s');
    expect(formatMoney(1250)).toBe('12s 50c');
    expect(formatMoney(10000)).toBe('1g');
    expect(formatMoney(1234567)).toBe('123g 45s 67c');
    expect(formatMoney(10005)).toBe('1g 5c');
    expect(formatMoney(123456)).toBe('12g 34s 56c');
    expect(formatMoney(500)).toBe('5s');
  });

  it('groups thousands of gold', () => {
    expect(formatMoney(12_345_670_000)).toBe('1,234,567g');
    expect(formatMoney(-12_345_670_001)).toBe('−1,234,567g 1c');
  });

  it('keeps fractional copper (a unit price of a stack), signs and missing values', () => {
    expect(formatMoney(2)).toBe('2c');
    expect(formatMoney(10 / 3)).toBe('3.33c');
    expect(formatMoney(100.5)).toBe('1s 0.5c');
    expect(formatMoney(-4)).toBe('−4c');
    expect(formatMoney(-10150)).toBe('−1g 1s 50c');
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney(undefined)).toBe('—');
    expect(formatMoney(Number.NaN)).toBe('—');
  });
});

describe('formatCosts', () => {
  it('lists item costs as N× [Item] and currencies as N [Currency]', () => {
    expect(
      formatCosts(0, [
        { amount: 3, itemId: 250001, name: 'Mark of the Barrens' },
        { amount: 25, currencyId: 1901, name: 'Honor Points' },
      ]),
    ).toBe('3× [Mark of the Barrens] + 25 [Honor Points]');
  });

  it('adds the gold part first when there is one, and names unnamed costs by id', () => {
    expect(formatCosts(1250, [{ amount: 1, itemId: 7 }])).toBe('12s 50c + 1× [Item 7]');
    expect(formatCosts(null, [{ amount: 2, currencyId: 1901 }])).toBe('2 [Currency 1901]');
    expect(formatCosts(0, [{ amount: 2 }])).toBe('2 [unknown]');
  });

  it('is just the price without costs', () => {
    expect(formatCosts(1250, null)).toBe('12s 50c');
    expect(formatCosts(0, [])).toBe('0c');
    expect(formatCosts(null, null)).toBe('—');
  });
});
