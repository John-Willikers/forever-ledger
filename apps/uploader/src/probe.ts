import { writeJsonAtomic } from './fsutil.js';
import { readSavedVariable } from './reader.js';
import type { ReadOptions } from './reader.js';
import { formatChicago } from './time.js';

/** SavedVariables global written by the ForeverLedgerProbe addon. */
export const PROBE_VARIABLE = 'ForeverLedgerProbeDB';

export interface ProbeBuildSummary {
  build: string;
  version?: string;
  buildDate?: string;
  interface?: number;
  probeVersion?: string;
  apiDocsAvailable: boolean;
  systems: number;
  globalFunctions: number;
  namespaces: number;
  eventsChecked: number;
  rejectedEvents: string[];
  globalsChecked: number;
  nilGlobals: string[];
  sniffedEvents: { event: string; count: number }[];
}

/** `/flprobe io` (probe 0.2.0+): SavedVariables load check at ADDON_LOADED. */
export interface ProbeLoadCheck {
  at?: number;
  loadCount?: number;
  arrivedNil?: boolean;
  arrivedEmpty?: boolean;
  arrivedKeys?: number;
  previousLoadAt?: number;
}

/** Read-only look at ForeverLedgerDB at the probe's PLAYER_LOGIN. */
export interface ProbeLedgerCheck {
  addonLoaded: boolean;
  type?: string;
  records?: number;
  empty?: boolean;
  counts: Record<string, number>;
}

export interface ProbeIoEntry {
  at?: number;
  action: string;
  marker?: number;
  /** One line: calls and their results, button creation, blocked action, … */
  detail: string;
}

export interface ProbeIoBuild {
  build: string;
  entries: number;
  /** Latest logging state read, `name → value` (or `error: …` / `missing`). */
  state?: { at?: number; values: Record<string, string> };
  last: ProbeIoEntry[];
}

export interface ProbeIoSummary {
  loadCheck?: ProbeLoadCheck;
  ledgerCheck?: ProbeLedgerCheck;
  builds: ProbeIoBuild[];
}

export interface ProbeSummary {
  probeVersion?: string;
  builds: ProbeBuildSummary[];
  /** Absent for probe 0.1.0 files. */
  io?: ProbeIoSummary;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Lua lists parse as arrays, but an empty table is `{}` and a sparse one an object. */
const size = (v: unknown) => (Array.isArray(v) ? v.length : isObj(v) ? Object.keys(v).length : 0);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : isObj(v) ? Object.values(v) : []);
const str = (v: unknown) =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined;
const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);

/** Entries shown per build. */
export const PROBE_IO_LAST = 10;

/** A pcall result recorded by the probe: `{ ok, values }`, `{ ok = false, err }` or `{ missing = true }`. */
function showResult(r: unknown): string {
  if (!isObj(r)) return '?';
  if (r.missing === true) return 'missing';
  if (r.ok !== true) return `error: ${str(r.err) ?? '?'}`;
  const values = list(r.values).map((v) => (typeof v === 'string' ? JSON.stringify(v) : String(v)));
  return values.length ? values.join(', ') : '(no value)';
}

function showState(s: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (isObj(s)) for (const [k, r] of Object.entries(s)) out[k] = showResult(r);
  return out;
}

function ioDetail(e: Obj): string {
  const calls = list(e.calls)
    .filter(isObj)
    .map((c) => `${str(c.call) ?? '?'} → ${showResult(c)}`);
  switch (e.action) {
    case 'reloadbtn':
      return `secure button ${showResult(e.secure)}, plain button ${showResult(e.plain)}`;
    case 'reloadui-click':
      return `clicked, calling ${str(e.fn) ?? '?'}`;
    case 'reloadui-result':
      return `returned without reloading: ${showResult(e.result)}`;
    case 'blocked':
      return `${str(e.event) ?? '?'} ${str(e.func) ?? ''}`.trim();
    case 'secure-click':
      return 'clicked the secure /reload button';
    case 'state':
      return 'logging state read';
    default:
      return calls.join(', ');
  }
}

