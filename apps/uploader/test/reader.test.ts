import { writeFile } from 'node:fs/promises';
import { UnsupportedSchemaError } from '@forever-ledger/contracts';
import { SavedVariablesParseError } from '@forever-ledger/lua-sv-parser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runUploadPass } from '../src/pass.js';
import { Queue } from '../src/queue.js';
import { readSavedVariable } from '../src/reader.js';
import { StateStore } from '../src/state.js';
import { FAST_READ, readFixture, tempEnv } from './helpers/fixtures.js';
import type { TempEnv } from './helpers/fixtures.js';

let env: TempEnv;
beforeEach(async () => {
  env = await tempEnv();
});
afterEach(() => env.cleanup());

describe('readSavedVariable', () => {
  it('retries a truncated (mid-write) file and succeeds once the full file appears', async () => {
    const full = await readFixture('session-v1.lua');
    const file = await env.writeSv(full.slice(0, Math.floor(full.length / 2)));
    setTimeout(() => void writeFile(file, full), 30);
    const res = await readSavedVariable(file, {
      stableIntervalMs: 5,
      truncatedRetryDelaysMs: [60, 60, 60],
    });
    expect(res.attempts).toBeGreaterThan(1);
    expect((res.value as { meta: { schemaVersion: number } }).meta.schemaVersion).toBe(1);
  });

  it('treats an empty file as mid-write', async () => {
    const full = await readFixture('session-v1.lua');
    const file = await env.writeSv('');
    setTimeout(() => void writeFile(file, full), 30);
    const res = await readSavedVariable(file, {
      stableIntervalMs: 5,
      truncatedRetryDelaysMs: [60, 60],
    });
    expect(res.attempts).toBeGreaterThan(1);
  });

  it('gives up after the configured retries with a truncated error', async () => {
    const full = await readFixture('session-v1.lua');
    const file = await env.writeSv(full.slice(0, 500));
    await expect(readSavedVariable(file, FAST_READ)).rejects.toMatchObject({
      name: 'SavedVariablesParseError',
      reason: 'truncated',
    });
  });

  it('does not retry other parse errors', async () => {
    const file = await env.writeSv('ForeverLedgerDB = os.execute("rm -rf /")\n');
    const err = await readSavedVariable(file, FAST_READ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SavedVariablesParseError);
    expect((err as SavedVariablesParseError).reason).not.toBe('truncated');
  });

  it('waits for size/mtime to settle before reading', async () => {
    const full = await readFixture('session-v1.lua');
    const file = await env.writeSv(full.slice(0, 100));
    // Keep growing the file for a bit; the reader must only parse the final content.
    let n = 100;
    const grow = setInterval(() => {
      n = Math.min(full.length, n + 1500);
      void writeFile(file, full.slice(0, n));
      if (n === full.length) clearInterval(grow);
    }, 10);
    const res = await readSavedVariable(file, {
      stableIntervalMs: 40,
      truncatedRetryDelaysMs: [80, 80, 80],
    });
    clearInterval(grow);
    expect(res.read.size).toBe(Buffer.byteLength(full));
  });
});

describe('unsupported schema', () => {
  it('v0 file → clear UnsupportedSchemaError message, nothing queued', async () => {
    await env.writeSv(await readFixture('session-v0.lua'));
    const config = env.config({ serverUrl: 'http://ledger.test' });
    let posted = 0;
    const res = await runUploadPass({
      config,
      read: FAST_READ,
      fetchImpl: async () => {
        posted++;
        return Response.json({});
      },
    });
    expect(res.ok).toBe(false);
    expect(res.files[0]?.ok).toBe(false);
    expect(res.files[0]?.error).toContain(new UnsupportedSchemaError(undefined).message);
    expect(res.files[0]?.error).toMatch(/v0\.2\.0\+ to migrate/);
    expect(posted).toBe(0);
    expect(await new Queue(config.stateDir).stats('TESTACCT')).toEqual({ batches: 0, records: 0 });
    const state = await StateStore.open(config.stateDir);
    expect(state.peek('TESTACCT')?.lastError?.message).toMatch(/schemaVersion/);
  });
});
