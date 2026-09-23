import { Command, Option } from 'commander';
import { createRequire } from 'node:module';
import { basename, dirname, resolve } from 'node:path';
import { checkHealth } from './client.js';
import {
  loadConfig,
  maskToken,
  newUploaderId,
  normalizeServerUrl,
  readConfigFile,
  requireServer,
  resolveConfig,
  resolveConfigPath,
  saveConfig,
} from './config.js';
import type { ConfigFile } from './config.js';
import { discoverSavedVariables } from './discover.js';
import { ConfigError, errorMessage } from './errors.js';
import { exportRecords, writeExport } from './export.js';
import { createLogger } from './log.js';
import type { Logger } from './log.js';
import { runUploadPass } from './pass.js';
import type { PassResult } from './pass.js';
import { formatProbeSummary, probeDump } from './probe.js';
import { collectStatus, formatStatus } from './status.js';
import { startWatch } from './watch.js';

const pkg = createRequire(import.meta.url)('../package.json') as { version: string };

interface GlobalOpts {
  config?: string;
  verbose?: boolean;
  jsonLogs?: boolean;
}

const out = (line = '') => process.stdout.write(`${line}\n`);

function globals(cmd: Command): GlobalOpts {
  return cmd.optsWithGlobals<GlobalOpts>();
}

function logger(g: GlobalOpts): Logger {
  return createLogger({ level: g.verbose ? 'debug' : 'info', json: g.jsonLogs });
}

/** Runs an action, turning thrown errors into a one-line message and exit code 1. */
function action<A extends unknown[]>(fn: (...args: A) => Promise<number | void>) {
  return async (...args: A) => {
    try {
      const code = await fn(...args);
      if (typeof code === 'number') process.exitCode = code;
    } catch (err) {
      process.stderr.write(`error: ${errorMessage(err)}\n`);
      process.exitCode = 1;
    }
  };
}

function printPass(res: PassResult) {
  for (const f of res.files) {
    if (f.ok)
      out(
        `${f.account}: ${f.records} records${f.problems ? ` (${f.problems} invalid, skipped)` : ''}, ${f.queuedRecords} new/changed queued in ${f.queuedBatches} batch(es)`,
      );
    else out(`${f.account}: FAILED — ${f.error}`);
  }
  for (const n of res.notes) out(n);
  const fl = res.flush;
  if (fl) {
    out(
      `uploaded ${fl.sent} batch(es), ${fl.acked} record(s) acknowledged; ${fl.pendingBatches} batch(es) / ${fl.pendingRecords} record(s) still queued`,
    );
    if (fl.split) out(`split ${fl.split} oversized batch(es)`);
    if (fl.rejected) out(`${fl.rejected} record(s) rejected by the server (kept in rejected/)`);
    for (const e of fl.errors)
      if (e.message !== res.fatal?.message) out(`${e.account}: ${e.message}`);
  }
  if (res.fatal) out(`STOPPED: ${res.fatal.message}`);
}

