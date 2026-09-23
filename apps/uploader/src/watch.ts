import { watch as chokidarWatch } from 'chokidar';
import type { FSWatcher } from 'chokidar';
import { resolve } from 'node:path';
import { backoffDelay } from './backoff.js';
import type { BackoffOptions } from './backoff.js';
import type { ChunkOptions } from './batches.js';
import type { FetchLike } from './client.js';
import type { Config } from './config.js';
import { discoverSavedVariables } from './discover.js';
import { errorMessage, FatalUploadError } from './errors.js';
import { LockedError } from './lock.js';
import { silentLogger } from './log.js';
import type { Logger } from './log.js';
import { runFlush, runUploadPass } from './pass.js';
import type { FlushResult } from './pass.js';
import type { ReadOptions } from './reader.js';
import { formatChicago } from './time.js';

export interface WatchOptions {
  config: Config;
  fetchImpl?: FetchLike;
  logger?: Logger;
  read?: ReadOptions;
  chunk?: ChunkOptions;
  /** How often to check whether a queue retry is due (default 5 s). */
  tickMs?: number;
  /** How often to look for newly created SavedVariables files (default 60 s). */
  rediscoverMs?: number;
  /** chokidar awaitWriteFinish (default 2 s stable, polled every 200 ms). */
  awaitWriteFinish?: { stabilityThreshold: number; pollInterval: number };
  usePolling?: boolean;
  backoff?: BackoffOptions;
}

export interface WatchHandle {
  /** Resolves when watching stops: with the fatal error that stopped it, or undefined after close(). */
  done: Promise<FatalUploadError | undefined>;
  close(): Promise<void>;
  /** Resolves once no pass is running (tests). */
  idle(): Promise<void>;
  watchedFiles(): string[];
}

/**
 * Initial upload pass, then re-uploads whenever WoW rewrites a watched file, and retries the queue
 * with exponential backoff while the server is unreachable. Never throws for file or network problems.
 */
export async function startWatch(opts: WatchOptions): Promise<WatchHandle> {
  const { config } = opts;
  const logger = opts.logger ?? silentLogger();
  const tickMs = opts.tickMs ?? 5_000;
  const rediscoverMs = opts.rediscoverMs ?? 60_000;
  const wowPath = config.wowPath;
  if (!wowPath) throw new Error('wowPath is not set');

  const watched = new Set<string>();
  const pendingFiles = new Set<string>();
  let pendingAll = true;
  let flushDue = false;
  let running: Promise<void> | null = null;
  let closed = false;
  let failures = 0;
  let nextRetryAt = 0;
  let queueNonEmpty = false;
  let lastDiscover = Date.now();
  let resolveDone!: (v: FatalUploadError | undefined) => void;
  const done = new Promise<FatalUploadError | undefined>((r) => (resolveDone = r));

  const watcher: FSWatcher = chokidarWatch([], {
    ignoreInitial: true,
    atomic: true,
    usePolling: opts.usePolling ?? false,
    awaitWriteFinish: opts.awaitWriteFinish ?? { stabilityThreshold: 2_000, pollInterval: 200 },
  });
  const onFileEvent = (path: string) => {
    logger.debug({ file: path }, 'SavedVariables changed');
    pendingFiles.add(resolve(path));
    kick();
  };
  watcher.on('add', onFileEvent);
  watcher.on('change', onFileEvent);
  watcher.on('error', (err) => logger.error({ err }, 'file watcher error'));

  async function discover() {
    lastDiscover = Date.now();
    try {
      const d = await discoverSavedVariables(wowPath as string, { accounts: config.accounts });
      for (const f of d.files) {
        const path = resolve(f.file);
        if (watched.has(path)) continue;
        watched.add(path);
        watcher.add(path);
        logger.info({ account: f.account, file: path }, 'watching');
        if (!pendingAll) {
          pendingFiles.add(path);
          kick();
        }
      }
      if (watched.size === 0) logger.warn({ wowPath }, 'no ForeverLedger.lua found yet; waiting');
    } catch (err) {
      logger.error({ err }, 'discovery failed');
    }
  }

  function afterFlush(flush: FlushResult | undefined) {
    if (!flush) return;
    queueNonEmpty = flush.pendingBatches > 0;
    if (flush.fatal) return stop(flush.fatal);
    if (flush.retryable) {
      failures++;
      const delay = backoffDelay(failures, opts.backoff);
      nextRetryAt = Date.now() + delay;
      logger.info(
        { queuedBatches: flush.pendingBatches, nextRetry: formatChicago(nextRetryAt) },
        'server unreachable; data kept in the queue',
      );
    } else if (flush.sent > 0 || flush.pendingBatches === 0) {
      failures = 0;
      nextRetryAt = 0;
    }
  }

  async function loop() {
    while (!closed && (pendingAll || pendingFiles.size > 0 || flushDue)) {
      const all = pendingAll;
      const files = [...pendingFiles];
      pendingAll = false;
      pendingFiles.clear();
      flushDue = false;
      try {
        if (all || files.length) {
          const res = await runUploadPass({
            config,
            logger,
            fetchImpl: opts.fetchImpl,
            read: opts.read,
            chunk: opts.chunk,
            files: all ? undefined : files,
          });
          afterFlush(res.flush);
        } else {
          afterFlush(await runFlush({ config, logger, fetchImpl: opts.fetchImpl }));
        }
      } catch (err) {
        if (err instanceof FatalUploadError) return stop(err);
        if (err instanceof LockedError) logger.warn(err.message);
        else logger.error({ err }, `upload pass failed: ${errorMessage(err)}`);
        // Try again later, including the files we did not get to.
        if (all) pendingAll = true;
        for (const f of files) pendingFiles.add(f);
        failures++;
        nextRetryAt = Date.now() + backoffDelay(failures, opts.backoff);
        queueNonEmpty = true;
        return;
      }
    }
  }

  function kick() {
    if (closed || running) return;
    running = loop().finally(() => {
      running = null;
    });
  }

  const timer = setInterval(() => {
    if (closed) return;
    if (Date.now() - lastDiscover >= rediscoverMs) void discover();
    if (running || Date.now() < nextRetryAt) return;
    if (pendingAll || pendingFiles.size > 0) kick();
    else if (queueNonEmpty) {
      flushDue = true;
      kick();
    }
  }, tickMs);
  timer.unref?.();

  async function close() {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    await watcher.close();
    await running;
    resolveDone(undefined);
  }

  function stop(fatal: FatalUploadError) {
    logger.fatal(fatal.message);
    closed = true;
    clearInterval(timer);
    void watcher.close().finally(() => resolveDone(fatal));
  }

  await discover();
  kick();

  return {
    done,
    close,
    idle: async () => {
      while (running) await running;
    },
    watchedFiles: () => [...watched],
  };
}
