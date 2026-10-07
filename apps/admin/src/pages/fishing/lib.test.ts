import { describe, expect, it } from 'vitest';
import { fishingQuery, percent, placeName } from './lib';

describe('fishing lib', () => {
  it('builds the query string from set filters only', () => {
    expect(fishingQuery({ zone: '', lure: '' })).toBe('');
    expect(fishingQuery({ zone: 'Tanaris', lure: 'yes' }, { item: 'clam' })).toBe(
      '?zone=Tanaris&lure=yes&item=clam',
    );
  });

  it('formats rates and places', () => {
    expect(percent(0.059)).toBe('5.9%');
    expect(percent(0.0035)).toBe('0.35%');
    expect(percent(0)).toBe('0.0%');
    expect(percent(null)).toBe('—');
    expect(placeName('Tanaris', 'Steamwheedle Port')).toBe('Tanaris · Steamwheedle Port');
    expect(placeName('Tanaris', '')).toBe('Tanaris');
    expect(placeName(null, null)).toBe('Unknown zone');
  });
});
