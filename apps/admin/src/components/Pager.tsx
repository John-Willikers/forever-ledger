import { formatNumber } from '../lib/format';

/** Previous / next for an offset-paged list, with "1–50 of 123". */
export function Pager({
  total,
  limit,
  offset,
  onOffset,
  busy,
}: {
  total: number;
  limit: number;
  offset: number;
  onOffset: (offset: number) => void;
  busy?: boolean;
}) {
  if (total <= limit && offset === 0) return null;
  const first = total === 0 ? 0 : Math.min(offset + 1, total);
  const last = Math.min(offset + limit, total);
  return (
    <div className="pager">
      <button
        type="button"
        className="secondary small"
        disabled={busy || offset === 0}
        onClick={() => onOffset(Math.max(0, offset - limit))}
      >
        Previous
      </button>
      <span className="muted small">
        {formatNumber(first)}–{formatNumber(last)} of {formatNumber(total)}
      </span>
      <button
        type="button"
        className="secondary small"
        disabled={busy || offset + limit >= total}
        onClick={() => onOffset(offset + limit)}
      >
        Next
      </button>
    </div>
  );
}
