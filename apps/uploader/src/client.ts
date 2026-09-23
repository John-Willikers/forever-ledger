import { DiagnosticsResponse, IngestResponse } from '@forever-ledger/contracts';
import type { DiagnosticsReport, UploadBatch } from '@forever-ledger/contracts';
import { errorMessage } from './errors.js';

export type FetchLike = typeof fetch;

export type PostResult =
  | { kind: 'ok'; response: IngestResponse }
  /** 400: the server will never accept this batch (`issues`: its validation issues, when it sent them). */
  | { kind: 'rejected'; status: number; message: string; issues?: ValidationIssue[] }
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

/** One zod issue as the server reports it. */
export interface ValidationIssue {
  path: string;
  message: string;
}

/** The first few `issues` of an error body, when well-formed. */
function readIssues(body: unknown): ValidationIssue[] | undefined {
  const raw = (body as { issues?: unknown } | null)?.issues;
  if (!Array.isArray(raw)) return undefined;
  const out = raw
    .filter(
      (i): i is ValidationIssue =>
        typeof i === 'object' &&
        i !== null &&
        typeof (i as ValidationIssue).path === 'string' &&
        typeof (i as ValidationIssue).message === 'string',
    )
    .slice(0, 5)
    .map((i) => ({ path: i.path.slice(0, 200), message: i.message.slice(0, 300) }));
  return out.length ? out : undefined;
}

/** `<status> <server message>` and any validation issues of an error response. */
async function errorBody(res: Response): Promise<{ message: string; issues?: ValidationIssue[] }> {
  const text = await res.text().catch(() => '');
  try {
    const body = JSON.parse(text) as { message?: unknown; error?: unknown };
    const msg = body.message ?? body.error;
    if (typeof msg === 'string') {
      const issues = readIssues(body);
      return { message: `${res.status} ${msg}`, ...(issues ? { issues } : {}) };
    }
  } catch {
    // not JSON
  }
  return { message: `${res.status} ${text.slice(0, 300) || res.statusText}`.trim() };
}

/** `<status> <server message>` for an error response. */
export async function errorText(res: Response): Promise<string> {
  return (await errorBody(res)).message;
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

  const { message, issues } = await errorBody(res);
  if (status === 400) return { kind: 'rejected', status, message, ...(issues ? { issues } : {}) };
  if (status === 401 || status === 403) return { kind: 'unauthorized', status, message };
  if (status === 409) return { kind: 'unsupported-schema', status, message };
  if (status === 413) return { kind: 'too-large', status, message };
  return { kind: 'retry', status, message };
}

export type DiagnosticsPostResult =
  | { kind: 'ok'; accepted: number }
  /** 400/413: this report will never be accepted; drop it. */
  | { kind: 'rejected'; status: number; message: string }
  /** 401/403: bad or revoked token. */
  | { kind: 'unauthorized'; status: number; message: string }
  /** 404 (older server), 429, 5xx, network errors: keep the events and try again later. */
  | { kind: 'retry'; status?: number; message: string };

/** `POST /v1/diagnostics`: the tray app's error report. */
export async function postDiagnostics(opts: {
  serverUrl: string;
  token: string;
  report: DiagnosticsReport;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<DiagnosticsPostResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(`${opts.serverUrl}/v1/diagnostics`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${opts.token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(opts.report),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    });
  } catch (err) {
    return { kind: 'retry', message: `network error: ${errorMessage(err)}` };
  }
  const status = res.status;
  if (res.ok) {
    const body = (await res.json().catch(() => null)) as unknown;
    const parsed = DiagnosticsResponse.safeParse(body);
    if (!parsed.success)
      return {
        kind: 'retry',
        status,
        message: 'server response does not match DiagnosticsResponse',
      };
    return { kind: 'ok', accepted: parsed.data.accepted };
  }
  const message = await errorText(res);
  if (status === 400 || status === 413) return { kind: 'rejected', status, message };
  if (status === 401 || status === 403) return { kind: 'unauthorized', status, message };
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
