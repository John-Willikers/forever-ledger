/** Times shown to humans are America/Chicago, whatever the browser's zone. */
export const TIME_ZONE = 'America/Chicago';

export type TimeInput = Date | number | string | null | undefined;

/** Epoch seconds below this are read as seconds, above as milliseconds (1e11 s is the year 5138). */
const SECONDS_LIMIT = 1e11;

export function toDate(value: TimeInput): Date | null {
  if (value === null || value === undefined) return null;
  const d =
    value instanceof Date
      ? new Date(value.getTime())
      : typeof value === 'number'
        ? new Date(Math.abs(value) < SECONDS_LIMIT ? value * 1000 : value)
        : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(options: Intl.DateTimeFormatOptions) {
  const key = JSON.stringify(options);
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, ...options });
    formatters.set(key, f);
  }
  return f;
}

const DASH = '—';

/** `Sep 23, 2026, 12:22 AM CDT` (seconds optional). */
export function formatChicago(value: TimeInput, opts: { seconds?: boolean } = {}) {
  const d = toDate(value);
  if (!d) return DASH;
  return formatter({
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...(opts.seconds ? { second: '2-digit' } : {}),
    timeZoneName: 'short',
  }).format(d);
}

/** `Sep 23, 2026` (the calendar day in Chicago). */
export function formatChicagoDate(value: TimeInput) {
  const d = toDate(value);
  return d ? formatter({ year: 'numeric', month: 'short', day: 'numeric' }).format(d) : DASH;
}
