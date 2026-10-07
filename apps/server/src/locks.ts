// Transaction-level advisory lock keys (pg_advisory_xact_lock). One place, so two features never share a key.

/** Serialises logins that may bootstrap the first admin. */
export const BOOTSTRAP_LOCK = 0x464c_4144; // "FLAD"

/**
 * Serialises run grouping: every ingest transaction that stores runs takes it before its first runs write, and
 * `regroupRuns` takes it again (re-entrant within a transaction) before reading and rewriting group ids.
 */
export const RUN_GROUPS_LOCK = 0x464c_5247; // "FLRG"

/** Serialises fetch leases, so two workers asking at once can't both spend the last of the hour's budget. */
export const FETCH_BUDGET_LOCK = 0x464c_4642; // "FLFB"
