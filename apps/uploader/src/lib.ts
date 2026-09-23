/**
 * The library surface without the CLI: `buildProgram` pulls in commander and reads package.json at load, which
 * breaks bundlers (the desktop app imports `@forever-ledger/uploader/lib`).
 */
export const PACKAGE = 'uploader';

// Only read-only helpers here: install/rollback/recover go through syncAddon and rollbackAddonEverywhere, which
// serialize them.
export { addonsDirFor, readInstalledVersion } from './addonInstall.js';
export { AddonSyncError, fetchManifest } from './addonManifest.js';
export type { ManifestOptions } from './addonManifest.js';
export { readAddonSyncState, rollbackAddonEverywhere, syncAddon } from './addonSync.js';
export type {
  AddonFsDeps,
  AddonSyncOptions,
  AddonSyncResult,
  AddonSyncState,
  AddonSyncStatus,
  RollbackOptions,
} from './addonSync.js';
export { backoffDelay } from './backoff.js';
export type { BackoffOptions } from './backoff.js';
export {
  buildBatch,
  chunkEntries,
  diffRecords,
  MAX_BATCH_BYTES,
  MAX_BATCH_RECORDS,
  toEntries,
} from './batches.js';
export type { BatchHeader, ChunkOptions, DiffResult, Entry } from './batches.js';
export { checkHealth, postBatch, postDiagnostics } from './client.js';
export type { DiagnosticsPostResult, FetchLike, PostResult, ValidationIssue } from './client.js';
export {
  defaultConfigPath,
  loadConfig,
  newUploaderId,
  readConfigFile,
  resolveConfig,
  resolveConfigPath,
  saveConfig,
  validateConfigFile,
} from './config.js';
export type { Config, ConfigFile } from './config.js';
export { sanitize, sanitizeJson, summarizeRejected } from './diagnostics.js';
export type {
  RejectedSample,
  RejectedSummary,
  SanitizeJsonOptions,
  SanitizeOptions,
} from './diagnostics.js';
export { discoverSavedVariables, SV_FILE_NAME } from './discover.js';
export type { Discovery, SavedVariablesFile } from './discover.js';
export { ConfigError, FatalUploadError } from './errors.js';
export { exportRecords, writeExport } from './export.js';
export type { ExportDocument } from './export.js';
export { acquireLock, LockedError, releaseHeldLocksSync, withLock } from './lock.js';
export { createLogger, silentLogger } from './log.js';
export type { Logger } from './log.js';
export { flushQueue, prepareFile, runFlush, runUploadPass } from './pass.js';
export type { FileResult, FlushResult, PassOptions, PassResult } from './pass.js';
export { formatProbeSummary, probeDump, PROBE_VARIABLE, summarizeProbe } from './probe.js';
export type { ProbeSummary } from './probe.js';
export { Queue } from './queue.js';
export type { QueuedBatch } from './queue.js';
export { readSavedVariable, readStableFile } from './reader.js';
export type { ReadOptions } from './reader.js';
export { StateStore } from './state.js';
export { collectStatus, formatStatus } from './status.js';
export type { AccountStatus } from './status.js';
export { formatChicago } from './time.js';
export { startWatch } from './watch.js';
export type { WatchEvent, WatchHandle, WatchOptions } from './watch.js';
