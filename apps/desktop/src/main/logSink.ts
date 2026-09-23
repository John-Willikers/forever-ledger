import { createWriteStream, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { dirname } from 'node:path';

export interface LogSinkOptions {
  /** Rotate at startup when the file is bigger than this (default 5 MB). */
  maxBytes?: number;
  /** Recent lines kept in memory for the window (default 50). */
  keep?: number;
  /** Also write every line here (dev: stdout). */
  echo?: (line: string) => void;
}

/** `forever-ledger.log` → `forever-ledger.1.log`. */
export const rotatedPath = (file: string) => file.replace(/(\.log)?$/, '.1.log');

/**
 * Appends log lines to a file (rotated once at startup: over maxBytes it becomes `<name>.1.log`) and keeps the last
 * few in memory for the window's Activity list.
 */
export class LogSink {
  private readonly stream: WriteStream;
  private readonly lines: string[] = [];
  private readonly keep: number;
  private readonly listeners = new Set<(line: string) => void>();

  constructor(
    readonly file: string,
    private readonly opts: LogSinkOptions = {},
  ) {
    this.keep = opts.keep ?? 50;
    mkdirSync(dirname(file), { recursive: true });
    try {
      if (statSync(file).size > (opts.maxBytes ?? 5 * 1024 * 1024)) {
        rmSync(rotatedPath(file), { force: true });
        renameSync(file, rotatedPath(file));
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    this.stream = createWriteStream(file, { flags: 'a' });
    // A full disk or a locked file must not take the app down; the window still shows recent lines.
    this.stream.on('error', () => undefined);
  }

  write(line: string): void {
    this.stream.write(line);
    this.opts.echo?.(line);
    const trimmed = line.replace(/\n+$/, '');
    this.lines.push(trimmed);
    if (this.lines.length > this.keep) this.lines.splice(0, this.lines.length - this.keep);
    for (const l of this.listeners) l(trimmed);
  }

  /** The last `keep` lines, oldest first, without trailing newlines. */
  recent(): string[] {
    return [...this.lines];
  }

  onLine(listener: (line: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.stream.end(resolve));
  }
}
