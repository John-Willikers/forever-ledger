import { pino } from 'pino';
import type { DestinationStream, Level, Logger } from 'pino';
import { formatChicago } from './time.js';

export type { Logger } from 'pino';

export interface LoggerOptions {
  level?: Level | 'silent';
  /** Raw pino JSON lines instead of the human-readable format. */
  json?: boolean;
  /** Where lines go (default: stderr, so stdout stays clean for command output). */
  write?: (line: string) => void;
}

const LEVEL_NAMES: Record<number, string> = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO',
  40: 'WARN',
  50: 'ERROR',
  60: 'FATAL',
};
const HIDDEN = new Set(['level', 'time', 'msg', 'pid', 'hostname']);

function formatField(v: unknown): string {
  if (typeof v === 'string') return /\s/.test(v) ? JSON.stringify(v) : v;
  return JSON.stringify(v);
}

/** One JSON log line → `[2026-09-23 05:22:10 CDT] INFO  message key=value`. */
export function prettyLine(line: string): string {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return line;
  }
  const level = LEVEL_NAMES[obj.level as number] ?? String(obj.level);
  const extras = Object.entries(obj)
    .filter(([k]) => !HIDDEN.has(k))
    .map(([k, v]) =>
      k === 'err' && typeof v === 'object' && v !== null
        ? `err=${formatField((v as { message?: unknown }).message)}`
        : `${k}=${formatField(v)}`,
    );
  return `[${String(obj.time)}] ${level.padEnd(5)} ${String(obj.msg ?? '')}${extras.length ? ` ${extras.join(' ')}` : ''}\n`;
}

export function createLogger(opts: LoggerOptions = {}): Logger {
  const write = opts.write ?? ((line: string) => process.stderr.write(line));
  const stream: DestinationStream = {
    write: (line: string) => write(opts.json ? line : prettyLine(line)),
  };
  return pino(
    {
      level: opts.level ?? 'info',
      base: undefined,
      timestamp: () => `,"time":"${formatChicago()}"`,
    },
    stream,
  );
}

/** A logger that discards everything (programmatic default). */
export const silentLogger = (): Logger => pino({ level: 'silent' });
