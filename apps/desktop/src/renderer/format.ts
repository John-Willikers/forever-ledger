import type { Snapshot } from '../main/state.js';

const chicago = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});

/** `Sep 23, 2026 5:22 AM CDT` (every time a human reads is America/Chicago). */
export function chicagoTime(epochMs: number): string {
  const p: Record<string, string> = {};
  for (const part of chicago.formatToParts(epochMs)) p[part.type] = part.value;
  return `${p.month} ${p.day}, ${p.year} ${p.hour}:${p.minute} ${p.dayPeriod} ${p.timeZoneName}`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One line for the Uploads card, e.g. `Up to date · last upload Sep 23, 2026 5:22 AM CDT`. */
export function uploadsLine(s: Snapshot): string {
  if (s.setupNeeded) return 'Not set up yet';
  if (s.fatal) return 'Uploads stopped';
  if (s.paused) return 'Paused';
  if (s.uploading) return 'Uploading…';
  const queued = s.accounts.reduce((n, a) => n + a.queuedBatches, 0);
  if (queued > 0) return `${plural(queued, 'batch', 'batches')} waiting for the server`;
  if (s.accounts.length === 0)
    return 'Waiting for ForeverLedger.lua (log in once with the addon on)';
  const last = Math.max(0, ...s.accounts.map((a) => a.lastSuccessAt ?? 0));
  return last
    ? `Up to date · last upload ${chicagoTime(last)}`
    : 'Up to date · nothing uploaded yet';
}

/** One line for the Addon card, e.g. `0.2.1 installed · server recommends 0.2.2 for build 69913`. */
export function addonLine(s: Snapshot): string {
  const a = s.addon;
  if (!a) return s.setupNeeded ? 'Not set up yet' : 'Not checked yet';
  const installed = a.installed ? `${a.installed} installed` : 'Not installed';
  const forBuild = a.build !== undefined ? ` for build ${a.build}` : '';
  switch (a.status) {
    case 'error':
      return `${installed} · last check failed`;
    case 'no-release':
      return `${installed} · no release published yet`;
    case 'paused':
      return `${installed} · auto-update paused after a roll back (server recommends ${a.recommended ?? '?'})`;
    default:
      if (a.recommended && a.recommended !== a.installed)
        return `${installed} · server recommends ${a.recommended}${forBuild}`;
      return `${installed} · up to date${forBuild}`;
  }
}

/** Per-account detail for the Uploads card. */
export function accountLine(a: Snapshot['accounts'][number]): string {
  const parts = [`${plural(a.acked, 'record')} uploaded`];
  if (a.queuedBatches) parts.push(`${plural(a.queuedRecords, 'record')} queued`);
  if (a.rejectedRecords) parts.push(`${plural(a.rejectedRecords, 'record')} refused by the server`);
  parts.push(a.lastSuccessAt ? `last ${chicagoTime(a.lastSuccessAt)}` : 'never uploaded');
  return `${a.account}: ${parts.join(' · ')}`;
}

/** `Error invoking remote method 'ledger:x': ConfigError: bad` → `bad`. */
export function ipcErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, '');
}
