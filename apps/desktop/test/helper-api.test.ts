import { describe, expect, it } from 'vitest';
import { helperApi, HelperApiError } from '../src/main/helper/api.js';

function fakeFetch(answers: Record<string, { status: number; body: unknown }>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const a = answers[new URL(url).pathname]!;
    return new Response(JSON.stringify(a.body), { status: a.status });
  };
  return { fn, calls };
}

describe('fetch helper server calls', () => {
  it('enrolls with the upload token and keeps the helper token', async () => {
    const f = fakeFetch({
      '/v1/fetch/enroll': { status: 201, body: { token: 'flt_helper', status: 'pending' } },
    });
    const api = helperApi('https://ledger.example', f.fn);
    expect(await api.enroll('flt_upload', 'pc-1')).toBe('flt_helper');
    expect((f.calls[0]!.init.headers as Record<string, string>).authorization).toBe(
      'Bearer flt_upload',
    );
  });

  it('turns a pending or paused 403 into a refusal, and leases one page at a time', async () => {
    const pending = fakeFetch({
      '/v1/fetch/lease': { status: 403, body: { error: 'x', status: 'pending' } },
    });
    expect(await helperApi('https://ledger.example', pending.fn).lease('flt_h', 'pc-1')).toEqual({
      refused: 'pending',
      leases: [],
    });
    const ok = fakeFetch({
      '/v1/fetch/lease': {
        status: 200,
        body: { leases: [{ url: 'https://www.wowhead.com/forever/npc=1' }] },
      },
    });
    await helperApi('https://ledger.example', ok.fn).lease('flt_h', 'pc-1');
    expect(JSON.parse(String(ok.calls[0]!.init.body))).toEqual({ worker: 'pc-1', max: 1 });
  });

  it('throws on other failures', async () => {
    const f = fakeFetch({
      '/v1/fetch/lease': { status: 401, body: { error: 'invalid or revoked token' } },
    });
    await expect(
      helperApi('https://ledger.example', f.fn).lease('flt_h', 'pc-1'),
    ).rejects.toBeInstanceOf(HelperApiError);
  });
});
