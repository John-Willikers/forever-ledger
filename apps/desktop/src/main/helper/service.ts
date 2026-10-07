// The fetch helper in the tray: off until the user turns it on from the consent screen or settings. Ties the loop
// (core.ts) to the sandboxed browser, the gate, the server and the stored settings, and tells the window what it's doing.
import { EventEmitter } from 'node:events';
import type { Logger } from '@forever-ledger/uploader/lib';
import { helperApi } from './api.js';
import type { HelperBrowser } from './browser.js';
import { step } from './core.js';
import { chicagoDay, DAILY_CAP } from './policy.js';
import type { ActivityEntry, HelperState } from './core.js';
import type { helperStore } from './store.js';

const ACTIVITY_CAP = 50;
const FETCHER = 'tray-helper/1';

/** What the window shows about the helper. */
export interface HelperView {
  /** Show the consent screen (never answered yet). */
  consentNeeded: boolean;
  enabled: boolean;
  state: HelperState;
  detail?: string;
  activity: ActivityEntry[];
}

export interface HelperServiceDeps {
  store: ReturnType<typeof helperStore>;
  target: () => { serverUrl: string; token: string; uploaderId: string } | undefined;
  browser: () => HelperBrowser;
  /** Deletes everything the helper session stored (works with or without an open window). */
  wipe: () => Promise<void>;
  /** Removes the session's folder on disk; only safe before the session is first used this run. */
  removeSessionFolder: () => void;
  blockedBy: () => Promise<string | null>;
  logger: Logger;
  now?: () => number;
  random?: () => number;
}

export class HelperService extends EventEmitter {
  private state: HelperState = 'off';
  private detail?: string;
  private readonly activity: ActivityEntry[] = [];
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopped = false;
  private browserInstance?: HelperBrowser;
  private readonly strikes = { n: 0 };

  constructor(private readonly deps: HelperServiceDeps) {
    super();
  }

  view(): HelperView {
    const s = this.deps.store.get();
    return {
      consentNeeded: !s.consentAnswered && this.deps.target() !== undefined,
      enabled: s.enabled,
      state: this.state,
      detail: this.detail,
      activity: [...this.activity].reverse(),
    };
  }

  private changed() {
    this.emit('change', this.view());
  }

  private setState(state: HelperState, detail?: string) {
    if (state === this.state && detail === this.detail) return;
    this.state = state;
    this.detail = detail;
    this.deps.logger.info({ state, detail }, 'fetch helper');
    this.changed();
  }

  private browser() {
    // Never re-open the browser once the helper was turned off.
    if (!this.deps.store.get().enabled) throw new Error('the helper is off');
    this.browserInstance ??= this.deps.browser();
    return this.browserInstance;
  }

  private pagesLeftToday() {
    const s = this.deps.store.get();
    const today = chicagoDay((this.deps.now ?? Date.now)());
    return DAILY_CAP - (s.day === today ? (s.pagesToday ?? 0) : 0);
  }

  private countPage() {
    const s = this.deps.store.get();
    const today = chicagoDay((this.deps.now ?? Date.now)());
    this.deps.store.set({
      day: today,
      pagesToday: (s.day === today ? (s.pagesToday ?? 0) : 0) + 1,
    });
  }

  start() {
    // Off at startup: leave nothing of the helper on disk (its session folder is only removed before first use).
    if (!this.deps.store.get().enabled) this.deps.removeSessionFolder();
    if (this.deps.store.get().tokenLost) {
      this.deps.logger.warn(
        'fetch helper key could not be read back; it will ask for approval again',
      );
    }
    this.schedule(5_000);
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.browserInstance?.close();
  }

  private schedule(ms: number) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), ms);
    this.timer.unref?.();
  }

  private async tick() {
    if (this.running || this.stopped) return;
    this.running = true;
    let wait = 60_000;
    try {
      wait = await this.runStep();
    } catch (err) {
      this.deps.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'fetch helper step failed',
      );
      wait = 5 * 60_000;
    } finally {
      this.running = false;
      this.schedule(wait);
    }
  }

  /** One loop step; enrolls first when the helper is on but has no token yet. */
  private async runStep(): Promise<number> {
    const settings = this.deps.store.get();
    const target = this.deps.target();
    if (!settings.enabled || !target) {
      this.setState('off');
      return 60_000;
    }
    const api = helperApi(target.serverUrl);
    if (!settings.token) {
      // A key lost to the OS keystore is never replaced quietly: the new one waits for Harlan's approval again.
      this.setState(
        'enrolling',
        settings.tokenLost
          ? "this PC's saved helper key couldn't be read, so it's asking for approval again"
          : 'asking the ledger for a helper key',
      );
      const token = await api.enroll(target.token, target.uploaderId);
      this.deps.store.set({ token, tokenLost: undefined });
    }
    const token = this.deps.store.get().token!;
    return step(
      {
        now: this.deps.now ?? Date.now,
        random: this.deps.random ?? Math.random,
        enabled: () => this.deps.store.get().enabled,
        pagesLeftToday: () => this.pagesLeftToday(),
        countPage: () => this.countPage(),
        blockedBy: this.deps.blockedBy,
        lease: () => api.lease(token, target.uploaderId),
        fetchPage: (url) => this.browser().fetchPage(url, target.uploaderId, FETCHER),
        report: (r) => api.report(token, r),
        activity: (e) => {
          this.activity.push(e);
          if (this.activity.length > ACTIVITY_CAP) this.activity.shift();
          this.changed();
        },
        setState: (s, d) => this.setState(s, d),
      },
      this.strikes,
    );
  }

  /**
   * The consent screen's answer, or the settings switch. Turning off wipes everything the helper session stored, gives
   * the helper key back to the ledger (which revokes it) and forgets it here.
   */
  async setEnabled(enabled: boolean) {
    const before = this.deps.store.get();
    this.deps.store.set({ enabled, consentAnswered: true, tokenLost: undefined });
    this.strikes.n = 0;
    if (!enabled) {
      this.browserInstance?.close();
      this.browserInstance = undefined;
      await this.deps
        .wipe()
        .catch((err: unknown) =>
          this.deps.logger.warn({ err: String(err) }, 'fetch helper wipe failed'),
        );
      const target = this.deps.target();
      if (before.token && target) {
        await helperApi(target.serverUrl)
          .unenroll(before.token)
          .catch((err: unknown) =>
            this.deps.logger.warn({ err: String(err) }, 'fetch helper unenroll failed'),
          );
      }
      this.deps.store.set({ token: undefined });
      this.setState('off');
    } else {
      this.schedule(1_000);
    }
    this.changed();
  }
}
