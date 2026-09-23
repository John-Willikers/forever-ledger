import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  readdir,
  rename as fsRename,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { addonDownloadUrl, MAX_ADDON_BYTES, NO_ADDON_RELEASE } from '@forever-ledger/contracts';
import type { AddonManifest } from '@forever-ledger/contracts';
import { strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installAddon, readInstalledVersion } from '../src/addonInstall.js';
import { readAddonSyncState, rollbackAddonEverywhere, syncAddon } from '../src/addonSync.js';
import type { FetchLike } from '../src/client.js';
import type { Config } from '../src/config.js';
import { ConfigError } from '../src/errors.js';
import { writeJsonAtomic } from '../src/fsutil.js';
import { runUploadPass } from '../src/pass.js';
import { StateStore } from '../src/state.js';
import { FAST_READ, readFixture, tempEnv } from './helpers/fixtures.js';
import type { TempEnv } from './helpers/fixtures.js';

const SERVER = 'https://ledger.test';
const SV = 'ForeverLedgerDB = { ["meta"] = { ["build"] = 69913, ["schemaVersion"] = 1 } }\n';

function release(version: string) {
  const zip = zipSync({
    'ForeverLedger/ForeverLedger.toc': strToU8(`## Interface: 11508\n## Version: ${version}\n`),
    'ForeverLedger/ForeverLedger.lua': strToU8(`-- ${version}`),
  });
  const manifest: AddonManifest = {
    addon: 'ForeverLedger',
    version,
    url: addonDownloadUrl(version),
    sha256: createHash('sha256').update(zip).digest('hex'),
    size: zip.length,
  };
  const files = new Map([
    ['ForeverLedger.toc', strToU8(`## Interface: 11508\n## Version: ${version}\n`)],
    ['ForeverLedger.lua', strToU8(`-- ${version}`)],
  ]);
  return { zip, manifest, files };
}

interface FakeServer {
  manifest: AddonManifest | null;
  manifestUrls: string[];
  downloads: number;
  /** Publishes `version` and makes it the recommended one. */
  recommend(version: string, patch?: Partial<AddonManifest>): void;
  serve(url: string, body: Uint8Array | (() => Response)): void;
  fetchImpl: FetchLike;
}

/** Fake ledger server + GitHub: serves `manifest` and the zips of every published release. */
function fakeServer(): FakeServer {
  const zips = new Map<string, Uint8Array | (() => Response)>();
  const s: FakeServer = {
    manifest: null,
    manifestUrls: [],
    downloads: 0,
    recommend(version: string, patch: Partial<AddonManifest> = {}) {
      const r = release(version);
      zips.set(r.manifest.url, r.zip);
      s.manifest = { ...r.manifest, ...patch };
    },
    serve(url: string, body: Uint8Array) {
      zips.set(url, body);
    },
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.startsWith(`${SERVER}/v1/addon/manifest`)) {
        s.manifestUrls.push(url);
        return s.manifest
          ? Response.json(s.manifest)
          : Response.json({ error: NO_ADDON_RELEASE }, { status: 404 });
      }
      const zip = zips.get(url);
      if (!zip) return new Response('not found', { status: 404 });
      s.downloads++;
      return typeof zip === 'function' ? zip() : new Response(zip);
    },
  };
  return s;
}

/** Writes a SavedVariables file for another flavor folder of the same install. */
async function writeFlavorSv(flavor: string, account = 'ACC1') {
  const dir = join(env.wowPath, flavor, 'WTF', 'Account', account, 'SavedVariables');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'ForeverLedger.lua'), SV);
}

const flavorAddons = (flavor: string) => join(env.wowPath, flavor, 'Interface', 'AddOns');
const writeState = (state: unknown) =>
  writeJsonAtomic(join(config.stateDir, 'addon-sync.json'), state);

