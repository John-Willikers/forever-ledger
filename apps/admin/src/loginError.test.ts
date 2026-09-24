import { describe, expect, it } from 'vitest';
import { loginError } from './loginError';

describe('loginError', () => {
  it('reads ?error= from the query string', () => {
    expect(loginError('?error=Battle.net+login+was+cancelled.')).toBe(
      'Battle.net login was cancelled.',
    );
    expect(loginError(new URLSearchParams({ error: 'x' }))).toBe('x');
  });

  it('ignores empty or missing errors', () => {
    expect(loginError('')).toBeNull();
    expect(loginError('?error=')).toBeNull();
    expect(loginError('?error=%20%20')).toBeNull();
  });

  it('caps the length', () => {
    expect(loginError(`?error=${'a'.repeat(1000)}`)).toHaveLength(200);
  });
});
