import { DIAGNOSTIC_DETAIL_MAX_BYTES, DIAGNOSTICS_MAX_EVENTS } from '@forever-ledger/contracts';
import type {
  DiagnosticEvent,
  DiagnosticLevel,
  DiagnosticsReport,
  DiagnosticSource,
} from '@forever-ledger/contracts';
import { postDiagnostics, sanitize, sanitizeJson } from '@forever-ledger/uploader/lib';
import type { FetchLike, Logger, SanitizeOptions } from '@forever-ledger/uploader/lib';

/** A problem worth reporting. */
export interface DiagnosticInput {
  level: DiagnosticLevel;
  source: DiagnosticSource;
  message: string;
  detail?: unknown;
}

/** A WARN/ERROR/FATAL log line: its level and the text after the level. */
export interface LogProblem {
  level: DiagnosticLevel;
  text: string;
}

/** What the window shows about error reports. */
export interface DiagnosticsStatus {
  enabled: boolean;
  /** Events waiting to be sent. */
  pending: number;
  /** Epoch ms of the last report the server accepted (this run). */
  lastSentAt?: number;
}

export interface ReporterDeps {
  appVersion: string;
  /** e.g. `win32 10.0.22631`. */
  platform: string;
  /** Where to send; undefined while the token or server isn't set (nothing is sent then). */
  target: () => { serverUrl: string; token: string; uploaderId: string } | undefined;
  /** The "Send error reports" setting. Off: nothing is collected and pending events are dropped. */
  enabled: () => boolean;
  logger: Logger;
  now?: () => number;
  fetchImpl?: FetchLike;
  /** How often new events are sent (default 5 min). */
  intervalMs?: number;
  /** A fatal event is sent this long after it happens, with whatever else arrived meanwhile (default 10 s). */
  fatalDelayMs?: number;
  /** Events kept while they can't be sent; the oldest go first (default 200). */
  maxPending?: number;
  /** A log line and a reported problem with the same text this close together are one problem (default 60 s). */
  correlateMs?: number;
  onChange?: () => void;
  /** Home folder / platform for sanitizing (tests). */
  sanitize?: Omit<SanitizeOptions, 'max'>;
}

/**
 * Events with the same level, source and message (digits aside) merge into one: the first message and time, the latest
 * detail, and a count.
 */
interface Group {
  key: string;
  level: DiagnosticLevel;
  source: DiagnosticSource;
  message: string;
  detail?: unknown;
  /** Epoch seconds of the first and latest occurrence. */
  at: number;
  lastAt: number;
  count: number;
  /**
   * Set for a log line: its full normalized text, searched for a reported problem's match text (the line is then
   * dropped as a duplicate).
   */
  haystack?: string;
  /** Epoch ms when recorded. */
  recordedAt: number;
}

/** Leaves room for the count added to a merged event's detail. */
const DETAIL_BYTES = DIAGNOSTIC_DETAIL_MAX_BYTES - 200;
/** Shortest text used to recognize a logged duplicate (shorter matches too much). */
const MIN_MATCH = 8;
/** Longest: the start of a long message is enough. */
const MAX_MATCH = 200;

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Collects problems on this PC and sends them to POST /v1/diagnostics: every few minutes when there is something new,
 * soon after a fatal one. Everything is sanitized (tokens, home folder) before it is kept. No Electron in here.
 */
export class DiagnosticsReporter {
  private readonly now: () => number;
  private groups: Group[] = [];
  private inFlight: Group[] = [];
  /** Match texts of recently reported problems, to drop their log lines. */
  private recent: { text: string; at: number }[] = [];
  private lastSentAt?: number;
  private interval?: ReturnType<typeof setInterval>;
  private fatalTimer?: ReturnType<typeof setTimeout>;
  private sending?: Promise<void>;

  constructor(private readonly deps: ReporterDeps) {
    this.now = deps.now ?? Date.now;
  }

  start(): void {
    this.stop();
    this.interval = setInterval(() => void this.flush(), this.deps.intervalMs ?? 5 * 60_000);
    (this.interval as { unref?: () => void }).unref?.();
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    if (this.fatalTimer) clearTimeout(this.fatalTimer);
    this.interval = undefined;
    this.fatalTimer = undefined;
  }

  status(): DiagnosticsStatus {
    const enabled = this.deps.enabled();
    return {
      enabled,
      pending: this.groups.length + this.inFlight.length,
      ...(this.lastSentAt !== undefined ? { lastSentAt: this.lastSentAt } : {}),
    };
  }

  /** Forgets pending events (the setting was turned off). */
  clear(): void {
    const had = this.groups.length > 0;
    this.groups = [];
    if (this.fatalTimer) clearTimeout(this.fatalTimer);
    this.fatalTimer = undefined;
    if (had) this.deps.onChange?.();
  }

  /**
   * Records a problem. `match` is the text a log line about the same problem contains (default the message): such a
   * line, logged just before or after, is not reported again.
   */
  record(input: DiagnosticInput, match: string = input.message): void {
    if (!this.deps.enabled()) {
      this.clear();
      return;
    }
    const text = this.normalize(match).slice(0, MAX_MATCH);
    if (text.length >= MIN_MATCH) {
      const since = this.now() - (this.deps.correlateMs ?? 60_000);
      this.recent = this.recent.filter((r) => r.at >= since);
      this.recent.push({ text, at: this.now() });
      const before = this.groups.length;
      this.groups = this.groups.filter(
        (g) => !(g.haystack !== undefined && g.recordedAt >= since && g.haystack.includes(text)),
      );
      if (this.groups.length !== before) this.deps.logger.debug('dropped a logged duplicate');
    }
    this.add(input);
  }

