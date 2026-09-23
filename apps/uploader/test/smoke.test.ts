import { describe, expect, it } from 'vitest';
import { PACKAGE } from '../src/index.js';

describe('scaffold', () => {
  it('loads', () => {
    expect(PACKAGE).toBeTypeOf('string');
  });
});
