import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LogSink, rotatedPath } from '../src/main/logSink.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fl-logsink-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('LogSink', () => {
  it('appends lines to the file and creates its folder', async () => {
    const file = join(dir, 'logs', 'forever-ledger.log');
    const sink = new LogSink(file);
    sink.write('one\n');
    sink.write('two\n');
    await sink.close();
    const again = new LogSink(file);
    again.write('three\n');
    await again.close();
    expect(await readFile(file, 'utf8')).toBe('one\ntwo\nthree\n');
  });

  it('rotates a file over maxBytes at startup', async () => {
    const file = join(dir, 'forever-ledger.log');
    await writeFile(file, 'x'.repeat(100));
    await writeFile(rotatedPath(file), 'older');
    const sink = new LogSink(file, { maxBytes: 50 });
    sink.write('fresh\n');
    await sink.close();
    expect(rotatedPath(file)).toBe(join(dir, 'forever-ledger.1.log'));
    expect(await readFile(rotatedPath(file), 'utf8')).toBe('x'.repeat(100));
    expect(await readFile(file, 'utf8')).toBe('fresh\n');
  });

  it('keeps the last lines in memory and notifies listeners', async () => {
    const sink = new LogSink(join(dir, 'a.log'), { keep: 3 });
    const seen: string[] = [];
    const off = sink.onLine((l) => seen.push(l));
    for (const n of [1, 2, 3, 4, 5]) sink.write(`line ${n}\n`);
    off();
    sink.write('line 6\n');
    await sink.close();
    expect(sink.recent()).toEqual(['line 4', 'line 5', 'line 6']);
    expect(seen).toHaveLength(5);
  });
});
