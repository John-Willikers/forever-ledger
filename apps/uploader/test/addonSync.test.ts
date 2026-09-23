import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { addonDownloadUrl, MAX_ADDON_BYTES } from '@forever-ledger/contracts';
import type { AddonManifest } from '@forever-ledger/contracts';
import { strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readInstalledVersion } from '../src/addonInstall.js';
import { readAddonSyncState, rollbackAddonEverywhere, syncAddon } from '../src/addonSync.js';
import type { FetchLike } from '../src/client.js';
import type { Config } from '../src/config.js';
import { ConfigError } from '../src/errors.js';
import { FAST_READ, tempEnv } from './helpers/fixtures.js';
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
  return { zip, manifest };
}

interface FakeServer {
  manifest: AddonManifest | null;
  manifestUrls: string[];
  downloads: number;
  /** Publishes `version` and makes it the recommended one. */
  recommend(version: string, patch?: Partial<AddonManifest>): void;
  serve(url: string, body: Uint8Array): void;
  fetchImpl: FetchLike;
}

/** Fake ledger server + GitHub: serves `manifest` and the zips of every published release. */
function fakeServer(): FakeServer {
  const zips = new Map<string, Uint8Array>();
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
          : Response.json({ error: 'no release' }, { status: 404 });
      }
      const zip = zips.get(url);
      if (!zip) return new Response('not found', { status: 404 });
      s.downloads++;
      return new Response(zip);
    },
  };
  return s;
}

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
});