export function buildProgram(): Command {
  const program = new Command()
    .name('forever-ledger')
    .description(
      'Uploads Forever Ledger SavedVariables (WTF/Account/<ACCOUNT>/SavedVariables/ForeverLedger.lua) to the ledger server.\nRead-only: it only reads that file and never touches the game.',
    )
    .version(pkg.version)
    .option(
      '-c, --config <path>',
      'config file (default: FOREVER_LEDGER_CONFIG, %APPDATA% or ~/.config/forever-ledger/config.json)',
    )
    .option('-v, --verbose', 'debug logging')
    .option('--json-logs', 'log raw JSON lines instead of readable text');

  program
    .command('init')
    .description('create or update the config and list the accounts found')
    .option('--wow-path <path>', 'WoW install folder, the game flavor folder, or its WTF folder')
    .option('--server <url>', 'ledger server URL, e.g. https://ledger.willikers.dev')
    .option('--token <token>', 'upload token')
    .option('--accounts <names>', 'comma-separated account folders to upload (default: all)')
    .option('--state-dir <path>', 'where the queue and upload state live (default: next to config)')
    .action(
      action(async (opts: Record<string, string | undefined>, cmd: Command) => {
        const configPath = resolveConfigPath(globals(cmd).config);
        const existing = await readConfigFile(configPath);
        const file: ConfigFile = {
          accounts: [],
          ...existing,
          uploaderId: existing?.uploaderId ?? newUploaderId(),
        };
        if (opts.wowPath) file.wowPath = resolve(opts.wowPath);
        if (opts.server) file.serverUrl = normalizeServerUrl(opts.server);
        if (opts.token) file.token = opts.token.trim();
        if (opts.stateDir) file.stateDir = resolve(opts.stateDir);
        if (opts.accounts !== undefined)
          file.accounts = opts.accounts
            .split(',')
            .map((a) => a.trim())
            .filter(Boolean);
        if (!file.wowPath)
          throw new ConfigError('--wow-path is required (the folder that contains WTF)');

        const d = await discoverSavedVariables(file.wowPath, { accounts: file.accounts });
        await saveConfig(configPath, file);
        const config = resolveConfig(file, configPath);

        out(`wrote ${configPath}`);
        out(`  wowPath:    ${file.wowPath}`);
        out(`  server:     ${file.serverUrl ?? '(not set: pass --server)'}`);
        out(`  token:      ${maskToken(file.token)}`);
        out(`  uploaderId: ${file.uploaderId}`);
        out(`  stateDir:   ${config.stateDir}`);
        out();
        for (const n of d.notes) out(n);
        out();
        if (d.files.length) {
          out(`will upload ${d.files.length} account(s):`);
          for (const f of d.files) out(`  ${f.account}  ${f.file}`);
        } else {
          out(
            'no ForeverLedger.lua found yet. Enable the addon, log in, /reload, then run init again.',
          );
        }
        if (file.serverUrl) {
          const h = await checkHealth(file.serverUrl);
          out(`server health: ${h.ok ? 'ok' : `unreachable (${h.message})`}`);
        }
        if (file.serverUrl && file.token && d.files.length)
          out('next: `forever-ledger upload-once` or `forever-ledger watch`');
      }),
    );

  program
    .command('watch')
    .description('upload now, then again every time WoW rewrites the file; retries while offline')
    .action(
      action(async (_opts: unknown, cmd: Command) => {
        const g = globals(cmd);
        const config = await loadConfig(resolveConfigPath(g.config));
        requireServer(config);
        const log = logger(g);
        const handle = await startWatch({ config, logger: log });
        log.info(
          { files: handle.watchedFiles().length },
          'watching for SavedVariables changes (Ctrl+C to stop)',
        );
        const shutdown = () => {
          log.info('stopping');
          void handle.close();
        };
        process.once('SIGINT', shutdown);
        process.once('SIGTERM', shutdown);
        const fatal = await handle.done;
        if (fatal) {
          process.stderr.write(`error: ${fatal.message}\n`);
          return 1;
        }
      }),
    );

  program
    .command('upload-once')
    .description('one upload pass; exits non-zero if anything failed or is still queued')
    .action(
      action(async (_opts: unknown, cmd: Command) => {
        const g = globals(cmd);
        const config = await loadConfig(resolveConfigPath(g.config));
        const res = await runUploadPass({ config, logger: logger(g) });
        printPass(res);
        return res.ok ? 0 : 1;
      }),
    );

  program
    .command('status')
    .description('per account: acked records, queued batches, last upload, last error')
    .action(
      action(async (_opts: unknown, cmd: Command) => {
        const config = await loadConfig(resolveConfigPath(globals(cmd).config));
        out(formatStatus(config, await collectStatus(config)));
      }),
    );

  program
    .command('export')
    .description('write normalized records as JSON (no server needed)')
    .argument('<out>', 'output .json file')
    .option('--account <name>', 'only this account')
    .addOption(
      new Option(
        '--file <path>',
        'read this ForeverLedger.lua instead of the configured WoW folder',
      ),
    )
    .action(
      action(async (outPath: string, opts: { account?: string; file?: string }, cmd: Command) => {
        let files: { account: string; file: string }[];
        if (opts.file) {
          const file = resolve(opts.file);
          files = [{ account: opts.account ?? basename(dirname(dirname(file))), file }];
        } else {
          const config = await loadConfig(resolveConfigPath(globals(cmd).config));
          if (!config.wowPath)
            throw new ConfigError('wowPath is not set (run init or pass --file)');
          const d = await discoverSavedVariables(config.wowPath, {
            accounts: opts.account ? [opts.account] : config.accounts,
          });
          files = d.files;
          if (!files.length)
            throw new Error(
              `no ForeverLedger.lua found${opts.account ? ` for account ${opts.account}` : ''}`,
            );
        }
        const doc = await exportRecords(files);
        await writeExport(resolve(outPath), doc);
        for (const a of doc.accounts) {
          const counts = Object.entries(a.records)
            .map(([k, v]) => `${k} ${v.length}`)
            .join(', ');
          out(
            `${a.account}: ${counts}${a.problems.length ? `; ${a.problems.length} invalid` : ''}`,
          );
        }
        out(`wrote ${resolve(outPath)}`);
      }),
    );

  program
    .command('probe-dump')
    .description('convert ForeverLedgerProbe.lua (the API probe addon) to JSON and summarise it')
    .argument('<probe>', 'WTF/Account/<ACCOUNT>/SavedVariables/ForeverLedgerProbe.lua')
    .argument('<out>', 'output .json file')
    .action(
      action(async (input: string, outPath: string) => {
        const summary = await probeDump(resolve(input), resolve(outPath));
        out(formatProbeSummary(summary));
        out();
        out(`wrote ${resolve(outPath)}`);
      }),
    );

  return program;
}
