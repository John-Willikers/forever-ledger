import type { AccountStatus, AddonSyncResult } from '@forever-ledger/uploader/lib';
import { describe, expect, it } from 'vitest';
import { deriveTrayState, TRAY_TOOLTIP } from '../src/main/state.js';
import type { Snapshot, TrayState } from '../src/main/state.js';

function account(over: Partial<AccountStatus> = {}): AccountStatus {
  return {
    account: 'ACCOUNT1',
    acked: 10,
    queuedBatches: 0,
    queuedRecords: 0,
    rejectedBatches: 0,
    rejectedRecords: 0,
    ...over,
  };
}

function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    setupNeeded: false,
    paused: false,
    uploading: false,
    accounts: [account()],
    appVersion: '0.1.0',
    diagnostics: { enabled: true, pending: 0 },
    settings: {
      tokenSet: true,
      startWithWindows: true,
      autoUpdateAddon: true,
      sendErrorReports: true,
    },
    ...over,
  };
}

const addon = (status: AddonSyncResult['status']): AddonSyncResult => ({
  status,
  addonsDirs: ['C:/WoW/Interface/AddOns'],
  checkedAt: 1_790_000_000,
  ...(status === 'error'
    ? { error: 'sha256 mismatch' }
    : { installed: '0.2.1', recommended: '0.2.1' }),
});
const addonError = addon('error');
const addonUpToDate = addon('up-to-date');
const queued = [account(), account({ account: 'ACCOUNT2', queuedBatches: 2, queuedRecords: 40 })];

describe('deriveTrayState', () => {
  it('is idle when nothing is happening', () => {
    expect(deriveTrayState(snapshot())).toBe('idle');
    expect(deriveTrayState(snapshot({ accounts: [] }))).toBe('idle');
    expect(deriveTrayState(snapshot({ addon: addonUpToDate }))).toBe('idle');
  });

  it('is uploading during a pass', () => {
    expect(deriveTrayState(snapshot({ uploading: true }))).toBe('uploading');
  });

  it('is queued when any account has batches waiting', () => {
    expect(deriveTrayState(snapshot({ accounts: queued }))).toBe('queued');
  });

  it('is error on a fatal error, a lasting warning or a failed addon sync', () => {
    expect(deriveTrayState(snapshot({ fatal: 'locked' }))).toBe('error');
    expect(deriveTrayState(snapshot({ warning: 'another uploader is running' }))).toBe('error');
    expect(deriveTrayState(snapshot({ addon: addonError }))).toBe('error');
  });

  it('is not error while a new addon failure is still being retried', () => {
    expect(deriveTrayState(snapshot({ addon: addonError, addonRetrying: true }))).toBe('idle');
  });

  it('ranks error > uploading > queued > idle', () => {
    expect(deriveTrayState(snapshot({ fatal: 'x', uploading: true, accounts: queued }))).toBe(
      'error',
    );
    expect(
      deriveTrayState(snapshot({ addon: addonError, uploading: true, accounts: queued })),
    ).toBe('error');
    expect(deriveTrayState(snapshot({ uploading: true, accounts: queued }))).toBe('uploading');
  });
});

describe('TRAY_TOOLTIP', () => {
  it('has a Forever Ledger tooltip for every state', () => {
    const states: TrayState[] = ['idle', 'uploading', 'queued', 'error'];
    for (const s of states) expect(TRAY_TOOLTIP[s]).toMatch(/^Forever Ledger: /);
  });
});
