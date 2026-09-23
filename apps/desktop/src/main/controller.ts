import { EventEmitter } from 'node:events';
import { LockedError, resolveConfig } from '@forever-ledger/uploader/lib';
import type {
  AccountStatus,
  AddonSyncResult,
  Config,
  ConfigFile,
  Logger,
  PassResult,
  WatchEvent,
  WatchHandle,
} from '@forever-ledger/uploader/lib';
import type * as UploaderLib from '@forever-ledger/uploader/lib';
import type { Snapshot } from './state.js';

/** App preferences kept outside the uploader config (the CLI doesn't use them). */
export interface Prefs {
  startWithWindows: boolean;
  autoUpdateAddon: boolean;
}

export const DEFAULT_PREFS: Prefs = { startWithWindows: true, autoUpdateAddon: true };
export const DEFAULT_SERVER_URL = 'https://ledger.willikers.dev';

/** The parts of `@forever-ledger/uploader/lib` the controller uses (tests pass fakes). */
export type UploaderApi = Pick<
  typeof UploaderLib,
  | 'readConfigFile'
  | 'saveConfig'
  | 'validateConfigFile'
  | 'newUploaderId'
  | 'withLock'
  | 'startWatch'
  | 'collectStatus'
  | 'syncAddon'
  | 'rollbackAddonEverywhere'
  | 'readAddonSyncState'
>;

export interface ControllerDeps {
  configPath: string;
  uploader: UploaderApi;
  logger: Logger;
  appVersion: string;
  prefs: { get(): Prefs; set(p: Prefs): void };
  now?: () => number;
  /** Addon sync interval (default 30 min). */
  addonIntervalMs?: number;
  /** Lock contention with another process is shown as a warning after this long (default 10 min). */
  lockWarnAfterMs?: number;
  /** A failing addon sync toasts once after this long (default 1 h). */
  addonErrorToastAfterMs?: number;
  /** Retries while our own upload pass holds the state lock (default 40 × 3 s). */
  ownLockRetries?: number;
  ownLockRetryMs?: number;
  /** This process's pid: a LockedError with it is our own watch, not another uploader. */
  pid?: number;
}

export interface SettingsInput {
  wowPath?: string;
  token?: string;
  serverUrl?: string;
  startWithWindows?: boolean;
  autoUpdateAddon?: boolean;
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));
const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    (t as { unref?: () => void }).unref?.();
  });

function passSummary(result: PassResult) {
  const f = result.flush;
  return {
    ok: result.ok,
    files: result.files.length,
    records: result.files.reduce((n, x) => n + x.records, 0),
    newRecords: result.files.reduce((n, x) => n + x.queuedRecords, 0),
    sent: f?.sent ?? 0,
    acked: f?.acked ?? 0,
    queuedBatches: f?.pendingBatches ?? 0,
    queuedRecords: f?.pendingRecords ?? 0,
  };
}

/**
 * Runs the uploader inside the tray app: the watch (uploads), periodic addon sync, settings. Owns everything the
 * window and tray show and emits `change` with a fresh Snapshot whenever it changes. No Electron in here.
 *
 * Locking: every upload pass takes the state-folder lock itself, so the controller only takes it around addon
 * sync/rollback and never for its lifetime.
 */
export class LedgerController extends EventEmitter<{ change: [Snapshot]; toast: [string] }> {
  private readonly now: () => number;
  private readonly pid: number;
  private readonly addonIntervalMs: number;
  private readonly lockWarnAfterMs: number;
  private readonly addonErrorToastAfterMs: number;

  private file?: ConfigFile;
  private config?: Config;
  private setupNeeded = true;
  private paused = false;
  private uploading = false;
  private fatal?: string;
  private accounts: AccountStatus[] = [];
  private addon?: AddonSyncResult;
  private addonPausedFor?: string;
  private appUpdateReady?: string;

  private watch?: WatchHandle;
  private watchGen = 0;
  private addonTimer?: ReturnType<typeof setInterval>;
  private addonRun?: Promise<void>;
  private ops: Promise<unknown> = Promise.resolve();
  private stopped = false;

  private uploadLocked?: { since: number; pid: number };
  private addonLocked?: { since: number; pid: number };
  private addonErrorSince?: number;
  private addonErrorToasted = false;

  constructor(private readonly deps: ControllerDeps) {
    super();
    this.now = deps.now ?? Date.now;
    this.pid = deps.pid ?? process.pid;
    this.addonIntervalMs = deps.addonIntervalMs ?? 30 * 60_000;
    this.lockWarnAfterMs = deps.lockWarnAfterMs ?? 10 * 60_000;
    this.addonErrorToastAfterMs = deps.addonErrorToastAfterMs ?? 60 * 60_000;
  }

