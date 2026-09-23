import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renameDirWithRetry } from '../src/fsutil.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fl-fsutil-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A folder the rename can't replace (ENOTEMPTY on POSIX, EPERM on Windows) until it is removed. */
async function blocker(path: string) {
  await mkdir(path, { recursive: true });
  await writeFile(join(path, 'x'), 'x');
}

describe('renameDirWithRetry', () => {
  it('keeps retrying until the destination frees up', async () => {
    await mkdir(join(dir, 'a'));
    await blocker(join(dir, 'b'));
    setTimeout(() => void rm(join(dir, 'b'), { recursive: true, force: true }), 150);
    await renameDirWithRetry(join(dir, 'a'), join(dir, 'b'), { budgetMs: 5_000 });
    expect(await readdir(dir)).toEqual(['b']);
  });

  it('gives up after its budget', async () => {
    await mkdir(join(dir, 'a'));
    await blocker(join(dir, 'b'));
    const started = Date.now();
    await expect(
      renameDirWithRetry(join(dir, 'a'), join(dir, 'b'), { budgetMs: 200 }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/ENOTEMPTY|EPERM|EEXIST/) });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('fails at once on errors that will not go away', async () => {
    const started = Date.now();
    await expect(
      renameDirWithRetry(join(dir, 'missing'), join(dir, 'b'), { budgetMs: 5_000 }),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
