// The tray writes the server's guides into the game as a generated data addon (project-plans/forever-ledger-guides.md).
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GuideDoc } from '@forever-ledger/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../src/config.js';
import { GUIDES_ADDON, guidesLua, luaString, syncGuides, toLua } from '../src/guides.js';
import { tempEnv } from './helpers/fixtures.js';
import type { TempEnv } from './helpers/fixtures.js';

const SERVER = 'https://ledger.example';
const guide = (id: number, title = 'Undead 1-13'): GuideDoc => ({
  id,
  char: 'Sam Willikers-Classic Beta PvE',
  title,
  createdAt: '2026-10-07T22:00:00-05:00',
  fromLevel: 1,
  toLevel: 13,
  basedOn: 'Timbo',
  steps: [
    {
      action: 'accept',
      npc: 'Undertaker Mordo',
      zone: 'Tirisfal Glades',
      subzone: 'Deathknell',
      mapId: 1420,
      x: 30.2,
      y: 71.6,
      quests: [{ questId: 363, title: 'Rude Awakening' }],
    },
    {
      action: 'complete',
      npc: null,
      zone: 'Tirisfal Glades',
      subzone: null,
      mapId: null,
      x: null,
      y: null,
      quests: [
        { questId: 364, title: 'The Mindless Ones', objectives: ['Mindless Zombie slain: 8'] },
      ],
    },
  ],
});

describe('Lua data', () => {
  it('escapes every string so nothing can break out of the data', () => {
    expect(luaString('Sarvis')).toBe('"Sarvis"');
    expect(luaString('a "quote" and \\ slash')).toBe('"a \\"quote\\" and \\\\ slash"');
    // A newline, a closing bracket and code: all stay inside the string.
    expect(luaString('x"]] end; os.exit() --\n')).toBe('"x\\"]] end; os.exit() --\\010"');
    expect(luaString('Zul’Farrak')).toBe('"Zul\\226\\128\\153Farrak"');
  });

  it('writes plain tables and refuses anything else', () => {
    expect(toLua({ a: 1, b: [true, 'x'], c: null })).toBe(
      '{\n  a = 1,\n  b = {\n    true,\n    "x",\n  },\n}',
    );
    expect(() => toLua({ 'bad-key': 1 })).toThrow('not a Lua field name');
    expect(() => toLua({ f: () => 1 })).toThrow("can't write function");
    expect(() => toLua({ n: Number.NaN })).toThrow('not a finite number');
    expect(guidesLua([guide(1)], 1_800_000_000)).toContain('ForeverLedgerGuidesData = {');
  });

  it('writes guide format 2: travel steps with how and note', () => {
    const g = guide(1);
    g.planned = true;
    g.steps.unshift({
      action: 'travel',
      how: 'fly',
      note: 'Orgrimmar → Crossroads',
      npc: 'Crossroads, The Barrens',
      zone: 'Kalimdor',
      subzone: null,
      mapId: 1414,
      x: 51.5,
      y: 30.3,
      quests: [],
    });
    const lua = guidesLua([g], 1_800_000_000);
    expect(lua).toContain('  version = 2,');
    expect(lua).toContain('planned = true,');
    expect(lua).toContain('action = "travel",');
    expect(lua).toContain('how = "fly",');
    expect(lua).toContain('note = "Orgrimmar \\226\\134\\146 Crossroads",');
    expect(lua).toContain('quests = {},');
  });
});

describe('syncGuides', () => {
  let env: TempEnv;
  let config: Config;
  let served: GuideDoc[];
  let acks: number[][];
  let asked: string[];
  const addons = () => join(env.wowPath, '_classic_era_', 'Interface', 'AddOns');
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    asked.push(u);
    if (u.endsWith('/v1/guides?format=2')) return Response.json({ guides: served });
    if (u.endsWith('/v1/guides/ack')) {
      acks.push(JSON.parse(String(init?.body)).ids);
      return Response.json({ acked: 1 });
    }
    return new Response('no', { status: 404 });
  };
  const sync = () => syncGuides({ config, fetchImpl, now: () => 1_800_000_000_000 });

  beforeEach(async () => {
    env = await tempEnv();
    await env.writeSv('ForeverLedgerDB = {}', 'ACC1');
    await mkdir(join(addons(), 'ForeverLedger'), { recursive: true });
    await writeFile(join(addons(), 'ForeverLedger', 'ForeverLedger.toc'), '## Interface: 16001\n');
    config = env.config({ serverUrl: SERVER, token: 'flt_x' });
    served = [guide(7)];
    acks = [];
    asked = [];
  });
  afterEach(() => env.cleanup());

  it('writes the guides addon next to ForeverLedger and acks the new guide', async () => {
    const r = await sync();
    expect(r).toMatchObject({
      status: 'written',
      arrived: [{ id: 7, title: 'Undead 1-13' }],
      newFolder: true,
    });
    const folder = join(addons(), GUIDES_ADDON);
    expect((await readdir(folder)).sort()).toEqual(['ForeverLedger_Guides.toc', 'Guides.lua']);
    expect(await readFile(join(folder, 'ForeverLedger_Guides.toc'), 'utf8')).toContain(
      '## Interface: 16001',
    );
    const lua = await readFile(join(folder, 'Guides.lua'), 'utf8');
    expect(lua).toContain('npc = "Undertaker Mordo"');
    expect(lua).toContain('"Mindless Zombie slain: 8"');
    expect(acks).toEqual([[7]]);
    // Guide format 2: planned guides' travel steps included.
    expect(asked[0]).toBe(`${SERVER}/v1/guides?format=2`);
  });

  it('writes again only when the guides change; with none left, the addon goes', async () => {
    await sync();
    expect((await sync()).status).toBe('unchanged');
    expect(acks).toEqual([[7]]); // acked once
    served = [guide(8, 'Undead 5-13'), guide(7)];
    const r = await sync();
    expect(r).toMatchObject({ status: 'written', arrived: [{ id: 8 }], newFolder: false });
    served = [];
    expect((await sync()).status).toBe('removed');
    expect(await readdir(addons())).toEqual(['ForeverLedger']);
  });

  it('announces a guide once even while the ack keeps failing, and acks it later', async () => {
    let ackOk = false;
    const flaky = async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/v1/guides/ack') && !ackOk)
        return new Response('down', { status: 503 });
      return fetchImpl(url, init);
    };
    const run = () => syncGuides({ config, fetchImpl: flaky });
    expect((await run()).arrived).toHaveLength(1);
    expect((await run()).arrived).toHaveLength(0);
    expect(acks).toEqual([]);
    ackOk = true;
    await run();
    expect(acks).toEqual([[7]]);
  });

  it('rejects Lua keywords as field names', () => {
    expect(() => toLua({ end: 1 })).toThrow('not a Lua field name');
  });

  it('writes and acks nothing where ForeverLedger is not installed', async () => {
    await env.writeSv('ForeverLedgerDB = {}', 'ACC1');
    const bare = env.config({ serverUrl: SERVER, token: 'flt_x' });
    await rm(join(addons(), 'ForeverLedger'), { recursive: true });
    const r = await syncGuides({ config: bare, fetchImpl });
    expect(r).toMatchObject({ status: 'no-addon', arrived: [], addonsDirs: [] });
    expect(acks).toEqual([]);
  });
});
