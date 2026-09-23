import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatProbeSummary, probeDump } from '../src/probe.js';
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

    expect(summary.probeVersion).toBe('0.1.0');
    expect(summary.builds).toHaveLength(1);
    const b = summary.builds[0]!;
    expect(b).toMatchObject({
      build: '61582',
      version: '1.15.7',
      interface: 11507,
      apiDocsAvailable: true,
      systems: 1,
      globalFunctions: 45,
      namespaces: 3,
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

  it('rejects a file without ForeverLedgerProbeDB', async () => {
    await expect(
      probeDump(fixturePath('session-v1.lua'), join(env.dir, 'x.json'), { stableIntervalMs: 5 }),
    ).rejects.toThrow(/ForeverLedgerProbeDB/);
  });
});
