// The helper's calls to the ledger server. Enrollment uses the tray's upload token; everything else the helper token.
import type { FetchReport } from '@forever-ledger/contracts';
import type { Budget, LeaseAnswer } from './core.js';

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 30_000;

export class HelperApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function helperApi(serverUrl: string, fetchFn: FetchFn = fetch) {
  const call = async (path: string, token: string, method: 'GET' | 'POST', body?: unknown) => {
    const res = await fetchFn(new URL(path, serverUrl).toString(), {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, json };
  };
  return {
    /** Asks for a helper token with the tray's upload token; it waits for approval before it can fetch. */
    async enroll(uploadToken: string, worker: string): Promise<string> {
      const r = await call('/v1/fetch/enroll', uploadToken, 'POST', { worker });
      if (r.status !== 201 || typeof r.json.token !== 'string') {
        throw new HelperApiError(r.status, String(r.json.error ?? `enroll failed (${r.status})`));
      }
      return r.json.token;
    },
    async lease(token: string, worker: string): Promise<LeaseAnswer> {
      const r = await call('/v1/fetch/lease', token, 'POST', { worker, max: 1 });
      if (r.status === 403 && (r.json.status === 'pending' || r.json.status === 'paused')) {
        return { refused: r.json.status, leases: [] };
      }
      if (r.status === 401) return { refused: 'revoked', leases: [] };
      if (r.status !== 200) {
        throw new HelperApiError(r.status, String(r.json.error ?? `lease failed (${r.status})`));
      }
      return {
        leases: (r.json.leases as { url: string }[]) ?? [],
        budget: r.json.budget as Budget | undefined,
      };
    },
    /** Gives the helper key back: the ledger revokes it (turning the helper off). */
    async unenroll(token: string): Promise<void> {
      const r = await call('/v1/fetch/unenroll', token, 'POST', {});
      if (r.status !== 200 && r.status !== 401) {
        throw new HelperApiError(r.status, String(r.json.error ?? `unenroll failed (${r.status})`));
      }
    },
    async report(token: string, report: FetchReport): Promise<{ result?: string }> {
      const r = await call('/v1/fetch/snapshots', token, 'POST', report);
      if (r.status >= 500) throw new HelperApiError(r.status, `server error (${r.status})`);
      return { result: typeof r.json.result === 'string' ? r.json.result : undefined };
    },
  };
}