function summarizeIo(db: Obj): ProbeIoSummary | undefined {
  const lc = isObj(db.loadCheck) ? db.loadCheck : undefined;
  const lg = isObj(db.ledgerCheck) ? db.ledgerCheck : undefined;
  const io = isObj(db.io) ? db.io : Array.isArray(db.io) ? { ...db.io } : {};
  const builds: ProbeIoBuild[] = [];
  for (const [build, raw] of Object.entries(io)) {
    const entries = list(raw).filter(isObj);
    const stateEntry = entries.findLast((e) => e.action === 'state');
    builds.push({
      build,
      entries: entries.length,
      state: stateEntry && { at: num(stateEntry.at), values: showState(stateEntry.state) },
      last: entries.slice(-PROBE_IO_LAST).map((e) => ({
        at: num(e.at),
        action: str(e.action) ?? '?',
        marker: num(e.marker),
        detail: ioDetail(e),
      })),
    });
  }
  builds.sort((a, b) => Number(a.build) - Number(b.build));
  if (!lc && !lg && builds.length === 0) return undefined;
  const counts: Record<string, number> = {};
  if (lg && isObj(lg.counts))
    for (const [k, v] of Object.entries(lg.counts)) if (typeof v === 'number') counts[k] = v;
  return {
    loadCheck: lc && {
      at: num(lc.at),
      loadCount: num(lc.loadCount) ?? num(db.loadCount),
      arrivedNil: bool(lc.arrivedNil),
      arrivedEmpty: bool(lc.arrivedEmpty),
      arrivedKeys: num(lc.arrivedKeys),
      previousLoadAt: num(lc.previousLoadAt),
    },
    ledgerCheck: lg && {
      addonLoaded: lg.addonLoaded === true,
      type: str(lg.type),
      records: num(lg.records),
      empty: bool(lg.empty),
      counts,
    },
    builds,
  };
}

const when = (epoch: number | undefined) =>
  epoch === undefined ? '?' : formatChicago(new Date(epoch * 1000));

function formatIo(io: ProbeIoSummary): string[] {
  const lines = ['', 'io (logging channels, reload, SavedVariables load check)'];
  const lc = io.loadCheck;
  if (lc) {
    const count = lc.loadCount ?? 0;
    lines.push(
      `  load check (${when(lc.at)}): loadCount ${count}, ForeverLedgerProbeDB arrived ${
        lc.arrivedNil ? 'nil' : `as a table with ${lc.arrivedKeys ?? 0} key(s)`
      }`,
      count > 1
        ? '    → SavedVariables were loaded back'
        : '    → first load, or Forever did not load SavedVariables back (reload again: loadCount stays 1 if so)',
    );
  }
  const lg = io.ledgerCheck;
  if (lg) {
    const counts = Object.entries(lg.counts)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ');
    lines.push(
      lg.addonLoaded
        ? `  ForeverLedgerDB at login: ${lg.type ?? '?'}, ${lg.records ?? 0} data record(s)${
            counts ? ` (${counts})` : ''
          }`
        : '  ForeverLedgerDB at login: ForeverLedger not loaded',
    );
  }
  for (const b of io.builds) {
    lines.push(`  build ${b.build}: ${b.entries} io entr${b.entries === 1 ? 'y' : 'ies'}`);
    if (b.state) {
      const values = Object.entries(b.state.values)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      lines.push(`    logging state (${when(b.state.at)}): ${values}`);
    }
    if (b.last.length) lines.push(`    last ${b.last.length}:`);
    for (const e of b.last) {
      lines.push(
        `      ${when(e.at)}  ${e.action}${e.marker !== undefined ? ` [FLPROBE marker ${e.marker}]` : ''}${
          e.detail ? `  ${e.detail}` : ''
        }`,
      );
    }
  }
  return lines;
}

