import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  DIAGNOSTIC_DETAIL_MAX_BYTES,
  DIAGNOSTIC_MESSAGE_MAX,
  jsonBytes,
} from '@forever-ledger/contracts';
import { isNotFound } from './fsutil.js';
import type { RejectedBatch } from './queue.js';

export interface SanitizeOptions {
  /** Longest result; longer text is cut and ends with `…` (default 500). */
  max?: number;
  /** The home folder replaced by `~` (default os.homedir()). */
  home?: string;
  /** Home folder matching is case-insensitive on win32 (default process.platform). */
  platform?: NodeJS.Platform;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const homeRes = new Map<string, RegExp | null>();

/** Matches the home folder with either slash style (also JSON-escaped `\\`), not a longer name that starts with it. */
function homeRe(home: string, platform: NodeJS.Platform): RegExp | null {
  const cacheKey = `${platform}\0${home}`;
  const cached = homeRes.get(cacheKey);
  if (cached !== undefined) return cached;
  const parts = home.split(/[\\/]+/).filter(Boolean);
  let re: RegExp | null = null;
  // A bare root (`/`, `C:\`) would match every absolute path.
  if (parts.length >= 2 || (parts.length === 1 && !/^[A-Za-z]:$/.test(parts[0]!))) {
    const lead = /^[\\/]/.test(home) ? '[\\\\/]+' : '';
    const body = parts.map(escapeRe).join('[\\\\/]+');
    re = new RegExp(`${lead}${body}(?![\\w.-])`, platform === 'win32' ? 'gi' : 'g');
  }
  homeRes.set(cacheKey, re);
  return re;
}

/**
 * Makes text safe to send in an error report: upload tokens and bearer values are redacted, the user's home folder
 * becomes `~`, and the result is at most `max` characters.
 */
export function sanitize(text: string, opts: SanitizeOptions = {}): string {
  const max = opts.max ?? DIAGNOSTIC_MESSAGE_MAX;
  let out = String(text)
    .replace(/Bearer\s+\S+/gi, 'Bearer ***')
    .replace(/flt_[A-Za-z0-9_-]+/g, 'flt_***');
  const re = homeRe(opts.home ?? homedir(), opts.platform ?? process.platform);
  if (re) out = out.replace(re, '~');
  return out.length > max ? `${out.slice(0, Math.max(0, max - 1))}…` : out;
}

export interface SanitizeJsonOptions extends Omit<SanitizeOptions, 'max'> {
  /** Longest string inside (default 1000). */
  maxString?: number;
  /** Largest result as UTF-8 JSON (default 4 KB); a bigger one becomes `{ truncated, preview }`. */
  maxBytes?: number;
}

const MAX_DEPTH = 8;
const MAX_ITEMS = 50;

/**
 * A JSON-safe copy of `value` for an error report's `detail`: every string and key sanitized, Errors as
 * `{ name, message }`, functions dropped, nesting and size bounded.
 */
export function sanitizeJson(value: unknown, opts: SanitizeJsonOptions = {}): unknown {
  const s = (t: string) => sanitize(t, { ...opts, max: opts.maxString ?? 1000 });
  const walk = (v: unknown, depth: number): unknown => {
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string') return s(v);
    if (typeof v === 'bigint') return v.toString();
    if (typeof v !== 'object') return undefined;
    if (depth >= MAX_DEPTH) return '…';
    if (v instanceof Error) return { name: v.name, message: s(v.message) };
    if (Array.isArray(v)) return v.slice(0, MAX_ITEMS).map((x) => walk(x, depth + 1) ?? null);
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v).slice(0, MAX_ITEMS)) {
      const w = walk(x, depth + 1);
      if (w !== undefined) out[s(k)] = w;
    }
    return out;
  };
  const out = walk(value, 0);
  const maxBytes = opts.maxBytes ?? DIAGNOSTIC_DETAIL_MAX_BYTES;
  if (jsonBytes(out) <= maxBytes) return out;
  // Leave room for the wrapper and multi-byte characters.
  const preview = sanitize(JSON.stringify(out), { ...opts, max: Math.floor((maxBytes - 64) / 4) });
  return { truncated: true, preview };
}

/** One parked batch in an error report: why the server refused it and which records, never their contents. */
export interface RejectedSample {
  at?: number;
  status?: number;
  message: string;
  issues?: { path: string; message: string }[];
  records: { kind: string; key: string }[];
}

export interface RejectedSummary {
  /** Batches parked in `rejected/`, all accounts. */
  total: number;
  accounts: { account: string; batches: number; sample: RejectedSample[] }[];
}

async function jsonNames(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((n) => n.endsWith('.json')).sort();
  } catch (err) {
    if (isNotFound(err)) return [];
    throw err;
  }
}

/**
 * What `stateDir/rejected/` holds: batches per account and the newest `sample` of them (reason, first validation
 * issues, record kind/key). Read-only; no lock needed.
 */
export async function summarizeRejected(
  stateDir: string,
  opts: { sample?: number } = {},
): Promise<RejectedSummary> {
  const root = join(stateDir, 'rejected');
  let dirs: string[];
  try {
    dirs = (await readdir(root, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch (err) {
    if (isNotFound(err)) return { total: 0, accounts: [] };
    throw err;
  }
  const out: RejectedSummary = { total: 0, accounts: [] };
  for (const dir of dirs) {
    const names = await jsonNames(join(root, dir));
    if (names.length === 0) continue;
    const sample: RejectedSample[] = [];
    for (const name of names.slice(-(opts.sample ?? 3)).reverse()) {
      try {
        const rb = JSON.parse(await readFile(join(root, dir, name), 'utf8')) as RejectedBatch;
        const r = rb.rejected;
        sample.push({
          ...(typeof r?.at === 'number' ? { at: Math.floor(r.at / 1000) } : {}),
          ...(typeof r?.status === 'number' ? { status: r.status } : {}),
          message: typeof r?.message === 'string' ? r.message : '(no reason recorded)',
          ...(Array.isArray(r?.issues) ? { issues: r.issues.slice(0, 3) } : {}),
          records: (Array.isArray(rb.entries) ? rb.entries : [])
            .slice(0, 3)
            .map((e) => ({ kind: String(e.kind), key: String(e.key) })),
        });
      } catch {
        sample.push({ message: `unreadable file ${name}`, records: [] });
      }
    }
    out.total += names.length;
    out.accounts.push({ account: decodeURIComponent(dir), batches: names.length, sample });
  }
  return out;
}
