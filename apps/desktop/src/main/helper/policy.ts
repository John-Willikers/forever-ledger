// The fetch helper's sandbox, as plain data (tray helper plan, "What sandboxed means here"). browser.ts builds the
// hidden window from these; the unit tests pin every guarantee. No Electron in here.

/**
 * The helper's own browser session: an empty, persistent partition inside this app's data folder. It is never the
 * user's Chrome, Edge or any other browser, and never this app's own window session.
 */
export const HELPER_PARTITION = 'persist:fetch-helper';

/** The only site the helper ever opens as a page. */
export const HELPER_HOST = 'www.wowhead.com';

/** Hidden window size: a common laptop screen, so pages lay out as they would for a person. */
export const HELPER_WINDOW = { width: 1366, height: 900 } as const;

/**
 * webPreferences of the hidden window. The page runs sandboxed with no preload and no Node: it can't reach the app,
 * its files, its token or anything on the PC. `session` is added by browser.ts.
 */
export const HELPER_WEB_PREFERENCES = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  webviewTag: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  spellcheck: false,
  // Hidden windows are throttled by default; pages would never finish loading.
  backgroundThrottling: false,
  autoplayPolicy: 'document-user-activation-required',
} as const;

/** Whether the helper may open `url` as the page itself (the main frame): https on www.wowhead.com only. */
export function isAllowedPageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === HELPER_HOST && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** Every permission a page asks for (camera, microphone, location, notifications, clipboard, USB, …) is refused. */
export const allowPermission = (_permission: string): boolean => false;

/** Pause between pages: 120–200 s, random each time (the same pace as cruiser). */
export const nextPageDelayMs = (random: () => number) => 120_000 + Math.floor(random() * 80_000);

/** Seconds the PC must be idle before the helper works (tray helper plan: only while you're away). */
export const IDLE_SECONDS = 300;

/** World of Warcraft's process names on Windows: Wow.exe, WowClassic.exe, WowClassicT.exe, WowB.exe, … */
export const WOW_PROCESS = /^wow[a-z]*\.exe$/i;

/** Process names from `tasklist /fo csv /nh` output (first column, quoted). */
export function processNames(tasklistCsv: string): string[] {
  return tasklistCsv
    .split(/\r?\n/)
    .map((line) => /^"([^"]+)"/.exec(line)?.[1])
    .filter((n): n is string => Boolean(n));
}

export const isWowRunning = (names: string[]) => names.some((n) => WOW_PROCESS.test(n));
