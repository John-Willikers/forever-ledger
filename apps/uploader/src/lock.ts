import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Locks held by this process (a pid match alone could be a stale file from before a reboot). */
const held = new Set<string>();

export class LockedError extends Error {
  constructor(readonly pid: number) {
    super(`another forever-ledger uploader (pid ${pid}) is using this state folder`);
    this.name = 'LockedError';
  }
}

/**
 * Exclusive lock on the state folder so `watch` and `upload-once` never flush the same queue at once.
 * A lock left behind by a dead process is taken over.
 */
export async function acquireLock(stateDir: string): Promise<() => Promise<void>> {
  await mkdir(stateDir, { recursive: true });
  const path = join(stateDir, 'uploader.lock');
  if (held.has(path)) throw new LockedError(process.pid);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fh = await open(path, 'wx');
      await fh.writeFile(String(process.pid));
      await fh.close();
      held.add(path);
      return async () => {
        held.delete(path);
        await rm(path, { force: true });
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const pid = Number((await readFile(path, 'utf8').catch(() => '')).trim());
      if (pid === process.pid || !alive(pid)) {
        await rm(path, { force: true });
        continue;
      }
      throw new LockedError(pid);
    }
  }
  throw new Error(`could not lock ${path}`);
}

export async function withLock<T>(stateDir: string, fn: () => Promise<T>): Promise<T> {
  const release = await acquireLock(stateDir);
  try {
    return await fn();
  } finally {
    await release();
  }
}
