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

/** One spec of the client's catalog (`/flprobe specs`, probe 0.3.0+). */
export interface ProbeSpecEntry {
  id: number;
  name?: string;
  role?: string;
  /** Client index: 1 STR, 2 AGI, 3 STA, 4 INT, 5 SPI (retail numbering; confirm on Forever). */
  primaryStat?: number;
}

export interface ProbeSpecClass {
  classId: number;
  class?: string;
  specs: ProbeSpecEntry[];
}

export interface ProbeSpecItem {
  id?: number;
  where?: string;
  equippable?: boolean;
  /** `[62, 253]` for a table, else `missing` / `error: …`. */
  specInfo: string;
  /** Spec ids `C_Item.DoesItemContainSpec` said yes to. */
  contains: number[];
  containsErr?: string;
  statKeys: string[];
}

export interface ProbeSpecsBuild {
  build: string;
  at?: number;
  probeVersion?: string;
  /** `name → type` for the spec functions the probe looked for. */
  api: Record<string, string>;
  player?: { class?: string; classId?: number; level?: number; specIndex?: number };
  /** Classes with at least one spec. */
  catalog: ProbeSpecClass[];
  classes: number;
  specs: number;
  items: number;
  equippable: number;
  withSpecInfo: number;
  emptySpecInfo: number;
  specInfoErrors: number;
  /** GetItemSpecInfo answered but not with a table (nil, false, a number). */
  specInfoOther: number;
  specInfoMissing: boolean;
  containsAvailable: boolean;
  containsAny: number;
  sample: ProbeSpecItem[];
}

