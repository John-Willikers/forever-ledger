// The helper's loop, one step at a time: decide, lease, fetch, report, and say how long to wait. No Electron in here
// (service.ts wires it to the real browser, gate and server; the tests pass fakes).
import type { FetchReport } from '@forever-ledger/contracts';
import { nextPageDelayMs } from './policy.js';

export type HelperState =
  | 'off'
  | 'enrolling'
  | 'pending'
  | 'paused'
  | 'waiting'
  | 'resting'
  | 'fetching'
  | 'stopped'
  | 'revoked';

export interface Budget {
  day: { used: number; limit: number };
  hour: { used: number; limit: number };
}

export interface LeaseAnswer {
  /** Set when the server refused: waiting for approval, paused, or the helper key was revoked. */
  refused?: 'pending' | 'paused' | 'revoked';
  leases: { url: string }[];
  budget?: Budget;
}

export interface ActivityEntry {
  at: number;
  url: string;
  result: 'saved' | 'unchanged' | 'challenge' | 'error';
  detail?: string;
}

export interface CoreDeps {
  now(): number;
  random(): number;
  enabled(): boolean;
  /** Pages this PC may still fetch today (the tray's own cap, whatever the server allows). */
  pagesLeftToday(): number;
  /** Counts a fetched page against today's cap. */
  countPage(): void;
  /** Why the helper must wait right now (you're at the PC, on battery, WoW is running), or null to go ahead. */
  blockedBy(): Promise<string | null>;
  lease(): Promise<LeaseAnswer>;
  fetchPage(url: string): Promise<FetchReport>;
  report(r: FetchReport): Promise<{ result?: string }>;
  activity(e: ActivityEntry): void;
  setState(state: HelperState, detail?: string): void;
}

const MINUTE = 60_000;
/** After this many challenge, 403 or 429 pages in a row the helper stops until someone looks (like cruiser). */
export const MAX_STRIKES = 3;

const msToNextHour = (now: number) => MINUTE * 60 - (now % (MINUTE * 60)) + 5_000;

/** One step of the helper; returns how long to wait before the next. `strikes` carries over between steps. */
export async function step(d: CoreDeps, strikes: { n: number }): Promise<number> {
  if (!d.enabled()) {
    d.setState('off');
    return MINUTE;
  }
  if (strikes.n >= MAX_STRIKES) {
    d.setState('stopped', 'Wowhead kept refusing pages; turn the helper off and on to try again');
    return 60 * MINUTE;
  }
  if (d.pagesLeftToday() <= 0) {
    d.setState('resting', "today's pages are done");
    return 60 * MINUTE;
  }
  const blocked = await d.blockedBy();
  if (blocked) {
    d.setState('waiting', blocked);
    return MINUTE;
  }
  const answer = await d.lease();
  if (answer.refused === 'revoked') {
    d.setState(
      'revoked',
      'the ledger no longer accepts this helper; turn it off and on to ask again',
    );
    return 60 * MINUTE;
  }
  if (answer.refused) {
    d.setState(
      answer.refused,
      answer.refused === 'pending'
        ? 'waiting for Harlan to approve this PC'
        : 'paused by the ledger',
    );
    return 10 * MINUTE;
  }
  const [lease] = answer.leases;
  if (!lease) {
    const b = answer.budget;
    if (b && b.day.used >= b.day.limit) {
      d.setState('resting', `today's ${b.day.limit} pages are done`);
      return 60 * MINUTE;
    }
    if (b && b.hour.used >= b.hour.limit) {
      d.setState('resting', `this hour's ${b.hour.limit} pages are done`);
      return msToNextHour(d.now());
    }
    d.setState('resting', 'nothing to fetch right now');
    return 10 * MINUTE;
  }

  // Turned off while the lease was in flight: load nothing (the lease simply runs out on the server).
  if (!d.enabled()) {
    d.setState('off');
    return MINUTE;
  }
  d.setState('fetching', lease.url);
  d.countPage();
  let report: FetchReport;
  try {
    report = await d.fetchPage(lease.url);
  } catch (err) {
    report = {
      url: lease.url,
      worker: 'tray',
      fetcher: 'tray-helper',
      outcome: 'error',
      fetchedAt: new Date(d.now()).toISOString(),
      error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
    } as FetchReport;
  }
  let result: ActivityEntry['result'];
  try {
    const answer = await d.report(report);
    result =
      report.outcome === 'challenge'
        ? 'challenge'
        : answer.result === 'stored'
          ? 'saved'
          : answer.result === 'unchanged'
            ? 'unchanged'
            : 'error';
  } catch (err) {
    d.activity({ at: d.now(), url: lease.url, result: 'error', detail: String(err).slice(0, 200) });
    return 5 * MINUTE;
  }
  d.activity({ at: d.now(), url: lease.url, result, detail: report.error });

  const refused =
    report.outcome === 'challenge' ||
    (report.outcome === 'http_error' && (report.httpStatus === 403 || report.httpStatus === 429));
  if (refused) {
    strikes.n++;
    return 15 * MINUTE * 2 ** (strikes.n - 1);
  }
  strikes.n = 0;
  return nextPageDelayMs(d.random);
}
