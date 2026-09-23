import { join } from 'node:path';
import type { Acknowledged } from '@forever-ledger/contracts';
import { readJsonIfExists, writeJsonAtomic } from './fsutil.js';

export interface AccountState {
  /** recordKey → contentHash of what the server has acknowledged. */
  acked: Record<string, string>;
  /** recordKey → contentHash the server rejected (400); not re-sent until the record changes. */
  rejected?: Record<string, string>;
  file?: string;
  /** Epoch ms of the last 2xx from /v1/ingest. */
  lastSuccessAt?: number;
  lastError?: { at: number; message: string };
}

export interface StateFile {
  version: 1;
  accounts: Record<string, AccountState>;
}

/** `stateDir/state.json`, rewritten atomically after every change. */
export class StateStore {
  readonly path: string;
  private data: StateFile = { version: 1, accounts: {} };

  constructor(stateDir: string) {
    this.path = join(stateDir, 'state.json');
  }

  static async open(stateDir: string): Promise<StateStore> {
    const store = new StateStore(stateDir);
    const raw = (await readJsonIfExists(store.path)) as StateFile | undefined;
    if (raw !== undefined) {
      if (raw.version !== 1 || typeof raw.accounts !== 'object' || raw.accounts === null)
        throw new Error(`${store.path} is not a Forever Ledger state file`);
      store.data = raw;
    }
    return store;
  }

  accounts(): string[] {
    return Object.keys(this.data.accounts);
  }

  account(name: string): AccountState {
    let a = this.data.accounts[name];
    if (!a) {
      a = { acked: {} };
      this.data.accounts[name] = a;
    }
    return a;
  }

  peek(name: string): AccountState | undefined {
    return this.data.accounts[name];
  }

  async markAcked(name: string, acks: Acknowledged[], at = Date.now()): Promise<void> {
    const a = this.account(name);
    for (const { key, hash } of acks) {
      a.acked[key] = hash;
      if (a.rejected?.[key] !== undefined) delete a.rejected[key];
    }
    a.lastSuccessAt = at;
    await this.save();
  }

  async markRejected(name: string, entries: Acknowledged[]): Promise<void> {
    const a = this.account(name);
    a.rejected ??= {};
    for (const { key, hash } of entries) a.rejected[key] = hash;
    await this.save();
  }

  async setError(name: string, message: string, at = Date.now()): Promise<void> {
    this.account(name).lastError = { at, message };
    await this.save();
  }

  async clearError(name: string): Promise<void> {
    const a = this.account(name);
    if (!a.lastError) return;
    delete a.lastError;
    await this.save();
  }

  async setFile(name: string, file: string): Promise<void> {
    const a = this.account(name);
    if (a.file === file) return;
    a.file = file;
    await this.save();
  }

  async save(): Promise<void> {
    await writeJsonAtomic(this.path, this.data, { pretty: false });
  }
}
