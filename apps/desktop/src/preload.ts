import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import { IPC } from './main/ipc.js';
import type { LedgerApi, WowFolderPick } from './main/ipc.js';
import type { Snapshot } from './main/state.js';

/** Subscribes to a main → renderer channel; returns the unsubscribe function. */
function listen<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const api: LedgerApi = {
  getState: () => ipcRenderer.invoke(IPC.state) as Promise<Snapshot>,
  onChange: (listener) => listen<Snapshot>(IPC.changed, listener),
  uploadNow: () => ipcRenderer.invoke(IPC.uploadNow) as Promise<void>,
  setPaused: (paused) => ipcRenderer.invoke(IPC.pause, paused) as Promise<void>,
  addonUpdateNow: () => ipcRenderer.invoke(IPC.addonUpdate) as Promise<void>,
  addonRollback: () => ipcRenderer.invoke(IPC.addonRollback) as Promise<void>,
  saveSettings: (input) => ipcRenderer.invoke(IPC.saveSettings, input) as Promise<void>,
  pickWowFolder: () => ipcRenderer.invoke(IPC.pickWowFolder) as Promise<WowFolderPick | undefined>,
  restartToUpdate: () => ipcRenderer.invoke(IPC.restartToUpdate) as Promise<void>,
  openLogs: () => ipcRenderer.invoke(IPC.openLogs) as Promise<void>,
  getLog: () => ipcRenderer.invoke(IPC.log) as Promise<string[]>,
  onLogLine: (listener) => listen<string>(IPC.logLine, listener),
};

contextBridge.exposeInMainWorld('ledger', api);
