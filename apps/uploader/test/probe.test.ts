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

    expect(summary.probeVersion).toBe('0.3.0');
    expect(summary.builds).toHaveLength(1);
    const b = summary.builds[0]!;
    expect(b).toMatchObject({
      build: '61582',
      version: '1.15.7',
      interface: 11507,
      apiDocsAvailable: true,
      systems: 1,
      globalFunctions: 58,
      namespaces: 7,
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
    expect(old.specs).toBeUndefined();
    expect(formatProbeSummary(old)).not.toMatch(/^io /m);
    expect(formatProbeSummary(old)).not.toMatch(/^specs /m);
  });

  it('summarises /flprobe specs: the catalog, items with spec info and DoesItemContainSpec hits', async () => {
    const summary = await probeDump(fixturePath('probe-dump.lua'), join(env.dir, 'api.json'), {
      stableIntervalMs: 5,
    });
    expect(summary.specs).toHaveLength(1);
    const s = summary.specs![0]!;
    expect(s).toMatchObject({
      build: '61582',
      probeVersion: '0.3.0',
      at: 1790000000,
      classes: 3,
      specs: 6,
      items: 3,
      equippable: 2,
      withSpecInfo: 2,
      emptySpecInfo: 1,
      specInfoErrors: 0,
      specInfoOther: 0,
      specInfoMissing: false,
      containsAvailable: true,
      containsAny: 2,
      player: { class: 'HUNTER', classId: 3, level: 10, specIndex: 1 },
    });
    expect(s.api['C_Item.GetItemSpecInfo']).toBe('function');
    expect(s.catalog).toContainEqual({
      classId: 1,
      class: 'WARRIOR',
      specs: [
        { id: 71, name: 'Arms', role: 'DAMAGER', primaryStat: 1 },
        { id: 72, name: 'Fury', role: 'DAMAGER', primaryStat: 1 },
        { id: 73, name: 'Protection', role: 'TANK', primaryStat: 1 },
      ],
    });
    expect(s.catalog.map((c) => c.classId)).toEqual([1, 3, 8]);
    // bags are walked before equipped slots
    expect(s.sample[0]).toMatchObject({
      id: 2308,
      where: 'bag:0:1',
      equippable: true,
      specInfo: '[62, 253, 254]',
      contains: [62, 253, 254],
      statKeys: ['ITEM_MOD_STAMINA_SHORT', 'RESISTANCE0_NAME'],
    });
    expect(s.sample[1]).toMatchObject({
      id: 2589,
      equippable: false,
      specInfo: '[]',
      contains: [],
    });
    expect(s.sample[2]).toMatchObject({ id: 872, where: 'slot:16', contains: [71, 72, 73] });

    const text = formatProbeSummary(summary);
    expect(text).toMatch(/^specs \(\/flprobe specs\)$/m);
    expect(text).toMatch(
      /build 61582 \(.* C[DS]T\): catalog 3 class\(es\) \/ 6 spec\(s\); 3 item\(s\), 2 equippable, 2 with GetItemSpecInfo \(1 empty, 0 errors, 0 non-table\), 2 matched by DoesItemContainSpec/,
    );
    expect(text).toMatch(/player: HUNTER \(class 3\) level 10, spec index 1/);
    expect(text).toMatch(
      /WARRIOR \(1\): Arms \(DAMAGER, stat 1\), Fury \(DAMAGER, stat 1\), Protection \(TANK, stat 1\)/,
    );
    expect(text).toMatch(
      /2308 bag:0:1 equippable {2}specInfo \[62, 253, 254\] {2}contains \[62, 253, 254\]/,
    );
    expect(text).toMatch(/2589 bag:0:3 not equippable {2}specInfo \[\]/);
  });

  it('flags missing spec APIs in the specs summary', () => {
    const s = summarizeProbe({
      probeVersion: '0.3.0',
      dumps: {},
      sniff: {},
      specs: {
        '69913': {
          at: 1790000000,
          probeVersion: '0.3.0',
          api: { 'C_Item.GetItemSpecInfo': 'nil', 'C_Item.DoesItemContainSpec': 'nil' },
          player: {
            class: 'MAGE',
            classID: 8,
            level: 20,
            specIndex: { ok: false, missing: true },
            specs: {},
          },
          catalog: {
            '1': {
              info: { ok: true, values: ['Warrior', 'WARRIOR', 1] },
              count: { ok: false, missing: true },
              specs: {},
            },
          },
          items: [
            {
              id: 5,
              link: 'x',
              where: 'bag:0:1',
              specInfo: { ok: false, missing: true },
              equippable: { ok: true, values: [true] },
            },
          ],
          counts: {
            items: 1,
            equippable: 1,
            withSpecInfo: 0,
            emptySpecInfo: 0,
            specInfoErrors: 0,
            containsAny: 0,
          },
        },
      },
    });
    const b = s.specs![0]!;
    expect(b).toMatchObject({
      build: '69913',
      specInfoMissing: true,
      containsAvailable: false,
      classes: 0,
      specs: 0,
    });
    expect(b.sample[0]).toMatchObject({ id: 5, specInfo: 'missing', contains: [] });
    const text = formatProbeSummary(s);
    expect(text).toMatch(/GetItemSpecInfo missing, DoesItemContainSpec missing/);
  });

  it('keeps a non-table GetItemSpecInfo apart from an empty one and reads 1..n contains keys', () => {
    const s = summarizeProbe({
      probeVersion: '0.3.0',
      dumps: {},
      sniff: {},
      specs: {
        '69913': {
          at: 1790000000,
          api: { 'C_Item.GetItemSpecInfo': 'function', 'C_Item.DoesItemContainSpec': 'function' },
          catalog: {},
          items: [
            // GetItemSpecInfo returned nil (recorded as the string "<nil>"); IsEquippableItem is missing
            {
              id: 5,
              where: 'bag:0:1',
              specInfo: { ok: true, values: ['<nil>'] },
              equippable: { ok: false, missing: true },
              contains: [true, true, false], // spec ids 1..3 parse as a Lua list
              askedSpecs: 3,
            },
          ],
          counts: {
            items: 1,
            withSpecInfo: 0,
            emptySpecInfo: 0,
            specInfoErrors: 0,
            specInfoOther: 1,
          },
        },
      },
    });
    const b = s.specs![0]!;
    expect(b.specInfoOther).toBe(1);
    expect(b.sample[0]).toMatchObject({
      id: 5,
      specInfo: '"<nil>"',
      contains: [1, 2],
      equippable: undefined,
    });
    const text = formatProbeSummary(s);
    expect(text).toMatch(/\(0 empty, 0 errors, 1 non-table\)/);
    expect(text).toMatch(/5 bag:0:1 equippable \? {2}specInfo "<nil>" {2}contains \[1, 2\]/);
  });

  it('rejects a file without ForeverLedgerProbeDB', async () => {
    await expect(
      probeDump(fixturePath('session-v1.lua'), join(env.dir, 'x.json'), { stableIntervalMs: 5 }),
    ).rejects.toThrow(/ForeverLedgerProbeDB/);
  });
});
