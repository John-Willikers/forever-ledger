import { normalize, UnsupportedSchemaError } from '@forever-ledger/contracts';
import { SavedVariablesParseError } from '@forever-ledger/lua-sv-parser';
import { resolve } from 'node:path';
import { buildBatch, chunkEntries, diffRecords, toEntries } from './batches.js';
import type { ChunkOptions } from './batches.js';
import { postBatch } from './client.js';
import type { FetchLike } from './client.js';
import { requireServer } from './config.js';
import type { Config } from './config.js';
import { discoverSavedVariables } from './discover.js';
import type { SavedVariablesFile } from './discover.js';
import { ConfigError, errorMessage, FatalUploadError } from './errors.js';
import { withLock } from './lock.js';
import { silentLogger } from './log.js';
import type { Logger } from './log.js';
import { Queue } from './queue.js';
import type { QueuedBatch } from './queue.js';
import { readSavedVariable } from './reader.js';
import type { ReadOptions } from './reader.js';
import { StateStore } from './state.js';

export interface FileResult {
  account: string;
  file: string;
  ok: boolean;
  error?: string;
  /** Valid records in the file. */
  records: number;
  /** Records that failed validation (not uploaded). */
  problems: number;
  /** New or changed records queued by this pass. */
  queuedRecords: number;
  queuedBatches: number;
}

export interface FlushResult {
  /** Batches the server acknowledged. */
  sent: number;
  /** Records acknowledged. */
  acked: number;
  rejected: number;
  split: number;
  /** Batches still queued after the flush. */
  pendingBatches: number;
  pendingRecords: number;
  /** Something retryable failed (network, 429, 5xx): back off and flush again later. */
  retryable: boolean;
  errors: { account: string; message: string }[];
  fatal?: FatalUploadError;
}

export interface PassResult {
  ok: boolean;
  files: FileResult[];
  flush?: FlushResult;
  fatal?: FatalUploadError;
  notes: string[];
}

interface Ctx {
  config: Config;
  state: StateStore;
  queue: Queue;
  logger: Logger;
}

export interface PrepareOptions {
  read?: ReadOptions;
  chunk?: ChunkOptions;
}

/** Parse → normalize → diff vs acked + queued → chunk → enqueue, for one SavedVariables file. */
export async function prepareFile(
  sv: SavedVariablesFile,
  ctx: Ctx,
  opts: PrepareOptions = {},
): Promise<FileResult> {
  const { logger, state, queue, config } = ctx;
  const result: FileResult = {
    account: sv.account,
    file: sv.file,
    ok: false,
    records: 0,
    problems: 0,
    queuedRecords: 0,
    queuedBatches: 0,
  };
  const log = logger.child({ account: sv.account });
  try {
    const { value, read } = await readSavedVariable(sv.file, { ...opts.read, logger: log });
    const normalized = normalize(value);
    const total = toEntries(normalized.records).length;
    result.records = total;
    result.problems = normalized.problems.length;
    if (normalized.problems.length) {
      log.warn(
        {
          problems: normalized.problems.length,
          first: normalized.problems
            .slice(0, 3)
            .map((p) => `${p.path}: ${p.issues.slice(0, 2).join('; ')}`),
        },
        'some records failed validation and will not be uploaded',
      );
    }

    await state.setFile(sv.account, sv.file);
    await state.setBuild(sv.account, normalized.meta.build, read.mtimeMs);
    const acked = state.account(sv.account).acked;
    const queued = await queue.pendingHashes(sv.account);
    const rejected = state.account(sv.account).rejected;
    const { changed, unchanged } = diffRecords(normalized.records, acked, queued, rejected);
    const header = { uploaderId: config.uploaderId, account: sv.account, meta: normalized.meta };
    for (const chunk of chunkEntries(header, changed, opts.chunk)) {
      await queue.enqueue(sv.account, buildBatch(header, chunk));
      result.queuedBatches++;
      result.queuedRecords += chunk.length;
    }
    log.info(
      { records: total, unchanged, queued: result.queuedRecords, batches: result.queuedBatches },
      changed.length ? 'queued new/changed records' : 'no new records',
    );
    result.ok = true;
  } catch (err) {
    let message: string;
    if (err instanceof UnsupportedSchemaError) message = `${sv.file}: ${err.message}`;
    else if (err instanceof SavedVariablesParseError && err.reason === 'truncated')
      message = `${sv.file} is still being written (truncated); will retry on the next change`;
    else if (err instanceof SavedVariablesParseError)
      message = `could not parse ${sv.file}: ${err.message}`;
    else message = `${sv.file}: ${errorMessage(err)}`;
    result.error = message;
    log.error({ file: sv.file }, message);
    await state.setError(sv.account, message);
  }
  return result;
}

