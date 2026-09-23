import type { AccountStatus, AddonSyncResult } from '@forever-ledger/uploader/lib';
import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../src/main/state.js';
import {
  accountLine,
  addonLine,
  chicagoTime,
  ipcErrorMessage,
  uploadsLine,
} from '../src/renderer/format.js';

const SEP_23_0522_CDT = Date.UTC(2026, 8, 23, 10, 22);
const JAN_15_1205_CST = Date.UTC(2026, 0, 15, 18, 5);

const account = (over: Partial<AccountStatus> = {}): AccountStatus => ({
  account: 'ACC1',
  acked: 12,
  queuedBatches: 0,
  queuedRecords: 0,
  rejectedBatches: 0,
  rejectedRecords: 0,
  lastSuccessAt: SEP_23_0522_CDT,
  ...over,
});

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  setupNeeded: false,
  paused: false,
  uploading: false,
  accounts: [account()],
  appVersion: '0.1.0',
  settings: { tokenSet: true, startWithWindows: true, autoUpdateAddon: true },
  ...over,
});

const addon = (over: Partial<AddonSyncResult>): AddonSyncResult => ({
  status: 'up-to-date',
  addonsDirs: [],
  checkedAt: 1_790_000_000,
  ...over,
});

describe('chicagoTime', () => {
  it('formats in America/Chicago with daylight time', () => {
    expect(chicagoTime(SEP_23_0522_CDT)).toBe('Sep 23, 2026 5:22 AM CDT');
  });
  it('formats standard time', () => {
    expect(chicagoTime(JAN_15_1205_CST)).toBe('Jan 15, 2026 12:05 PM CST');
  });
});

describe('uploadsLine', () => {
  it('shows the last upload when everything is sent', () => {
    expect(uploadsLine(snap())).toBe('Up to date · last upload Sep 23, 2026 5:22 AM CDT');
  });
  it('uses the newest upload across accounts', () => {
    const accounts = [account({ lastSuccessAt: JAN_15_1205_CST }), account({ account: 'B' })];
    expect(uploadsLine(snap({ accounts }))).toMatch(/Sep 23, 2026/);
  });
  it('ranks setup > stopped > paused > uploading > queued', () => {
    const queued = [account({ queuedBatches: 2, queuedRecords: 40 })];
    expect(uploadsLine(snap({ setupNeeded: true, fatal: 'x' }))).toBe('Not set up yet');
    expect(uploadsLine(snap({ fatal: 'x', paused: true }))).toBe('Uploads stopped');
    expect(uploadsLine(snap({ paused: true, uploading: true }))).toBe('Paused');
    expect(uploadsLine(snap({ uploading: true, accounts: queued }))).toBe('Uploading…');
    expect(uploadsLine(snap({ accounts: queued }))).toBe('2 batches waiting for the server');
    expect(uploadsLine(snap({ accounts: [account({ queuedBatches: 1 })] }))).toBe(
      '1 batch waiting for the server',
    );
  });
  it('explains an empty or never-uploaded state', () => {
    expect(uploadsLine(snap({ accounts: [] }))).toMatch(/^Waiting for ForeverLedger\.lua/);
    expect(uploadsLine(snap({ accounts: [account({ lastSuccessAt: undefined })] }))).toBe(
      'Up to date · nothing uploaded yet',
    );
  });
});

describe('addonLine', () => {
  it('shows a newer recommendation with the build', () => {
    const a = addon({ installed: '0.2.1', recommended: '0.2.2', build: 69913 });
    expect(addonLine(snap({ addon: a }))).toBe(
      '0.2.1 installed · server recommends 0.2.2 for build 69913',
    );
  });
  it('is up to date when installed matches', () => {
    const a = addon({ status: 'installed', installed: '0.2.2', recommended: '0.2.2', build: 1 });
    expect(addonLine(snap({ addon: a }))).toBe('0.2.2 installed · up to date for build 1');
  });
  it('covers error, no release, paused and not checked', () => {
    expect(addonLine(snap({ addon: addon({ status: 'error', error: 'HTTP 502' }) }))).toBe(
      'Not installed · last check failed',
    );
    expect(addonLine(snap({ addon: addon({ status: 'no-release', installed: '0.2.1' }) }))).toBe(
      '0.2.1 installed · no release published yet',
    );
    expect(
      addonLine(
        snap({ addon: addon({ status: 'paused', installed: '0.2.0', recommended: '0.2.1' }) }),
      ),
    ).toBe('0.2.0 installed · auto-update paused after a roll back (server recommends 0.2.1)');
    expect(addonLine(snap())).toBe('Not checked yet');
    expect(addonLine(snap({ setupNeeded: true }))).toBe('Not set up yet');
  });
});

describe('accountLine', () => {
  it('summarises an account', () => {
    expect(accountLine(account({ queuedBatches: 1, queuedRecords: 3, rejectedRecords: 1 }))).toBe(
      'ACC1: 12 records uploaded · 3 records queued · 1 record refused by the server · last Sep 23, 2026 5:22 AM CDT',
    );
    expect(accountLine(account({ acked: 1, lastSuccessAt: undefined }))).toBe(
      'ACC1: 1 record uploaded · never uploaded',
    );
  });
});

describe('ipcErrorMessage', () => {
  it('strips the Electron IPC prefix', () => {
    expect(
      ipcErrorMessage(
        new Error("Error invoking remote method 'ledger:save-settings': ConfigError: bad url"),
      ),
    ).toBe('bad url');
    expect(ipcErrorMessage('plain')).toBe('plain');
  });
});