  /** A WARN/ERROR/FATAL log line; skipped when it is about a problem reported just now. */
  noteLogLine(p: LogProblem): void {
    if (!this.deps.enabled()) return;
    const haystack = this.normalize(p.text);
    const since = this.now() - (this.deps.correlateMs ?? 60_000);
    if (this.recent.some((r) => r.at >= since && haystack.includes(r.text))) return;
    // Uploader lines come from child loggers that carry the account.
    const source: DiagnosticSource = /(^|\s)account=/.test(p.text) ? 'uploader' : 'tray';
    this.add({ level: p.level, source, message: p.text }, haystack);
  }

  /** Sends pending events now (at most 50); failures keep them for the next try. */
  flush(): Promise<void> {
    this.sending ??= this.send().finally(() => {
      this.sending = undefined;
    });
    return this.sending;
  }

  // ---- internals ----

  private sanitizeOpts(max?: number): SanitizeOptions {
    return { ...this.deps.sanitize, ...(max !== undefined ? { max } : {}) };
  }

  /** Sanitized and without backslashes/quotes, which log lines JSON-escape. */
  private normalize(text: string): string {
    return sanitize(text, this.sanitizeOpts(4000)).replace(/[\\"]/g, '').trim();
  }

  /** `haystack`: set for a log line (see Group). */
  private add(input: DiagnosticInput, haystack?: string) {
    const message = sanitize(input.message, this.sanitizeOpts()).trim() || '(no message)';
    const key = `${input.level}|${input.source}|${message.replace(/\d+/g, '#')}`;
    const nowMs = this.now();
    const at = Math.floor(nowMs / 1000);
    const same = this.groups.find((g) => g.key === key);
    const detail =
      input.detail === undefined
        ? undefined
        : sanitizeJson(input.detail, { ...this.deps.sanitize, maxBytes: DETAIL_BYTES });
    if (same) {
      same.count++;
      same.lastAt = at;
      if (detail !== undefined) same.detail = detail;
    } else {
      this.groups.push({
        key,
        level: input.level,
        source: input.source,
        message,
        ...(detail !== undefined ? { detail } : {}),
        at,
        lastAt: at,
        count: 1,
        ...(haystack !== undefined ? { haystack } : {}),
        recordedAt: nowMs,
      });
      this.trim();
    }
    if (input.level === 'fatal' && !this.fatalTimer) {
      this.fatalTimer = setTimeout(() => {
        this.fatalTimer = undefined;
        void this.flush();
      }, this.deps.fatalDelayMs ?? 10_000);
      (this.fatalTimer as { unref?: () => void }).unref?.();
    }
    this.deps.onChange?.();
  }

  private trim() {
    const max = (this.deps.maxPending ?? 200) - this.inFlight.length;
    if (this.groups.length > max) this.groups.splice(0, this.groups.length - Math.max(0, max));
  }

  private toEvent(g: Group): DiagnosticEvent {
    const event: DiagnosticEvent = {
      at: g.at,
      level: g.level,
      source: g.source,
      message: g.message,
    };
    if (g.count > 1) {
      const d = g.detail;
      const extra = { count: g.count, lastAt: g.lastAt };
      event.detail =
        typeof d === 'object' && d !== null && !Array.isArray(d)
          ? { ...(d as Record<string, never>), ...extra }
          : d === undefined
            ? extra
            : { detail: d as never, ...extra };
    } else if (g.detail !== undefined) {
      event.detail = g.detail as DiagnosticEvent['detail'];
    }
    return event;
  }

  /** Puts unsent events back in front, merging any that arrived meanwhile. */
  private restore(groups: Group[]) {
    for (const g of groups) {
      const newer = this.groups.findIndex((x) => x.key === g.key);
      if (newer >= 0) {
        const n = this.groups[newer]!;
        g.count += n.count;
        g.lastAt = Math.max(g.lastAt, n.lastAt);
        if (n.detail !== undefined) g.detail = n.detail;
        this.groups.splice(newer, 1);
      }
    }
    this.groups = [...groups, ...this.groups];
    this.trim();
  }

  private async send() {
    if (!this.deps.enabled()) {
      this.clear();
      return;
    }
    const target = this.deps.target();
    if (!target || this.groups.length === 0) return;
    this.inFlight = this.groups.splice(0, DIAGNOSTICS_MAX_EVENTS);
    const report: DiagnosticsReport = {
      uploaderId: target.uploaderId,
      appVersion: this.deps.appVersion,
      platform: this.deps.platform,
      events: this.inFlight.map((g) => this.toEvent(g)),
    };
    const batch = this.inFlight;
    let res;
    try {
      res = await postDiagnostics({
        serverUrl: target.serverUrl,
        token: target.token,
        report,
        fetchImpl: this.deps.fetchImpl,
      });
    } catch (err) {
      res = { kind: 'retry' as const, message: errorMessage(err) };
    }
    this.inFlight = [];
    // Logged at info: a warning would itself become an error report.
    switch (res.kind) {
      case 'ok':
        this.lastSentAt = this.now();
        this.deps.logger.info({ events: batch.length }, 'error report sent');
        break;
      case 'rejected':
        this.deps.logger.info(
          { events: batch.length, reason: res.message },
          'error report refused by the server; dropped',
        );
        break;
      default:
        if (this.deps.enabled()) this.restore(batch);
        this.deps.logger.info(
          { events: batch.length, reason: res.message },
          'error report not sent; will retry',
        );
    }
    this.deps.onChange?.();
  }
}
