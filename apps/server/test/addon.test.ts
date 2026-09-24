import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  ADDON_REPO,
  addonAssetName,
  addonDownloadUrl,
  AddonManifest,
  MAX_SUPPORTED_SCHEMA,
  NO_ADDON_RELEASE,
  SCHEMA_VERSION,
  tocVersion,
} from '@forever-ledger/contracts';
import { strToU8, zipSync } from 'fflate';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addonPins, addonReleases } from '../src/db/schema.js';
import {
  listAddon,
  pinVersion,
  publishRelease,
  resolveManifest,
  unpin,
  yankVersion,
} from '../src/index.js';
import { startServer } from './helpers.js';

type Server = Awaited<ReturnType<typeof startServer>>;

const sha = (c: string) => c.repeat(64);

let s: Server;
const get = (url: string, headers: Record<string, string> = s.auth) =>
  s.app.inject({ method: 'GET', url, headers });
const release = (
  version: string,
  status: 'active' | 'yanked' = 'active',
  schemaVersion: number | null = null,
) =>
  s.database.db.insert(addonReleases).values({
    version,
    url: addonDownloadUrl(version),
    sha256: sha('a'),
    size: 1234,
    status,
    schemaVersion,
  });
const pin = (buildMin: number, buildMax: number | null, version: string) =>
  s.database.db.insert(addonPins).values({ buildMin, buildMax, version });

beforeAll(async () => {
  s = await startServer();
});
afterAll(async () => {
  await s?.stop();
});
beforeEach(async () => {
  await s.database.db.delete(addonPins);
  await s.database.db.delete(addonReleases);
});

describe('addon manifest', () => {
  it('requires a token', async () => {
    expect((await get('/v1/addon/manifest', {})).statusCode).toBe(401);
  });

  it('404s with the no-release error when nothing is published', async () => {
    const res = await get('/v1/addon/manifest?build=69913');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: NO_ADDON_RELEASE });
  });

  it('serves the newest active release as a valid manifest', async () => {
    await release('0.2.9');
    await release('0.2.10');
    await release('0.1.99');
    const res = await get('/v1/addon/manifest?build=69913');
    expect(res.statusCode).toBe(200);
    expect(AddonManifest.parse(res.json())).toEqual({
      addon: 'ForeverLedger',
      version: '0.2.10',
      url: addonDownloadUrl('0.2.10'),
      sha256: sha('a'),
      size: 1234,
    });
  });

  it('skips yanked releases', async () => {
    await release('0.2.9');
    await release('0.2.10', 'yanked');
    expect((await resolveManifest(s.database.db, 69913))?.version).toBe('0.2.9');
    await s.database.pool.query(`update addon_releases set status = 'yanked'`);
    expect(await resolveManifest(s.database.db, 69913)).toBeNull();
  });

  it('prefers a pin covering the build', async () => {
    await release('0.2.0');
    await release('0.3.0');
    await pin(69900, 69920, '0.2.0');
    expect((await resolveManifest(s.database.db, 69913))?.version).toBe('0.2.0');
    expect((await resolveManifest(s.database.db, 69920))?.version).toBe('0.2.0');
    expect((await resolveManifest(s.database.db, 69921))?.version).toBe('0.3.0');
    expect((await resolveManifest(s.database.db, 69899))?.version).toBe('0.3.0');
    const res = await get('/v1/addon/manifest?build=69913');
    expect(res.json().version).toBe('0.2.0');
  });

  it('lets a newer pin beat an older overlapping one', async () => {
    await release('0.1.0');
    await release('0.2.0');
    await release('0.3.0');
    await pin(69000, 70000, '0.1.0');
    await pin(69900, 69920, '0.2.0');
    expect((await resolveManifest(s.database.db, 69913))?.version).toBe('0.2.0');
    expect((await resolveManifest(s.database.db, 69500))?.version).toBe('0.1.0');
  });

  it('ignores a pin to a yanked version', async () => {
    await release('0.2.0', 'yanked');
    await release('0.3.0');
    await pin(69900, 69920, '0.2.0');
    expect((await resolveManifest(s.database.db, 69913))?.version).toBe('0.3.0');
  });

  it('ignores pins without a build', async () => {
    await release('0.2.0');
    await release('0.3.0');
    await pin(1, null, '0.2.0');
    expect((await resolveManifest(s.database.db, null))?.version).toBe('0.3.0');
    expect((await get('/v1/addon/manifest')).json().version).toBe('0.3.0');
    // Anything but a positive integer counts as no build.
    expect((await get('/v1/addon/manifest?build=abc')).json().version).toBe('0.3.0');
    expect((await get('/v1/addon/manifest?build=-5')).json().version).toBe('0.3.0');
    // Out of int4 range: no pin can cover it, and Postgres must not see it.
    const huge = await get('/v1/addon/manifest?build=99999999999');
    expect(huge.statusCode).toBe(200);
    expect(huge.json().version).toBe('0.3.0');
  });

  it('honours open-ended pins', async () => {
    await release('0.2.0');
    await release('0.3.0');
    await pin(69913, null, '0.2.0');
    expect((await resolveManifest(s.database.db, 69912))?.version).toBe('0.3.0');
    expect((await resolveManifest(s.database.db, 69913))?.version).toBe('0.2.0');
    expect((await resolveManifest(s.database.db, 999999))?.version).toBe('0.2.0');
  });
});

