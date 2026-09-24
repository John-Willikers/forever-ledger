// A sortable table on TanStack Table v9: click a header to sort. Markup and styles are ours.
import {
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { useState } from 'react';

export const sortableFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
    text: sortFn_text,
  },
});
export type SortableFeatures = typeof sortableFeatures;

export function DataTable<T extends object>({
  data,
  columns,
  initialSorting = [],
  rowKey,
  rowClassName,
  empty = 'Nothing yet.',
}: {
  data: T[];
  columns: ColumnDef<SortableFeatures, T>[];
  initialSorting?: SortingState;
  rowKey: (row: T) => string | number;
  rowClassName?: (row: T) => string | undefined;
  empty?: string;
}) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const table = useTable({
    features: sortableFeatures,
    columns,
    data,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId: (row) => String(rowKey(row)),
  });
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => {
                const dir = header.column.getIsSorted();
                const canSort = header.column.getCanSort();
                return (
                  <th
                    key={header.id}
                    aria-sort={
                      dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined
                    }
                  >
                    {header.isPlaceholder ? null : canSort ? (
                      <button
                        type="button"
                        className="th-sort"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        <table.FlexRender header={header} />
                        <span className="sort-mark" aria-hidden>
                          {dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : ''}
                        </span>
                      </button>
                    ) : (
                      <table.FlexRender header={header} />
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="muted empty-row">
                {empty}
              </td>
            </tr>
          ) : (
            table.getRowModel().rows.map((row) => (
              <tr key={row.id} className={rowClassName?.(row.original)}>
                {row.getAllCells().map((cell) => (
                  <td key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
