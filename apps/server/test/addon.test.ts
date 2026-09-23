import { createHash } from 'node:crypto';
import {
  ADDON_REPO,
  addonAssetName,
  addonDownloadUrl,
  AddonManifest,
  NO_ADDON_RELEASE,
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
const release = (version: string, status: 'active' | 'yanked' = 'active') =>
  s.database.db
    .insert(addonReleases)
    .values({ version, url: addonDownloadUrl(version), sha256: sha('a'), size: 1234, status });
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

const hex = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const addonZip = (tocVersion: string) =>
  zipSync({
    ForeverLedger: {
      'ForeverLedger.toc': strToU8(
        `## Interface: 16001\n## Version: ${tocVersion}\nForeverLedger.lua\n`,
      ),
      'ForeverLedger.lua': strToU8(`local VERSION = "${tocVersion}"\n`),
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
        ForeverLedger: { 'ForeverLedger.toc': strToU8('## Version: 0.3.0\n-- changed\n') },
      }),
    });
    await expect(publish('0.3.0', other)).rejects.toThrow(/already published/);
    expect(await resolveManifest(s.database.db, null)).toEqual(first);
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
