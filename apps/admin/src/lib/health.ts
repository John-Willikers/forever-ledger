// Filters for the Health feed (GET /v1/diagnostics) and helpers for API samples.
import type { HealthItem, SampleFlag } from '../types';

export const DIAGNOSTIC_LEVELS = ['warn', 'error', 'fatal'] as const;
/** The tray app's sources, plus `ingest` for batches the server refused. */
export const DIAGNOSTIC_SOURCES = [
  'tray',
  'uploader',
  'addon-sync',
  'parse',
  'rejected',
  'updater',
  'ingest',
] as const;

export interface HealthFilters {
  type?: '' | 'diagnostic' | 'ingest-error';
  level?: string;
  source?: string;
  /** Days back (default 7 on the server). */
  days?: number;
}

/** `/v1/diagnostics?…` for the filters; empty filters are left out. `now` is for tests. */
export function diagnosticsPath(f: HealthFilters, now: number = Date.now()) {
  const q = new URLSearchParams();
  if (f.type) q.set('type', f.type);
  if (f.level) q.set('level', f.level);
  if (f.source) q.set('source', f.source);
  if (f.days && f.days !== 7) q.set('since', String(Math.floor(now / 1000) - f.days * 86_400));
  const s = q.toString();
  return s ? `/v1/diagnostics?${s}` : '/v1/diagnostics';
}

/** Severity for styling a feed row: ingest errors are errors. */
export function severity(item: HealthItem): 'warn' | 'error' | 'fatal' {
  if (item.type === 'ingest-error') return 'error';
  return item.level === 'fatal' ? 'fatal' : item.level === 'warn' ? 'warn' : 'error';
}

/** One line for a feed row. */
export function headline(item: HealthItem) {
  if (item.type === 'ingest-error')
    return `Ingest refused (${item.status ?? '?'}): ${item.error ?? 'unknown error'}`;
  return item.message ?? '(no message)';
}

export const FLAG_LABELS: Readonly<Record<SampleFlag, string>> = {
  errors: 'Addon Lua errors',
  fieldMisses: 'Field misses',
};

/** Pretty JSON for display (2 spaces); `undefined` shows as nothing. */
export const prettyJson = (v: unknown) => (v === undefined ? '' : JSON.stringify(v, null, 2));

/** True when a sample has something in it (non-empty object or array, or any other value). */
export function hasEntries(v: unknown) {
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}
