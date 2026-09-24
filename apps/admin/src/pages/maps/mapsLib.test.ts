import { describe, expect, it } from 'vitest';
import {
  buildQuery,
  fileProblem,
  MAX_UPLOAD_BYTES,
  mimeLabel,
  sizeProblem,
  zoneName,
} from './mapsLib';

describe('fileProblem', () => {
  it('accepts PNG, WebP and JPEG up to 8 MB', () => {
    for (const type of ['image/png', 'image/webp', 'image/jpeg'])
      expect(fileProblem({ type, size: 1000 })).toBeNull();
    expect(fileProblem({ type: 'image/png', size: MAX_UPLOAD_BYTES })).toBeNull();
  });

  it('refuses other types, empty files and more than 8 MB', () => {
    expect(fileProblem({ type: 'image/svg+xml', size: 10 })).toMatch(/PNG, WebP or JPEG/);
    expect(fileProblem({ type: 'text/html', size: 10 })).toMatch(/PNG, WebP or JPEG/);
    expect(fileProblem({ type: '', size: 10 })).toMatch(/PNG, WebP or JPEG/);
    expect(fileProblem({ type: 'image/png', size: 0 })).toMatch(/empty/);
    expect(fileProblem({ type: 'image/png', size: MAX_UPLOAD_BYTES + 1 })).toMatch(/8 MB/);
  });
});

describe('sizeProblem', () => {
  it('refuses more than 4096 px on a side', () => {
    expect(sizeProblem(1002, 668)).toBeNull();
    expect(sizeProblem(4096, 4096)).toBeNull();
    expect(sizeProblem(4097, 10)).toMatch(/4097×10/);
    expect(sizeProblem(10, 5000)).toMatch(/4096/);
  });
});

describe('buildQuery / zoneName / mimeLabel', () => {
  it('sends a build only when it is a positive int4', () => {
    expect(buildQuery(' 69977 ')).toBe('?build=69977');
    expect(buildQuery('')).toBe('');
    expect(buildQuery('0')).toBe('');
    expect(buildQuery('abc')).toBe('');
    expect(buildQuery('1.5')).toBe('');
    expect(buildQuery('99999999999')).toBe('');
  });

  it('names a map by its zone, else its id', () => {
    expect(zoneName({ uiMapId: 1411, zone: 'Durotar' })).toBe('Durotar');
    expect(zoneName({ uiMapId: 1413, zone: null })).toBe('Map 1413');
    expect(mimeLabel('image/webp')).toBe('WebP');
    expect(mimeLabel('image/x')).toBe('image/x');
  });
});
