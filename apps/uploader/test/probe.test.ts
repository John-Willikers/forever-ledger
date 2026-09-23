import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatProbeSummary, probeDump, summarizeProbe } from '../src/probe.js';
import { fixturePath, tempEnv } from './helpers/fixtures.js';
import type { TempEnv } from './helpers/fixtures.js';

let env: TempEnv;
beforeEach(async () => {
  env = await tempEnv();
});
afterEach(() => env.cleanup());

describe('probe-dump', () => {
  it('parses ForeverLedgerProbe.lua, writes JSON and summarises it', async () => {
    const out = join(env.dir, 'api.json');
    const summary = await probeDump(fixturePath('probe-dump.lua'), out, { stableIntervalMs: 5 });

    const json = JSON.parse(await readFile(out, 'utf8')) as {
      dumps: Record<string, { buildInfo: { build: number } }>;
    };
    expect(json.dumps['61582']?.buildInfo.build).toBe(61582);

    expect(summary.probeVersion).toBe('0.2.0');
    expect(summary.builds).toHaveLength(1);
    const b = summary.builds[0]!;
    expect(b).toMatchObject({
      build: '61582',
      version: '1.15.7',
      interface: 11507,
      apiDocsAvailable: true,
      systems: 1,
      globalFunctions: 51,
      namespaces: 5,
      rejectedEvents: ['ENCOUNTER_END'],
    });
    expect(b.nilGlobals).toContain('GetRewardXP');
    expect(b.nilGlobals).toContain('C_Item');
    expect(b.nilGlobals).not.toContain('GetLootSourceInfo');
    expect(b.sniffedEvents).toContainEqual({ event: 'QUEST_ACCEPTED', count: 8 });

    const text = formatProbeSummary(summary);
    expect(text).toMatch(/build 61582 \(1\.15\.7, Sep 18 2026, interface 11507\)/);
    expect(text).toMatch(/API docs available: yes \(1 systems\)/);
    expect(text).toMatch(/candidate events rejected: 1\/\d+ — ENCOUNTER_END/);
  });

  it('summarises /flprobe io: logging state, load check and the last entries', async () => {
    const summary = await probeDump(fixturePath('probe-dump.lua'), join(env.dir, 'api.json'), {
      stableIntervalMs: 5,
    });
    const io = summary.io!;
    // The fixture's table was handed back to a second load, as a working client does.
    expect(io.loadCheck).toMatchObject({ loadCount: 2, arrivedNil: false, arrivedEmpty: false });
    expect(io.ledgerCheck).toMatchObject({
      addonLoaded: true,
      type: 'table',
      records: 1,
      empty: false,
    });
    expect(io.ledgerCheck?.counts).toMatchObject({ items: 1, chars: 1, quests: 0 });
    expect(io.builds).toHaveLength(1);
    const b = io.builds[0]!;
    expect(b.build).toBe('61582');
    expect(b.state?.values).toMatchObject({
      LoggingChat: 'false',
      LoggingCombat: 'false',
      'C_CombatLog.IsCombatLogRestricted': 'true',
      'GetCVar(advancedCombatLogging)': '"1"',
    });
    expect(b.last.length).toBeLessThanOrEqual(10);
    const on = b.last.find((e) => e.action === 'on');
    expect(on?.marker).toBe(1790000000);
    expect(on?.detail).toBe('LoggingChat(true) → true, LoggingCombat(true) → true');
    expect(b.last.find((e) => e.action === 'reloadui-result')?.detail).toMatch(
      /returned without reloading: error: .*Interface action failed/,
    );
    expect(b.last.map((e) => e.action)).toContain('secure-click');

    const text = formatProbeSummary(summary);
    expect(text).toMatch(/^io \(logging channels, reload, SavedVariables load check\)$/m);
    expect(text).toMatch(/load check \(.* C[DS]T\): loadCount 2, .*arrived as a table/);
    expect(text).toMatch(/SavedVariables were loaded back/);
    expect(text).toMatch(/ForeverLedgerDB at login: table, 1 data record\(s\)/);
    expect(text).toMatch(/logging state \(.*\): .*LoggingCombat=false/);
    expect(text).toMatch(/on \[FLPROBE marker 1790000000\] {2}LoggingChat\(true\) → true/);
  });

  it('flags a load that arrived empty and skips io for probe 0.1.0 files', () => {
    const empty = summarizeProbe({
      probeVersion: '0.2.0',
      loadCount: 1,
      loadCheck: {
        at: 1790000000,
        loadCount: 1,
        arrivedNil: true,
        arrivedEmpty: true,
        arrivedKeys: 0,
      },
      ledgerCheck: { addonLoaded: false, type: 'nil' },
      io: {},
    });
    expect(empty.io?.loadCheck).toMatchObject({ loadCount: 1, arrivedNil: true });
    const text = formatProbeSummary(empty);
    expect(text).toMatch(/loadCount 1, ForeverLedgerProbeDB arrived nil/);
    expect(text).toMatch(/did not load SavedVariables back/);
    expect(text).toMatch(/ForeverLedger not loaded/);

    const old = summarizeProbe({ probeVersion: '0.1.0', dumps: {}, sniff: {} });
    expect(old.io).toBeUndefined();
    expect(formatProbeSummary(old)).not.toMatch(/^io /m);
  });

  it('rejects a file without ForeverLedgerProbeDB', async () => {
    await expect(
      probeDump(fixturePath('session-v1.lua'), join(env.dir, 'x.json'), { stableIntervalMs: 5 }),
    ).rejects.toThrow(/ForeverLedgerProbeDB/);
  });
});