export function summarizeProbe(db: unknown): ProbeSummary {
  if (!isObj(db)) throw new TypeError(`${PROBE_VARIABLE} is not a table`);
  const dumps = isObj(db.dumps) ? db.dumps : Array.isArray(db.dumps) ? { ...db.dumps } : {};
  const sniff = isObj(db.sniff) ? db.sniff : {};
  const builds: ProbeBuildSummary[] = [];

  for (const [build, d] of Object.entries(dumps)) {
    if (!isObj(d)) continue;
    const info = isObj(d.buildInfo) ? d.buildInfo : {};
    const api = isObj(d.api) ? d.api : {};
    const events = isObj(d.events) ? d.events : {};
    const globals = isObj(d.globals) ? d.globals : {};
    const sniffed = isObj(sniff[build]) ? (sniff[build] as Obj) : {};
    builds.push({
      build,
      version: str(info.version),
      buildDate: str(info.date),
      interface: typeof info.interface === 'number' ? info.interface : undefined,
      probeVersion: str(d.probeVersion),
      apiDocsAvailable: api.available === true,
      systems: size(api.systems),
      globalFunctions: size(d.globalFunctions),
      namespaces: size(d.namespaces),
      eventsChecked: Object.keys(events).length,
      rejectedEvents: Object.entries(events)
        .filter(([, ok]) => ok !== true)
        .map(([name]) => name)
        .sort(),
      globalsChecked: Object.keys(globals).length,
      nilGlobals: Object.entries(globals)
        .filter(([, type]) => type === 'nil')
        .map(([name]) => name)
        .sort(),
      sniffedEvents: Object.entries(sniffed)
        .map(([event, s]) => ({
          event,
          count: isObj(s) && typeof s.count === 'number' ? s.count : 0,
        }))
        .sort((a, b) => a.event.localeCompare(b.event)),
    });
  }
  builds.sort((a, b) => Number(a.build) - Number(b.build));
  const io = summarizeIo(db);
  return { probeVersion: str(db.probeVersion), builds, ...(io ? { io } : {}) };
}

export function formatProbeSummary(s: ProbeSummary): string {
  const lines: string[] = [];
  lines.push(`probe ${s.probeVersion ?? '?'}: ${s.builds.length} build(s)`);
  for (const b of s.builds) {
    lines.push(
      '',
      `build ${b.build}${b.version ? ` (${b.version}` : ' ('}${b.buildDate ? `, ${b.buildDate}` : ''}${
        b.interface !== undefined ? `, interface ${b.interface}` : ''
      })`,
      `  API docs available: ${b.apiDocsAvailable ? `yes (${b.systems} systems)` : 'no'}`,
      `  global functions: ${b.globalFunctions}, C_ namespaces: ${b.namespaces}`,
      `  candidate events rejected: ${b.rejectedEvents.length}/${b.eventsChecked}${
        b.rejectedEvents.length ? ` — ${b.rejectedEvents.join(', ')}` : ''
      }`,
      `  candidate globals nil: ${b.nilGlobals.length}/${b.globalsChecked}${
        b.nilGlobals.length ? ` — ${b.nilGlobals.join(', ')}` : ''
      }`,
    );
    if (b.sniffedEvents.length)
      lines.push(
        `  sniffed events: ${b.sniffedEvents.map((e) => `${e.event}×${e.count}`).join(', ')}`,
      );
  }
  if (s.io) lines.push(...formatIo(s.io));
  return lines.join('\n');
}

/** Parses ForeverLedgerProbe.lua (never executing it), writes the table as JSON, returns a summary. */
export async function probeDump(
  input: string,
  output: string,
  read: ReadOptions = {},
): Promise<ProbeSummary> {
  const { value } = await readSavedVariable(input, { ...read, global: PROBE_VARIABLE });
  const summary = summarizeProbe(value);
  await writeJsonAtomic(output, value);
  return summary;
}
