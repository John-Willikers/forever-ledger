import type { LedgerApi } from '../main/ipc.js';

declare global {
  interface Window {
    /** Exposed by the preload script. */
    ledger: LedgerApi;
  }
}

export {};
