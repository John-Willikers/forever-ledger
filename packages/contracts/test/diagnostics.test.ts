import { describe, expect, it } from 'vitest';
import {
  DIAGNOSTIC_DETAIL_MAX_BYTES,
  DIAGNOSTIC_MESSAGE_MAX,
  DIAGNOSTICS_MAX_EVENTS,
  DiagnosticsReport,
} from '../src/index.js';

const event = (over: Record<string, unknown> = {}) => ({
  at: 1_790_000_000,
  level: 'error',
  source: 'uploader',
  message: 'upload failed, will retry: network error',
  ...over,
});

const report = (over: Record<string, unknown> = {}) => ({
  uploaderId: 'pc-1',
  appVersion: '0.1.3',
  platform: 'win32 10.0.22631',
  events: [event()],
  ...over,
});

describe('DiagnosticsReport', () => {
  it('accepts a report with every level and source', () => {
    const events = ['warn', 'error', 'fatal'].flatMap((level) =>
      ['tray', 'uploader', 'addon-sync', 'parse', 'rejected', 'updater'].map((source) =>
        event({ level, source, detail: { count: 2, nested: [1, 'x', null] } }),
      ),
    );
    const parsed = DiagnosticsReport.safeParse(report({ events }));
    expect(parsed.success).toBe(true);
  });

  it('needs 1 to 50 events', () => {
    expect(DiagnosticsReport.safeParse(report({ events: [] })).success).toBe(false);
    const many = Array.from({ length: DIAGNOSTICS_MAX_EVENTS + 1 }, () => event());
    expect(DiagnosticsReport.safeParse(report({ events: many })).success).toBe(false);
    expect(
      DiagnosticsReport.safeParse(report({ events: many.slice(0, DIAGNOSTICS_MAX_EVENTS) }))
        .success,
    ).toBe(true);
  });

  it('rejects unknown levels and sources', () => {
    expect(
      DiagnosticsReport.safeParse(report({ events: [event({ level: 'info' })] })).success,
    ).toBe(false);
    expect(DiagnosticsReport.safeParse(report({ events: [event({ source: 'x' })] })).success).toBe(
      false,
    );
  });

  it('caps the message at 500 characters and needs a non-empty one', () => {
    const at = (message: string) =>
      DiagnosticsReport.safeParse(report({ events: [event({ message })] })).success;
    expect(DIAGNOSTIC_MESSAGE_MAX).toBe(500);
    expect(at('x'.repeat(500))).toBe(true);
    expect(at('x'.repeat(501))).toBe(false);
    expect(at('')).toBe(false);
  });

  it('caps the detail at 4 KB of JSON', () => {
    const at = (detail: unknown) =>
      DiagnosticsReport.safeParse(report({ events: [event({ detail })] })).success;
    expect(DIAGNOSTIC_DETAIL_MAX_BYTES).toBe(4096);
    // {"s":"…"} is 8 bytes of wrapping.
    expect(at({ s: 'x'.repeat(4096 - 8) })).toBe(true);
    expect(at({ s: 'x'.repeat(4096 - 7) })).toBe(false);
    expect(at(() => 1)).toBe(false);
  });

  it('needs whole epoch seconds and the header fields', () => {
    expect(DiagnosticsReport.safeParse(report({ events: [event({ at: 1.5 })] })).success).toBe(
      false,
    );
    expect(DiagnosticsReport.safeParse(report({ events: [event({ at: -1 })] })).success).toBe(
      false,
    );
    expect(DiagnosticsReport.safeParse(report({ uploaderId: '' })).success).toBe(false);
    expect(DiagnosticsReport.safeParse(report({ appVersion: undefined })).success).toBe(false);
    expect(DiagnosticsReport.safeParse(report({ platform: 'x'.repeat(129) })).success).toBe(false);
  });
});