export interface FlushOptions {
  serverUrl: string;
  token: string;
  fetchImpl?: FetchLike;
  /** Only flush these accounts (default: every account with a queue folder). */
  accounts?: string[];
}

function fatalFor(
  kind: 'unauthorized' | 'unsupported-schema',
  message: string,
  schemaVersion: number,
) {
  return kind === 'unauthorized'
    ? new FatalUploadError(
        'unauthorized',
        `the server rejected the upload token (${message}). Ask for a new token and run \`forever-ledger init --token <token>\`; queued data is kept.`,
      )
    : new FatalUploadError(
        'unsupported-schema',
        `the server does not accept schemaVersion ${schemaVersion} (${message}). Update the Forever Ledger uploader (and addon); queued data is kept.`,
      );
}

/** Sends queued batches oldest-first. Acks are recorded only from a 2xx response. */
export async function flushQueue(ctx: Ctx, opts: FlushOptions): Promise<FlushResult> {
  const { queue, state, logger } = ctx;
  const out: FlushResult = {
    sent: 0,
    acked: 0,
    rejected: 0,
    split: 0,
    pendingBatches: 0,
    pendingRecords: 0,
    retryable: false,
    errors: [],
  };
  const accounts = opts.accounts ?? (await queue.accounts());

  accounts: for (const account of accounts) {
    const log = logger.child({ account });
    for (;;) {
      const [id] = await queue.list(account);
      if (id === undefined) break;
      let qb: QueuedBatch;
      try {
        qb = await queue.read(account, id);
      } catch (err) {
        const message = `unreadable queued batch ${id}: ${errorMessage(err)}`;
        log.error(message);
        await queue.reject(account, id, { message });
        out.rejected++;
        out.errors.push({ account, message });
        continue;
      }

      const res = await postBatch(qb.batch, opts);
      switch (res.kind) {
        case 'ok': {
          const acks = res.response.acknowledged;
          await state.markAcked(account, acks);
          await queue.remove(account, id);
          out.sent++;
          out.acked += acks.length;
          const ackedKeys = new Set(acks.map((a) => a.key));
          const missing = qb.entries.filter((e) => !ackedKeys.has(e.key)).length;
          log.info(
            { batch: id, batchId: res.response.batchId, acked: acks.length, notAcked: missing },
            'batch uploaded',
          );
          if (missing)
            log.warn({ notAcked: missing }, 'server did not acknowledge every record; will resend');
          break;
        }
        case 'too-large':
        case 'rejected': {
          const entries = toEntries(qb.batch.records);
          if (entries.length > 1) {
            // 413: make it smaller. 400: bisect so only the offending record(s) end up rejected.
            const half = Math.ceil(entries.length / 2);
            await queue.replace(account, id, [
              buildBatch(qb.batch, entries.slice(0, half)),
              buildBatch(qb.batch, entries.slice(half)),
            ]);
            out.split++;
            log.warn(
              { batch: id, records: entries.length, status: res.status },
              res.kind === 'too-large'
                ? 'batch too large, split in half'
                : `server rejected the batch (${res.message}); splitting to isolate the bad record`,
            );
            break;
          }
          const message =
            res.kind === 'too-large'
              ? `record ${qb.entries[0]?.key} is too large for the server (${res.message})`
              : `server rejected record ${qb.entries[0]?.key}: ${res.message}`;
          log.error({ batch: id }, message);
          await queue.reject(account, id, {
            status: res.status,
            message: res.message,
            ...(res.kind === 'rejected' && res.issues ? { issues: res.issues } : {}),
          });
          await state.markRejected(account, qb.entries);
          await state.setError(account, message);
          out.rejected++;
          out.errors.push({ account, message });
          break;
        }
        case 'unauthorized':
        case 'unsupported-schema': {
          const fatal = fatalFor(res.kind, res.message, qb.batch.schemaVersion);
          log.error(fatal.message);
          await state.setError(account, fatal.message);
          out.fatal = fatal;
          out.errors.push({ account, message: fatal.message });
          break accounts;
        }
        case 'retry': {
          const message = `upload failed, will retry: ${res.message}`;
          log.warn(message);
          await state.setError(account, message);
          out.retryable = true;
          out.errors.push({ account, message });
          continue accounts;
        }
      }
    }
  }

  for (const account of await queue.accounts()) {
    const s = await queue.stats(account);
    out.pendingBatches += s.batches;
    out.pendingRecords += s.records;
  }
  return out;
}

