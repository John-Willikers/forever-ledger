const DASH = '—';
const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

/** `12,345`; a dash for missing values. */
export function formatNumber(n: number | null | undefined) {
  return typeof n === 'number' && Number.isFinite(n) ? integer.format(n) : DASH;
}

/** `12K`, `1.2M` for tiles; small numbers stay exact. */
export function formatCompact(n: number | null | undefined) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return DASH;
  return Math.abs(n) < 10_000 ? integer.format(n) : compact.format(n);
}

/** `202 B`, `1.5 KB`, `3.2 MB`. */
export function formatBytes(n: number | null | undefined) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return DASH;
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

/** `1 upload`, `3 uploads`. */
export function plural(n: number, one: string, many = `${one}s`) {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}
