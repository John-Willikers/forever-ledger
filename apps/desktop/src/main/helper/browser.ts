// The fetch helper's hidden browser: a window that never shows, in the app's own session (HELPER_PARTITION), never the
// user's Chrome, Edge or anything else. Every guarantee is in policy.ts and its tests; this file only applies them.
// The page is read from the main process over the DevTools protocol (DOM.getOuterHTML): no script of ours runs in it.
// Pages load like in any browser, ads and trackers included (Harlan, 2026-10-07); only the page itself is fenced to
// Wowhead entity pages.
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { looksLikeChallenge } from '@forever-ledger/contracts';
import type { FetchReport } from '@forever-ledger/contracts';
import { BrowserWindow, session } from 'electron';
import type { Session, WebContents } from 'electron';
import {
  allowPermission,
  HELPER_PARTITION,
  HELPER_WEB_PREFERENCES,
  HELPER_WINDOW,
  isAllowedPageUrl,
} from './policy.js';

const LOAD_TIMEOUT_MS = 45_000;
const CDP_TIMEOUT_MS = 15_000;
const SETTLE_MS = 3_000;
const CHALLENGE_WAIT_MS = 30_000;
const MAX_HTML_CHARS = 12 * 1024 * 1024;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

class Timeout extends Error {}

/** `p`, or a Timeout after `ms` (the page is hostile until proven otherwise: it may never answer). */
function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    p,
    delay(ms).then(() => {
      throw new Timeout(`${what} took longer than ${ms / 1000} s`);
    }),
  ]);
}

let guarded: Session | undefined;

/** The helper session with every guard on (once per process; Electron returns the same session for the partition). */
export function helperSession(): Session {
  const ses = session.fromPartition(HELPER_PARTITION);
  if (guarded === ses) return ses;
  guarded = ses;
  ses.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(allowPermission(permission)),
  );
  ses.setPermissionCheckHandler((_wc, permission) => allowPermission(permission));
  ses.setDevicePermissionHandler(() => false);
  ses.setDisplayMediaRequestHandler((_req, callback) => callback({}));
  // Nothing is ever saved to the PC from a page.
  ses.on('will-download', (event) => event.preventDefault());
  // The one authoritative fence: whatever starts it (a link, a script, a redirect, history), the page itself is only
  // ever a Wowhead entity page. Ads and other frames inside it load like in any browser.
  ses.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: details.resourceType === 'mainFrame' && !isAllowedPageUrl(details.url) });
  });
  return ses;
}

function guardContents(wc: WebContents) {
  wc.setAudioMuted(true);
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (event, url) => {
    if (!isAllowedPageUrl(url)) event.preventDefault();
  });
  wc.on('will-redirect', (event) => {
    if (event.isMainFrame && !isAllowedPageUrl(event.url)) event.preventDefault();
  });
  // A page can't hold the window on itself with "Leave site?".
  wc.on('will-prevent-unload', (event) => event.preventDefault());
  wc.on('will-attach-webview', (event) => event.preventDefault());
}

export interface HelperBrowser {
  fetchPage(url: string, worker: string, fetcher: string): Promise<FetchReport>;
  close(): void;
}

/** Deletes everything the helper session stored (cookies, cache, site storage), whether or not a window is open. */
export async function wipeHelperSession(): Promise<void> {
  const ses = helperSession();
  await ses.clearStorageData();
  await ses.clearCache();
  await ses.clearAuthCache();
  await ses.clearHostResolverCache();
}

export function createHelperBrowser(): HelperBrowser {
  const ses = helperSession();
  let win: BrowserWindow | undefined;

  const window = () => {
    if (win && !win.isDestroyed()) return win;
    win = new BrowserWindow({
      ...HELPER_WINDOW,
      webPreferences: { ...HELPER_WEB_PREFERENCES, session: ses },
    });
    guardContents(win.webContents);
    return win;
  };

  /** A page that stopped answering: crash its renderer and drop the window (a new one is made next time). */
  const kill = () => {
    if (!win || win.isDestroyed()) return;
    try {
      win.webContents.forcefullyCrashRenderer();
    } catch {
      // already gone
    }
    win.destroy();
    win = undefined;
  };

  async function fetchPage(url: string, worker: string, fetcher: string): Promise<FetchReport> {
    const base = { url, worker, fetcher, fetchedAt: new Date().toISOString() };
    const error = (message: string) =>
      ({ ...base, outcome: 'error', error: message }) as FetchReport;
    if (!isAllowedPageUrl(url)) return error('not a Wowhead entity page');
    const wc = window().webContents;
    let status: number | undefined;
    let finalUrl = url;
    const onNavigate = (_e: unknown, navUrl: string, code: number) => {
      status = code;
      finalUrl = navUrl;
    };
    wc.on('did-navigate', onNavigate);
    const dbg = wc.debugger;
    try {
      const stopped = new Promise<void>((resolve) => wc.once('did-stop-loading', () => resolve()));
      await within(
        wc.loadURL(url).catch((err: unknown) => {
          // A redirect inside Wowhead aborts the first load; the check below decides whether a page arrived.
          if (!String(err).includes('ERR_ABORTED')) throw err;
        }),
        LOAD_TIMEOUT_MS,
        'loading the page',
      );
      await within(stopped, LOAD_TIMEOUT_MS, 'loading the page').catch(() => undefined);
      // A blocked redirect or an aborted load leaves no page: never report that as one.
      if (status === undefined || !isAllowedPageUrl(wc.getURL()) || wc.getURL() !== finalUrl) {
        return error('the page did not load (blocked redirect or aborted)');
      }
      await delay(SETTLE_MS);
      if (!dbg.isAttached()) dbg.attach('1.3');
      const html = async () => {
        const { root } = await within(
          dbg.sendCommand('DOM.getDocument', { depth: 0 }) as Promise<{ root: { nodeId: number } }>,
          CDP_TIMEOUT_MS,
          'reading the page',
        );
        const { outerHTML } = await within(
          dbg.sendCommand('DOM.getOuterHTML', { nodeId: root.nodeId }) as Promise<{
            outerHTML: string;
          }>,
          CDP_TIMEOUT_MS,
          'reading the page',
        );
        return outerHTML;
      };
      let page = await html();
      const waitUntil = Date.now() + CHALLENGE_WAIT_MS;
      while (looksLikeChallenge(page) && Date.now() < waitUntil) {
        await delay(3_000);
        page = await html();
      }
      if (looksLikeChallenge(page)) {
        return { ...base, outcome: 'challenge', httpStatus: status, finalUrl } as FetchReport;
      }
      if (status >= 400) {
        return { ...base, outcome: 'http_error', httpStatus: status, finalUrl } as FetchReport;
      }
      if (page.length > MAX_HTML_CHARS) return error('page too large');
      const bytes = Buffer.from(page, 'utf8');
      return {
        ...base,
        outcome: 'ok',
        httpStatus: status,
        finalUrl,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        htmlGzBase64: gzipSync(bytes).toString('base64'),
      } as FetchReport;
    } catch (err) {
      if (err instanceof Timeout) kill();
      throw err;
    } finally {
      if (!wc.isDestroyed()) {
        wc.off('did-navigate', onNavigate);
        if (dbg.isAttached()) dbg.detach();
        // Leave nothing running in the background between pages (ads, video).
        try {
          await within(wc.loadURL('about:blank'), CDP_TIMEOUT_MS, 'clearing the page');
        } catch {
          kill();
        }
      }
    }
  }

  return {
    fetchPage,
    close() {
      if (win && !win.isDestroyed()) win.destroy();
      win = undefined;
    },
  };
}
