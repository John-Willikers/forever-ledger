// The helper's own settings in `<userData>/fetch-helper.json`: whether the consent screen was answered, whether the
// helper is on, and its token, encrypted with the OS (Windows DPAPI via safeStorage) whenever that is available.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface HelperSettings {
  /** The consent screen was answered (Turn on or Not now): it isn't shown again. */
  consentAnswered: boolean;
  enabled: boolean;
  token?: string;
  /** Pages fetched on `day` (America/Chicago date), for the tray's own daily cap. */
  day?: string;
  pagesToday?: number;
  /** The stored key couldn't be read back (the OS keystore changed): the window says why approval is asked again. */
  tokenLost?: boolean;
}

export interface Crypto {
  available(): boolean;
  encrypt(text: string): string;
  decrypt(data: string): string;
}

interface OnDisk {
  consentAnswered?: boolean;
  enabled?: boolean;
  tokenEnc?: string;
  token?: string;
  day?: string;
  pagesToday?: number;
}

export function helperStore(file: string, crypto: Crypto) {
  let settings: HelperSettings = { consentAnswered: false, enabled: false };
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as OnDisk;
    settings = {
      consentAnswered: raw.consentAnswered === true,
      enabled: raw.enabled === true,
      day: typeof raw.day === 'string' ? raw.day : undefined,
      pagesToday: typeof raw.pagesToday === 'number' ? raw.pagesToday : undefined,
    };
    // A key that can't be decrypted any more is dropped, not the user's choices: the helper asks for a new one.
    try {
      settings.token = raw.tokenEnc
        ? crypto.available()
          ? crypto.decrypt(raw.tokenEnc)
          : undefined
        : raw.token;
      if (raw.tokenEnc && !settings.token) settings.tokenLost = true;
    } catch {
      settings.tokenLost = true;
    }
  } catch {
    // no file yet, or unreadable: start over (the consent screen shows again)
  }
  return {
    get: (): HelperSettings => ({ ...settings }),
    set(patch: Partial<HelperSettings>) {
      settings = { ...settings, ...patch };
      const disk: OnDisk = {
        consentAnswered: settings.consentAnswered,
        enabled: settings.enabled,
        day: settings.day,
        pagesToday: settings.pagesToday,
      };
      if (settings.token) {
        if (crypto.available()) disk.tokenEnc = crypto.encrypt(settings.token);
        else disk.token = settings.token;
      }
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(disk, null, 2)}\n`);
    },
  };
}
