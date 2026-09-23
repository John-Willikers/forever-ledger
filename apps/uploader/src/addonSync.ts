import { join } from 'node:path';
import { ADDON_NAME, MAX_ADDON_BYTES, verifyAddonZip } from '@forever-ledger/contracts';
import { addonsDirFor, installAddon, readInstalledVersion, rollbackAddon } from './addonInstall.js';
import { AddonSyncError, fetchManifest } from './addonManifest.js';
import type { FetchLike } from './client.js';
import { requireServer } from './config.js';
import type { Config } from './config.js';
import { discoverSavedVariables } from './discover.js';
import type { SavedVariablesFile } from './discover.js';
import { ConfigError, errorMessage } from './errors.js';
import { readJsonIfExists, writeJsonAtomic } from './fsutil.js';
import { silentLogger } from './log.js';
import type { Logger } from './log.js';
import { readSavedVariable } from './reader.js';
import type { ReadOptions } from './reader.js';

export interface AddonSyncOptions {
  config: Config;
  fetchImpl?: FetchLike;
  logger?: Logger;
  /** Install even while paused after a manual rollback. */
  force?: boolean;
  /** Timings for reading SavedVariables (tests shorten them). */
  read?: ReadOptions;
}

export type AddonSyncStatus = 'up-to-date' | 'installed' | 'paused' | 'no-release' | 'error';

export interface AddonSyncResult {
  status: AddonSyncStatus;
  /** Version the server recommends for this client build. */
  recommended?: string;
  /** Version on disk after this run (first AddOns folder). */
  installed?: string;
  /** Client build sent to the server. */
  build?: number;
  addonsDirs: string[];
  /** Epoch seconds. */
  checkedAt: number;
  error?: string;
}

/** `<stateDir>/addon-sync.json`. */
export interface AddonSyncState {
  /** Set by a manual rollback: don't reinstall while the server still recommends this version. */
  pausedWhileRecommended?: string;
  last?: AddonSyncResult;
}

const statePath = (config: Config) => join(config.stateDir, 'addon-sync.json');

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export async function readAddonSyncState(config: Config): Promise<AddonSyncState> {
  const raw = await readJsonIfExists(statePath(config));
  return isObj(raw) ? (raw as AddonSyncState) : {};
}

function requireWowPath(config: Config): string {
  if (!config.wowPath)
    throw new ConfigError(
      `wowPath is not set in ${config.configPath} (run \`forever-ledger init\`)`,
    );
  return config.wowPath;
}

/** Interface/AddOns next to every WTF folder under wowPath, plus the SavedVariables files found. */
async function findAddonsDirs(config: Config, wowPath: string) {
  const d = await discoverSavedVariables(wowPath, { accounts: config.accounts });
  return { addonsDirs: [...new Set(d.wtfDirs.map(addonsDirFor))], files: d.files };
}

/** Highest `meta.build` among the SavedVariables files; files that can't be read are skipped. */
async function clientBuild(
  files: SavedVariablesFile[],
  read: ReadOptions | undefined,
  logger: Logger,
): Promise<number | undefined> {
  let best: number | undefined;
  for (const sv of files) {
    try {
      const { value } = await readSavedVariable(sv.file, { ...read, logger });
      const build = isObj(value) && isObj(value.meta) ? value.meta.build : undefined;
      if (typeof build === 'number' && Number.isInteger(build) && build >= 0)
        best = Math.max(best ?? build, build);
    } catch (err) {
      logger.debug({ file: sv.file, err: errorMessage(err) }, 'no client build from this file');
    }
  }
  return best;
}

