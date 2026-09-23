import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { release } from 'node:os';
import { FatalUploadError, LockedError, resolveConfig } from '@forever-ledger/uploader/lib';
import type {
  AccountStatus,
  AddonSyncResult,
  Config,
  ConfigFile,
  FetchLike,
  Logger,
  PassResult,
  WatchEvent,
  WatchHandle,
} from '@forever-ledger/uploader/lib';
import type * as UploaderLib from '@forever-ledger/uploader/lib';
import { DiagnosticsReporter } from './diagnostics.js';
import type { DiagnosticInput, LogProblem } from './diagnostics.js';
import type { Snapshot } from './state.js';

/** App preferences kept outside the uploader config (the CLI doesn't use them). */
export interface Prefs {
  startWithWindows: boolean;
  autoUpdateAddon: boolean;
  /** Send warnings and errors on this PC to the server (sanitized); see README "Error reports". */
  sendErrorReports: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  startWithWindows: true,
  autoUpdateAddon: true,
  sendErrorReports: true,
};
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
  | 'summarizeRejected'
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
  /** Lock contention with another process is shown as a warning once it has lasted this long (default 10 min). */
  lockWarnAfterMs?: number;
  /** A failing addon sync turns the tray red once it has failed for this long (default 15 min). */
  addonErrorRedAfterMs?: number;
  /** A failing addon sync toasts once after this long (default 1 h). */
  addonErrorToastAfterMs?: number;
  /** Delays before retrying a failed addon sync, then the normal interval (default 1, 2, 5, 10 min). */
  addonRetryMs?: number[];
  /** Tries per addon sync while another process holds the lock (default 3, 10 s apart). */
  otherLockRetries?: number;
  otherLockRetryMs?: number;
  /** Reads config.json as plain JSON (to keep uploaderId/stateDir from a config that no longer validates). */
  readRawConfig?: (path: string) => Promise<unknown>;
  /** Retries while our own upload pass holds the state lock (default 40 × 3 s). */
  ownLockRetries?: number;
  ownLockRetryMs?: number;
  /** This process's pid: a LockedError with it is our own watch, not another uploader. */
  pid?: number;
  /** A pass shows as "uploading" only once it has run this long (default 750 ms; no tray flicker while offline). */
  uploadingDelayMs?: number;
  /** For error reports (tests pass a fake). */
  fetchImpl?: FetchLike;
  /** Reported with each error report (default `<process.platform> <os.release()>`). */
  platform?: string;
  /** How often new error reports are sent (default 5 min). */
  diagnosticsIntervalMs?: number;
}

export interface SettingsInput {
  wowPath?: string;
  token?: string;
  serverUrl?: string;
  startWithWindows?: boolean;
  autoUpdateAddon?: boolean;
  sendErrorReports?: boolean;
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Thrown inside addon sync/rollback once stop() was called: no new lock or network work after that. */
class StoppedError extends Error {}

const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, 'utf8')) as unknown;
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

/** Consecutive LockedErrors from another process: first and latest time seen. */
interface LockStreak {
  since: number;
  lastAt: number;
  pid: number;
}

