import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as uploader from '@forever-ledger/uploader/lib';
import type { Logger } from '@forever-ledger/uploader/lib';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  powerMonitor,
  shell,
  Tray,
} from 'electron';
import electronUpdater from 'electron-updater';
import { DEFAULT_PREFS, LedgerController } from './controller.js';
import type { Prefs } from './controller.js';
import { IPC, sanitizeSettings } from './ipc.js';
import type { WowFlavor, WowFolderPick } from './ipc.js';
import { LogSink } from './logSink.js';
import { deriveTrayState, TRAY_TOOLTIP } from './state.js';
import type { Snapshot, TrayState } from './state.js';

/** Replaced by esbuild with apps/desktop/package.json's version (app.getVersion() is Electron's in dev). */
declare const __APP_VERSION__: string | undefined;

const APP_ID = 'dev.willikers.forever-ledger';
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : app.getVersion();
const UPDATE_CHECK_MS = 6 * 60 * 60_000;
/** How long quitting waits for the watch and addon sync to stop before exiting anyway. */
const QUIT_TIMEOUT_MS = 5_000;
const here = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(here, '..', 'assets');
const smoke = Boolean(process.env.FL_SMOKE);
const startHidden = process.argv.includes('--hidden');

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A startup failure must not leave an invisible process behind: say what happened and exit. */
function startupFailed(err: unknown) {
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  let logPath = '(unknown)';
  try {
    logPath = join(app.getPath('logs'), 'forever-ledger.log');
  } catch {
    // keep the placeholder
  }
  try {
    process.stderr.write(`Forever Ledger could not start: ${detail}\n`);
  } catch {
    // no console (packaged Windows app)
  }
  dialog.showErrorBox('Forever Ledger could not start', `${detail}\n\nLog file: ${logPath}`);
  app.exit(1);
}

if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void app.whenReady().then(run).catch(startupFailed);
}

/** Prefs in `<userData>/prefs.json`; a missing or broken file means the defaults. */
function prefsStore(file: string, logger: Logger, onSet: (p: Prefs) => void) {
  let prefs: Prefs = { ...DEFAULT_PREFS };
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<Prefs>;
    if (typeof raw.startWithWindows === 'boolean') prefs.startWithWindows = raw.startWithWindows;
    if (typeof raw.autoUpdateAddon === 'boolean') prefs.autoUpdateAddon = raw.autoUpdateAddon;
    if (typeof raw.sendErrorReports === 'boolean') prefs.sendErrorReports = raw.sendErrorReports;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT')
      logger.warn({ file, err: errorMessage(err) }, 'ignoring unreadable prefs');
  }
  return {
    get: () => prefs,
    set: (p: Prefs) => {
      prefs = { ...p };
      try {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, `${JSON.stringify(prefs, null, 2)}\n`);
      } catch (err) {
        logger.error({ file, err: errorMessage(err) }, 'cannot save prefs');
      }
      onSet(prefs);
    },
  };
}

