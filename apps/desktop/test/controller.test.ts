import { FatalUploadError, LockedError, silentLogger } from '@forever-ledger/uploader/lib';
import type {
  AccountStatus,
  AddonSyncResult,
  ConfigFile,
  PassResult,
  WatchEvent,
  WatchHandle,
  WatchOptions,
} from '@forever-ledger/uploader/lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SERVER_URL, LedgerController } from '../src/main/controller.js';
import type { ControllerDeps, Prefs, UploaderApi } from '../src/main/controller.js';
import type { Snapshot } from '../src/main/state.js';

const CONFIG_PATH = '/cfg/config.json';
const FULL: ConfigFile = {
  wowPath: '/wow',
  accounts: [],
  serverUrl: 'https://ledger.example',
  token: 'flt_test',
  uploaderId: 'u1',
};
const OTHER_PID = 424242;

const account = (over: Partial<AccountStatus> = {}): AccountStatus => ({
  account: 'ACC1',
  acked: 5,
  queuedBatches: 0,
  queuedRecords: 0,
  rejectedBatches: 0,
  rejectedRecords: 0,
  ...over,
});

const syncResult = (over: Partial<AddonSyncResult> = {}): AddonSyncResult => ({
  status: 'up-to-date',
  installed: '0.2.1',
  recommended: '0.2.1',
  addonsDirs: ['/wow/_classic_era_/Interface/AddOns'],
  checkedAt: 1_790_000_000,
  ...over,
});

const passResult: PassResult = {
  ok: true,
  files: [],
  notes: [],
  flush: {
    sent: 1,
    acked: 3,
    rejected: 0,
    split: 0,
    pendingBatches: 0,
    pendingRecords: 0,
    retryable: false,
    errors: [],
  },
};

interface FakeWatch extends WatchHandle {
  opts: WatchOptions;
  emit(e: WatchEvent): void;
  close: ReturnType<typeof vi.fn<() => Promise<void>>>;
  trigger: ReturnType<typeof vi.fn<() => void>>;
}

function setup(opts: { file?: ConfigFile; prefs?: Partial<Prefs> } = {}) {
  let file: ConfigFile | undefined = 'file' in opts ? opts.file : FULL;
  let prefs: Prefs = { startWithWindows: true, autoUpdateAddon: true, ...opts.prefs };
  const watches: FakeWatch[] = [];
  const lockHolder: { pid?: number } = {};

  const uploader = {
    readConfigFile: vi.fn(async () => file),
    saveConfig: vi.fn(async (_path: string, f: ConfigFile) => {
      file = f;
    }),
    validateConfigFile: vi.fn((raw: unknown) => raw as ConfigFile),
    newUploaderId: vi.fn(() => 'new-id'),
    withLock: vi.fn(async <T>(_dir: string, fn: () => Promise<T>) => {
      if (lockHolder.pid !== undefined) throw new LockedError(lockHolder.pid);
      return fn();
    }),
    startWatch: vi.fn(async (o: WatchOptions) => {
      const w: FakeWatch = {
        opts: o,
        emit: (e) => o.onEvent?.(e),
        done: new Promise(() => undefined),
        close: vi.fn(async () => undefined),
        idle: async () => undefined,
        watchedFiles: () => ['/wow/sv.lua'],
        trigger: vi.fn(),
      };
      watches.push(w);
      return w;
    }),
    collectStatus: vi.fn(async () => [account()]),
    syncAddon: vi.fn(async () => syncResult()),
    rollbackAddonEverywhere: vi.fn(async () => '0.2.0'),
    readAddonSyncState: vi.fn(async () => ({})),
  };

  let now = 1_790_000_000_000;
  const deps: ControllerDeps = {
    configPath: CONFIG_PATH,
    uploader: uploader as unknown as UploaderApi,
    logger: silentLogger(),
    appVersion: '0.1.0',
    prefs: { get: () => prefs, set: (p) => (prefs = p) },
    now: () => now,
    addonIntervalMs: 1_000,
    ownLockRetryMs: 10,
    pid: 1,
  };
  const controller = new LedgerController(deps);
  const changes: Snapshot[] = [];
  const toasts: string[] = [];
  controller.on('change', (s) => changes.push(s));
  controller.on('toast', (t) => toasts.push(t));
  return {
    controller,
    uploader,
    watches,
    changes,
    toasts,
    lockHolder,
    getFile: () => file,
    getPrefs: () => prefs,
    advance: (ms: number) => (now += ms),
  };
}

