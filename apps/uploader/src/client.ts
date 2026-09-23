import { IngestResponse } from '@forever-ledger/contracts';
import type { UploadBatch } from '@forever-ledger/contracts';
import { errorMessage } from './errors.js';

export type FetchLike = typeof fetch;

export type PostResult =
  | { kind: 'ok'; response: IngestResponse }
  /** 400: the server will never accept this batch. */
  | { kind: 'rejected'; status: number; message: string }
  /** 401/403: bad or revoked token. */
  | { kind: 'unauthorized'; status: number; message: string }
  /** 409: the server does not accept this schemaVersion. */
  | { kind: 'unsupported-schema'; status: number; message: string }
  /** 413: split and retry. */
  | { kind: 'too-large'; status: number; message: string }
  /** 429, 5xx, network errors, anything unexpected: keep queued, back off. */
  | { kind: 'retry'; status?: number; message: string };

export interface ClientOptions {
  serverUrl: string;
  token: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

/** `<status> <server message>` for an error response. */
export async function errorText(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const body = JSON.parse(text) as { message?: unknown; error?: unknown };
    const msg = body.message ?? body.error;
    if (typeof msg === 'string') return `${res.status} ${msg}`;
  } catch {
    // not JSON
  }
  return `${res.status} ${text.slice(0, 300) || res.statusText}`.trim();
}

export async function postBatch(batch: UploadBatch, opts: ClientOptions): Promise<PostResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(`${opts.serverUrl}/v1/ingest`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${opts.token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
    });
  } catch (err) {
    const cause = (err as { cause?: unknown }).cause;
    return {
      kind: 'retry',
      message: `network error: ${errorMessage(err)}${cause ? ` (${errorMessage(cause)})` : ''}`,
    };
  }

  const status = res.status;
  if (res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch (err) {
      return { kind: 'retry', status, message: `unreadable response: ${errorMessage(err)}` };
    }
    const parsed = IngestResponse.safeParse(body);
    if (!parsed.success)
      return { kind: 'retry', status, message: 'server response does not match IngestResponse' };
    return { kind: 'ok', response: parsed.data };
  }

  const message = await errorText(res);
  if (status === 400) return { kind: 'rejected', status, message };
  if (status === 401 || status === 403) return { kind: 'unauthorized', status, message };
  if (status === 409) return { kind: 'unsupported-schema', status, message };
  if (status === 413) return { kind: 'too-large', status, message };
  return { kind: 'retry', status, message };
}

/** `GET /v1/health` → true when the server answers `{ ok: true }`. */
export async function checkHealth(
  serverUrl: string,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 10_000,
): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetchImpl(`${serverUrl}/v1/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await res.json().catch(() => null)) as { ok?: unknown } | null;
    if (res.ok && body?.ok === true) return { ok: true, message: 'ok' };
    return { ok: false, message: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
}