async function run() {
  const logsDir = app.getPath('logs');
  const sink = new LogSink(join(logsDir, 'forever-ledger.log'), {
    echo: app.isPackaged ? undefined : (line) => process.stdout.write(line),
  });
  const level = process.env.FL_LOG_LEVEL === 'debug' ? 'debug' : 'info';
  const logger = uploader.createLogger({ level, write: (line) => sink.write(line) });
  // Crashes also go into the error reports once the controller exists.
  const crash: { reports?: LedgerController } = {};
  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'uncaught exception');
    crash.reports?.reportProblem(
      {
        level: 'fatal',
        source: 'tray',
        message: `uncaught exception: ${err.message}`,
        detail: { stack: err.stack },
      },
      err.message,
    );
  });
  process.on('unhandledRejection', (err) => {
    logger.error({ err: errorMessage(err) }, 'unhandled rejection');
    crash.reports?.reportProblem(
      {
        level: 'error',
        source: 'tray',
        message: `unhandled rejection: ${errorMessage(err)}`,
        ...(err instanceof Error ? { detail: { stack: err.stack } } : {}),
      },
      errorMessage(err),
    );
  });

  const applyLoginItem = (p: Prefs) => {
    // Dev builds would register electron.exe; only the installed app starts with Windows.
    if (!app.isPackaged || smoke || process.platform === 'linux') return;
    app.setLoginItemSettings({ openAtLogin: p.startWithWindows, args: ['--hidden'] });
    logger.info({ openAtLogin: p.startWithWindows }, 'login item updated');
  };
  const prefs = prefsStore(join(app.getPath('userData'), 'prefs.json'), logger, applyLoginItem);
  applyLoginItem(prefs.get());

  const controller = new LedgerController({
    configPath: uploader.resolveConfigPath(),
    uploader,
    logger,
    appVersion: APP_VERSION,
    prefs,
  });
  crash.reports = controller;
  // Every WARN/ERROR/FATAL line is a candidate for the error reports (the controller drops duplicates).
  sink.onProblem((p) => controller.noteLogProblem(p));

  const notify = (body: string) => {
    if (!Notification.isSupported()) return;
    new Notification({ title: 'Forever Ledger', body, icon: join(assetsDir, 'icon.png') }).show();
  };
  controller.on('toast', notify);

  // ---- window ----
  let quitting = false;
  let win: BrowserWindow | undefined;
  const createWindow = () => {
    const w = new BrowserWindow({
      width: 480,
      height: 680,
      show: false,
      title: 'Forever Ledger',
      icon: join(assetsDir, 'icon.png'),
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(here, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    w.removeMenu();
    w.on('close', (e) => {
      if (quitting) return;
      e.preventDefault();
      w.hide();
    });
    // Windows logoff/shutdown: there's little time; stop quickly (the watch lets go of the lock).
    w.on('session-end', () => systemShutdown('session-end'));
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.on('will-navigate', (e) => e.preventDefault());
    void w.loadFile(join(here, 'index.html'));
    win = w;
    return w;
  };
  const showWindow = () => {
    const w = win && !win.isDestroyed() ? win : createWindow();
    if (w.isMinimized()) w.restore();
    w.show();
    w.focus();
  };
  const send = (channel: string, payload: unknown) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };
  let shuttingDown = false;
  const systemShutdown = (why: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ why }, 'system is shutting down; stopping');
    quitting = true;
    // The OS won't wait long: drop our lock after 2 s even if a pass is still stuck on the network.
    void Promise.race([controller.stop().catch(() => undefined), delay(2_000)]).then(() =>
      uploader.releaseHeldLocksSync(),
    );
  };
  // Linux/macOS; on Windows the window's session-end covers it.
  powerMonitor.on('shutdown', () => systemShutdown('shutdown'));
  app.on('second-instance', showWindow);
  // The window only hides; keep running in the tray even if it is ever destroyed.
  app.on('window-all-closed', () => undefined);
  sink.onLine((line) => send(IPC.logLine, line));

  // ---- app self-update ----
  let manualUpdateCheck = false;
  let readyToasted: string | undefined;
  const updater = (() => {
    if (!app.isPackaged || smoke) {
      logger.info('app self-update is off (not an installed build)');
      return undefined;
    }
    const { autoUpdater } = electronUpdater;
    autoUpdater.logger = {
      info: (m?: unknown) => logger.info(`updater: ${String(m)}`),
      warn: (m?: unknown) => logger.warn(`updater: ${String(m)}`),
      // Errors are logged once by the 'error' handler below.
      error: (m?: unknown) => logger.debug(`updater: ${String(m)}`),
      debug: (m: string) => logger.debug(`updater: ${m}`),
    };
    autoUpdater.autoDownload = true;
    autoUpdater.on('update-available', (info) => {
      logger.info({ version: info.version }, 'app update available; downloading');
      if (manualUpdateCheck) notify(`Downloading Forever Ledger ${info.version}…`);
      manualUpdateCheck = false;
    });
    autoUpdater.on('update-not-available', () => {
      logger.info({ version: APP_VERSION }, 'app is up to date');
      if (manualUpdateCheck) notify(`Forever Ledger ${APP_VERSION} is up to date.`);
      manualUpdateCheck = false;
    });
    autoUpdater.on('update-downloaded', (info) => {
      // Every 6-hour check reports the already-downloaded update again: tell the user once per version.
      if (readyToasted === info.version) return;
      readyToasted = info.version;
      controller.setAppUpdateReady(info.version);
      notify(`Forever Ledger ${info.version} is ready — open the window and restart to update.`);
    });
    autoUpdater.on('error', (err) => {
      logger.warn({ err: errorMessage(err) }, 'app update check failed');
      controller.reportProblem(
        {
          level: 'error',
          source: 'updater',
          message: `app update check failed: ${errorMessage(err)}`,
        },
        errorMessage(err),
      );
      if (manualUpdateCheck) notify(`Couldn't check for updates: ${errorMessage(err)}`);
      manualUpdateCheck = false;
    });
    const check = () =>
      autoUpdater.checkForUpdates().catch((err: unknown) => {
        // Also reported through the 'error' event.
        logger.debug({ err: errorMessage(err) }, 'checkForUpdates rejected');
      });
    void check();
    setInterval(() => void check(), UPDATE_CHECK_MS).unref();
    return { check, quitAndInstall: () => autoUpdater.quitAndInstall() };
  })();

  // ---- tray ----
  const icons = new Map<TrayState, Electron.NativeImage>();
  const icon = (s: TrayState) => {
    let img = icons.get(s);
    if (!img) {
      img = nativeImage.createFromPath(join(assetsDir, `tray-${s}.png`));
      icons.set(s, img);
    }
    return img;
  };
  const tray = new Tray(icon('idle'));
  tray.setToolTip(TRAY_TOOLTIP.idle);
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
  let trayState: TrayState = 'idle';

  const checkForUpdates = () => {
    logger.info('update check requested');
    void controller.addonCheckNow();
    if (updater) {
      manualUpdateCheck = true;
      void updater.check();
    }
  };
  const updateTray = (s: Snapshot) => {
    const state = deriveTrayState(s);
    if (state !== trayState) {
      trayState = state;
      tray.setImage(icon(state));
      logger.debug({ state }, 'tray state');
    }
    tray.setToolTip(s.paused ? 'Forever Ledger: uploads paused' : TRAY_TOOLTIP[state]);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Forever Ledger', click: showWindow },
        {
          label: 'Upload now',
          enabled: !s.setupNeeded && !s.paused,
          click: () => controller.uploadNow(),
        },
        { label: 'Check for updates', enabled: !s.setupNeeded, click: checkForUpdates },
        {
          label: 'Pause uploads',
          type: 'checkbox',
          checked: s.paused,
          enabled: !s.setupNeeded,
          click: (item) => void controller.setPaused(item.checked),
        },
        { label: 'Open logs folder', click: () => void shell.openPath(logsDir) },
        { type: 'separator' },
        {
          label: 'Quit',
          click: () => {
            quitting = true;
            app.quit();
          },
        },
      ]),
    );
  };
  controller.on('change', (s) => {
    updateTray(s);
    send(IPC.changed, s);
  });
  updateTray(controller.snapshot());

  // ---- IPC ----
  ipcMain.handle(IPC.state, () => controller.snapshot());
  ipcMain.handle(IPC.log, () => sink.recent());
  ipcMain.handle(IPC.uploadNow, () => controller.uploadNow());
  ipcMain.handle(IPC.pause, (_e, paused: unknown) => controller.setPaused(paused === true));
  ipcMain.handle(IPC.addonUpdate, () => controller.addonUpdateNow());
  ipcMain.handle(IPC.addonRollback, () => controller.addonRollback());
  ipcMain.handle(IPC.saveSettings, (_e, raw: unknown) =>
    controller.saveSettings(sanitizeSettings(raw)),
  );
  ipcMain.handle(IPC.pickWowFolder, async (): Promise<WowFolderPick | undefined> => {
    const opts: Electron.OpenDialogOptions = {
      title: 'Choose your World of Warcraft folder',
      properties: ['openDirectory'],
    };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    const path = res.filePaths[0];
    if (res.canceled || !path) return undefined;
    try {
      const d = await uploader.discoverSavedVariables(path, { accounts: [] });
      const pick: WowFolderPick = {
        path,
        accounts: [...new Set(d.files.map((f) => f.account))],
        notes: d.notes,
      };
      // Several flavors (_classic_era_, _classic_beta_…): the user picks one; wowPath becomes that flavor folder.
      if (d.wtfDirs.length > 1)
        pick.flavors = d.wtfDirs.map((wtfDir): WowFlavor => ({
          name: basename(dirname(wtfDir)),
          path: dirname(wtfDir),
          accounts: [...new Set(d.files.filter((f) => f.wtfDir === wtfDir).map((f) => f.account))],
        }));
      return pick;
    } catch (err) {
      return { path, accounts: [], notes: [errorMessage(err)] };
    }
  });
  ipcMain.handle(IPC.restartToUpdate, () => {
    if (!updater) return;
    logger.info('restarting to install the app update');
    quitting = true;
    updater.quitAndInstall();
  });
  ipcMain.handle(IPC.openLogs, () => shell.openPath(logsDir).then(() => undefined));

  // ---- quit ----
  let stopped = false;
  app.on('before-quit', (e) => {
    quitting = true;
    if (stopped) return;
    e.preventDefault();
    // A pass stuck on an unanswering server can take a minute to give up: don't wait for it.
    const stop = controller
      .stop()
      .then(() => true)
      .catch((err: unknown) => {
        logger.error({ err: errorMessage(err) }, 'stop failed');
        return true;
      });
    void Promise.race([stop, delay(QUIT_TIMEOUT_MS).then(() => false)]).then(async (clean) => {
      if (!clean) {
        logger.warn({ afterMs: QUIT_TIMEOUT_MS }, 'still busy; quitting anyway');
        // The interrupted pass's lock would otherwise stay behind with our pid.
        uploader.releaseHeldLocksSync();
      }
      stopped = true;
      await Promise.race([sink.close(), delay(500)]);
      app.quit();
    });
  });
  for (const sig of ['SIGINT', 'SIGTERM'] as const)
    process.on(sig, () => {
      logger.info({ signal: sig }, 'quitting on signal');
      app.quit();
    });

  // ---- start ----
  logger.info(
    { version: APP_VERSION, electron: process.versions.electron, logs: sink.file },
    'Forever Ledger app starting',
  );
  const w = createWindow();
  const ready = new Promise<void>((resolve) => w.once('ready-to-show', () => resolve()));
  // Show the window before the first upload pass and addon sync finish: they can take seconds (on Windows a refused
  // connection alone takes ~2 s) and the window fills in as their results arrive.
  const starting = controller.start();
  if (!startHidden) {
    await ready;
    showWindow();
  }
  await starting;
  if (startHidden && controller.snapshot().setupNeeded) {
    await ready;
    showWindow();
  }
}
