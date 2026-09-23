import type { AccountStatus, AddonSyncResult } from '@forever-ledger/uploader/lib';

export type TrayState = 'idle' | 'uploading' | 'queued' | 'error';

/** Everything the window and tray show. Sent to the renderer as-is. */
export interface Snapshot {
  setupNeeded: boolean;
  paused: boolean;
  uploading: boolean;
  accounts: AccountStatus[];
  /** Uploads stopped until the user fixes something (bad token, unreadable config…). */
  fatal?: string;
  /** Something that has been going wrong for a while but may fix itself (another uploader holds the lock). */
  warning?: string;
  addon?: AddonSyncResult;
  addonPausedFor?: string;
  appVersion: string;
  appUpdateReady?: string;
  settings: {
    wowPath?: string;
    serverUrl?: string;
    tokenSet: boolean;
    startWithWindows: boolean;
    autoUpdateAddon: boolean;
  };
}

/** Tray icon state; priority error > uploading > queued > idle. */
export function deriveTrayState(s: Snapshot): TrayState {
  if (s.fatal || s.warning || s.addon?.status === 'error') return 'error';
  if (s.uploading) return 'uploading';
  if (s.accounts.some((a) => a.queuedBatches > 0)) return 'queued';
  return 'idle';
}

export const TRAY_TOOLTIP: Record<TrayState, string> = {
  idle: 'Forever Ledger: up to date',
  uploading: 'Forever Ledger: uploading…',
  queued: 'Forever Ledger: waiting for the server (batches queued)',
  error: 'Forever Ledger: needs attention',
};
