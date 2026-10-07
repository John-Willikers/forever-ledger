// The fetch helper in the tray: off until the user turns it on from the consent screen or settings. Ties the loop
// (core.ts) to the sandboxed browser, the gate, the server and the stored settings, and tells the window what it's doing.
import { EventEmitter } from 'node:events';
import type { Logger } from '@forever-ledger/uploader/lib';
import { helperApi } from './api.js';
import type { HelperBrowser } from './browser.js';
import { step } from './core.js';
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
    this.browserInstance ??= this.deps.browser();
    return this.browserInstance;
  }

  start() {
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
      this.setState('enrolling', 'asking the ledger for a helper key');
      const token = await api.enroll(target.token, target.uploaderId);
      this.deps.store.set({ token });
    }
    const token = this.deps.store.get().token!;
    return step(
      {
        now: this.deps.now ?? Date.now,
        random: this.deps.random ?? Math.random,
        enabled: () => this.deps.store.get().enabled,
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

  /** The consent screen's answer, or the settings switch. Turning off wipes everything the helper session stored. */
  async setEnabled(enabled: boolean) {
    this.deps.store.set({ enabled, consentAnswered: true });
    if (!enabled) {
      this.strikes.n = 0;
      await this.browserInstance?.wipe();
      this.browserInstance = undefined;
      this.setState('off');
    } else {
      this.strikes.n = 0;
      this.schedule(1_000);
    }
    this.changed();
  }
}
