import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ADDON_NAME, MAX_ADDON_BYTES, verifyAddonZip } from '@forever-ledger/contracts';
import {
  addonsDirFor,
  hasAddonFolder,
  installAddon,
  isAddonLinked,
  readInstalledVersion,
  recoverAddon,
  rollbackAddon,
} from './addonInstall.js';
import type { InstallDeps } from './addonInstall.js';
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
import { StateStore } from './state.js';

/** Folder operations used for install/rollback (tests inject failures). */
export type AddonFsDeps = Pick<InstallDeps, 'rename' | 'remove'>;

export interface AddonSyncOptions {
  config: Config;
  fetchImpl?: FetchLike;
  logger?: Logger;
  /** Install even while paused after a manual rollback. */
  force?: boolean;
  /** Timings for reading SavedVariables (tests shorten them). */
  read?: ReadOptions;
  installDeps?: AddonFsDeps;
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
  /** AddOns folders this sync manages. */
  addonsDirs: string[];
  /** AddOns folders restored from ForeverLedger.bak this run (an interrupted swap): WoW needs a /reload. */
  recovered?: string[];
  /** AddOns folders left alone because ForeverLedger there is a link (a developer checkout). */
  skipped?: string[];
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

/** Reads addon-sync.json; a missing or corrupt file reads as empty (a corrupt one is logged). */
export async function readAddonSyncState(
  config: Config,
  logger: Logger = silentLogger(),
): Promise<AddonSyncState> {
  let raw: unknown;
  try {
    raw = await readJsonIfExists(statePath(config));
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    logger.warn({ file: statePath(config), err: err.message }, 'ignoring corrupt addon sync state');
    return {};
  }
  return isObj(raw) ? (raw as AddonSyncState) : {};
}

/** Read-modify-write of addon-sync.json; only called under `serialized`. */
async function updateState(
  config: Config,
  logger: Logger,
  change: (state: AddonSyncState) => void,
): Promise<void> {
  const state = await readAddonSyncState(config, logger);
  change(state);
  await writeJsonAtomic(statePath(config), state);
}

/** Tail of the running sync/rollback per state folder: they touch the same AddOns folders and state file. */
const running = new Map<string, Promise<unknown>>();

/** Runs `fn` after every earlier sync/rollback for the same stateDir has finished (in this process). */
async function serialized<T>(config: Config, fn: () => Promise<T>): Promise<T> {
  const key = config.stateDir;
  const run = (running.get(key) ?? Promise.resolve()).then(fn, fn);
  const tail = run.catch(() => undefined);
  running.set(key, tail);
  try {
    return await run;
  } finally {
    if (running.get(key) === tail) running.delete(key);
  }
}

function requireWowPath(config: Config): string {
  if (!config.wowPath)
    throw new ConfigError(
      `wowPath is not set in ${config.configPath} (run \`forever-ledger init\`)`,
    );
  return config.wowPath;
}

/** Interface/AddOns next to every WTF folder under wowPath, plus the SavedVariables files found. */
async function discoverAddons(config: Config, wowPath: string) {
  const d = await discoverSavedVariables(wowPath, { accounts: config.accounts });
  const dirs = d.wtfDirs.map((wtfDir) => ({ wtfDir, addonsDir: addonsDirFor(wtfDir) }));
  return { dirs, files: d.files };
}

/**
 * The AddOns folders to manage: flavors where the addon is installed or has written SavedVariables for an uploaded
 * account. On a first run with a single flavor, that one.
 */
async function targetDirs(
  wowPath: string,
  found: Awaited<ReturnType<typeof discoverAddons>>,
): Promise<string[]> {
  if (found.dirs.length === 0)
    throw new AddonSyncError(`no WTF folder found under ${wowPath} — start the game once`);
  const withSv = new Set(found.files.map((f) => f.wtfDir));
  const targets: string[] = [];
  for (const { wtfDir, addonsDir } of found.dirs)
    if (withSv.has(wtfDir) || (await hasAddonFolder(addonsDir))) targets.push(addonsDir);
  if (targets.length) return [...new Set(targets)];
  if (found.dirs.length === 1) return [found.dirs[0]?.addonsDir as string];
  throw new AddonSyncError(
    'several WoW flavors found; start the game with the addon once or set wowPath to the flavor folder',
  );
}

/** The build the upload pass recorded for this file, unless the file changed since (or nothing was recorded). */
async function recordedBuild(
  store: StateStore | undefined,
  sv: SavedVariablesFile,
): Promise<number | undefined> {
  const a = store?.peek(sv.account);
  if (a?.build === undefined || a.buildMtimeMs === undefined) return undefined;
  const mtimeMs = await stat(sv.file).then(
    (st) => st.mtimeMs,
    () => undefined,
  );
  return mtimeMs !== undefined && mtimeMs <= a.buildMtimeMs ? a.build : undefined;
}

/** `meta.build` parsed from a SavedVariables file (slow for big files); undefined when unreadable. */
async function parsedBuild(
  sv: SavedVariablesFile,
  read: ReadOptions | undefined,
  logger: Logger,
): Promise<number | undefined> {
  try {
    const { value } = await readSavedVariable(sv.file, { ...read, logger });
    const build = isObj(value) && isObj(value.meta) ? value.meta.build : undefined;
    if (typeof build === 'number' && Number.isInteger(build) && build >= 0) return build;
  } catch (err) {
    logger.debug({ file: sv.file, err: errorMessage(err) }, 'no client build from this file');
  }
  return undefined;
}

/**
 * Highest `meta.build` among the SavedVariables files. Uses what the upload pass recorded and parses a file only
 * when nothing was recorded for it or it changed since.
 */
async function clientBuild(
  config: Config,
  files: SavedVariablesFile[],
  read: ReadOptions | undefined,
  logger: Logger,
): Promise<number | undefined> {
  const store = await StateStore.open(config.stateDir).catch((err: unknown) => {
    logger.debug({ err: errorMessage(err) }, 'no recorded client build');
    return undefined;
  });
  let best: number | undefined;
  for (const sv of files) {
    const build = (await recordedBuild(store, sv)) ?? (await parsedBuild(sv, read, logger));
    if (build !== undefined) best = Math.max(best ?? build, build);
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
 * Puts ForeverLedger.bak back wherever an interrupted swap left no working addon. Returns the folders restored.
 * Never throws.
 */
async function recoverAll(dirs: string[], deps: InstallDeps, logger: Logger): Promise<string[]> {
  const recovered: string[] = [];
  for (const dir of dirs) {
    try {
      if (await recoverAddon(dir, deps)) recovered.push(dir);
    } catch (err) {
      logger.warn({ dir, err: errorMessage(err) }, 'cannot restore addon from ForeverLedger.bak');
    }
  }
  return recovered;
}

/**
 * One addon sync: heals interrupted installs, asks the server which version this client build should run and
 * installs it into every managed AddOns folder that has a different version. Network, zip and disk problems come
 * back as status `error` (retry next cycle); only a missing server/wowPath throws (ConfigError). The result is saved
 * to addon-sync.json. Runs one at a time with rollbackAddonEverywhere.
 */
export async function syncAddon(opts: AddonSyncOptions): Promise<AddonSyncResult> {
  const { config } = opts;
  const { serverUrl, token } = requireServer(config);
  const wowPath = requireWowPath(config);
  return serialized(config, () => runSync(opts, serverUrl, token, wowPath));
}

async function runSync(
  opts: AddonSyncOptions,
  serverUrl: string,
  token: string,
  wowPath: string,
): Promise<AddonSyncResult> {
  const { config } = opts;
  const logger = opts.logger ?? silentLogger();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const deps: InstallDeps = { ...opts.installDeps, logger };

  const result: AddonSyncResult = {
    status: 'error',
    addonsDirs: [],
    checkedAt: Math.floor(Date.now() / 1000),
  };
  let resume = false;
  try {
    const found = await discoverAddons(config, wowPath);
    // Before the pause check and any network call, so it heals offline and paused installs too.
    const recovered = await recoverAll(
      found.dirs.map((d) => d.addonsDir),
      deps,
      logger,
    );
    if (recovered.length) result.recovered = recovered;
    result.addonsDirs = await targetDirs(wowPath, found);
    result.build = await clientBuild(config, found.files, opts.read, logger);

    const state = await readAddonSyncState(config, logger);
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
        for (const dir of result.addonsDirs) {
          if (await isAddonLinked(dir)) {
            logger.warn({ dir }, `${ADDON_NAME} is a link here; leaving it alone`);
            (result.skipped ??= []).push(dir);
            continue;
          }
          if ((await readInstalledVersion(dir)) === manifest.version) continue;
          files ??= verifyAddonZip(await download(manifest.url, fetchImpl), manifest);
          await installAddon(dir, files, deps);
          result.status = 'installed';
          logger.info({ dir, version: manifest.version }, 'addon installed');
        }
        // The server now recommends something else, or the user forced this version: resume auto-update.
        resume = true;
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
    await updateState(config, logger, (state) => {
      if (resume) delete state.pausedWhileRecommended;
      state.last = result;
    });
  } catch (err) {
    logger.warn({ err: errorMessage(err) }, 'cannot save addon sync state');
  }
  return result;
}

export interface RollbackOptions {
  config: Config;
  logger?: Logger;
  installDeps?: AddonFsDeps;
}

/**
 * Restores ForeverLedger.bak in every AddOns folder that has one and pauses auto-update until the server recommends
 * a different version. Returns the restored version. If some folders fail, the pause is still saved for the ones
 * that were restored and the failures are thrown afterwards.
 */
export async function rollbackAddonEverywhere(opts: RollbackOptions): Promise<string> {
  const { config } = opts;
  const wowPath = requireWowPath(config);
  const logger = opts.logger ?? silentLogger();
  const deps: InstallDeps = { ...opts.installDeps, logger };

  return serialized(config, async () => {
    const { dirs } = await discoverAddons(config, wowPath);
    const candidates: string[] = [];
    for (const { addonsDir } of dirs)
      if (
        !(await isAddonLinked(addonsDir)) &&
        (await readInstalledVersion(addonsDir, `${ADDON_NAME}.bak`))
      )
        candidates.push(addonsDir);
    if (candidates.length === 0)
      throw new AddonSyncError(`no previous version to roll back to under ${wowPath}`);

    let restored: string | undefined;
    let replaced: string | undefined;
    const failures: string[] = [];
    for (const dir of candidates) {
      try {
        const current = await readInstalledVersion(dir).catch(() => undefined);
        const version = await rollbackAddon(dir, deps);
        replaced ??= current;
        restored ??= version;
        logger.info({ dir, version }, 'addon rolled back');
      } catch (err) {
        failures.push(`${dir}: ${errorMessage(err)}`);
        logger.warn({ dir, err: errorMessage(err) }, 'addon rollback failed');
      }
    }

    if (restored) {
      await updateState(config, logger, (state) => {
        // Without a recorded recommendation, the version just rolled back from is the best guess.
        const paused = state.last?.recommended ?? replaced;
        if (paused) state.pausedWhileRecommended = paused;
      });
    }
    if (failures.length)
      throw new AddonSyncError(
        `${restored ? `rolled back to ${restored} in ${candidates.length - failures.length} of ${candidates.length} folders, but` : 'rollback'} failed in ${failures.join('; ')}`,
      );
    return restored as string;
  });
}
