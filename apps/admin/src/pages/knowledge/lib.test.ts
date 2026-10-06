import { describe, expect, it } from 'vitest';
import { entityLabel, formatValue, safeHref, tierName, VALUE_MAX } from './lib';

describe('formatValue', () => {
  it('reads ranges, lists, objects and scalars', () => {
    expect(formatValue({ min: 40, max: 50 })).toBe('40–50');
    expect(formatValue({ min: 60, max: 60 })).toBe('60');
    expect(formatValue(['Azshara', 'Tanaris'])).toBe('Azshara, Tanaris');
    expect(formatValue({ level: 35, trainer: 'Nat Pagle' })).toBe('level: 35 · trainer: Nat Pagle');
    expect(formatValue(false)).toBe('no');
    expect(formatValue(null)).toBe('—');
    expect(formatValue({ zone: 'Tanaris', caught: 0, lure: true })).toBe(
      'zone: Tanaris · caught: 0 · lure: yes',
    );
  });

  it('caps long values', () => {
    expect(formatValue('x'.repeat(1000))).toHaveLength(VALUE_MAX);
  });
});

describe('labels and links', () => {
  it('names entities and tiers', () => {
    expect(entityLabel({ entityType: 'item', entityKey: '7973', entityName: null })).toBe(
      'item 7973',
    );
    expect(entityLabel({ entityType: 'zone', entityKey: 'tanaris', entityName: 'Tanaris' })).toBe(
      'Tanaris',
    );
    expect(tierName(1)).toBe('first-party');
    expect(tierName(9)).toBe('tier 9');
  });

  it('links http(s) only', () => {
    expect(safeHref('https://mobalytics.gg/x')).toBe('https://mobalytics.gg/x');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref(null)).toBeNull();
  });
});
