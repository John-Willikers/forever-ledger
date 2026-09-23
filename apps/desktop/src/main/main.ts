import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
  shell,
  Tray,
} from 'electron';
import electronUpdater from 'electron-updater';
import { DEFAULT_PREFS, LedgerController } from './controller.js';
import type { Prefs } from './controller.js';
import { IPC, sanitizeSettings } from './ipc.js';
import type { WowFolderPick } from './ipc.js';
import { LogSink } from './logSink.js';
import { deriveTrayState, TRAY_TOOLTIP } from './state.js';
import type { Snapshot, TrayState } from './state.js';

/** Replaced by esbuild with apps/desktop/package.json's version (app.getVersion() is Electron's in dev). */
declare const __APP_VERSION__: string | undefined;

const APP_ID = 'dev.willikers.forever-ledger';
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : app.getVersion();
const UPDATE_CHECK_MS = 6 * 60 * 60_000;
const here = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(here, '..', 'assets');
const smoke = Boolean(process.env.FL_SMOKE);
const startHidden = process.argv.includes('--hidden');

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void app.whenReady().then(run);
}

/** Prefs in `<userData>/prefs.json`; a missing or broken file means the defaults. */
function prefsStore(file: string, logger: Logger, onSet: (p: Prefs) => void) {
  let prefs: Prefs = { ...DEFAULT_PREFS };
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<Prefs>;
    if (typeof raw.startWithWindows === 'boolean') prefs.startWithWindows = raw.startWithWindows;
    if (typeof raw.autoUpdateAddon === 'boolean') prefs.autoUpdateAddon = raw.autoUpdateAddon;
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
  process.on('uncaughtException', (err) => logger.error({ err }, 'uncaught exception'));
  process.on('unhandledRejection', (err) =>
    logger.error({ err: errorMessage(err) }, 'unhandled rejection'),
  );

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
  app.on('second-instance', showWindow);
  // The window only hides; keep running in the tray even if it is ever destroyed.
  app.on('window-all-closed', () => undefined);
  sink.onLine((line) => send(IPC.logLine, line));

  // ---- app self-update ----
  let manualUpdateCheck = false;
  const updater = (() => {
    if (!app.isPackaged || smoke) {
      logger.info('app self-update is off (not an installed build)');
      return undefined;
    }
    const { autoUpdater } = electronUpdater;
    autoUpdater.logger = {
      info: (m?: unknown) => logger.info(`updater: ${String(m)}`),
      warn: (m?: unknown) => logger.warn(`updater: ${String(m)}`),
      error: (m?: unknown) => logger.error(`updater: ${String(m)}`),
      debug: (m: string) => logger.debug(`updater: ${m}`),
    };
    autoUpdater.autoDownload = true;
    autoUpdater.on('update-available', (info) =>
      logger.info({ version: info.version }, 'app update available; downloading'),
    );
    autoUpdater.on('update-not-available', () => {
      logger.info({ version: APP_VERSION }, 'app is up to date');
      if (manualUpdateCheck) notify(`Forever Ledger ${APP_VERSION} is up to date.`);
      manualUpdateCheck = false;
    });
    autoUpdater.on('update-downloaded', (info) => {
      controller.setAppUpdateReady(info.version);
      notify(`Forever Ledger ${info.version} is ready — open the window and restart to update.`);
    });
    autoUpdater.on('error', (err) => {
      logger.warn({ err: errorMessage(err) }, 'app update check failed');
      manualUpdateCheck = false;
    });
    const check = () =>
      autoUpdater.checkForUpdates().catch((err: unknown) => {
        logger.warn({ err: errorMessage(err) }, 'app update check failed');
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
      return { path, accounts: [...new Set(d.files.map((f) => f.account))], notes: d.notes };
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
    void controller
      .stop()
      .catch((err: unknown) => logger.error({ err: errorMessage(err) }, 'stop failed'))
      .finally(async () => {
        stopped = true;
        await sink.close();
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
