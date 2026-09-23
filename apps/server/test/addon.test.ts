import { addonDownloadUrl, AddonManifest, NO_ADDON_RELEASE } from '@forever-ledger/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addonPins, addonReleases } from '../src/db/schema.js';
import { resolveManifest } from '../src/index.js';
import { startServer } from './helpers.js';

type Server = Awaited<ReturnType<typeof startServer>>;

const sha = (c: string) => c.repeat(64);

describe('addon manifest', () => {
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