/** Lets pending promise chains (fire-and-forget syncs, status refreshes) settle. */
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('LedgerController', () => {
  describe('start', () => {
    it('needs setup when the config lacks a token', async () => {
      const t = setup({ file: { ...FULL, token: undefined } });
      await t.controller.start();
      await flush();
      const s = t.controller.snapshot();
      expect(s.setupNeeded).toBe(true);
      expect(s.settings.tokenSet).toBe(false);
      expect(t.uploader.startWatch).not.toHaveBeenCalled();
      expect(t.uploader.syncAddon).not.toHaveBeenCalled();
    });

    it('needs setup when there is no config file', async () => {
      const t = setup({ file: undefined });
      await t.controller.start();
      expect(t.controller.snapshot().setupNeeded).toBe(true);
      expect(t.controller.snapshot().settings.serverUrl).toBe(DEFAULT_SERVER_URL);
    });

    it('starts watching and runs the first addon sync under the lock', async () => {
      const t = setup();
      await t.controller.start();
      await flush();
      expect(t.uploader.startWatch).toHaveBeenCalledTimes(1);
      expect(t.watches[0]?.opts.config).toMatchObject({ wowPath: '/wow', stateDir: '/cfg/state' });
      expect(t.uploader.withLock).toHaveBeenCalledWith('/cfg/state', expect.any(Function));
      expect(t.uploader.syncAddon).toHaveBeenCalledWith(expect.objectContaining({ force: false }));
      const s = t.controller.snapshot();
      expect(s.setupNeeded).toBe(false);
      expect(s.addon?.status).toBe('up-to-date');
      expect(s.accounts).toEqual([account()]);
      expect(s.settings).toMatchObject({ wowPath: '/wow', tokenSet: true });
    });

    it('shows the last addon sync result from disk right away', async () => {
      const t = setup();
      let release!: () => void;
      t.uploader.syncAddon.mockImplementation(
        () => new Promise((r) => (release = () => r(syncResult({ status: 'installed' })))),
      );
      t.uploader.readAddonSyncState.mockResolvedValue({
        last: syncResult({ installed: '0.1.9' }),
        pausedWhileRecommended: '0.2.1',
      } as never);
      await t.controller.start();
      expect(t.controller.snapshot().addon?.installed).toBe('0.1.9');
      expect(t.controller.snapshot().addonPausedFor).toBe('0.2.1');
      release();
      await flush();
    });

    it('reports an unreadable config as fatal and needs setup', async () => {
      const t = setup();
      t.uploader.readConfigFile.mockRejectedValue(new Error('invalid config: uploaderId missing'));
      await t.controller.start();
      expect(t.controller.snapshot()).toMatchObject({
        setupNeeded: true,
        fatal: 'invalid config: uploaderId missing',
      });
    });
  });

  describe('watch events', () => {
    it('flips uploading around a pass and refreshes the accounts', async () => {
      const t = setup();
      await t.controller.start();
      await flush();
      const w = t.watches[0] as FakeWatch;
      t.uploader.collectStatus.mockResolvedValue([account({ acked: 9 })]);

      w.emit({ type: 'pass-start' });
      expect(t.controller.snapshot().uploading).toBe(false);
      await vi.advanceTimersByTimeAsync(750);
      expect(t.controller.snapshot().uploading).toBe(true);
      expect(t.changes.at(-1)?.uploading).toBe(true);

      w.emit({ type: 'pass-end', result: passResult });
      expect(t.controller.snapshot().uploading).toBe(false);
      await flush();
      expect(t.controller.snapshot().accounts[0]?.acked).toBe(9);
    });

    it('a quick pass never shows as uploading (no tray flicker)', async () => {
      const t = setup();
      await t.controller.start();
      const w = t.watches[0] as FakeWatch;
      w.emit({ type: 'pass-start' });
      await vi.advanceTimersByTimeAsync(100);
      w.emit({ type: 'pass-end', result: passResult });
      await vi.advanceTimersByTimeAsync(2_000);
      expect(t.changes.some((c) => c.uploading)).toBe(false);
    });

    it('a pass that throws clears uploading and shows the error until a pass works', async () => {
      const t = setup();
      await t.controller.start();
      const w = t.watches[0] as FakeWatch;
      w.emit({ type: 'pass-start' });
      await vi.advanceTimersByTimeAsync(1_000);
      w.emit({ type: 'pass-error', error: new Error('state.json is corrupt') });
      expect(t.controller.snapshot().uploading).toBe(false);
      expect(t.controller.snapshot().warning).toMatch(/state\.json is corrupt/);
      w.emit({ type: 'pass-end', result: passResult });
      expect(t.controller.snapshot().warning).toBeUndefined();
    });

    it('a fatal error during a pass clears uploading', async () => {
      const t = setup();
      await t.controller.start();
      const w = t.watches[0] as FakeWatch;
      w.emit({ type: 'pass-start' });
      await vi.advanceTimersByTimeAsync(1_000);
      w.emit({ type: 'fatal', error: new FatalUploadError('unauthorized', 'nope') });
      expect(t.controller.snapshot().uploading).toBe(false);
    });

    it('warns when another uploader holds the lock for over 10 minutes', async () => {
      const t = setup();
      await t.controller.start();
      const w = t.watches[0] as FakeWatch;
      w.emit({ type: 'pass-error', error: new LockedError(OTHER_PID) });
      expect(t.controller.snapshot().warning).toBeUndefined();
      t.advance(11 * 60_000);
      w.emit({ type: 'pass-error', error: new LockedError(OTHER_PID) });
      expect(t.controller.snapshot().warning).toMatch(/Another Forever Ledger uploader/);
      w.emit({ type: 'pass-end', result: passResult });
      expect(t.controller.snapshot().warning).toBeUndefined();
    });

    it('ignores our own lock (an addon sync running) for the warning', async () => {
      const t = setup();
      await t.controller.start();
      const w = t.watches[0] as FakeWatch;
      w.emit({ type: 'pass-error', error: new LockedError(1) });
      t.advance(11 * 60_000);
      w.emit({ type: 'pass-error', error: new LockedError(1) });
      expect(t.controller.snapshot().warning).toBeUndefined();
    });

    it('a fatal error stops uploads, toasts, and Upload now restarts the watch', async () => {
      const t = setup();
      await t.controller.start();
      const w = t.watches[0] as FakeWatch;
      w.emit({ type: 'fatal', error: new FatalUploadError('unauthorized', 'token rejected') });
      expect(t.controller.snapshot().fatal).toBe('token rejected');
      expect(t.toasts).toContain('Uploads stopped: token rejected');

      t.controller.uploadNow();
      await flush();
      expect(t.uploader.startWatch).toHaveBeenCalledTimes(2);
      expect(t.controller.snapshot().fatal).toBeUndefined();
    });

    it('Upload now triggers the running watch', async () => {
      const t = setup();
      await t.controller.start();
      t.controller.uploadNow();
      expect(t.watches[0]?.trigger).toHaveBeenCalledTimes(1);
    });

    it('ignores events from a watch that was replaced', async () => {
      const t = setup();
      await t.controller.start();
      const old = t.watches[0] as FakeWatch;
      await t.controller.setPaused(true);
      await t.controller.setPaused(false);
      old.emit({ type: 'pass-start' });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(t.controller.snapshot().uploading).toBe(false);
    });
  });

  describe('addon sync', () => {
    it('runs every addonIntervalMs while auto-update is on', async () => {
      const t = setup();
      await t.controller.start();
      await flush();
      expect(t.uploader.syncAddon).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(t.uploader.syncAddon).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(t.uploader.syncAddon).toHaveBeenCalledTimes(4);
    });

    it('does not run on a timer when auto-update is off', async () => {
      const t = setup({ prefs: { autoUpdateAddon: false } });
      await t.controller.start();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(t.uploader.syncAddon).not.toHaveBeenCalled();
    });

    it('toasts when it installs a version', async () => {
      const t = setup();
      t.uploader.syncAddon.mockResolvedValue(
        syncResult({ status: 'installed', installed: '0.2.2', recommended: '0.2.2' }),
      );
      await t.controller.start();
      await flush();
      expect(t.toasts).toContain('ForeverLedger 0.2.2 installed — type /reload in game to use it');
    });

    it('toasts when it recovered an interrupted install', async () => {
      const t = setup();
      t.uploader.syncAddon.mockResolvedValue(
        syncResult({ status: 'up-to-date', recovered: ['/wow/AddOns'] }),
      );
      await t.controller.start();
      await flush();
      expect(t.toasts).toContain('ForeverLedger 0.2.1 installed — type /reload in game to use it');
    });

    it('skips a cycle while another process holds the lock and warns after 10 minutes', async () => {
      const t = setup();
      t.lockHolder.pid = OTHER_PID;
      await t.controller.start();
      await flush();
      expect(t.uploader.syncAddon).not.toHaveBeenCalled();
      expect(t.controller.snapshot().addon).toBeUndefined();
      expect(t.controller.snapshot().warning).toBeUndefined();

      t.advance(11 * 60_000);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(t.controller.snapshot().warning).toMatch(/can't be updated/);

      t.lockHolder.pid = undefined;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(t.uploader.syncAddon).toHaveBeenCalledTimes(1);
      expect(t.controller.snapshot().warning).toBeUndefined();
    });

    it('waits for our own upload pass to release the lock', async () => {
      const t = setup();
      t.lockHolder.pid = 1;
      await t.controller.start();
      await flush();
      expect(t.uploader.syncAddon).not.toHaveBeenCalled();
      t.lockHolder.pid = undefined;
      await vi.advanceTimersByTimeAsync(10);
      expect(t.uploader.syncAddon).toHaveBeenCalledTimes(1);
    });

    it('a sync that throws (no wowPath) shows as an addon error', async () => {
      const t = setup();
      t.uploader.syncAddon.mockRejectedValue(new Error('no WTF folder found'));
      await t.controller.start();
      await flush();
      expect(t.controller.snapshot().addon).toMatchObject({
        status: 'error',
        error: 'no WTF folder found',
      });
    });

    it('toasts once when addon sync has failed for over an hour', async () => {
      const t = setup();
      t.uploader.syncAddon.mockResolvedValue(syncResult({ status: 'error', error: 'HTTP 502' }));
      await t.controller.start();
      await flush();
      expect(t.toasts).toEqual([]);
      t.advance(61 * 60_000);
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(t.toasts).toEqual(['Addon updates have been failing for over an hour: HTTP 502']);
    });

    it('Update now forces a sync', async () => {
      const t = setup({ prefs: { autoUpdateAddon: false } });
      await t.controller.start();
      await t.controller.addonUpdateNow();
      expect(t.uploader.syncAddon).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
    });

    it('Roll back restores under the lock, toasts, and reloads the pause', async () => {
      const t = setup();
      await t.controller.start();
      await flush();
      t.uploader.readAddonSyncState.mockResolvedValue({ pausedWhileRecommended: '0.2.1' } as never);
      await t.controller.addonRollback();
      expect(t.uploader.rollbackAddonEverywhere).toHaveBeenCalledTimes(1);
      expect(t.controller.snapshot().addon?.installed).toBe('0.2.0');
      expect(t.controller.snapshot().addonPausedFor).toBe('0.2.1');
      expect(t.toasts.at(-1)).toMatch(/rolled back to 0\.2\.0/);
    });
  });

  describe('pause', () => {
    it('stops the watch and restarts it on resume', async () => {
      const t = setup();
      await t.controller.start();
      await t.controller.setPaused(true);
      expect(t.watches[0]?.close).toHaveBeenCalledTimes(1);
      expect(t.controller.snapshot().paused).toBe(true);
      t.controller.uploadNow();
      expect(t.watches[0]?.trigger).not.toHaveBeenCalled();

      await t.controller.setPaused(false);
      expect(t.uploader.startWatch).toHaveBeenCalledTimes(2);
      expect(t.controller.snapshot().paused).toBe(false);
    });
  });

  describe('saveSettings', () => {
    it('first run: writes the config with the default server, starts watching and syncs the addon', async () => {
      const t = setup({ file: undefined });
      await t.controller.start();
      await t.controller.saveSettings({ wowPath: '/wow', token: ' flt_new ' });
      await flush();
      expect(t.uploader.saveConfig).toHaveBeenCalledWith(CONFIG_PATH, {
        accounts: [],
        uploaderId: 'new-id',
        wowPath: '/wow',
        token: 'flt_new',
        serverUrl: DEFAULT_SERVER_URL,
      });
      expect(t.controller.snapshot().setupNeeded).toBe(false);
      expect(t.uploader.startWatch).toHaveBeenCalledTimes(1);
      expect(t.uploader.syncAddon).toHaveBeenCalledTimes(1);
    });

    it('a new token restarts the watch; an empty token keeps the old one', async () => {
      const t = setup();
      await t.controller.start();
      await t.controller.saveSettings({ token: 'flt_other' });
      expect(t.getFile()?.token).toBe('flt_other');
      expect(t.watches[0]?.close).toHaveBeenCalledTimes(1);
      expect(t.uploader.startWatch).toHaveBeenCalledTimes(2);

      await t.controller.saveSettings({ token: '', startWithWindows: false });
      expect(t.uploader.saveConfig).toHaveBeenCalledTimes(1);
      expect(t.getPrefs().startWithWindows).toBe(false);
      expect(t.uploader.startWatch).toHaveBeenCalledTimes(2);
    });

    it('a new WoW folder resets the account filter', async () => {
      const t = setup({ file: { ...FULL, accounts: ['OLD'] } });
      await t.controller.start();
      await t.controller.saveSettings({ wowPath: '/wow2' });
      expect(t.getFile()).toMatchObject({ wowPath: '/wow2', accounts: [] });
    });

    it('turning auto-update off stops the timer', async () => {
      const t = setup();
      await t.controller.start();
      await flush();
      await t.controller.saveSettings({ autoUpdateAddon: false });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(t.uploader.syncAddon).toHaveBeenCalledTimes(1);
      expect(t.controller.snapshot().settings.autoUpdateAddon).toBe(false);
    });

    it('rejects an invalid config without saving', async () => {
      const t = setup();
      await t.controller.start();
      t.uploader.validateConfigFile.mockImplementation(() => {
        throw new Error('serverUrl must start with http');
      });
      await expect(t.controller.saveSettings({ serverUrl: 'ftp://x' })).rejects.toThrow(/http/);
      expect(t.uploader.saveConfig).not.toHaveBeenCalled();
    });
  });

  it('setAppUpdateReady shows up in the snapshot', async () => {
    const t = setup();
    await t.controller.start();
    t.controller.setAppUpdateReady('0.1.1');
    expect(t.changes.at(-1)?.appUpdateReady).toBe('0.1.1');
  });

  it('stop closes the watch and the addon timer', async () => {
    const t = setup();
    await t.controller.start();
    await flush();
    await t.controller.stop();
    expect(t.watches[0]?.close).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(t.uploader.syncAddon).toHaveBeenCalledTimes(1);
  });
});
