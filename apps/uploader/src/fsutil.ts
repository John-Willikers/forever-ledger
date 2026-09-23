import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { sleep } from './time.js';

/** Errors Windows raises when a virus scanner or indexer briefly holds the target open. */
const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES']);

const code = (err: unknown) => (err as NodeJS.ErrnoException | undefined)?.code;

/** rename() with a few retries for Windows' transient sharing violations. */
export async function renameWithRetry(from: string, to: string, attempts = 5): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      if (i >= attempts || !TRANSIENT.has(code(err) ?? '')) throw err;
      await sleep(50 * i);
    }
  }
}

/** Writes via a temp file in the same directory + rename, so readers never see a half-written file. */
export async function writeFileAtomic(
  path: string,
  data: string,
  opts: { mode?: number } = {},
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await writeFile(tmp, data, { encoding: 'utf8', mode: opts.mode ?? 0o644, flush: true });
    await renameWithRetry(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

export async function writeJsonAtomic(
  path: string,
  value: unknown,
  opts: { mode?: number; pretty?: boolean } = {},
): Promise<void> {
  const json = opts.pretty === false ? JSON.stringify(value) : JSON.stringify(value, null, 2);
  await writeFileAtomic(path, `${json}\n`, opts);
}

/** Reads JSON, returning `undefined` when the file does not exist. */
export async function readJsonIfExists(path: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if (code(err) === 'ENOENT') return undefined;
    throw err;
  }
  return JSON.parse(text) as unknown;
}

export const isNotFound = (err: unknown) => code(err) === 'ENOENT';