export interface PassOptions extends PrepareOptions {
  config: Config;
  fetchImpl?: FetchLike;
  logger?: Logger;
  /** Only these SavedVariables files (absolute paths); default every discovered file. */
  files?: string[];
  /** Set false to only parse + queue (no network). */
  flush?: boolean;
}

/**
 * One upload pass: discover files, queue new/changed records, then flush the whole queue.
 * Holds the state-folder lock for the duration.
 */
export async function runUploadPass(opts: PassOptions): Promise<PassResult> {
  const { config } = opts;
  const logger = opts.logger ?? silentLogger();
  const server = opts.flush === false ? undefined : requireServer(config);
  if (!config.wowPath)
    throw new ConfigError(
      `wowPath is not set in ${config.configPath} (run \`forever-ledger init\`)`,
    );
  const wowPath = config.wowPath;

  return withLock(config.stateDir, async () => {
    const ctx: Ctx = {
      config,
      logger,
      state: await StateStore.open(config.stateDir),
      queue: new Queue(config.stateDir),
    };
    const discovery = await discoverSavedVariables(wowPath, { accounts: config.accounts });
    const notes: string[] = [];
    let svFiles = discovery.files;
    if (opts.files) {
      const wanted = new Set(opts.files.map((f) => resolve(f)));
      svFiles = svFiles.filter((f) => wanted.has(resolve(f.file)));
    } else if (svFiles.length === 0) {
      notes.push(`no ForeverLedger.lua found under ${wowPath}`, ...discovery.notes);
      for (const n of notes) logger.warn(n);
    }

    const files: FileResult[] = [];
    for (const sv of svFiles) files.push(await prepareFile(sv, ctx, opts));

    let flush: FlushResult | undefined;
    if (server) {
      flush = await flushQueue(ctx, { ...server, fetchImpl: opts.fetchImpl });
      const failed = new Set(flush.errors.map((e) => e.account));
      for (const f of files)
        if (f.ok && !failed.has(f.account)) await ctx.state.clearError(f.account);
    }

    const ok =
      (svFiles.length > 0 || opts.files !== undefined) &&
      files.every((f) => f.ok) &&
      (!flush || (!flush.fatal && flush.errors.length === 0 && flush.pendingBatches === 0));
    return { ok, files, flush, fatal: flush?.fatal, notes };
  });
}

/** Flush only (no file parsing): used by `watch` to retry the queue on a timer. */
export async function runFlush(opts: {
  config: Config;
  fetchImpl?: FetchLike;
  logger?: Logger;
}): Promise<FlushResult> {
  const server = requireServer(opts.config);
  return withLock(opts.config.stateDir, async () => {
    const ctx: Ctx = {
      config: opts.config,
      logger: opts.logger ?? silentLogger(),
      state: await StateStore.open(opts.config.stateDir),
      queue: new Queue(opts.config.stateDir),
    };
    return flushQueue(ctx, { ...server, fetchImpl: opts.fetchImpl });
  });
}
