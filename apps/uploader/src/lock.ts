import { mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import { uptime } from 'node:os';
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

export interface LockOptions {
  now?: () => number;
  /** Seconds since the OS booted (os.uptime). */
  uptimeSec?: () => number;
}

/** A lock file this much older than the boot-time estimate is from before the last boot. */
const BOOT_SLACK_MS = 30_000;

/** Written before the last boot: its pid may have been reused by an unrelated process since (Windows). */
async function fromBeforeBoot(path: string, opts: LockOptions): Promise<boolean> {
  const mtimeMs = await stat(path).then(
    (st) => st.mtimeMs,
    () => undefined,
  );
  if (mtimeMs === undefined) return false;
  const bootMs = (opts.now ?? Date.now)() - (opts.uptimeSec ?? uptime)() * 1000;
  return mtimeMs < bootMs - BOOT_SLACK_MS;
}

/**
 * Exclusive lock on the state folder so `watch` and `upload-once` never flush the same queue at once.
 * A lock left behind by a dead process, or written before the last boot, is taken over.
 */
export async function acquireLock(
  stateDir: string,
  opts: LockOptions = {},
): Promise<() => Promise<void>> {
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
      if (pid === process.pid || !alive(pid) || (await fromBeforeBoot(path, opts))) {
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