/** Downloads the release zip, refusing non-2xx answers and bodies over MAX_ADDON_BYTES. */
async function download(url: string, fetchImpl: FetchLike): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(120_000) });
  } catch (err) {
    throw new AddonSyncError(`addon download failed: ${errorMessage(err)}`);
  }
  if (!res.ok) throw new AddonSyncError(`addon download failed: HTTP ${res.status} (${url})`);
  const tooLarge = () =>
    new AddonSyncError(`addon download is too large (over ${MAX_ADDON_BYTES} bytes)`);
  if (Number(res.headers.get('content-length')) > MAX_ADDON_BYTES) {
    await res.body?.cancel();
    throw tooLarge();
  }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_ADDON_BYTES) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * One addon sync: asks the server which version this client build should run and installs it into every AddOns
 * folder that has a different version. Network, zip and disk problems come back as status `error` (retry next
 * cycle); only a missing server/wowPath throws (ConfigError). The result is saved to addon-sync.json.
 */
export async function syncAddon(opts: AddonSyncOptions): Promise<AddonSyncResult> {
  const { config } = opts;
  const logger = opts.logger ?? silentLogger();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const { serverUrl, token } = requireServer(config);
  const wowPath = requireWowPath(config);

  const result: AddonSyncResult = {
    status: 'error',
    addonsDirs: [],
    checkedAt: Math.floor(Date.now() / 1000),
  };
  let state: AddonSyncState = {};
  try {
    state = await readAddonSyncState(config);
    const found = await findAddonsDirs(config, wowPath);
    result.addonsDirs = found.addonsDirs;
    if (found.addonsDirs.length === 0)
      throw new AddonSyncError(`no WTF folder found under ${wowPath} — start the game once`);
    result.build = await clientBuild(found.files, opts.read, logger);

    const manifest = await fetchManifest({ serverUrl, token, build: result.build, fetchImpl });
    if (!manifest) {
      result.status = 'no-release';
    } else {
      result.recommended = manifest.version;
      if (state.pausedWhileRecommended === manifest.version && !opts.force) {
        result.status = 'paused';
      } else {
        let files: Map<string, Uint8Array> | undefined;
        result.status = 'up-to-date';
        for (const dir of found.addonsDirs) {
          if ((await readInstalledVersion(dir)) === manifest.version) continue;
          files ??= verifyAddonZip(await download(manifest.url, fetchImpl), manifest);
          await installAddon(dir, files);
          result.status = 'installed';
          logger.info({ dir, version: manifest.version }, 'addon installed');
        }
        // The server now recommends something else, or the user forced this version: resume auto-update.
        delete state.pausedWhileRecommended;
      }
    }
  } catch (err) {
    result.status = 'error';
    result.error = errorMessage(err);
    logger.warn({ err: result.error }, 'addon sync failed');
  }

  const first = result.addonsDirs[0];
  if (first) result.installed = await readInstalledVersion(first).catch(() => undefined);
  try {
    await writeJsonAtomic(statePath(config), { ...state, last: result });
  } catch (err) {
    logger.warn({ err: errorMessage(err) }, 'cannot save addon sync state');
  }
  return result;
}

/**
 * Restores ForeverLedger.bak in every AddOns folder that has one and pauses auto-update until the server recommends
 * a different version. Returns the restored version.
 */
export async function rollbackAddonEverywhere(opts: { config: Config }): Promise<string> {
  const { config } = opts;
  const wowPath = requireWowPath(config);
  const { addonsDirs } = await findAddonsDirs(config, wowPath);
  const state = await readAddonSyncState(config);

  let restored: string | undefined;
  let replaced: string | undefined;
  for (const dir of addonsDirs) {
    if (!(await readInstalledVersion(dir, `${ADDON_NAME}.bak`))) continue;
    replaced ??= await readInstalledVersion(dir);
    const version = await rollbackAddon(dir);
    restored ??= version;
  }
  if (!restored) throw new AddonSyncError(`no previous version to roll back to under ${wowPath}`);

  // Without a recorded recommendation, the version just rolled back from is the best guess.
  const paused = state.last?.recommended ?? replaced;
  await writeJsonAtomic(statePath(config), { ...state, pausedWhileRecommended: paused });
  return restored;
}
