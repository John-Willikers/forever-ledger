import { describe, expect, it } from 'vitest';
import { pickTab, stepTab, tabParamValue } from './tabsLib';

const tabs = [
  { key: 'stats', label: 'Stats' },
  { key: 'sources', label: 'Sources' },
  { key: 'trade', label: 'Trade' },
];

describe('pickTab', () => {
  it('returns the wanted key when it is a tab', () => {
    expect(pickTab(tabs, 'trade')).toBe('trade');
  });
  it('falls back to the first tab for null or an unknown key', () => {
    expect(pickTab(tabs, null)).toBe('stats');
    expect(pickTab(tabs, 'nope')).toBe('stats');
  });
  it('returns an empty string when there are no tabs', () => {
    expect(pickTab([], 'x')).toBe('');
  });
});

describe('tabParamValue', () => {
  it('is null for the first (default) tab and the key otherwise', () => {
    expect(tabParamValue(tabs, 'stats')).toBeNull();
    expect(tabParamValue(tabs, 'trade')).toBe('trade');
  });
});

describe('stepTab', () => {
  it('moves by delta and wraps at both ends', () => {
    expect(stepTab(tabs, 'stats', 1)).toBe('sources');
    expect(stepTab(tabs, 'trade', 1)).toBe('stats');
    expect(stepTab(tabs, 'stats', -1)).toBe('trade');
  });
  it('starts from the first tab when current is unknown', () => {
    expect(stepTab(tabs, 'nope', 1)).toBe('sources');
  });
  it('wraps for any delta, past a full turn either way', () => {
    expect(stepTab(tabs, 'stats', -4)).toBe('trade');
    expect(stepTab(tabs, 'stats', 7)).toBe('sources');
  });
});