describe('addon manifest schema gate', () => {
  const version = async (url: string) => {
    const res = await get(url);
    return res.statusCode === 200 ? (res.json() as { version: string }).version : res.json();
  };

  it('serves trays only releases whose schema they read (no ?schema= reads up to 5)', async () => {
    await release('0.3.2', 'active', null); // published before the gate: schema ≤ 5
    await release('0.3.3', 'active', null);
    await release('0.3.4', 'active', 6);
    // Tray 0.1.4 sends no schema: it reads up to 5 and must never get 0.3.4.
    expect(await version('/v1/addon/manifest?build=69913')).toBe('0.3.3');
    expect(await version('/v1/addon/manifest')).toBe('0.3.3');
    expect(await version('/v1/addon/manifest?build=69913&schema=5')).toBe('0.3.3');
    // Tray 0.1.5 reads up to 6 (and a future tray more).
    expect(await version('/v1/addon/manifest?build=69913&schema=6')).toBe('0.3.4');
    expect(await version('/v1/addon/manifest?schema=7')).toBe('0.3.4');
    // Anything but a positive integer counts as a tray that doesn't send it.
    for (const bad of ['abc', '0', '-6', '6.5', '']) {
      expect(await version(`/v1/addon/manifest?build=69913&schema=${bad}`), bad).toBe('0.3.3');
    }
    // An explicit schema 5 is as good as a legacy null.
    await release('0.3.5', 'active', 5);
    expect(await version('/v1/addon/manifest?schema=5')).toBe('0.3.5');
    expect(await version('/v1/addon/manifest?schema=6')).toBe('0.3.5');
  });

  it('404s with the no-release error only when no release fits', async () => {
    await release('0.3.4', 'active', 6);
    await release('0.4.0', 'active', 7);
    const res = await get('/v1/addon/manifest?build=69913');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: NO_ADDON_RELEASE });
    expect(await version('/v1/addon/manifest?schema=6')).toBe('0.3.4');
    expect(await version('/v1/addon/manifest?schema=7')).toBe('0.4.0');
    expect(await resolveManifest(s.database.db, null)).toBeNull(); // the function defaults to 5 too
  });

  it('falls back from a pin whose release needs a newer schema to the newest release that fits', async () => {
    await release('0.3.2', 'active', null);
    await release('0.3.3', 'active', null);
    await release('0.3.4', 'active', 6);
    await pin(69000, 70000, '0.3.2'); // an older, compatible pin: superseded by the next one
    await pin(69900, 69920, '0.3.4');
    const db = s.database.db;
    expect((await resolveManifest(db, 69913, 6))?.version).toBe('0.3.4');
    expect((await resolveManifest(db, 69913, 5))?.version).toBe('0.3.3');
    expect(await version('/v1/addon/manifest?build=69913')).toBe('0.3.3');
    expect(await version('/v1/addon/manifest?build=69913&schema=6')).toBe('0.3.4');
    // Outside the newer pin, the older compatible pin still holds for both trays.
    expect((await resolveManifest(db, 69500, 5))?.version).toBe('0.3.2');
    expect((await resolveManifest(db, 69500, 6))?.version).toBe('0.3.2');
    // Nothing fits at all: 404.
    await yankVersion(db, '0.3.3');
    await yankVersion(db, '0.3.2');
    expect(await resolveManifest(db, 69913, 5)).toBeNull();
    expect((await get('/v1/addon/manifest?build=69913')).statusCode).toBe(404);
  });

  it('keeps a compatible pin for old and new trays alike', async () => {
    await release('0.3.2', 'active', null);
    await release('0.3.4', 'active', 6);
    await pin(69900, 69920, '0.3.2');
    expect(await version('/v1/addon/manifest?build=69913')).toBe('0.3.2');
    expect(await version('/v1/addon/manifest?build=69913&schema=6')).toBe('0.3.2');
    expect(await version('/v1/addon/manifest?build=69921&schema=6')).toBe('0.3.4');
    expect(await version('/v1/addon/manifest?build=69921')).toBe('0.3.2');
  });
});

