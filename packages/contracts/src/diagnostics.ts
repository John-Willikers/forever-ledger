import { z } from 'zod';

/**
 * Error reports the tray app sends to POST /v1/diagnostics: problems on the user's PC (tray, uploader, addon sync,
 * SavedVariables parsing, records the server refused, app self-update) so they can be fixed without asking for logs.
 */
export const DIAGNOSTIC_LEVELS = ['warn', 'error', 'fatal'] as const;
export type DiagnosticLevel = (typeof DIAGNOSTIC_LEVELS)[number];

export const DIAGNOSTIC_SOURCES = [
  'tray',
  'uploader',
  'addon-sync',
  'parse',
  'rejected',
  'updater',
] as const;
export type DiagnosticSource = (typeof DIAGNOSTIC_SOURCES)[number];

export const DIAGNOSTIC_MESSAGE_MAX = 500;
/** Largest `detail`, as UTF-8 JSON. */
export const DIAGNOSTIC_DETAIL_MAX_BYTES = 4096;
export const DIAGNOSTICS_MAX_EVENTS = 50;

/** UTF-8 bytes of `JSON.stringify(v)`; Infinity when it doesn't serialize. */
export function jsonBytes(v: unknown): number {
  try {
    const text = JSON.stringify(v);
    return text === undefined ? Infinity : new TextEncoder().encode(text).length;
  } catch {
    return Infinity;
  }
}

export const DiagnosticEvent = z.object({
  /** Epoch seconds on the reporting PC. */
  at: z.number().int().min(0).max(4_102_444_800),
  level: z.enum(DIAGNOSTIC_LEVELS),
  source: z.enum(DIAGNOSTIC_SOURCES),
  message: z.string().min(1).max(DIAGNOSTIC_MESSAGE_MAX),
  detail: z
    .json()
    .refine((v) => jsonBytes(v) <= DIAGNOSTIC_DETAIL_MAX_BYTES, {
      message: `detail is over ${DIAGNOSTIC_DETAIL_MAX_BYTES} bytes of JSON`,
    })
    .optional(),
});
export type DiagnosticEvent = z.infer<typeof DiagnosticEvent>;

export const DiagnosticsReport = z.object({
  uploaderId: z.string().min(1).max(128),
  appVersion: z.string().min(1).max(64),
  /** e.g. `win32 10.0.22631`. */
  platform: z.string().min(1).max(128),
  events: z.array(DiagnosticEvent).min(1).max(DIAGNOSTICS_MAX_EVENTS),
});
export type DiagnosticsReport = z.infer<typeof DiagnosticsReport>;

/** POST /v1/diagnostics response. */
export const DiagnosticsResponse = z.object({ accepted: z.number().int().nonnegative() });
export type DiagnosticsResponse = z.infer<typeof DiagnosticsResponse>;