  private get log() {
    return this.deps.logger;
  }

  /** Loads the config; if setup is done, starts watching and runs the first addon sync. */
  async start(): Promise<void> {
    await this.serial(async () => {
      this.stopped = false;
      await this.loadConfig();
      await this.loadAddonState();
      this.log.info(
        {
          version: this.deps.appVersion,
          config: this.deps.configPath,
          setupNeeded: this.setupNeeded,
        },
        'Forever Ledger started',
      );
      await this.startWatching();
      this.scheduleAddon(true);
      this.changed();
    });
  }

  /** Closes the watch and timers; waits a few seconds for a running addon sync. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.clearAddonTimer();
    await this.serial(() => this.stopWatching());
    if (this.addonRun) await Promise.race([this.addonRun, delay(5_000)]);
    this.log.info('Forever Ledger stopped');
  }

  snapshot(): Snapshot {
    const prefs = this.deps.prefs.get();
    return {
      setupNeeded: this.setupNeeded,
      paused: this.paused,
      uploading: this.uploading,
      accounts: this.accounts,
      fatal: this.fatal,
      warning: this.warning(),
      addon: this.addon,
      addonPausedFor: this.addonPausedFor,
      appVersion: this.deps.appVersion,
      appUpdateReady: this.appUpdateReady,
      settings: {
        wowPath: this.config?.wowPath,
        serverUrl: this.config?.serverUrl ?? DEFAULT_SERVER_URL,
        tokenSet: Boolean(this.config?.token),
        startWithWindows: prefs.startWithWindows,
        autoUpdateAddon: prefs.autoUpdateAddon,
      },
    };
  }

  /** Uploads every file now; restarts the watch if a fatal error stopped it. */
  uploadNow(): void {
    if (this.setupNeeded || this.paused) return;
    this.log.info('upload requested');
    if (this.watch) this.watch.trigger();
    else
      void this.serial(async () => {
        await this.startWatching();
        this.changed();
      });
  }

  async setPaused(paused: boolean): Promise<void> {
    await this.serial(async () => {
      if (this.paused === paused) return;
      this.paused = paused;
      this.log.info(paused ? 'uploads paused' : 'uploads resumed');
      if (paused) await this.stopWatching();
      else await this.startWatching();
      this.changed();
    });
  }

  /** Installs the recommended addon now, even while paused after a rollback. */
  async addonUpdateNow(): Promise<void> {
    if (this.addonRun) await this.addonRun;
    await this.runAddonSync(true, true);
  }

  /** Restores ForeverLedger.bak everywhere; auto-update pauses until the server recommends another version. */
  async addonRollback(): Promise<void> {
    const config = this.config;
    if (!config) return;
    if (this.addonRun) await this.addonRun;
    try {
      const version = await this.locked(config, () =>
        this.deps.uploader.rollbackAddonEverywhere({ config, logger: this.log }),
      );
      this.log.info({ version }, 'addon rolled back by the user');
      if (this.addon) this.addon = { ...this.addon, installed: version };
      this.toast(
        `ForeverLedger rolled back to ${version} — type /reload in game to use it. Auto-update waits for a newer version.`,
      );
    } catch (err) {
      this.log.warn({ err: errorMessage(err) }, 'addon rollback failed');
      this.toast(
        err instanceof LockedError
          ? 'Roll back skipped: another uploader is busy. Try again in a minute.'
          : `Roll back failed: ${errorMessage(err)}`,
      );
    }
    await this.loadAddonState();
    this.changed();
  }

