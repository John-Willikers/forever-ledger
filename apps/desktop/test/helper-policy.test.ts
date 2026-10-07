// The fetch helper's sandbox guarantees (tray helper plan, "What sandboxed means here"), pinned.
import { describe, expect, it } from 'vitest';
import {
  allowPermission,
  chicagoDay,
  HELPER_PARTITION,
  HELPER_WEB_PREFERENCES,
  HELPER_WINDOW,
  isAllowedPageUrl,
  isWowRunning,
  nextPageDelayMs,
  processNames,
  tasklistPath,
} from '../src/main/helper/policy.js';

describe('fetch helper sandbox', () => {
  it('uses its own persistent partition, never the default session or a browser profile', () => {
    expect(HELPER_PARTITION).toBe('persist:fetch-helper');
  });

  it('runs pages sandboxed, isolated, with no Node, no preload and no webviews', () => {
    expect(HELPER_WEB_PREFERENCES).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      disableDialogs: true,
    });
    // Never on screen, never takes focus, never in the taskbar.
    expect(HELPER_WINDOW).toMatchObject({ show: false, focusable: false, skipTaskbar: true });
    expect(HELPER_WEB_PREFERENCES).not.toHaveProperty('preload');
  });

  it('opens only https www.wowhead.com entity pages', () => {
    for (const ok of [
      'https://www.wowhead.com/forever/item=7973',
      'https://www.wowhead.com/forever/npc=5431/sergeant-bly',
      'https://www.wowhead.com/forever/quest=2861?x=1',
      'https://www.wowhead.com/item=7973',
    ]) {
      expect(isAllowedPageUrl(ok), ok).toBe(true);
    }
    for (const bad of [
      'https://www.wowhead.com/',
      'https://www.wowhead.com/account',
      'https://www.wowhead.com/forever/guide/fishing',
      'https://www.wowhead.com/forever/item=7973/a/b',
      'http://www.wowhead.com/forever/item=7973',
      'https://wowhead.com.evil.example/',
      'https://evil.example/?u=https://www.wowhead.com/',
      'https://user:pw@www.wowhead.com/',
      'file:///C:/Users/cody/Documents',
      'chrome://settings',
      'javascript:alert(1)',
      'not a url',
    ]) {
      expect(isAllowedPageUrl(bad), bad).toBe(false);
    }
  });

  it('refuses every permission a page asks for', () => {
    for (const p of [
      'media',
      'geolocation',
      'notifications',
      'clipboard-read',
      'hid',
      'usb',
      'openExternal',
    ]) {
      expect(allowPermission(p)).toBe(false);
    }
  });

  it('waits 120-200 s between pages', () => {
    expect(nextPageDelayMs(() => 0)).toBe(120_000);
    expect(nextPageDelayMs(() => 0.999999)).toBeLessThan(200_000);
  });

  it("knows WoW's process names and nothing else", () => {
    const csv =
      '"System Idle Process","0","Services","0","8 K"\r\n"WowClassic.exe","1234","Console","1","2,000,000 K"\r\n"chrome.exe","42","Console","1","1 K"';
    expect(processNames(csv)).toEqual(['System Idle Process', 'WowClassic.exe', 'chrome.exe']);
    expect(isWowRunning(processNames(csv))).toBe(true);
    expect(isWowRunning(['chrome.exe', 'Wowza.txt', 'Discord.exe'])).toBe(false);
    expect(isWowRunning(['Wow.exe'])).toBe(true);
    // Windows' own tasklist by full path, never whatever "tasklist" is first on PATH.
    expect(tasklistPath('C:\\Windows')).toBe('C:\\Windows\\System32\\tasklist.exe');
  });

  it('counts the daily cap by the Chicago day', () => {
    // 2026-10-08 03:30 UTC is still the 7th in Chicago.
    expect(chicagoDay(Date.UTC(2026, 9, 8, 3, 30))).toBe('2026-10-07');
    expect(chicagoDay(Date.UTC(2026, 9, 8, 6, 0))).toBe('2026-10-08');
  });
});
