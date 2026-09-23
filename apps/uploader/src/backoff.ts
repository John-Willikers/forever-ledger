export interface BackoffOptions {
  baseMs?: number;
  capMs?: number;
  random?: () => number;
}

/**
 * Exponential backoff with "equal jitter": half the window is fixed, half random, so retries never
 * collapse to zero but also never synchronise. `failures` counts consecutive failures (1 = first).
 */
export function backoffDelay(failures: number, opts: BackoffOptions = {}): number {
  const base = opts.baseMs ?? 5_000;
  const cap = opts.capMs ?? 5 * 60_000;
  const random = opts.random ?? Math.random;
  const window = Math.min(cap, base * 2 ** Math.max(0, failures - 1));
  return Math.round(window / 2 + random() * (window / 2));
}