const hex = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const addonZip = (
  tocVersion: string,
  lua = `local VERSION = "${tocVersion}"\nlocal SCHEMA_VERSION = 5\n`,
) =>
  zipSync({
    ForeverLedger: {
      'ForeverLedger.toc': strToU8(
        `## Interface: 16001\n## Version: ${tocVersion}\nForeverLedger.lua\n`,
      ),
      'ForeverLedger.lua': strToU8(lua),
    },
  });

interface FakeAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

/** A GitHub stand-in serving one release (or a 404) and its asset bytes. */
function fakeGitHub(
  version: string,
  opts: { zip?: Uint8Array; assets?: FakeAsset[]; releaseStatus?: number } = {},
) {
  const zip = opts.zip ?? addonZip(version);
  const assets = opts.assets ?? [
    {
      name: addonAssetName(version),
      browser_download_url: addonDownloadUrl(version),
      size: zip.length,
    },
  ];
  const calls: { url: string; headers: Headers }[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init?.headers) });
    if (url === `https://api.github.com/repos/${ADDON_REPO}/releases/tags/addon-v${version}`) {
      if (opts.releaseStatus) {
        return Response.json({ message: 'Not Found' }, { status: opts.releaseStatus });
      }
      return Response.json({ tag_name: `addon-v${version}`, assets });
    }
    if (assets.some((a) => a.browser_download_url === url)) return new Response(Buffer.from(zip));
    return new Response('not found', { status: 404 });
  };
  return { fetchImpl: fetchImpl as typeof fetch, calls, zip };
}

