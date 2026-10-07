// The fetch helper's hidden browser: a window that never shows, in the app's own empty session (HELPER_PARTITION),
// never the user's Chrome, Edge or anything else. Every guarantee is in policy.ts and its tests; this file only applies
// them. The page is read from the main process over the DevTools protocol, so nothing of ours runs in it.
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
const SETTLE_MS = 3_000;
const CHALLENGE_WAIT_MS = 30_000;
const MAX_HTML_BYTES = 12 * 1024 * 1024;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The helper session with every guard on. Called once; Electron returns the same session for the partition. */
export function helperSession(): Session {
  const ses = session.fromPartition(HELPER_PARTITION);
  ses.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(allowPermission(permission)),
  );
  ses.setPermissionCheckHandler((_wc, permission) => allowPermission(permission));
  ses.setDevicePermissionHandler(() => false);
  ses.setDisplayMediaRequestHandler((_req, callback) => callback({}));
  // Nothing is ever saved to the PC from a page.
  ses.on('will-download', (event) => event.preventDefault());
  return ses;
}

function guardContents(wc: WebContents) {
  wc.setAudioMuted(true);
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  // The page itself may only be a www.wowhead.com page; ads and other frames inside it are left alone.
  wc.on('will-navigate', (event, url) => {
    if (!isAllowedPageUrl(url)) event.preventDefault();
  });
  wc.on('will-redirect', (event) => {
    if (event.isMainFrame && !isAllowedPageUrl(event.url)) event.preventDefault();
  });
  wc.on('will-attach-webview', (event) => event.preventDefault());
}

export interface HelperBrowser {
  fetchPage(url: string, worker: string, fetcher: string): Promise<FetchReport>;
  /** Deletes everything the helper session stored (cookies, cache, site storage) and closes the window. */
  wipe(): Promise<void>;
  close(): void;
}

export function createHelperBrowser(): HelperBrowser {
  const ses = helperSession();
  let win: BrowserWindow | undefined;

  const window = () => {
    if (win && !win.isDestroyed()) return win;
    win = new BrowserWindow({
      show: false,
      ...HELPER_WINDOW,
      webPreferences: { ...HELPER_WEB_PREFERENCES, session: ses },
    });
    guardContents(win.webContents);
    return win;
  };

  async function fetchPage(url: string, worker: string, fetcher: string): Promise<FetchReport> {
    const base = { url, worker, fetcher, fetchedAt: new Date().toISOString() };
    if (!isAllowedPageUrl(url)) {
      return { ...base, outcome: 'error', error: 'not a www.wowhead.com page' } as FetchReport;
    }
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
      await Promise.race([
        wc.loadURL(url).catch((err: unknown) => {
          // A redirect inside Wowhead aborts the first load; the page still arrives.
          if (!String(err).includes('ERR_ABORTED')) throw err;
        }),
        delay(LOAD_TIMEOUT_MS).then(() => {
          throw new Error('page took longer than 45 s');
        }),
      ]);
      if (!dbg.isAttached()) dbg.attach('1.3');
      const evaluate = async (expression: string) =>
        (
          (await dbg.sendCommand('Runtime.evaluate', { expression, returnByValue: true })) as {
            result: { value: unknown };
          }
        ).result.value;
      const started = Date.now();
      while (Date.now() - started < LOAD_TIMEOUT_MS) {
        if ((await evaluate('document.readyState')) !== 'loading') break;
        await delay(500);
      }
      await delay(SETTLE_MS);
      const html = async () => {
        const { root } = (await dbg.sendCommand('DOM.getDocument', { depth: -1 })) as {
          root: { nodeId: number };
        };
        const { outerHTML } = (await dbg.sendCommand('DOM.getOuterHTML', {
          nodeId: root.nodeId,
        })) as { outerHTML: string };
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
      if (status !== undefined && status >= 400) {
        return { ...base, outcome: 'http_error', httpStatus: status, finalUrl } as FetchReport;
      }
      const bytes = Buffer.from(page, 'utf8');
      if (bytes.length > MAX_HTML_BYTES) {
        return { ...base, outcome: 'error', error: 'page too large' } as FetchReport;
      }
      return {
        ...base,
        outcome: 'ok',
        httpStatus: status ?? 200,
        finalUrl,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        htmlGzBase64: gzipSync(bytes).toString('base64'),
      } as FetchReport;
    } finally {
      wc.off('did-navigate', onNavigate);
      if (dbg.isAttached()) dbg.detach();
      // Leave nothing running in the background between pages (ads, video).
      await wc.loadURL('about:blank').catch(() => undefined);
    }
  }

  return {
    fetchPage,
    async wipe() {
      if (win && !win.isDestroyed()) win.destroy();
      win = undefined;
      await ses.clearStorageData();
      await ses.clearCache();
      await ses.clearAuthCache();
    },
    close() {
      if (win && !win.isDestroyed()) win.destroy();
      win = undefined;
    },
  };
}
