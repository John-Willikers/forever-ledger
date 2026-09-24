import { AddonManifest, MAX_SUPPORTED_SCHEMA, NO_ADDON_RELEASE } from '@forever-ledger/contracts';
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
  /**
   * Newest SavedVariables schema this uploader reads (default: the newest of contracts' SUPPORTED_SCHEMA_VERSIONS).
   * The server only hands out addon releases that write it or older, so an auto-update never installs an addon whose
   * files this uploader would refuse.
   */
  schema?: number;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

/** The `error` string of a JSON error body, if any. */
function errorField(text: string): unknown {
  try {
    return (JSON.parse(text) as { error?: unknown } | null)?.error;
  } catch {
    return undefined;
  }
}

/**
 * `GET /v1/addon/manifest?[build=N&]schema=S` → the addon version to run, or null when no release this uploader can
 * read is published.
 */
export async function fetchManifest(opts: ManifestOptions): Promise<AddonManifest | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const params = new URLSearchParams();
  if (opts.build !== undefined) params.set('build', String(opts.build));
  params.set('schema', String(opts.schema ?? MAX_SUPPORTED_SCHEMA));
  const url = `${opts.serverUrl}/v1/addon/manifest?${params}`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { authorization: `Bearer ${opts.token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    });
  } catch (err) {
    const cause = (err as { cause?: unknown }).cause;
    throw new AddonSyncError(
      `manifest request failed: ${errorMessage(err)}${cause ? ` (${errorMessage(cause)})` : ''}`,
    );
  }

  if (res.status === 404) {
    const text = await res.text().catch(() => '');
    if (errorField(text) === NO_ADDON_RELEASE) return null;
    throw new AddonSyncError(
      `manifest route not found at ${url} (404: check serverUrl): ${text.slice(0, 200)}`,
    );
  }
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