  /**
   * Saves settings. WoW folder / token / server go to the uploader config (same file as the CLI; empty values keep
   * the current ones) and restart the watch plus an addon sync; the rest are app prefs.
   */
  async saveSettings(input: SettingsInput): Promise<void> {
    await this.serial(async () => {
      const oldPrefs = this.deps.prefs.get();
      const prefs: Prefs = {
        startWithWindows: input.startWithWindows ?? oldPrefs.startWithWindows,
        autoUpdateAddon: input.autoUpdateAddon ?? oldPrefs.autoUpdateAddon,
      };
      const prefsChanged =
        prefs.startWithWindows !== oldPrefs.startWithWindows ||
        prefs.autoUpdateAddon !== oldPrefs.autoUpdateAddon;
      if (prefsChanged) {
        this.deps.prefs.set(prefs);
        this.log.info({ ...prefs }, 'preferences saved');
      }

      const wowPath = input.wowPath?.trim() || undefined;
      const token = input.token?.trim() || undefined;
      const serverUrl = input.serverUrl?.trim() || undefined;
      const base = this.file;
      const configChanged =
        !base ||
        (wowPath !== undefined && wowPath !== base.wowPath) ||
        (token !== undefined && token !== base.token) ||
        (serverUrl !== undefined && serverUrl !== base.serverUrl) ||
        !base.serverUrl;

      if (configChanged && (wowPath || token || serverUrl || base)) {
        const from: ConfigFile = base ?? {
          accounts: [],
          uploaderId: this.deps.uploader.newUploaderId(),
        };
        const next = this.deps.uploader.validateConfigFile({
          ...from,
          wowPath: wowPath ?? from.wowPath,
          // A different WoW folder may not have the accounts the CLI was limited to.
          accounts: wowPath && wowPath !== from.wowPath ? [] : from.accounts,
          token: token ?? from.token,
          serverUrl: serverUrl ?? from.serverUrl ?? DEFAULT_SERVER_URL,
        });
        await this.deps.uploader.saveConfig(this.deps.configPath, next);
        this.log.info(
          {
            wowPath: next.wowPath,
            serverUrl: next.serverUrl,
            tokenChanged: token !== undefined && token !== base?.token,
          },
          'settings saved',
        );
        await this.stopWatching();
        this.fatal = undefined;
        await this.loadConfig();
        await this.loadAddonState();
        await this.startWatching();
        this.scheduleAddon(true);
      } else if (prefs.autoUpdateAddon !== oldPrefs.autoUpdateAddon) {
        this.scheduleAddon(prefs.autoUpdateAddon);
      }
      this.changed();
    });
  }

  setAppUpdateReady(version: string): void {
    this.appUpdateReady = version;
    this.log.info({ version }, 'app update downloaded; restart to install');
    this.changed();
  }

  // ---- internals ----

  /** Lifecycle operations (start/stop/pause/save) run one at a time. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.ops.then(fn, fn);
    this.ops = run.catch(() => undefined);
    return run;
  }

  private changed() {
    this.emit('change', this.snapshot());
  }

  private toast(message: string) {
    this.log.info({ toast: message }, 'notification');
    this.emit('toast', message);
  }

  private warning(): string | undefined {
    const now = this.now();
    const lasting = (l?: { since: number }) =>
      l !== undefined && now - l.since >= this.lockWarnAfterMs;
    if (lasting(this.uploadLocked))
      return `Another Forever Ledger uploader (pid ${this.uploadLocked?.pid}) is using the same state folder, so uploads are waiting. Close it (for example \`forever-ledger watch\`).`;
    if (lasting(this.addonLocked))
      return `Another Forever Ledger uploader (pid ${this.addonLocked?.pid}) keeps the state folder locked, so the addon can't be updated. Close it (for example \`forever-ledger watch\`).`;
    return undefined;
  }

  private async loadConfig() {
    this.file = undefined;
    this.config = undefined;
    try {
      this.file = await this.deps.uploader.readConfigFile(this.deps.configPath);
      if (this.file) this.config = resolveConfig(this.file, this.deps.configPath);
    } catch (err) {
      this.fatal = errorMessage(err);
      this.log.error({ err: this.fatal }, 'cannot load the config');
    }
    this.setupNeeded = !this.config?.wowPath || !this.config.token || !this.config.serverUrl;
  }

  private async loadAddonState() {
    if (!this.config) return;
    try {
      const state = await this.deps.uploader.readAddonSyncState(this.config, this.log);
      this.addon ??= state.last;
      this.addonPausedFor = state.pausedWhileRecommended;
    } catch (err) {
      this.log.debug({ err: errorMessage(err) }, 'cannot read the addon sync state');
    }
  }

  private async startWatching() {
    const config = this.config;
    if (this.stopped || this.paused || this.setupNeeded || this.watch || !config) return;
    this.fatal = undefined;
    const gen = ++this.watchGen;
    try {
      const handle = await this.deps.uploader.startWatch({
        config,
        logger: this.log,
        onEvent: (e) => {
          if (gen === this.watchGen) this.onWatchEvent(e);
        },
      });
      if (gen !== this.watchGen) {
        await handle.close();
        return;
      }
      this.watch = handle;
      this.log.info({ files: handle.watchedFiles().length }, 'watching SavedVariables');
      void handle.done.then((fatal) => {
        if (fatal && gen === this.watchGen) this.watch = undefined;
      });
      void this.refreshAccounts();
    } catch (err) {
      this.fatal = `Cannot start uploading: ${errorMessage(err)}`;
      this.log.error({ err: errorMessage(err) }, 'cannot start watching');
    }
  }

  private async stopWatching() {
    this.watchGen++;
    const handle = this.watch;
    this.watch = undefined;
    this.uploading = false;
    await handle?.close();
  }

  private onWatchEvent(e: WatchEvent) {
    switch (e.type) {
      case 'pass-start':
        this.uploading = true;
        break;
      case 'pass-end':
        this.uploading = false;
        this.uploadLocked = undefined;
        this.log.info(passSummary(e.result), 'upload pass finished');
        void this.refreshAccounts();
        break;
      case 'pass-error':
        this.uploading = false;
        if (e.error instanceof LockedError && e.error.pid !== this.pid)
          this.uploadLocked ??= { since: this.now(), pid: e.error.pid };
        void this.refreshAccounts();
        break;
      case 'fatal':
        this.uploading = false;
        this.watch = undefined;
        this.fatal = e.error.message;
        this.toast(`Uploads stopped: ${e.error.message}`);
        break;
    }
    this.changed();
  }

  private async refreshAccounts() {
    const config = this.config;
    if (!config) return;
    try {
      this.accounts = await this.deps.uploader.collectStatus(config);
      this.changed();
    } catch (err) {
      this.log.debug({ err: errorMessage(err) }, 'cannot read upload status');
    }
  }

  private clearAddonTimer() {
    if (this.addonTimer) clearInterval(this.addonTimer);
    this.addonTimer = undefined;
  }

  /** Periodic addon sync while auto-update is on; `runNow` also syncs right away. */
  private scheduleAddon(runNow: boolean) {
    this.clearAddonTimer();
    if (this.stopped || this.setupNeeded || !this.deps.prefs.get().autoUpdateAddon) return;
    this.addonTimer = setInterval(() => void this.runAddonSync(false, false), this.addonIntervalMs);
    (this.addonTimer as { unref?: () => void }).unref?.();
    if (runNow) void this.runAddonSync(false, false);
  }