const extendStreak = (s: LockStreak | undefined, now: number, pid: number): LockStreak => ({
  since: s?.since ?? now,
  lastAt: now,
  pid,
});

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
  private readonly addonErrorRedAfterMs: number;
  private readonly addonErrorToastAfterMs: number;
  private readonly addonRetryMs: number[];

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
  private addonTimer?: ReturnType<typeof setTimeout>;
  /** Consecutive addon sync cycles that failed or found the lock taken (drives the short retry schedule). */
  private addonFailures = 0;
  private addonRun?: Promise<void>;
  private ops: Promise<unknown> = Promise.resolve();
  private stopped = false;

  private uploadingTimer?: ReturnType<typeof setTimeout>;
  private passError?: string;
  private uploadLocked?: LockStreak;
  private addonLocked?: LockStreak;
  private addonErrorSince?: number;
  private addonErrorToasted = false;

  private readonly diagnostics: DiagnosticsReporter;
  /** Batches in rejected/ at the last report (undefined: not looked yet this run). */
  private rejectedReported?: number;

  constructor(private readonly deps: ControllerDeps) {
    super();
    this.now = deps.now ?? Date.now;
    this.pid = deps.pid ?? process.pid;
    this.addonIntervalMs = deps.addonIntervalMs ?? 30 * 60_000;
    this.lockWarnAfterMs = deps.lockWarnAfterMs ?? 10 * 60_000;
    this.addonErrorRedAfterMs = deps.addonErrorRedAfterMs ?? 15 * 60_000;
    this.addonErrorToastAfterMs = deps.addonErrorToastAfterMs ?? 60 * 60_000;
    this.addonRetryMs = deps.addonRetryMs ?? [60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000];
    this.diagnostics = new DiagnosticsReporter({
      appVersion: deps.appVersion,
      platform: deps.platform ?? `${process.platform} ${release()}`,
      target: () => {
        const c = this.config;
        return c?.token && c.serverUrl
          ? { serverUrl: c.serverUrl, token: c.token, uploaderId: c.uploaderId }
          : undefined;
      },
      enabled: () => this.deps.prefs.get().sendErrorReports,
      logger: deps.logger,
      now: this.now,
      fetchImpl: deps.fetchImpl,
      intervalMs: deps.diagnosticsIntervalMs,
      onChange: () => this.changed(),
    });
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
      this.diagnostics.start();
      await this.startWatching();
      this.scheduleAddon(true);
      this.changed();
    });
  }

  /** Closes the watch and timers; waits a few seconds for a running addon sync. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.clearAddonTimer();
    this.diagnostics.stop();
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
      addonRetrying: this.addonRetrying(),
      addonPausedFor: this.addonPausedFor,
      appVersion: this.deps.appVersion,
      appUpdateReady: this.appUpdateReady,
      diagnostics: this.diagnostics.status(),
      settings: {
        wowPath: this.config?.wowPath,
        serverUrl: this.config?.serverUrl ?? DEFAULT_SERVER_URL,
        tokenSet: Boolean(this.config?.token),
        startWithWindows: prefs.startWithWindows,
        autoUpdateAddon: prefs.autoUpdateAddon,
        sendErrorReports: prefs.sendErrorReports,
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

  /** Checks for an addon update now (a rollback pause still applies). */
  async addonCheckNow(): Promise<void> {
    if (this.addonRun) await this.addonRun;
    await this.runAddonSync(false, true);
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
        sendErrorReports: input.sendErrorReports ?? oldPrefs.sendErrorReports,
      };
      const prefsChanged =
        prefs.startWithWindows !== oldPrefs.startWithWindows ||
        prefs.autoUpdateAddon !== oldPrefs.autoUpdateAddon ||
        prefs.sendErrorReports !== oldPrefs.sendErrorReports;
      if (prefsChanged) {
        this.deps.prefs.set(prefs);
        this.log.info({ ...prefs }, 'preferences saved');
        if (!prefs.sendErrorReports) this.diagnostics.clear();
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
        const from: ConfigFile = base ?? (await this.salvageConfig());
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

  /** A WARN/ERROR/FATAL line from the log (main.ts wires the LogSink here). */
  noteLogProblem(p: LogProblem): void {
    this.diagnostics.noteLogLine(p);
  }

  /**
   * A problem outside the controller (app self-update, a crash). `match`: the text its log line contains, so that line
   * isn't reported a second time.
   */
  reportProblem(input: DiagnosticInput, match?: string): void {
    this.diagnostics.record(input, match);
  }

  setAppUpdateReady(version: string): void {
    this.appUpdateReady = version;
    this.log.info({ version }, 'app update downloaded; restart to install');
    this.changed();
  }

  // ---- internals ----

  /**
   * A fresh config for setup, keeping uploaderId and stateDir from an existing config.json that no longer validates
   * (so its queue and acks aren't orphaned). Best effort.
   */
  private async salvageConfig(): Promise<ConfigFile> {
    const fresh: ConfigFile = { accounts: [], uploaderId: this.deps.uploader.newUploaderId() };
    let raw: unknown;
    try {
      raw = await (this.deps.readRawConfig ?? readJson)(this.deps.configPath);
    } catch {
      return fresh;
    }
    if (typeof raw !== 'object' || raw === null) return fresh;
    const r = raw as Record<string, unknown>;
    const id = typeof r.uploaderId === 'string' ? r.uploaderId.trim() : '';
    if (id && id.length <= 128) fresh.uploaderId = id;
    if (typeof r.stateDir === 'string' && r.stateDir.trim()) fresh.stateDir = r.stateDir.trim();
    return fresh;
  }

  /** A failing addon sync that hasn't failed for long yet: shown neutrally ("retrying"), not red. */
  private addonRetrying(): boolean {
    if (this.addon?.status !== 'error') return false;
    return (
      this.addonErrorSince === undefined ||
      this.now() - this.addonErrorSince < this.addonErrorRedAfterMs
    );
  }

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
    // "Lasting" = consecutive failures spanning the threshold, not one failure a while ago.
    const lasting = (l?: LockStreak) =>
      l !== undefined && l.lastAt - l.since >= this.lockWarnAfterMs;
    if (lasting(this.uploadLocked))
      return `Another Forever Ledger uploader (pid ${this.uploadLocked?.pid}) is using the same state folder, so uploads are waiting. Close it (for example \`forever-ledger watch\`).`;
    if (this.passError) return `Uploads are failing and will be retried: ${this.passError}`;
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
    this.setUploading(false);
    this.passError = undefined;
    await handle?.close();
  }

  /** `uploading` turns on only after uploadingDelayMs, so quick retry passes don't flash the tray. */
  private setUploading(on: boolean) {
    if (this.uploadingTimer) clearTimeout(this.uploadingTimer);
    this.uploadingTimer = undefined;
    if (!on) {
      this.uploading = false;
      return;
    }
    this.uploadingTimer = setTimeout(() => {
      this.uploadingTimer = undefined;
      this.uploading = true;
      this.changed();
    }, this.deps.uploadingDelayMs ?? 750);
  }

  private onWatchEvent(e: WatchEvent) {
    switch (e.type) {
      case 'pass-start':
        this.setUploading(true);
        return;
      case 'pass-end':
        this.setUploading(false);
        this.uploadLocked = undefined;
        this.passError = undefined;
        {
          const summary = passSummary(e.result);
          if (summary.files === 0 && summary.sent === 0)
            this.log.debug(summary, 'nothing to upload yet');
          else this.log.info(summary, 'upload pass finished');
        }
        for (const f of e.result.files) {
          // A file WoW is still writing is read again on its next change: not a problem.
          if (!f.error || f.error.includes('still being written')) continue;
          this.diagnostics.record({
            level: 'error',
            source: 'parse',
            message: f.error,
            detail: { account: f.account },
          });
        }
        void this.refreshAccounts();
        break;
      case 'pass-error':
        this.setUploading(false);
        if (e.error instanceof LockedError) {
          this.passError = undefined;
          if (e.error.pid !== this.pid)
            this.uploadLocked = extendStreak(this.uploadLocked, this.now(), e.error.pid);
        } else {
          this.passError = e.error.message;
          if (!(e.error instanceof FatalUploadError))
            this.diagnostics.record(
              {
                level: 'error',
                source: 'uploader',
                message: `upload pass failed: ${e.error.message}`,
              },
              e.error.message,
            );
        }
        void this.refreshAccounts();
        break;
      case 'fatal':
        this.setUploading(false);
        this.watch = undefined;
        // The uploader's text points at the CLI; in the app the fix is the Settings card.
        this.fatal =
          e.error.code === 'unauthorized'
            ? 'The server rejected the upload token. Paste a new token in Settings; queued data is kept.'
            : e.error.message;
        this.diagnostics.record(
          {
            level: 'fatal',
            source: 'uploader',
            message: `uploads stopped: ${this.fatal}`,
            detail: { code: e.error.code },
          },
          e.error.message,
        );
        this.toast(`Uploads stopped: ${this.fatal}`);
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
      return;
    }
    await this.reportRejected(config);
  }

  /** Error report about batches parked in rejected/, once per run and whenever there are more of them. */
  private async reportRejected(config: Config) {
    const total = this.accounts.reduce((n, a) => n + a.rejectedBatches, 0);
    const before = this.rejectedReported ?? 0;
    this.rejectedReported = total;
    if (total <= before) return;
    try {
      const summary = await this.deps.uploader.summarizeRejected(config.stateDir);
      if (summary.total === 0) return;
      this.diagnostics.record({
        level: 'error',
        source: 'rejected',
        // No count in the message: a later summary merges into a pending one (and replaces its detail).
        message: 'records the server refused are parked in rejected/',
        detail: summary,
      });
    } catch (err) {
      this.log.debug({ err: errorMessage(err) }, 'cannot read rejected/');
    }
  }

  private clearAddonTimer() {
    if (this.addonTimer) clearTimeout(this.addonTimer);
    this.addonTimer = undefined;
  }

  private autoAddon() {
    return !this.stopped && !this.setupNeeded && this.deps.prefs.get().autoUpdateAddon;
  }

  /** Addon sync while auto-update is on: now (`runNow`) or after the next delay. Off clears the lock warning. */
  private scheduleAddon(runNow: boolean) {
    this.clearAddonTimer();
    if (!this.autoAddon()) {
      this.addonLocked = undefined;
      return;
    }
    if (runNow) void this.runAddonSync(false, false);
    else this.scheduleNextAddon();
  }

  /** The next automatic sync: soon after failures (1, 2, 5, 10 min), else the normal interval. */
  private scheduleNextAddon() {
    this.clearAddonTimer();
    if (!this.autoAddon()) return;
    const retry = this.addonFailures > 0 ? this.addonRetryMs[this.addonFailures - 1] : undefined;
    const ms = retry ?? this.addonIntervalMs;
    this.addonTimer = setTimeout(() => void this.runAddonSync(false, false), ms);
    (this.addonTimer as { unref?: () => void }).unref?.();
  }

  private runAddonSync(force: boolean, manual: boolean): Promise<void> {
    this.addonRun ??= this.doAddonSync(force, manual).finally(() => {
      this.addonRun = undefined;
    });
    return this.addonRun;
  }

  /**
   * Runs `fn` under the state-folder lock. While our own upload pass holds it, waits for the pass and retries; a lock
   * held by another process is retried a few times (its passes are short) before LockedError. After stop(), throws
   * StoppedError instead of taking the lock.
   */
  private async locked<T>(config: Config, fn: () => Promise<T>): Promise<T> {
    let own = 0;
    let other = 0;
    for (;;) {
      if (this.stopped) throw new StoppedError('stopped');
      await this.watch?.idle();
      if (this.stopped) throw new StoppedError('stopped');
      try {
        return await this.deps.uploader.withLock(config.stateDir, fn);
      } catch (err) {
        if (!(err instanceof LockedError)) throw err;
        if (err.pid === this.pid) {
          if (++own > (this.deps.ownLockRetries ?? 40)) throw err;
          await delay(this.deps.ownLockRetryMs ?? 3_000);
        } else {
          if (++other >= (this.deps.otherLockRetries ?? 3)) throw err;
          await delay(this.deps.otherLockRetryMs ?? 10_000);
        }
      }
    }
  }

  private async doAddonSync(force: boolean, manual: boolean) {
    const config = this.config;
    if (!config || this.setupNeeded || this.stopped) return;
    this.log.info({ force }, 'checking for addon updates');
    try {
      const result = await this.locked(config, () =>
        this.deps.uploader.syncAddon({ config, logger: this.log, force }),
      );
      this.addonLocked = undefined;
      this.addonFailures = result.status === 'error' ? this.addonFailures + 1 : 0;
      this.applyAddonResult(result);
    } catch (err) {
      if (err instanceof StoppedError) return;
      this.addonFailures++;
      if (err instanceof LockedError) {
        this.addonLocked = extendStreak(this.addonLocked, this.now(), err.pid);
        this.log.warn(
          { pid: err.pid },
          'addon sync skipped: another uploader keeps the state folder locked; will retry',
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
    this.scheduleNextAddon();
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
    if (result.status === 'error') {
      this.diagnostics.record(
        {
          level: 'error',
          source: 'addon-sync',
          message: `addon sync failed: ${result.error ?? 'unknown error'}`,
          detail: {
            installed: result.installed,
            recommended: result.recommended,
            build: result.build,
            folders: result.addonsDirs.length,
          },
        },
        result.error,
      );
      this.log.warn(fields, `addon sync failed (retry #${this.addonFailures} soon)`);
    } else this.log.info(fields, `addon sync: ${result.status}`);

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
