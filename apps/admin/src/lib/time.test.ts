import { describe, expect, it } from 'vitest';
import {
  formatChicago,
  formatChicagoDate,
  formatChicagoHour,
  formatChicagoShort,
  timeAgo,
  toDate,
} from './time';

// 2026-09-23T05:22:17Z = 00:22:17 CDT (UTC-5); 2026-01-15T18:00:00Z = 12:00 CST (UTC-6).
const SUMMER = Date.UTC(2026, 8, 23, 5, 22, 17);
const WINTER = Date.UTC(2026, 0, 15, 18, 0, 0);

describe('toDate', () => {
  it('reads epoch seconds, epoch milliseconds, ISO strings and Dates', () => {
    expect(toDate(SUMMER / 1000)?.getTime()).toBe(SUMMER);
    expect(toDate(SUMMER)?.getTime()).toBe(SUMMER);
    expect(toDate('2026-09-23T00:22:17-05:00')?.getTime()).toBe(SUMMER);
    expect(toDate(new Date(SUMMER))?.getTime()).toBe(SUMMER);
  });

  it('returns null for missing or invalid input', () => {
    expect(toDate(null)).toBeNull();
    expect(toDate(undefined)).toBeNull();
    expect(toDate('not a date')).toBeNull();
    expect(toDate(Number.NaN)).toBeNull();
  });
});

describe('formatChicago', () => {
  it('renders America/Chicago with the daylight-saving abbreviation', () => {
    expect(formatChicago(SUMMER)).toBe('Sep 23, 2026, 12:22 AM CDT');
    expect(formatChicago(WINTER)).toBe('Jan 15, 2026, 12:00 PM CST');
  });

  it('can include seconds', () => {
    expect(formatChicago(SUMMER / 1000, { seconds: true })).toBe('Sep 23, 2026, 12:22:17 AM CDT');
  });

  it('shows a dash for missing values', () => {
    expect(formatChicago(null)).toBe('—');
    expect(formatChicago('garbage')).toBe('—');
  });

  it('does not depend on the browser time zone', () => {
    // The day in Chicago, not in UTC: 05:22Z on the 23rd is still the 23rd in Chicago, 03:00Z on the 24th is the 23rd.
    expect(formatChicagoDate(Date.UTC(2026, 8, 24, 3, 0, 0))).toBe('Sep 23, 2026');
  });
});

describe('formatChicagoShort / formatChicagoHour', () => {
  it('drops the year and keeps the Chicago zone', () => {
    expect(formatChicagoShort(SUMMER)).toBe('Sep 23, 12:22 AM CDT');
    expect(formatChicagoShort(null)).toBe('—');
    expect(formatChicagoHour('2026-09-23T19:00:00-05:00')).toBe('Sep 23, 7 PM');
    expect(formatChicagoHour(WINTER)).toBe('Jan 15, 12 PM');
  });
});

describe('timeAgo', () => {
  const now = SUMMER;
  it('rounds to a readable unit', () => {
    expect(timeAgo(now - 10_000, now)).toBe('just now');
    expect(timeAgo(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(timeAgo(now - 3 * 86_400_000, now)).toBe('3 d ago');
  });

  it('treats the future as now and missing values as a dash', () => {
    expect(timeAgo(now + 60_000, now)).toBe('just now');
    expect(timeAgo(undefined, now)).toBe('—');
  });
});