  private runAddonSync(force: boolean, manual: boolean): Promise<void> {
    this.addonRun ??= this.doAddonSync(force, manual).finally(() => {
      this.addonRun = undefined;
    });
    return this.addonRun;
  }

  /**
   * Runs `fn` under the state-folder lock. While our own upload pass holds it, waits for the pass and retries; a lock
   * held by another process throws LockedError.
   */
  private async locked<T>(config: Config, fn: () => Promise<T>): Promise<T> {
    const retries = this.deps.ownLockRetries ?? 40;
    for (let attempt = 0; ; attempt++) {
      await this.watch?.idle();
      try {
        return await this.deps.uploader.withLock(config.stateDir, fn);
      } catch (err) {
        if (!(err instanceof LockedError) || err.pid !== this.pid || attempt >= retries) throw err;
        await delay(this.deps.ownLockRetryMs ?? 3_000);
      }
    }
  }

  private async doAddonSync(force: boolean, manual: boolean) {
    const config = this.config;
    if (!config || this.setupNeeded) return;
    this.log.info({ force }, 'checking for addon updates');
    try {
      const result = await this.locked(config, () =>
        this.deps.uploader.syncAddon({ config, logger: this.log, force }),
      );
      this.addonLocked = undefined;
      this.applyAddonResult(result);
    } catch (err) {
      if (err instanceof LockedError) {
        this.addonLocked ??= { since: this.now(), pid: err.pid };
        this.log.warn(
          { pid: err.pid },
          'addon sync skipped: the state folder is locked; will retry',
        );
        if (manual)
          this.toast('Addon update skipped: another uploader is busy. Try again in a minute.');
      } else {
        this.applyAddonResult({
          status: 'error',
          error: errorMessage(err),
          addonsDirs: [],
          checkedAt: Math.floor(this.now() / 1000),
        });
      }
    }
    await this.loadAddonState();
    this.changed();
  }

  private applyAddonResult(result: AddonSyncResult) {
    this.addon = result;
    const fields = {
      status: result.status,
      installed: result.installed,
      recommended: result.recommended,
      build: result.build,
      folders: result.addonsDirs.length,
      ...(result.recovered?.length ? { recovered: result.recovered.length } : {}),
      ...(result.error ? { err: result.error } : {}),
    };
    if (result.status === 'error') this.log.warn(fields, 'addon sync failed');
    else this.log.info(fields, `addon sync: ${result.status}`);

    if (result.status === 'installed' || result.recovered?.length) {
      const version = result.installed ?? result.recommended ?? '';
      this.toast(`ForeverLedger ${version} installed — type /reload in game to use it`);
    }
    if (result.status === 'error') {
      this.addonErrorSince ??= this.now();
      if (
        !this.addonErrorToasted &&
        this.now() - this.addonErrorSince >= this.addonErrorToastAfterMs
      ) {
        this.addonErrorToasted = true;
        this.toast(
          `Addon updates have been failing for over an hour: ${result.error ?? 'unknown error'}`,
        );
      }
    } else {
      this.addonErrorSince = undefined;
      this.addonErrorToasted = false;
    }
  }
}
