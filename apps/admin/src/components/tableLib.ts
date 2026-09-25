/**
 * The rows of one page. An offset past the end (the data shrank under a filter) snaps back to the first page so the
 * table is never blank. No page size, or one that is not positive, means unpaged: every row.
 */
export function pageSlice<T>(
  rows: readonly T[],
  offset: number,
  pageSize: number | undefined,
): { rows: readonly T[]; offset: number } {
  if (pageSize === undefined || pageSize <= 0) return { rows, offset: 0 };
  const at = offset >= rows.length ? 0 : offset;
  return { rows: rows.slice(at, at + pageSize), offset: at };
}
