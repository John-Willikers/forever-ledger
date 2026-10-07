// The fetch helper's loop decisions, with fakes for the browser, gate and server.
import type { FetchReport } from '@forever-ledger/contracts';
import { describe, expect, it } from 'vitest';
import { MAX_STRIKES, step } from '../src/main/helper/core.js';
import type { ActivityEntry, CoreDeps, HelperState, LeaseAnswer } from '../src/main/helper/core.js';

const URL1 = 'https://www.wowhead.com/forever/item=7973';
const budget = (dayUsed = 0, hourUsed = 0) => ({
  day: { used: dayUsed, limit: 200 },
  hour: { used: hourUsed, limit: 13 },
});

function deps(over: Partial<CoreDeps> = {}) {
  const states: [HelperState, string | undefined][] = [];
  const activity: ActivityEntry[] = [];
  const reports: FetchReport[] = [];
  const d: CoreDeps = {
    now: () => Date.UTC(2026, 9, 7, 15, 20, 0),
    random: () => 0.5,
    enabled: () => true,
    pagesLeftToday: () => 200,
    countPage: () => undefined,
    blockedBy: async () => null,
    lease: async (): Promise<LeaseAnswer> => ({ leases: [{ url: URL1 }], budget: budget(1, 1) }),
    fetchPage: async (url) =>
      ({
        url,
        worker: 'w',
        fetcher: 'f',
        outcome: 'ok',
        fetchedAt: '2026-10-07T10:20:00-05:00',
      }) as FetchReport,
    report: async (r) => {
      reports.push(r);
      return { result: 'stored' };
    },
    activity: (e) => activity.push(e),
    setState: (s, detail) => states.push([s, detail]),
    ...over,
  };
  return { d, states, activity, reports };
}

describe('fetch helper loop', () => {
  it('does nothing while off', async () => {
    const t = deps({
      enabled: () => false,
      lease: async () => {
        throw new Error('must not lease');
      },
    });
    expect(await step(t.d, { n: 0 })).toBe(60_000);
    expect(t.states).toEqual([['off', undefined]]);
  });

  it('waits while you are at the PC, on battery or playing', async () => {
    const t = deps({
      blockedBy: async () => 'waiting until World of Warcraft is closed',
      lease: async () => {
        throw new Error('must not lease');
      },
    });
    expect(await step(t.d, { n: 0 })).toBe(60_000);
    expect(t.states).toEqual([['waiting', 'waiting until World of Warcraft is closed']]);
  });

  it('waits for approval or a pause without fetching', async () => {
    for (const refused of ['pending', 'paused'] as const) {
      const t = deps({ lease: async () => ({ refused, leases: [] }) });
      expect(await step(t.d, { n: 0 })).toBe(10 * 60_000);
      expect(t.states[0]![0]).toBe(refused);
      expect(t.reports).toEqual([]);
    }
  });

  it('stops for good when the ledger revoked the helper key', async () => {
    const t = deps({ lease: async () => ({ refused: 'revoked', leases: [] }) });
    expect(await step(t.d, { n: 0 })).toBe(60 * 60_000);
    expect(t.states[0]![0]).toBe('revoked');
    expect(t.reports).toEqual([]);
  });

  it("keeps the tray's own daily cap whatever the server allows", async () => {
    const t = deps({
      pagesLeftToday: () => 0,
      lease: async () => {
        throw new Error('must not lease');
      },
    });
    expect(await step(t.d, { n: 0 })).toBe(60 * 60_000);
    expect(t.states).toEqual([['resting', "today's pages are done"]]);
  });

  it('counts each page it loads, and loads nothing if turned off during the lease', async () => {
    let counted = 0;
    const on = deps({ countPage: () => void counted++ });
    await step(on.d, { n: 0 });
    expect(counted).toBe(1);
    let enabledCalls = 0;
    const off = deps({
      enabled: () => enabledCalls++ === 0,
      fetchPage: async () => {
        throw new Error('must not fetch');
      },
    });
    await step(off.d, { n: 0 });
    expect(off.states.at(-1)![0]).toBe('off');
    expect(off.reports).toEqual([]);
  });

  it("rests when the day's or the hour's budget is spent, or nothing is queued", async () => {
    const day = deps({ lease: async () => ({ leases: [], budget: budget(200, 5) }) });
    expect(await step(day.d, { n: 0 })).toBe(60 * 60_000);
    expect(day.states[0]).toEqual(['resting', "today's 200 pages are done"]);
    const hour = deps({ lease: async () => ({ leases: [], budget: budget(20, 13) }) });
    // 15:20 UTC: the next hour starts in 40 min (+5 s).
    expect(await step(hour.d, { n: 0 })).toBe(40 * 60_000 + 5_000);
    const empty = deps({ lease: async () => ({ leases: [], budget: budget(2, 1) }) });
    expect(await step(empty.d, { n: 0 })).toBe(10 * 60_000);
  });

  it('fetches one page, reports it, logs it and waits 120-200 s', async () => {
    const t = deps();
    const strikes = { n: 2 };
    expect(await step(t.d, strikes)).toBe(160_000);
    expect(t.reports.map((r) => r.url)).toEqual([URL1]);
    expect(t.activity).toEqual([expect.objectContaining({ url: URL1, result: 'saved' })]);
    expect(strikes.n).toBe(0);
    expect(t.states.map((s) => s[0])).toEqual(['fetching']);
  });

  it('backs off on challenges and refusals, and stops after three in a row', async () => {
    const strikes = { n: 0 };
    const t = deps({
      fetchPage: async (url) =>
        ({
          url,
          worker: 'w',
          fetcher: 'f',
          outcome: 'challenge',
          fetchedAt: '2026-10-07T10:20:00-05:00',
        }) as FetchReport,
      report: async () => ({ result: 'challenge' }),
    });
    expect(await step(t.d, strikes)).toBe(15 * 60_000);
    expect(await step(t.d, strikes)).toBe(30 * 60_000);
    expect(await step(t.d, strikes)).toBe(60 * 60_000);
    expect(strikes.n).toBe(MAX_STRIKES);
    const stopped = deps({
      lease: async () => {
        throw new Error('must not lease');
      },
    });
    expect(await step(stopped.d, strikes)).toBe(60 * 60_000);
    expect(stopped.states[0]![0]).toBe('stopped');
    expect(t.activity.every((a) => a.result === 'challenge')).toBe(true);
  });

  it('reports a page the browser could not load as an error, without stopping', async () => {
    const t = deps({
      fetchPage: async () => {
        throw new Error('page took longer than 45 s');
      },
    });
    const strikes = { n: 0 };
    await step(t.d, strikes);
    expect(t.reports[0]).toMatchObject({
      url: URL1,
      outcome: 'error',
      error: 'page took longer than 45 s',
    });
    expect(strikes.n).toBe(0);
  });
});
