import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acquireLock, LockedError, releaseHeldLocksSync } from '../src/lock.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fl-lock-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A pid that is alive but isn't us: our parent (the test runner's launcher). */
const OTHER_ALIVE_PID = process.ppid;

async function writeLock(pid: number, mtimeMs: number) {
  await mkdir(dir, { recursive: true });
  const path = join(dir, 'uploader.lock');
  await writeFile(path, String(pid));
  await utimes(path, mtimeMs / 1000, mtimeMs / 1000);
  return path;
}

describe('acquireLock', () => {
  it('refuses a lock held by another live process since this boot', async () => {
    const now = Date.now();
    await writeLock(OTHER_ALIVE_PID, now - 60_000);
    // Booted an hour ago: the lock was written after boot.
    await expect(acquireLock(dir, { now: () => now, uptimeSec: () => 3_600 })).rejects.toThrow(
      LockedError,
    );
  });

  it('takes over a lock written before the last boot even if its pid is alive again (pid reuse)', async () => {
    const now = Date.now();
    const path = await writeLock(OTHER_ALIVE_PID, now - 2 * 3_600_000);
    // Booted 10 minutes ago; the lock is from two hours ago.
    const release = await acquireLock(dir, { now: () => now, uptimeSec: () => 600 });
    expect((await readFile(path, 'utf8')).trim()).toBe(String(process.pid));
    await release();
  });

  it('keeps a slack around the boot time (a lock from just after boot stays valid)', async () => {
    const now = Date.now();
    // Boot estimate 10 minutes ago; the lock is 5 s older than that estimate (inside the slack).
    await writeLock(OTHER_ALIVE_PID, now - 600_000 - 5_000);
    await expect(acquireLock(dir, { now: () => now, uptimeSec: () => 600 })).rejects.toThrow(
      LockedError,
    );
  });

  it('takes over a lock whose pid is dead', async () => {
    await writeLock(2 ** 22 + 12_345, Date.now());
    const release = await acquireLock(dir);
    await release();
  });

  it('releaseHeldLocksSync deletes the locks this process holds', async () => {
    await acquireLock(dir);
    expect(existsSync(join(dir, 'uploader.lock'))).toBe(true);
    releaseHeldLocksSync();
    expect(existsSync(join(dir, 'uploader.lock'))).toBe(false);
    const release = await acquireLock(dir);
    await release();
  });
});
