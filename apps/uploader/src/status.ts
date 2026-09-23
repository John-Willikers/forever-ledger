import type { Config } from './config.js';
import { discoverSavedVariables } from './discover.js';
import { Queue } from './queue.js';
import { StateStore } from './state.js';
import { formatChicago } from './time.js';

export interface AccountStatus {
  account: string;
  file?: string;
  acked: number;
  queuedBatches: number;
  queuedRecords: number;
  rejectedBatches: number;
  rejectedRecords: number;
  lastSuccessAt?: number;
  lastError?: { at: number; message: string };
}

/** Per-account status from state.json, the queue and discovery. Read-only; no lock needed. */
export async function collectStatus(config: Config): Promise<AccountStatus[]> {
  const state = await StateStore.open(config.stateDir);
  const queue = new Queue(config.stateDir);
  const names = new Set([...state.accounts(), ...(await queue.accounts())]);
  const files = new Map<string, string>();
  if (config.wowPath) {
    const d = await discoverSavedVariables(config.wowPath, { accounts: config.accounts });
    for (const f of d.files) {
      names.add(f.account);
      files.set(f.account, f.file);
    }
  }
  const out: AccountStatus[] = [];
  for (const account of [...names].sort()) {
    const a = state.peek(account);
    const q = await queue.stats(account);
    out.push({
      account,
      file: files.get(account) ?? a?.file,
      acked: a ? Object.keys(a.acked).length : 0,
      queuedBatches: q.batches,
      queuedRecords: q.records,
      rejectedBatches: await queue.rejectedCount(account),
      rejectedRecords: Object.keys(a?.rejected ?? {}).length,
      lastSuccessAt: a?.lastSuccessAt,
      lastError: a?.lastError,
    });
  }
  return out;
}

export function formatStatus(config: Config, accounts: AccountStatus[]): string {
  const lines = [
    `config:   ${config.configPath}`,
    `state:    ${config.stateDir}`,
    `server:   ${config.serverUrl ?? '(not set)'}`,
    `uploader: ${config.uploaderId}`,
  ];
  if (accounts.length === 0) lines.push('', 'no accounts yet (run `forever-ledger upload-once`)');
  for (const a of accounts) {
    lines.push(
      '',
      `account ${a.account}${a.file ? `  (${a.file})` : ''}`,
      `  acked records:  ${a.acked}`,
      `  queued:         ${a.queuedBatches} batch(es), ${a.queuedRecords} record(s)`,
      `  last upload:    ${a.lastSuccessAt ? formatChicago(a.lastSuccessAt) : 'never'}`,
    );
    if (a.rejectedBatches || a.rejectedRecords)
      lines.push(
        `  rejected:       ${a.rejectedRecords} record(s) the server refused; see ${config.stateDir}/rejected`,
      );
    if (a.lastError)
      lines.push(`  last error:     ${formatChicago(a.lastError.at)}  ${a.lastError.message}`);
  }
  return lines.join('\n');
}