export interface ProbeSummary {
  probeVersion?: string;
  builds: ProbeBuildSummary[];
  /** Absent for probe 0.1.0 files. */
  io?: ProbeIoSummary;
  /** Absent before probe 0.3.0 or when `/flprobe specs` never ran. */
  specs?: ProbeSpecsBuild[];
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

/** Items shown per build in the specs summary. */
export const PROBE_SPECS_SAMPLE = 5;

/** Lua tables keyed 1..n parse as arrays; anything else as an object. Yields `[key, value]` with 1-based keys. */
const luaEntries = (v: unknown): [string, unknown][] =>
  Array.isArray(v) ? v.map((x, i) => [String(i + 1), x]) : isObj(v) ? Object.entries(v) : [];

/** First `values` entry of a recorded pcall result, when it succeeded. */
const firstValue = (r: unknown) => (isObj(r) && r.ok === true ? list(r.values)[0] : undefined);
const valueAt = (r: unknown, i: number) =>
  isObj(r) && r.ok === true ? list(r.values)[i] : undefined;
const numList = (v: unknown) => list(v).filter((x): x is number => typeof x === 'number');

function specEntry(s: unknown): ProbeSpecEntry | undefined {
  if (!isObj(s)) return undefined;
  const id = num(firstValue(s.forClass)) || num(firstValue(s.info));
  if (!id || id <= 0) return undefined;
  return {
    id,
    name: str(valueAt(s.forClass, 1)) ?? str(valueAt(s.info, 1)),
    role: str(valueAt(s.forClass, 4)) ?? str(valueAt(s.info, 4)),
    primaryStat: num(valueAt(s.info, 5)),
  };
}

function specItem(it: Obj): ProbeSpecItem {
  const answer = firstValue(it.specInfo);
  // A table answer prints as a list; a nil/false/number answer keeps showResult's rendering (`"<nil>"`, `false`).
  const specInfo =
    Array.isArray(answer) || isObj(answer)
      ? `[${numList(answer).join(', ')}]`
      : showResult(it.specInfo);
  // Spec ids 1..n would parse as a Lua list, so read the keys 1-based either way.
  const contains = luaEntries(it.contains)
    .filter(([, yes]) => yes === true)
    .map(([id]) => Number(id))
    .filter((id) => Number.isFinite(id))
    .sort((a, b) => a - b);
  return {
    id: num(it.id),
    where: str(it.where),
    equippable: bool(firstValue(it.equippable)),
    specInfo,
    contains,
    containsErr: str(it.containsErr),
    statKeys: list(it.statKeys).filter((k): k is string => typeof k === 'string'),
  };
}

function summarizeSpecs(db: Obj): ProbeSpecsBuild[] | undefined {
  const out: ProbeSpecsBuild[] = [];
  for (const [build, raw] of luaEntries(db.specs)) {
    if (!isObj(raw)) continue;
    const api: Record<string, string> = {};
    for (const [k, v] of Object.entries(isObj(raw.api) ? raw.api : {}))
      if (str(v)) api[k] = str(v)!;
    const catalog: ProbeSpecClass[] = [];
    for (const [classKey, c] of luaEntries(raw.catalog)) {
      if (!isObj(c)) continue;
      const specs = list(c.specs)
        .map(specEntry)
        .filter((s): s is ProbeSpecEntry => s !== undefined);
      if (specs.length === 0) continue;
      catalog.push({ classId: Number(classKey), class: str(valueAt(c.info, 1)), specs });
    }
    catalog.sort((a, b) => a.classId - b.classId);
    const items = list(raw.items).filter(isObj);
    const counts = isObj(raw.counts) ? raw.counts : {};
    const count = (k: string) => num(counts[k]) ?? 0;
    const p = isObj(raw.player) ? raw.player : undefined;
    const specInfoType = api['C_Item.GetItemSpecInfo'];
    out.push({
      build,
      at: num(raw.at),
      probeVersion: str(raw.probeVersion),
      api,
      player: p && {
        class: str(p.class),
        classId: num(p.classID),
        level: num(p.level),
        specIndex: num(firstValue(p.specIndex)),
      },
      catalog,
      classes: catalog.length,
      specs: catalog.reduce((n, c) => n + c.specs.length, 0),
      items: count('items'),
      equippable: count('equippable'),
      withSpecInfo: count('withSpecInfo'),
      emptySpecInfo: count('emptySpecInfo'),
      specInfoErrors: count('specInfoErrors'),
      specInfoOther: count('specInfoOther'),
      specInfoMissing: specInfoType
        ? specInfoType !== 'function'
        : items.length > 0 &&
          items.every((it) => isObj(it.specInfo) && it.specInfo.missing === true),
      containsAvailable: api['C_Item.DoesItemContainSpec'] === 'function',
      containsAny: count('containsAny'),
      sample: items.slice(0, PROBE_SPECS_SAMPLE).map(specItem),
    });
  }
  out.sort((a, b) => Number(a.build) - Number(b.build));
  return out.length ? out : undefined;
}

function formatSpecs(builds: ProbeSpecsBuild[]): string[] {
  const lines = ['', 'specs (/flprobe specs)'];
  for (const b of builds) {
    lines.push(
      `  build ${b.build} (${when(b.at)}): catalog ${b.classes} class(es) / ${b.specs} spec(s); ${b.items} item(s), ${
        b.equippable
      } equippable, ${b.withSpecInfo} with GetItemSpecInfo (${b.emptySpecInfo} empty, ${
        b.specInfoErrors
      } errors, ${b.specInfoOther} non-table), ${b.containsAny} matched by DoesItemContainSpec`,
    );
    if (b.specInfoMissing || !b.containsAvailable)
      lines.push(
        `    api: GetItemSpecInfo ${b.specInfoMissing ? 'missing' : 'present'}, DoesItemContainSpec ${
          b.containsAvailable ? 'present' : 'missing'
        }`,
      );
    if (b.player)
      lines.push(
        `    player: ${b.player.class ?? '?'} (class ${b.player.classId ?? '?'}) level ${
          b.player.level ?? '?'
        }, spec index ${b.player.specIndex ?? '?'}`,
      );
    for (const c of b.catalog)
      lines.push(
        `    ${c.class ?? '?'} (${c.classId}): ${c.specs
          .map((s) => `${s.name ?? s.id} (${s.role ?? '?'}, stat ${s.primaryStat ?? '?'})`)
          .join(', ')}`,
      );
    if (b.sample.length) lines.push(`    items (first ${b.sample.length}):`);
    for (const it of b.sample) {
      const parts = [
        `${it.id ?? '?'} ${it.where ?? '?'} ${
          it.equippable === undefined
            ? 'equippable ?'
            : it.equippable
              ? 'equippable'
              : 'not equippable'
        }`,
        `specInfo ${it.specInfo}`,
      ];
      if (it.contains.length) parts.push(`contains [${it.contains.join(', ')}]`);
      if (it.containsErr) parts.push(`contains error: ${it.containsErr}`);
      if (it.statKeys.length) parts.push(`stats ${it.statKeys.join(', ')}`);
      lines.push(`      ${parts.join('  ')}`);
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
  const specs = summarizeSpecs(db);
  return {
    probeVersion: str(db.probeVersion),
    builds,
    ...(io ? { io } : {}),
    ...(specs ? { specs } : {}),
  };
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
  if (s.specs) lines.push(...formatSpecs(s.specs));
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
