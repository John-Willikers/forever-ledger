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
});

describe('syncGuides', () => {
  let env: TempEnv;
  let config: Config;
  let served: GuideDoc[];
  let acks: number[][];
  const addons = () => join(env.wowPath, '_classic_era_', 'Interface', 'AddOns');
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('/v1/guides')) return Response.json({ guides: served });
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
  });
  afterEach(() => env.cleanup());

  it('writes the guides addon next to ForeverLedger and acks the new guide', async () => {
    const r = await sync();
    expect(r).toMatchObject({ status: 'written', arrived: [{ id: 7, title: 'Undead 1-13' }] });
    const folder = join(addons(), GUIDES_ADDON);
    expect((await readdir(folder)).sort()).toEqual(['ForeverLedger_Guides.toc', 'Guides.lua']);
    expect(await readFile(join(folder, 'ForeverLedger_Guides.toc'), 'utf8')).toContain(
      '## Interface: 16001',
    );
    const lua = await readFile(join(folder, 'Guides.lua'), 'utf8');
    expect(lua).toContain('npc = "Undertaker Mordo"');
    expect(lua).toContain('"Mindless Zombie slain: 8"');
    expect(acks).toEqual([[7]]);
  });

  it('writes again only when the guides change; with none left, the addon goes', async () => {
    await sync();
    expect((await sync()).status).toBe('unchanged');
    expect(acks).toEqual([[7]]); // acked once
    served = [guide(8, 'Undead 5-13'), guide(7)];
    const r = await sync();
    expect(r).toMatchObject({ status: 'written', arrived: [{ id: 8 }] });
    served = [];
    expect((await sync()).status).toBe('removed');
    expect(await readdir(addons())).toEqual(['ForeverLedger']);
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
