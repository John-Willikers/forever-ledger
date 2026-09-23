import { createWriteStream, mkdirSync, openSync, renameSync, rmSync, statSync } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { dirname } from 'node:path';

export interface LogSinkOptions {
  /** Rotate when the file is bigger than this, at startup and while running (default 5 MB). */
  maxBytes?: number;
  /** Recent lines kept in memory for the window (default 50). */
  keep?: number;
  /** Also write every line here (dev: stdout). */
  echo?: (line: string) => void;
  /** Where the sink's own problems go (default stderr). Logging must never stop the app. */
  onError?: (message: string) => void;
}

/** `forever-ledger.log` → `forever-ledger.1.log`. */
export const rotatedPath = (file: string) => file.replace(/(\.log)?$/, '.1.log');

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Appends log lines to a file (over maxBytes it becomes `<name>.1.log` and a new file starts) and keeps the last few
 * in memory for the window's Activity list. File problems are reported once and never thrown.
 */
export class LogSink {
  private stream: WriteStream;
  private readonly lines: string[] = [];
  private readonly keep: number;
  private readonly maxBytes: number;
  private readonly listeners = new Set<(line: string) => void>();
  private size = 0;
  private reported = new Set<string>();

  constructor(
    readonly file: string,
    private readonly opts: LogSinkOptions = {},
  ) {
    this.keep = opts.keep ?? 50;
    this.maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
    try {
      mkdirSync(dirname(file), { recursive: true });
    } catch (err) {
      this.report('cannot create the log folder', err);
    }
    try {
      this.size = statSync(file).size;
    } catch {
      this.size = 0;
    }
    if (this.size > this.maxBytes) this.rotate();
    this.stream = this.open();
  }

  write(line: string): void {
    if (this.size > this.maxBytes && this.rotate()) {
      // The old stream keeps its handle on the renamed file and flushes what it still buffers there.
      this.stream.end();
      this.stream = this.open();
    }
    this.stream.write(line);
    this.size += Buffer.byteLength(line);
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

  private open(): WriteStream {
    // Opened synchronously so the file exists right away (a rotation can follow immediately).
    let fd: number | undefined;
    try {
      fd = openSync(this.file, 'a');
    } catch (err) {
      this.report('cannot open the log file', err);
    }
    const stream = createWriteStream(this.file, { flags: 'a', fd });
    stream.on('error', (err) => this.report('cannot write the log file', err));
    return stream;
  }

  /** Renames the file to `<name>.1.log`. On failure keeps appending and tries again after another maxBytes. */
  private rotate(): boolean {
    try {
      rmSync(rotatedPath(this.file), { force: true });
      renameSync(this.file, rotatedPath(this.file));
      this.size = 0;
      return true;
    } catch (err) {
      this.report('cannot rotate the log file', err);
      this.size = 0;
      return false;
    }
  }

  private report(what: string, err: unknown) {
    if (this.reported.has(what)) return;
    this.reported.add(what);
    const message = `forever-ledger: ${what} ${this.file}: ${errorMessage(err)}\n`;
    try {
      (this.opts.onError ?? ((m: string) => process.stderr.write(m)))(message);
    } catch {
      // Nowhere left to report to (no console in a packaged Windows app).
    }
  }
}
