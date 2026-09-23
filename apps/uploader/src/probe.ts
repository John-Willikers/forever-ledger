import { writeJsonAtomic } from './fsutil.js';
import { readSavedVariable } from './reader.js';
import type { ReadOptions } from './reader.js';

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

export interface ProbeSummary {
  probeVersion?: string;
  builds: ProbeBuildSummary[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Lua lists parse as arrays, but an empty table is `{}` and a sparse one an object. */
const size = (v: unknown) => (Array.isArray(v) ? v.length : isObj(v) ? Object.keys(v).length : 0);
const str = (v: unknown) =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined;

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
  return { probeVersion: str(db.probeVersion), builds };
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
