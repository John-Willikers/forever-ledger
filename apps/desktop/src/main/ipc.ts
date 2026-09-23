import type { SettingsInput } from './controller.js';
import type { Snapshot } from './state.js';

/** IPC channel names shared by the main process and the preload script. */
export const IPC = {
  state: 'ledger:state',
  changed: 'ledger:changed',
  uploadNow: 'ledger:upload-now',
  pause: 'ledger:pause',
  addonUpdate: 'ledger:addon-update',
  addonRollback: 'ledger:addon-rollback',
  saveSettings: 'ledger:save-settings',
  pickWowFolder: 'ledger:pick-wow-folder',
  restartToUpdate: 'ledger:restart-to-update',
  openLogs: 'ledger:open-logs',
  /** Recent log lines (invoke) and each new line (main → renderer). */
  log: 'ledger:log',
  logLine: 'ledger:log-line',
} as const;

/** A game flavor folder (`_classic_era_`…) that has a WTF folder. */
export interface WowFlavor {
  name: string;
  path: string;
  accounts: string[];
}

/** What choosing a WoW folder found there. */
export interface WowFolderPick {
  path: string;
  accounts: string[];
  notes: string[];
  /** Set when the folder holds several flavors: the user picks one and wowPath becomes that flavor folder. */
  flavors?: WowFlavor[];
}

/** Settings the window may change (the server URL is only changed in config.json). */
export type WindowSettings = Omit<SettingsInput, 'serverUrl'>;

/** `window.ledger` in the renderer (exposed by the preload script). */
export interface LedgerApi {
  getState(): Promise<Snapshot>;
  onChange(listener: (s: Snapshot) => void): () => void;
  uploadNow(): Promise<void>;
  setPaused(paused: boolean): Promise<void>;
  addonUpdateNow(): Promise<void>;
  addonRollback(): Promise<void>;
  saveSettings(input: WindowSettings): Promise<void>;
  /** Undefined when the dialog was cancelled. */
  pickWowFolder(): Promise<WowFolderPick | undefined>;
  restartToUpdate(): Promise<void>;
  openLogs(): Promise<void>;
  getLog(): Promise<string[]>;
  onLogLine(listener: (line: string) => void): () => void;
}

/** Keeps only known, well-typed settings fields from renderer input (never the server URL). */
export function sanitizeSettings(raw: unknown): WindowSettings {
  const out: WindowSettings = {};
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as Record<string, unknown>;
  for (const k of ['wowPath', 'token'] as const) {
    const v = r[k];
    if (typeof v === 'string' && v.length <= 4096) out[k] = v;
  }
  for (const k of ['startWithWindows', 'autoUpdateAddon'] as const) {
    const v = r[k];
    if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}
