import { readFile, stat } from 'node:fs/promises';
import { SAVED_VARIABLE } from '@forever-ledger/contracts';
import { parseSavedVariables, SavedVariablesParseError } from '@forever-ledger/lua-sv-parser';
import type { Logger } from './log.js';
import { sleep } from './time.js';

export interface ReadOptions {
  /** Gap between the two stat() calls that must agree before reading (default 500 ms). */
  stableIntervalMs?: number;
  /** Give up waiting for a stable size/mtime after this many checks (default 20). */
  maxStableChecks?: number;
  /** Delays before re-reading a file that parsed as truncated (default 1s, 2s, 4s, 8s). */
  truncatedRetryDelaysMs?: number[];
  logger?: Logger;
}

export interface ReadResult {
  buffer: Buffer;
  size: number;
  mtimeMs: number;
}

/** Waits until size and mtime agree across two stat() calls, then reads the file. */
export async function readStableFile(path: string, opts: ReadOptions = {}): Promise<ReadResult> {
  const interval = opts.stableIntervalMs ?? 500;
  const maxChecks = opts.maxStableChecks ?? 20;
  let prev = await stat(path);
  for (let i = 0; i < maxChecks; i++) {
    await sleep(interval);
    const cur = await stat(path);
    if (cur.size === prev.size && cur.mtimeMs === prev.mtimeMs) {
      const buffer = await readFile(path);
      // A write that started between the stat and the read shows up as a size mismatch.
      if (buffer.length === cur.size) return { buffer, size: cur.size, mtimeMs: cur.mtimeMs };
    }
    prev = cur;
  }
  throw new Error(`${path} kept changing for ${(interval * maxChecks) / 1000}s; will retry later`);
}

/**
 * Reads and parses a SavedVariables file and returns the value of `global` (default ForeverLedgerDB).
 * A file that parses as truncated (WoW is mid-write) is re-read with backoff; other parse errors throw.
 */
export async function readSavedVariable(
  path: string,
  opts: ReadOptions & { global?: string } = {},
): Promise<{ value: unknown; read: ReadResult; attempts: number }> {
  const delays = opts.truncatedRetryDelaysMs ?? [1_000, 2_000, 4_000, 8_000];
  const global = opts.global ?? SAVED_VARIABLE;
  for (let attempt = 1; ; attempt++) {
    const read = await readStableFile(path, opts);
    try {
      const parsed = parseSavedVariables(read.buffer);
      const value = parsed[global];
      if (value === undefined) {
        // WoW truncates the file before writing it, so an empty file is a write in progress.
        const empty = read.buffer.toString('latin1').trim() === '';
        throw new SavedVariablesParseError(
          empty ? 'truncated' : 'syntax',
          empty ? `${path} is empty` : `${path} does not define ${global}`,
        );
      }
      return { value, read, attempts: attempt };
    } catch (err) {
      const delay = delays[attempt - 1];
      if (!(err instanceof SavedVariablesParseError) || err.reason !== 'truncated' || !delay)
        throw err;
      opts.logger?.debug(
        { file: path, attempt, retryInMs: delay },
        'file looks mid-write, retrying',
      );
      await sleep(delay);
    }
  }
}
