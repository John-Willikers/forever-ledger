import { describe, expect, it } from 'vitest';
import type { DiagnosticItem, IngestErrorItem } from '../types';
import { diagnosticsPath, hasEntries, headline, prettyJson, severity } from './health';

const diag = (over: Partial<DiagnosticItem> = {}): DiagnosticItem => ({
  type: 'diagnostic',
  id: 1,
  receivedAt: '2026-09-23T19:00:00-05:00',
  occurredAt: '2026-09-23T19:00:00-05:00',
  tokenId: 2,
  uploaderId: 'pc-1',
  appVersion: '0.1.4',
  platform: 'win32',
  level: 'warn',
  source: 'uploader',
  message: 'slow',
  detail: null,
  ...over,
});

const refused: IngestErrorItem = {
  type: 'ingest-error',
  id: 2,
  receivedAt: '2026-09-23T19:00:00-05:00',
  tokenId: 2,
  uploaderId: 'pc-1',
  account: 'A',
  schemaVersion: 9,
  status: 409,
  error: 'unsupported schemaVersion 9',
  issues: null,
};

describe('diagnosticsPath', () => {
  const now = 1_790_000_000_000;
  it('leaves out empty filters', () => {
    expect(diagnosticsPath({}, now)).toBe('/v1/diagnostics');
    expect(diagnosticsPath({ type: '', level: '', source: '', days: 7 }, now)).toBe(
      '/v1/diagnostics',
    );
  });

  it('adds type, level, source and a since for other windows', () => {
    expect(diagnosticsPath({ type: 'diagnostic', level: 'warn', source: 'tray' }, now)).toBe(
      '/v1/diagnostics?type=diagnostic&level=warn&source=tray',
    );
    expect(diagnosticsPath({ days: 30 }, now)).toBe(
      `/v1/diagnostics?since=${1_790_000_000 - 30 * 86_400}`,
    );
  });
});

describe('feed rows', () => {
  it('rates severity; ingest errors are errors', () => {
    expect(severity(diag({ level: 'warn' }))).toBe('warn');
    expect(severity(diag({ level: 'fatal' }))).toBe('fatal');
    expect(severity(diag({ level: 'error' }))).toBe('error');
    expect(severity(refused)).toBe('error');
  });

  it('writes a headline', () => {
    expect(headline(diag())).toBe('slow');
    expect(headline(diag({ message: null }))).toBe('(no message)');
    expect(headline(refused)).toBe('Ingest refused (409): unsupported schemaVersion 9');
  });
});

describe('samples', () => {
  it('pretty-prints JSON', () => {
    expect(prettyJson({ a: [1] })).toBe('{\n  "a": [\n    1\n  ]\n}');
    expect(prettyJson(undefined)).toBe('');
  });

  it('knows an empty report from a filled one', () => {
    expect(hasEntries({})).toBe(false);
    expect(hasEntries([])).toBe(false);
    expect(hasEntries(null)).toBe(false);
    expect(hasEntries({ x: 1 })).toBe(true);
    expect(hasEntries('text')).toBe(true);
  });
});
