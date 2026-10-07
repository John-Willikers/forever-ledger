// The helper's own settings in `<userData>/fetch-helper.json`: whether the consent screen was answered, whether the
// helper is on, and its token, encrypted with the OS (Windows DPAPI via safeStorage) whenever that is available.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface HelperSettings {
  /** The consent screen was answered (Turn on or Not now): it isn't shown again. */
  consentAnswered: boolean;
  enabled: boolean;
  token?: string;
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
}

export function helperStore(file: string, crypto: Crypto) {
  let settings: HelperSettings = { consentAnswered: false, enabled: false };
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as OnDisk;
    settings = {
      consentAnswered: raw.consentAnswered === true,
      enabled: raw.enabled === true,
      token: raw.tokenEnc && crypto.available() ? crypto.decrypt(raw.tokenEnc) : raw.token,
    };
  } catch {
    // no file yet, or unreadable: start over (the consent screen shows again)
  }
  return {
    get: (): HelperSettings => ({ ...settings }),
    set(patch: Partial<HelperSettings>) {
      settings = { ...settings, ...patch };
      const disk: OnDisk = { consentAnswered: settings.consentAnswered, enabled: settings.enabled };
      if (settings.token) {
        if (crypto.available()) disk.tokenEnc = crypto.encrypt(settings.token);
        else disk.token = settings.token;
      }
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(disk, null, 2)}\n`);
    },
  };
}
