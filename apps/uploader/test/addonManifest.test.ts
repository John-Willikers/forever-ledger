import { addonDownloadUrl, NO_ADDON_RELEASE } from '@forever-ledger/contracts';
import { describe, expect, it } from 'vitest';
import { AddonSyncError, fetchManifest } from '../src/addonManifest.js';
import type { FetchLike } from '../src/client.js';

const manifest = {
  addon: 'ForeverLedger',
  version: '0.2.1',
  url: addonDownloadUrl('0.2.1'),
  sha256: 'a'.repeat(64),
  size: 1234,
};

/** Records every request and answers with `reply`. */
function stub(reply: () => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    calls.push({ url: String(input), init });
    return reply();
  };
  return { calls, fetchImpl };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const base = { serverUrl: 'https://ledger.test', token: 'flt_x' };

describe('fetchManifest', () => {
  it('sends the bearer token and the build', async () => {
    const { calls, fetchImpl } = stub(() => json(manifest));
    await expect(fetchManifest({ ...base, build: 69913, fetchImpl })).resolves.toEqual(manifest);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://ledger.test/v1/addon/manifest?build=69913');
    expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe('Bearer flt_x');
  });

  it('omits build when it is unknown', async () => {
    const { calls, fetchImpl } = stub(() => json(manifest));
    await fetchManifest({ ...base, fetchImpl });
    expect(calls[0]?.url).toBe('https://ledger.test/v1/addon/manifest');
  });

  it('returns null on the server 404 for "no release yet"', async () => {
    const { fetchImpl } = stub(() => json({ error: NO_ADDON_RELEASE }, 404));
    await expect(fetchManifest({ ...base, fetchImpl })).resolves.toBeNull();
  });

  it('throws on any other 404 (wrong serverUrl, route not deployed)', async () => {
    const { fetchImpl } = stub(() =>
      json({ message: 'Route GET:/v1/addon/manifest not found' }, 404),
    );
    const err = await fetchManifest({ ...base, fetchImpl }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AddonSyncError);
    expect((err as Error).message).toContain('https://ledger.test/v1/addon/manifest');
    const html = stub(() => new Response('<h1>Not Found</h1>', { status: 404 }));
    await expect(fetchManifest({ ...base, fetchImpl: html.fetchImpl })).rejects.toThrow(/404/);
  });

  it('throws on 401', async () => {
    const { fetchImpl } = stub(() => json({ error: 'bad token' }, 401));
    const err = await fetchManifest({ ...base, fetchImpl }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AddonSyncError);
    expect((err as Error).message).toMatch(/token/);
  });

  it('throws on a body that is not a manifest', async () => {
    const { fetchImpl } = stub(() => json({ ...manifest, url: 'https://evil.test/x.zip' }));
    await expect(fetchManifest({ ...base, fetchImpl })).rejects.toThrow();
  });

  it('throws on 500 with the status', async () => {
    const { fetchImpl } = stub(() => json({ error: 'boom' }, 500));
    const err = await fetchManifest({ ...base, fetchImpl }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AddonSyncError);
    expect((err as Error).message).toMatch(/500/);
  });

  it('throws AddonSyncError on network errors', async () => {
    const { fetchImpl } = stub(() => {
      throw new TypeError('fetch failed');
    });
    const err = await fetchManifest({ ...base, fetchImpl }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AddonSyncError);
    expect((err as Error).message).toMatch(/fetch failed/);
  });
});
