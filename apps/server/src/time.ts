/** Human-facing times are America/Chicago. */
export const TIME_ZONE = 'America/Chicago';

const parts = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'longOffset',
});

/** ISO-8601 with the Chicago offset, e.g. `2026-09-23T00:22:17-05:00`. */
export function chicagoIso(date: Date | number = new Date()): string {
  const p = Object.fromEntries(parts.formatToParts(new Date(date)).map((x) => [x.type, x.value]));
  const offset = (p.timeZoneName ?? 'GMT').replace('GMT', '') || '+00:00';
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${offset}`;
}

export const fromEpoch = (secs: number | undefined) =>
  secs === undefined ? undefined : new Date(secs * 1000);
