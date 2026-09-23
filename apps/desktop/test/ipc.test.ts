import { describe, expect, it } from 'vitest';
import { sanitizeSettings } from '../src/main/ipc.js';

describe('sanitizeSettings', () => {
  it('keeps known, well-typed fields', () => {
    expect(
      sanitizeSettings({
        wowPath: 'C:/WoW',
        token: 'flt_x',
        startWithWindows: false,
        autoUpdateAddon: true,
      }),
    ).toEqual({
      wowPath: 'C:/WoW',
      token: 'flt_x',
      startWithWindows: false,
      autoUpdateAddon: true,
    });
  });

  it('drops the server URL, unknown keys and wrong types', () => {
    expect(
      sanitizeSettings({
        serverUrl: 'https://evil.example',
        stateDir: '/x',
        token: 5,
        startWithWindows: 'yes',
        wowPath: 'x'.repeat(5_000),
      }),
    ).toEqual({});
    expect(sanitizeSettings(null)).toEqual({});
    expect(sanitizeSettings('nope')).toEqual({});
  });
});
