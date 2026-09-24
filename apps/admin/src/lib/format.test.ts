import { describe, expect, it } from 'vitest';
import { formatBytes, formatCompact, formatNumber, plural } from './format';

describe('number formatting', () => {
  it('groups thousands and dashes missing values', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(null)).toBe('—');
    expect(formatNumber(Number.NaN)).toBe('—');
  });

  it('compacts only big numbers', () => {
    expect(formatCompact(9_999)).toBe('9,999');
    expect(formatCompact(12_345)).toBe('12.3K');
    expect(formatCompact(2_500_000)).toBe('2.5M');
    expect(formatCompact(undefined)).toBe('—');
  });

  it('formats bytes', () => {
    expect(formatBytes(202)).toBe('202 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(20 * 1024)).toBe('20 KB');
    expect(formatBytes(3.2 * 1024 * 1024)).toBe('3.2 MB');
    expect(formatBytes(-1)).toBe('—');
  });

  it('pluralizes', () => {
    expect(plural(1, 'upload')).toBe('1 upload');
    expect(plural(1200, 'upload')).toBe('1,200 uploads');
    expect(plural(2, 'entry', 'entries')).toBe('2 entries');
  });
});
