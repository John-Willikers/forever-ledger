import { describe, expect, it } from 'vitest';
import { readEnv } from '../src/env.js';

const base = { DATABASE_URL: 'postgres://x@127.0.0.1/db' };
const SECRET = 'a'.repeat(32);

describe('readEnv admin settings', () => {
  it('leaves Battle.net unconfigured by default', () => {
    const env = readEnv(base);
    expect(env.admin.bnet).toBeUndefined();
    expect(env.admin.adminBattletags).toEqual([]);
    expect(env.admin.cookieSecret).toBeUndefined();
    expect(env.admin.cookieInsecure).toBe(false);
    expect(env.admin.distDir).toBeUndefined();
  });

  it('reads the Battle.net client, admin BattleTags and cookie settings', () => {
    const env = readEnv({
      ...base,
      BNET_CLIENT_ID: 'id',
      BNET_CLIENT_SECRET: 'secret',
      ADMIN_BATTLETAGS: ' JohnWilliker#1292 , Other#1 ,,',
      COOKIE_SECRET: SECRET,
      COOKIE_INSECURE: '1',
      ADMIN_DIST_DIR: '/srv/admin',
    });
    expect(env.admin.bnet).toEqual({
      clientId: 'id',
      clientSecret: 'secret',
      redirectUri: 'https://ledger.willikers.dev/admin/auth/callback',
    });
    expect(env.admin.adminBattletags).toEqual(['JohnWilliker#1292', 'Other#1']);
    expect(env.admin.cookieSecret).toBe(SECRET);
    expect(env.admin.cookieInsecure).toBe(true);
    expect(env.admin.distDir).toBe('/srv/admin');
  });

  it('honours BNET_REDIRECT_URI', () => {
    const env = readEnv({
      ...base,
      BNET_CLIENT_ID: 'id',
      BNET_CLIENT_SECRET: 'secret',
      BNET_REDIRECT_URI: 'http://localhost:3410/admin/auth/callback',
      COOKIE_SECRET: SECRET,
    });
    expect(env.admin.bnet?.redirectUri).toBe('http://localhost:3410/admin/auth/callback');
  });

  it('needs the client secret and COOKIE_SECRET once BNET_CLIENT_ID is set', () => {
    expect(() => readEnv({ ...base, BNET_CLIENT_ID: 'id', COOKIE_SECRET: SECRET })).toThrow(
      /BNET_CLIENT_SECRET/,
    );
    expect(() => readEnv({ ...base, BNET_CLIENT_ID: 'id', BNET_CLIENT_SECRET: 's' })).toThrow(
      /COOKIE_SECRET/,
    );
  });

  it('refuses BattleTags without their #number (an unquoted .env value loses it)', () => {
    expect(() => readEnv({ ...base, ADMIN_BATTLETAGS: 'JohnWilliker' })).toThrow(/quote the value/);
    expect(() => readEnv({ ...base, ADMIN_BATTLETAGS: 'A#1, B' })).toThrow(/"B"/);
  });

  it('refuses a short COOKIE_SECRET', () => {
    expect(() => readEnv({ ...base, COOKIE_SECRET: 'short' })).toThrow(/COOKIE_SECRET/);
  });
});
