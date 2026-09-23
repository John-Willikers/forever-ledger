// Admin CLI for addon releases:
//   node dist/addon-cli.js publish <version> | pin <buildMin>-<buildMax|> <version> | unpin <id>
//                          | yank <version> | list
import { listAddon, pinVersion, publishRelease, unpin, yankVersion } from './addon.js';
import { openDatabase, runMigrations } from './db/client.js';
import { readEnv } from './env.js';
import { chicagoIso } from './time.js';

const USAGE =
  'usage: addon-cli publish <version> | pin <buildMin>-<buildMax|> <version> | unpin <id> | yank <version> | list';

const [command, arg, arg2] = process.argv.slice(2);
const env = readEnv();
const database = openDatabase(env.databaseUrl);
const { db } = database;

try {
  await runMigrations(db);
  if (command === 'publish' && arg) {
    const m = await publishRelease(db, arg, { repo: env.githubRepo, token: env.githubToken });
    console.log(
      `published ${m.addon} ${m.version} (${m.size} bytes, sha256 ${m.sha256})\n${m.url}`,
    );
  } else if (command === 'pin' && arg && arg2) {
    const range = /^(\d+)-(\d*)$/.exec(arg);
    if (!range) throw new Error(`build range must look like 69913-69920 or 69913-: ${arg}`);
    const buildMin = Number(range[1]);
    const buildMax = range[2] ? Number(range[2]) : null;
    const id = await pinVersion(db, buildMin, buildMax, arg2);
    console.log(`pin #${id}: builds ${buildMin}-${buildMax ?? '∞'} run ${arg2}`);
  } else if (command === 'unpin' && arg) {
    const ok = /^\d+$/.test(arg) && (await unpin(db, Number(arg)));
    console.log(ok ? `pin #${arg} removed` : `no pin #${arg}`);
    process.exitCode = ok ? 0 : 1;
  } else if (command === 'yank' && arg) {
    const ok = await yankVersion(db, arg);
    console.log(ok ? `${arg} yanked` : `no active release ${arg}`);
    process.exitCode = ok ? 0 : 1;
  } else if (command === 'list') {
    const { releases, pins } = await listAddon(db);
    console.log(releases.length ? 'releases:' : 'releases: none');
    for (const r of releases) {
      console.log(
        `  ${r.version}\t${r.status}\tpublished ${chicagoIso(r.publishedAt)}\t${r.size} bytes\tsha256 ${r.sha256}`,
      );
    }
    console.log(pins.length ? 'pins:' : 'pins: none');
    for (const p of pins) {
      console.log(
        `  #${p.id}\tbuilds ${p.buildMin}-${p.buildMax ?? '∞'}\t${p.version}\tcreated ${chicagoIso(p.createdAt)}`,
      );
    }
  } else {
    console.error(USAGE);
    process.exitCode = 2;
  }
} catch (e) {
  console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await database.pool.end();
}
