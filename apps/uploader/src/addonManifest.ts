import { AddonManifest } from '@forever-ledger/contracts';
import { errorText } from './client.js';
import type { FetchLike } from './client.js';
import { errorMessage } from './errors.js';

/** Addon sync failed (server, network, download or install); retried on the next cycle. */
export class AddonSyncError extends Error {
  override name = 'AddonSyncError';
}

export interface ManifestOptions {
  serverUrl: string;
  token: string;
  /** Client build from SavedVariables; omitted before the addon has run once. */
  build?: number;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

/** `GET /v1/addon/manifest[?build=N]` → the addon version to run, or null when nothing is published yet. */
export async function fetchManifest(opts: ManifestOptions): Promise<AddonManifest | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const query = opts.build === undefined ? '' : `?build=${opts.build}`;
  let res: Response;
  try {
    res = await fetchImpl(`${opts.serverUrl}/v1/addon/manifest${query}`, {
      headers: { authorization: `Bearer ${opts.token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    });
  } catch (err) {
    const cause = (err as { cause?: unknown }).cause;
    throw new AddonSyncError(
      `manifest request failed: ${errorMessage(err)}${cause ? ` (${errorMessage(cause)})` : ''}`,
    );
  }

  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 403)
    throw new AddonSyncError(`token rejected by the server (${await errorText(res)})`);
  if (!res.ok) throw new AddonSyncError(`manifest request failed: ${await errorText(res)}`);

  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    throw new AddonSyncError(`unreadable manifest: ${errorMessage(err)}`);
  }
  const parsed = AddonManifest.safeParse(body);
  if (!parsed.success)
    throw new AddonSyncError(
      `server manifest is invalid: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
    );
  return parsed.data;
}
