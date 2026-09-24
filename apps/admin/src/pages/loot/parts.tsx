// Small pieces shared by the Loot, Item, Dungeons and Run pages. Names are uploaded data: rendered as text only.
import { Link } from 'react-router';
import { useAdminQuery } from '../../api';
import type { Overview } from '../../types';
import { formatRate, itemLabel, qualityClass, qualityLabel, rateWidth } from './lootLib';

/** An item name in its quality color, linking to the Item page. */
export function ItemName({
  itemId,
  name,
  quality,
}: {
  itemId: number | null;
  name: string | null;
  quality: number | null;
}) {
  const label = itemLabel(itemId, name);
  if (itemId === null) return <span className={qualityClass(quality)}>{label}</span>;
  return (
    <Link
      to={`/items/${itemId}`}
      className={`item-name ${qualityClass(quality)}`}
      title={`${qualityLabel(quality)} · item ${itemId}`}
    >
      {label}
    </Link>
  );
}

/** A rate as a thin bar with the percentage next to it. */
export function RateBar({ rate }: { rate: number | null }) {
  return (
    <span className="rate">
      <span className="rate-track" aria-hidden>
        <span className="rate-fill" style={{ width: `${rateWidth(rate)}%` }} />
      </span>
      <span className="rate-value">{formatRate(rate)}</span>
    </span>
  );
}

export function ForeverBadge({ show }: { show: boolean }) {
  return show ? (
    <span className="pill forever" title="Id above the Classic ranges">
      Forever-only
    </span>
  ) : null;
}

/** Client builds seen, newest first (from the overview, which the Overview page also caches). */
export function useBuilds() {
  const overview = useAdminQuery<Overview>(['overview'], '/admin/api/overview');
  return overview.data?.builds ?? [];
}

/** "All builds" or one build. */
export function BuildSelect({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (build: number | null) => void;
}) {
  const builds = useBuilds();
  return (
    <label>
      Build
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      >
        <option value="">All builds</option>
        {value !== null && !builds.some((b) => b.build === value) && (
          <option value={value}>{value}</option>
        )}
        {builds.map((b) => (
          <option key={b.build} value={b.build}>
            {b.build}
            {b.version ? ` (${b.version})` : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

/** `?key=` from a search string as a positive integer, else null. */
export function intFromParams(params: URLSearchParams, key: string) {
  const raw = params.get(key);
  return raw !== null && /^\d{1,10}$/.test(raw) && Number(raw) > 0 ? Number(raw) : null;
}