let env: TempEnv;
let config: Config;
let server: FakeServer;
let addonsDir: string;
const sync = (opts: { force?: boolean } = {}) =>
  syncAddon({ config, fetchImpl: server.fetchImpl, read: FAST_READ, ...opts });

beforeEach(async () => {
  env = await tempEnv();
  await env.writeSv(SV, 'ACC1');
  config = env.config({ serverUrl: SERVER, token: 'flt_x' });
  server = fakeServer();
  addonsDir = join(env.wowPath, '_classic_era_', 'Interface', 'AddOns');
});
afterEach(() => env.cleanup());

describe('syncAddon', () => {
  it('installs when the addon is missing and sends the client build', async () => {
    server.recommend('0.2.1');
    const r = await sync();
    expect(r).toMatchObject({
      status: 'installed',
      recommended: '0.2.1',
      installed: '0.2.1',
      build: 69913,
      addonsDirs: [addonsDir],
    });
    expect(r.checkedAt).toBeCloseTo(Date.now() / 1000, -1);
    expect(await readInstalledVersion(addonsDir)).toBe('0.2.1');
    expect(server.manifestUrls).toEqual([`${SERVER}/v1/addon/manifest?build=69913`]);
  });

  it('is up to date on the second run and does not download again', async () => {
    server.recommend('0.2.1');
    await sync();
    const r = await sync();
    expect(r.status).toBe('up-to-date');
    expect(r.installed).toBe('0.2.1');
    expect(server.downloads).toBe(1);
  });

  it('installs an older version when the server pins it', async () => {
    server.recommend('0.2.2');
    await sync();
    server.recommend('0.2.1');
    const r = await sync();
    expect(r.status).toBe('installed');
    expect(await readInstalledVersion(addonsDir)).toBe('0.2.1');
  });

  it('reports a sha256 mismatch and leaves the installed addon alone', async () => {
    server.recommend('0.2.1');
    await sync();
    server.recommend('0.2.2', { sha256: 'f'.repeat(64) });
    const r = await sync();
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/sha256/);
    expect(r.installed).toBe('0.2.1');
    expect(await readInstalledVersion(addonsDir)).toBe('0.2.1');
  });

  it('rejects a download bigger than the addon limit', async () => {
    server.recommend('0.2.1');
    server.serve(addonDownloadUrl('0.2.1'), new Uint8Array(MAX_ADDON_BYTES + 1));
    const r = await sync();
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/too large/);
    expect(await readInstalledVersion(addonsDir)).toBeUndefined();
  });

  it('reports a failed download', async () => {
    server.manifest = release('0.2.9').manifest; // never uploaded to the fake GitHub
    const r = await sync();
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/404/);
  });

  it('reports no-release when the server has nothing published', async () => {
    const r = await sync();
    expect(r.status).toBe('no-release');
    expect(r.addonsDirs).toEqual([addonsDir]);
  });

  it('omits build before the addon has written SavedVariables', async () => {
    const fresh = await tempEnv();
    try {
      await mkdir(join(fresh.wowPath, '_classic_era_', 'WTF'), { recursive: true });
      server.recommend('0.2.1');
      const r = await syncAddon({
        config: fresh.config({ serverUrl: SERVER, token: 'flt_x' }),
        fetchImpl: server.fetchImpl,
      });
      expect(r.status).toBe('installed');
      expect(r.build).toBeUndefined();
      expect(server.manifestUrls).toEqual([`${SERVER}/v1/addon/manifest`]);
    } finally {
      await fresh.cleanup();
    }
  });

  it('reports an error when there is no WTF folder', async () => {
    const empty = await tempEnv();
    try {
      await mkdir(empty.wowPath, { recursive: true });
      server.recommend('0.2.1');
      const r = await syncAddon({
        config: empty.config({ serverUrl: SERVER, token: 'flt_x' }),
        fetchImpl: server.fetchImpl,
      });
      expect(r.status).toBe('error');
      expect(r.error).toMatch(/no WTF folder found under .* start the game once/);
      expect(server.manifestUrls).toEqual([]);
    } finally {
      await empty.cleanup();
    }
  });

  it('throws ConfigError without a server', async () => {
    await expect(
      syncAddon({ config: { ...config, serverUrl: undefined }, fetchImpl: server.fetchImpl }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it('saves the last result', async () => {
    server.recommend('0.2.1');
    const r = await sync();
    expect((await readAddonSyncState(config)).last).toEqual(r);
  });

  it('pauses after a rollback until the server recommends another version', async () => {
    server.recommend('0.2.1');
    await sync();
    server.recommend('0.2.2');
    await sync();

    expect(await rollbackAddonEverywhere({ config })).toBe('0.2.1');
    expect(await readInstalledVersion(addonsDir)).toBe('0.2.1');
    expect((await readAddonSyncState(config)).pausedWhileRecommended).toBe('0.2.2');

    const paused = await sync();
    expect(paused).toMatchObject({ status: 'paused', recommended: '0.2.2', installed: '0.2.1' });
    expect(await readInstalledVersion(addonsDir)).toBe('0.2.1');

    server.recommend('0.2.3');
    const resumed = await sync();
    expect(resumed.status).toBe('installed');
    expect(await readInstalledVersion(addonsDir)).toBe('0.2.3');
    expect((await readAddonSyncState(config)).pausedWhileRecommended).toBeUndefined();
  });

  it('installs while paused when forced', async () => {
    server.recommend('0.2.1');
    await sync();
    server.recommend('0.2.2');
    await sync();
    await rollbackAddonEverywhere({ config });

    const r = await sync({ force: true });
    expect(r.status).toBe('installed');
    expect(await readInstalledVersion(addonsDir)).toBe('0.2.2');
    expect((await sync()).status).toBe('up-to-date');
  });

  it('refuses to roll back when there is no previous version', async () => {
    server.recommend('0.2.1');
    await sync();
    await expect(rollbackAddonEverywhere({ config })).rejects.toThrow(/no previous version/);
  });

  it('checks content-length before reading the download', async () => {
    server.recommend('0.2.1');
    server.serve(
      addonDownloadUrl('0.2.1'),
      () =>
        new Response(new Uint8Array(10), {
          headers: { 'content-length': String(MAX_ADDON_BYTES + 1) },
        }),
    );
    const r = await sync();
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/too large/);
  });

  it('treats a corrupt state file as empty', async () => {
    await mkdir(config.stateDir, { recursive: true });
    await writeFile(join(config.stateDir, 'addon-sync.json'), '{"pausedWhile');
    server.recommend('0.2.1');
    expect((await sync()).status).toBe('installed');
    expect((await readAddonSyncState(config)).last?.status).toBe('installed');
  });
});

describe('recovering an interrupted install', () => {
  /** What a crash (or two failed renames) between "current → .bak" and "staging → current" leaves behind. */
  async function halfInstalled() {
    await installAddon(addonsDir, release('0.2.1').files);
    await mkdir(join(addonsDir, '.ForeverLedger.new'));
    await writeFile(join(addonsDir, '.ForeverLedger.swap'), '');
    await fsRename(join(addonsDir, 'ForeverLedger'), join(addonsDir, 'ForeverLedger.bak'));
  }

  it('restores .bak before anything else, even while paused with no release', async () => {
    await halfInstalled();
    await writeState({ pausedWhileRecommended: '0.2.2' });
    const r = await sync();
    expect(r).toMatchObject({ status: 'no-release', installed: '0.2.1', recovered: [addonsDir] });
    expect(await readInstalledVersion(addonsDir)).toBe('0.2.1');
    expect((await sync()).recovered).toBeUndefined();
  });

  it('restores .bak while paused', async () => {
    await halfInstalled();
    await writeState({ pausedWhileRecommended: '0.2.2' });
    server.recommend('0.2.2');
    expect(await sync()).toMatchObject({ status: 'paused', installed: '0.2.1' });
  });

  it('restores .bak when the server is unreachable', async () => {
    await halfInstalled();
    const r = await syncAddon({
      config,
      read: FAST_READ,
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
    });
    expect(r).toMatchObject({ status: 'error', installed: '0.2.1' });
  });

  it('does not bring back an addon the user removed from an otherwise unused flavor', async () => {
    const other = flavorAddons('_classic_');
    await mkdir(join(env.wowPath, '_classic_', 'WTF'), { recursive: true });
    await installAddon(other, release('0.2.0').files);
    await installAddon(other, release('0.2.1').files);
    await rm(join(other, 'ForeverLedger'), { recursive: true });
    server.recommend('0.2.1');
    const r = await sync();
    expect(r.addonsDirs).toEqual([addonsDir]);
    expect(r.recovered).toBeUndefined();
    expect(await readdir(other)).toEqual(['ForeverLedger.bak']);
  });
});

describe('which AddOns folders', () => {
  it('installs into every flavor that uses the addon with a single download', async () => {
    await writeFlavorSv('_classic_');
    server.recommend('0.2.1');
    const r = await sync();
    expect(r.status).toBe('installed');
    expect(r.addonsDirs).toEqual([flavorAddons('_classic_'), addonsDir]);
    expect(await readInstalledVersion(flavorAddons('_classic_'))).toBe('0.2.1');
    expect(await readInstalledVersion(addonsDir)).toBe('0.2.1');
    expect(server.downloads).toBe(1);
  });

  it('leaves flavors alone that never ran the addon', async () => {
    await mkdir(join(env.wowPath, '_classic_', 'WTF'), { recursive: true });
    await writeFlavorSv('_anniversary_', 'OTHER'); // an account the config does not upload
    config = { ...config, accounts: ['ACC1'] };
    server.recommend('0.2.1');
    const r = await sync();
    expect(r.addonsDirs).toEqual([addonsDir]);
    expect(await readInstalledVersion(addonsDir)).toBe('0.2.1');
    expect(await readdir(join(env.wowPath, '_classic_'))).toEqual(['WTF']);
    expect(await readdir(join(env.wowPath, '_anniversary_'))).toEqual(['WTF']);
  });

  it('keeps updating a flavor where the addon is installed', async () => {
    await mkdir(join(env.wowPath, '_classic_', 'WTF'), { recursive: true });
    await installAddon(flavorAddons('_classic_'), release('0.2.0').files);
    server.recommend('0.2.1');
    const r = await sync();
    expect(r.addonsDirs).toEqual([flavorAddons('_classic_'), addonsDir]);
    expect(await readInstalledVersion(flavorAddons('_classic_'))).toBe('0.2.1');
  });

  it('refuses to guess between several flavors on a first run', async () => {
    const fresh = await tempEnv();
    try {
      for (const flavor of ['_classic_', '_classic_era_'])
        await mkdir(join(fresh.wowPath, flavor, 'WTF'), { recursive: true });
      server.recommend('0.2.1');
      const r = await syncAddon({
        config: fresh.config({ serverUrl: SERVER, token: 'flt_x' }),
        fetchImpl: server.fetchImpl,
      });
      expect(r.status).toBe('error');
      expect(r.error).toMatch(/several WoW flavors found/);
      expect(server.downloads).toBe(0);
    } finally {
      await fresh.cleanup();
    }
  });

  it('skips a linked addon folder and reports it', async (ctx) => {
    const checkout = join(env.dir, 'checkout');
    await mkdir(checkout);
    await writeFile(join(checkout, 'ForeverLedger.toc'), '## Version: 9.9.9\n');
    await mkdir(addonsDir, { recursive: true });
    try {
      await symlink(checkout, join(addonsDir, 'ForeverLedger'), 'junction');
    } catch {
      return ctx.skip();
    }
    server.recommend('0.2.1');
    const r = await sync();
    expect(r).toMatchObject({ status: 'up-to-date', skipped: [addonsDir], installed: '9.9.9' });
    expect((await lstat(join(addonsDir, 'ForeverLedger'))).isSymbolicLink()).toBe(true);
    expect(server.downloads).toBe(0);
  });
});

describe('rollback across folders', () => {
  it('keeps the pause when one folder fails to roll back', async () => {
    await writeFlavorSv('_classic_');
    server.recommend('0.2.1');
    await sync();
    server.recommend('0.2.2');
    await sync();

    const other = flavorAddons('_classic_');
    const rename = async (from: string, to: string) => {
      if (from.startsWith(other)) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      await fsRename(from, to);
    };
    await expect(rollbackAddonEverywhere({ config, installDeps: { rename } })).rejects.toThrow(
      /rolled back to 0\.2\.1 in 1 of 2 .*busy/s,
    );
    expect(await readInstalledVersion(addonsDir)).toBe('0.2.1');
    expect(await readInstalledVersion(other)).toBe('0.2.2');
    expect((await readAddonSyncState(config)).pausedWhileRecommended).toBe('0.2.2');
  });
});

describe('concurrent runs', () => {
  it('serializes two syncs: one download, one install', async () => {
    server.recommend('0.2.1');
    const [a, b] = await Promise.all([sync(), sync()]);
    expect([a.status, b.status].sort()).toEqual(['installed', 'up-to-date']);
    expect(server.downloads).toBe(1);
    expect(await readdir(addonsDir)).toEqual(['ForeverLedger']);
  });

  it('keeps disk and pause in agreement when a sync races a rollback', async () => {
    server.recommend('0.2.1');
    await sync();
    server.recommend('0.2.2');
    await sync();
    const [, restored] = await Promise.all([sync(), rollbackAddonEverywhere({ config })]);
    expect(restored).toBe('0.2.1');
    expect(await readInstalledVersion(addonsDir)).toBe('0.2.1');
    expect((await readAddonSyncState(config)).pausedWhileRecommended).toBe('0.2.2');
    expect((await sync()).status).toBe('paused');
  });
});

describe('client build', () => {
  it('uses the build recorded by the upload pass instead of parsing SavedVariables', async () => {
    // Whole seconds: utimes can't reproduce a sub-millisecond mtime exactly.
    const readAt = new Date('2026-09-01T12:00:00Z');
    const file = await env.writeSv(await readFixture('session-v1.lua'), 'ACC1'); // meta.build 61600
    await utimes(file, readAt, readAt);
    // The upload pass records the build even when the server is down.
    await runUploadPass({
      config: { ...config, serverUrl: 'http://127.0.0.1:9' },
      read: FAST_READ,
    });
    expect((await StateStore.open(config.stateDir)).peek('ACC1')).toMatchObject({
      build: 61600,
      buildMtimeMs: readAt.getTime(),
    });

    // Same mtime as when the pass read it: the recorded build is used and the file is not parsed.
    await env.writeSv('not lua at all', 'ACC1');
    await utimes(file, readAt, readAt);
    server.recommend('0.2.1');
    const r = await sync();
    expect(r.build).toBe(61600);
    expect(server.manifestUrls).toEqual([`${SERVER}/v1/addon/manifest?build=61600`]);
  });

  it('re-reads SavedVariables that changed since the upload pass recorded the build', async () => {
    await env.writeSv(await readFixture('session-v1.lua'), 'ACC1'); // meta.build 61600
    await runUploadPass({
      config: { ...config, serverUrl: 'http://127.0.0.1:9' },
      read: FAST_READ,
    });
    await env.writeSv(SV, 'ACC1'); // the game patched: meta.build 69913
    const later = new Date(Date.now() + 60_000);
    await utimes(env.svFile('ACC1'), later, later);
    server.recommend('0.2.1');
    expect((await sync()).build).toBe(69913);
  });
});