describe('addon admin', () => {
  const publish = (version: string, gh: ReturnType<typeof fakeGitHub>, token?: string) =>
    publishRelease(s.database.db, version, { repo: ADDON_REPO, fetchImpl: gh.fetchImpl, token });

  it('publishes a GitHub release asset with its computed sha256', async () => {
    const gh = fakeGitHub('0.3.0');
    const manifest = await publish('0.3.0', gh);
    expect(manifest).toEqual({
      addon: 'ForeverLedger',
      version: '0.3.0',
      url: addonDownloadUrl('0.3.0'),
      sha256: hex(gh.zip),
      size: gh.zip.length,
    });
    expect(await resolveManifest(s.database.db, null)).toEqual(manifest);
    expect(gh.calls.map((c) => c.url)).toEqual([
      `https://api.github.com/repos/${ADDON_REPO}/releases/tags/addon-v0.3.0`,
      addonDownloadUrl('0.3.0'),
    ]);
    const api = gh.calls[0]!.headers;
    expect(api.get('accept')).toBe('application/vnd.github+json');
    expect(api.get('user-agent')).toBe('forever-ledger-server');
    expect(api.get('authorization')).toBeNull();
  });

  it('sends a GitHub token to the API only', async () => {
    const gh = fakeGitHub('0.3.0');
    await publish('0.3.0', gh, 'ghp_secret');
    expect(gh.calls[0]!.headers.get('authorization')).toBe('Bearer ghp_secret');
    expect(gh.calls[1]!.headers.get('authorization')).toBeNull();
  });

  it('rejects a bad version before calling GitHub', async () => {
    const gh = fakeGitHub('0.3.0');
    await expect(publish('v0.3.0', gh)).rejects.toThrow(/x\.y\.z/);
    await expect(publish('0.3.0/../../x', gh)).rejects.toThrow(/x\.y\.z/);
    expect(gh.calls).toHaveLength(0);
  });

  it('rejects a malformed repo before calling GitHub', async () => {
    const gh = fakeGitHub('0.3.0');
    await expect(
      publishRelease(s.database.db, '0.3.0', { repo: 'a/b/../c', fetchImpl: gh.fetchImpl }),
    ).rejects.toThrow(/owner\/name/);
    expect(gh.calls).toHaveLength(0);
  });

  it('throws when the tag has no GitHub release', async () => {
    const gh = fakeGitHub('0.3.0', { releaseStatus: 404 });
    await expect(publish('0.3.0', gh)).rejects.toThrow('no GitHub release addon-v0.3.0');
    expect(await s.count('addon_releases')).toBe(0);
  });

  it('throws when the release has no addon asset', async () => {
    const gh = fakeGitHub('0.3.0', {
      assets: [{ name: 'other.zip', browser_download_url: addonDownloadUrl('0.3.0'), size: 10 }],
    });
    await expect(publish('0.3.0', gh)).rejects.toThrow(/ForeverLedger-0\.3\.0\.zip/);
    expect(gh.calls).toHaveLength(1);
    expect(await s.count('addon_releases')).toBe(0);
  });

  it('refuses an asset served from anywhere but the expected download url', async () => {
    const gh = fakeGitHub('0.3.0', {
      assets: [
        {
          name: addonAssetName('0.3.0'),
          browser_download_url: 'https://evil.example/ForeverLedger-0.3.0.zip',
          size: 10,
        },
      ],
    });
    await expect(publish('0.3.0', gh)).rejects.toThrow(/download url/);
    expect(gh.calls).toHaveLength(1);
    expect(await s.count('addon_releases')).toBe(0);
  });

  it('refuses a tampered zip and stores nothing', async () => {
    const gh = fakeGitHub('0.3.0', { zip: addonZip('0.2.9') });
    await expect(publish('0.3.0', gh)).rejects.toThrow(/\.toc version 0\.2\.9/);
    expect(await s.count('addon_releases')).toBe(0);
  });

  it('republishes the same bytes idempotently but never swaps a version’s bytes', async () => {
    const gh = fakeGitHub('0.3.0');
    const first = await publish('0.3.0', gh);
    expect(await yankVersion(s.database.db, '0.3.0')).toBe(true);
    expect(await resolveManifest(s.database.db, null)).toBeNull();
    expect(await publish('0.3.0', gh)).toEqual(first); // re-activates
    expect(await resolveManifest(s.database.db, null)).toEqual(first);

    const other = fakeGitHub('0.3.0', {
      zip: zipSync({
        ForeverLedger: {
          'ForeverLedger.toc': strToU8('## Version: 0.3.0\n-- changed\n'),
          'ForeverLedger.lua': strToU8('local SCHEMA_VERSION = 6\n'),
        },
      }),
    });
    await expect(publish('0.3.0', other)).rejects.toThrow(/already published/);
    expect(await resolveManifest(s.database.db, null)).toEqual(first);
  });

  it('records the schema read from ForeverLedger.lua', async () => {
    await publish(
      '0.3.4',
      fakeGitHub('0.3.4', { zip: addonZip('0.3.4', 'local SCHEMA_VERSION = 6\n') }),
    );
    const legacyZip = addonZip('0.3.3', 'local SCHEMA_VERSION = 5\n');
    await publish('0.3.3', fakeGitHub('0.3.3', { zip: legacyZip }));
    const { releases } = await listAddon(s.database.db);
    expect(releases.map((r) => [r.version, r.schemaVersion])).toEqual([
      ['0.3.4', 6],
      ['0.3.3', 5],
    ]);
    expect((await resolveManifest(s.database.db, null, 5))?.version).toBe('0.3.3');
    expect((await resolveManifest(s.database.db, null, 6))?.version).toBe('0.3.4');
  });

  it('reads the schema of the real addon sources: 0.3.4 needs 6, 0.3.3 fits old trays', async () => {
    const src = (p: string) =>
      readFileSync(new URL(`../../../addon/${p}`, import.meta.url), 'utf8');
    const toc = tocVersion(src('ForeverLedger/ForeverLedger.toc'))!;
    const current = addonZip(toc, src('ForeverLedger/ForeverLedger.lua'));
    const legacy = addonZip('0.3.3', src('tests/legacy/ForeverLedger-0.3.3.lua'));
    await publish(toc, fakeGitHub(toc, { zip: current }));
    await publish('0.3.3', fakeGitHub('0.3.3', { zip: legacy }));
    const { releases } = await listAddon(s.database.db);
    expect(Object.fromEntries(releases.map((r) => [r.version, r.schemaVersion]))).toEqual({
      [toc]: SCHEMA_VERSION,
      '0.3.3': 5,
    });
    expect(await resolveManifest(s.database.db, 69913)).toMatchObject({ version: '0.3.3' });
    expect(await resolveManifest(s.database.db, 69913, MAX_SUPPORTED_SCHEMA)).toMatchObject({
      version: toc,
    });
  });

  it('refuses a release whose schema cannot be read, and stores nothing', async () => {
    for (const lua of [
      'local VERSION = "0.3.4"\n',
      'local SCHEMA_VERSION = 5 + 1\n',
      'local SCHEMA_VERSION = 6\nlocal SCHEMA_VERSION = 7\n',
      'SCHEMA_VERSION = 6\n',
    ]) {
      const gh = fakeGitHub('0.3.4', { zip: addonZip('0.3.4', lua) });
      await expect(publish('0.3.4', gh), lua).rejects.toThrow(/SCHEMA_VERSION/);
    }
    const noLua = zipSync({
      ForeverLedger: { 'ForeverLedger.toc': strToU8('## Version: 0.3.4\n') },
    });
    await expect(publish('0.3.4', fakeGitHub('0.3.4', { zip: noLua }))).rejects.toThrow(
      /no ForeverLedger\/ForeverLedger\.lua/,
    );
    expect(await s.count('addon_releases')).toBe(0);
  });

  it('records the schema of a legacy release when it is published again', async () => {
    const gh = fakeGitHub('0.3.3', { zip: addonZip('0.3.3', 'local SCHEMA_VERSION = 5\n') });
    await s.database.db.insert(addonReleases).values({
      version: '0.3.3',
      url: addonDownloadUrl('0.3.3'),
      sha256: hex(gh.zip),
      size: gh.zip.length,
      status: 'active',
    });
    expect((await listAddon(s.database.db)).releases[0]?.schemaVersion).toBeNull();
    await publish('0.3.3', gh);
    expect((await listAddon(s.database.db)).releases[0]?.schemaVersion).toBe(5);
  });

  it('pins, unpins and yanks', async () => {
    await release('0.2.0');
    await release('0.3.0');
    const db = s.database.db;
    const id = await pinVersion(db, 69900, 69920, '0.2.0');
    expect((await resolveManifest(db, 69913))?.version).toBe('0.2.0');
    expect(await unpin(db, id)).toBe(true);
    expect(await unpin(db, id)).toBe(false);
    expect((await resolveManifest(db, 69913))?.version).toBe('0.3.0');

    await pinVersion(db, 69913, null, '0.2.0');
    expect((await resolveManifest(db, 70000))?.version).toBe('0.2.0');
    expect(await yankVersion(db, '0.2.0')).toBe(true);
    expect(await yankVersion(db, '0.2.0')).toBe(false);
    expect(await yankVersion(db, '9.9.9')).toBe(false);
    expect((await resolveManifest(db, 70000))?.version).toBe('0.3.0');
  });

  it('validates pins', async () => {
    await release('0.2.0');
    const db = s.database.db;
    await expect(pinVersion(db, 69900, 69920, '0.9.0')).rejects.toThrow(/no release 0\.9\.0/);
    await expect(pinVersion(db, 69920, 69900, '0.2.0')).rejects.toThrow(/build range/);
    await expect(pinVersion(db, 0, null, '0.2.0')).rejects.toThrow(/build range/);
    await expect(pinVersion(db, 1.5, null, '0.2.0')).rejects.toThrow(/build range/);
    expect(await s.count('addon_pins')).toBe(0);
  });

  it('lists releases newest first and pins', async () => {
    await release('0.2.9');
    await release('0.2.10', 'yanked');
    await pinVersion(s.database.db, 69913, null, '0.2.9');
    const { releases, pins } = await listAddon(s.database.db);
    expect(releases.map((r) => [r.version, r.status])).toEqual([
      ['0.2.10', 'yanked'],
      ['0.2.9', 'active'],
    ]);
    expect(pins).toMatchObject([{ buildMin: 69913, buildMax: null, version: '0.2.9' }]);
  });
});
