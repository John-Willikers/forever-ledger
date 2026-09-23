/** Every time a human reads is shown in America/Chicago. */
export const HUMAN_TIME_ZONE = 'America/Chicago';

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: HUMAN_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'short',
});

/** `2026-09-23 05:22:10 CDT` */
export function formatChicago(when: Date | number = new Date()): string {
  const parts: Record<string, string> = {};
  for (const p of formatter.formatToParts(when)) parts[p.type] = p.value;
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${parts.timeZoneName}`;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
