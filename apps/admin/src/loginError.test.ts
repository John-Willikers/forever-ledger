import { describe, expect, it } from 'vitest';
import { LOGIN_ERRORS, loginError } from './loginError';

describe('loginError', () => {
  it('maps the server’s fixed codes to fixed messages', () => {
    expect(loginError('?error=state')).toBe(
      'Your login expired or was started elsewhere. Please try again.',
    );
    expect(loginError('?error=cancelled')).toBe('Battle.net login was cancelled.');
    expect(loginError('?error=failed')).toBe('Battle.net login failed. Please try again.');
    expect(loginError(new URLSearchParams({ error: 'unauthorized' }))).toBe(
      'This Battle.net account is not allowed to log in.',
    );
    expect(Object.keys(LOGIN_ERRORS).sort()).toEqual([
      'cancelled',
      'failed',
      'state',
      'unauthorized',
    ]);
  });

  it('shows nothing for unknown values (never echoes the query string)', () => {
    for (const search of [
      '?error=Battle.net+login+was+cancelled.',
      '?error=Your+account+was+hacked.+Call+555-0100',
      '?error=%3Cscript%3Ealert(1)%3C%2Fscript%3E',
      '?error=STATE',
      '?error=state%20',
      '?error=toString',
      '?error=__proto__',
      '?error=constructor',
    ]) {
      expect(loginError(search), search).toBeNull();
    }
  });

  it('ignores empty or missing errors', () => {
    expect(loginError('')).toBeNull();
    expect(loginError('?error=')).toBeNull();
    expect(loginError('?other=state')).toBeNull();
  });
});
