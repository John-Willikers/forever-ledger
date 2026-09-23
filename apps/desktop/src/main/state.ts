import type { AccountStatus, AddonSyncResult } from '@forever-ledger/uploader/lib';

export type TrayState = 'idle' | 'uploading' | 'queued' | 'error';

/** Everything the window and tray show. Sent to the renderer as-is. */
export interface Snapshot {
  setupNeeded: boolean;
  paused: boolean;
  uploading: boolean;
  accounts: AccountStatus[];
  fatal?: string;
  addon?: AddonSyncResult;
  addonPausedFor?: string;
  appVersion: string;
  appUpdateReady?: string;
  settings: {
    wowPath?: string;
    tokenSet: boolean;
    startWithWindows: boolean;
    autoUpdateAddon: boolean;
  };
}

/** Tray icon state; priority error > uploading > queued > idle. */
export function deriveTrayState(s: Snapshot): TrayState {
  if (s.fatal || s.addon?.status === 'error') return 'error';
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
