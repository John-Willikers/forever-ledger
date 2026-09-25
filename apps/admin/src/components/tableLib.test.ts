import { describe, expect, it } from 'vitest';
import { pageSlice } from './tableLib';

const rows = ['a', 'b', 'c', 'd', 'e'];

describe('pageSlice', () => {
  it('returns everything when there is no page size', () => {
    expect(pageSlice(rows, 0, undefined)).toEqual({ rows, offset: 0 });
  });
  it('treats a page size that is not positive as unpaged', () => {
    expect(pageSlice(rows, 3, 0)).toEqual({ rows, offset: 0 });
    expect(pageSlice(rows, 3, -1)).toEqual({ rows, offset: 0 });
  });
  it('slices one page', () => {
    expect(pageSlice(rows, 2, 2)).toEqual({ rows: ['c', 'd'], offset: 2 });
  });
  it('snaps an offset past the end back to the first page', () => {
    expect(pageSlice(rows, 10, 2)).toEqual({ rows: ['a', 'b'], offset: 0 });
  });
  it('keeps the last partial page', () => {
    expect(pageSlice(rows, 4, 2)).toEqual({ rows: ['e'], offset: 4 });
  });
});
