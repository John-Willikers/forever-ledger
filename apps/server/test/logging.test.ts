import { describe, expect, it } from 'vitest';
import { redactUrl } from '../src/logging.js';

describe('redactUrl', () => {
  it('hides OAuth codes, states and tokens in query strings', () => {
    expect(redactUrl('/admin/auth/callback?code=abc&state=def')).toBe(
      '/admin/auth/callback?code=redacted&state=redacted',
    );
    expect(redactUrl('/x?access_token=1&Token=2&keep=3')).toBe(
      '/x?access_token=redacted&Token=redacted&keep=3',
    );
  });

  it('leaves other URLs alone', () => {
    expect(redactUrl('/v1/quests/xp?build=63000')).toBe('/v1/quests/xp?build=63000');
    expect(redactUrl('/admin/')).toBe('/admin/');
  });
});
