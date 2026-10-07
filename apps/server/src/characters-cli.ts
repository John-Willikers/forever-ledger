// Character identity CLI: node dist/characters-cli.js suggest | merge <from key> <into key> [--apply] [--force]
//                                                     | aliases
// Build 70009 dropped surnames from UnitName, so addon 0.3.4 keyed "Sam Willikers" as "Sam-<realm>". `merge` moves
// every row of the old key onto the full-name key and records the alias for the accounts that uploaded the old key
// (dry run unless --apply). It refuses when an account uploaded the old key but never the full one (another player
// with that first name) unless --force. Addon 0.4.0 keys by full name and sends the GUID, so renames after it merge
// at ingest.
import { accountsOf, MergeRefused, mergeCharacter, suggestMerges } from './characters.js';
import { openDatabase, runMigrations } from './db/client.js';
import { characterAliases } from './db/schema.js';
import { readEnv } from './env.js';
import { lockRunGroups } from './runGroups.js';
import { chicagoIso } from './time.js';

const USAGE =
  'usage: characters-cli suggest | merge <from key> <into key> [--apply] [--force] | aliases';
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const force = args.includes('--force');
const [command, from, into] = args.filter((a) => a !== '--apply' && a !== '--force');
const database = openDatabase(readEnv().databaseUrl);
const { db } = database;

class DryRun extends Error {}

try {
  // Only a merge that writes runs the migrations; suggest, aliases and a dry run only read.
  if (command === 'merge' && apply) await runMigrations(db);
  if (command === 'suggest') {
    const list = await suggestMerges(db);
    for (const s of list) console.log(`${s.from}  ->  ${s.into}   (${s.why})`);
    if (list.length === 0) console.log('nothing to suggest');
  } else if (command === 'merge' && from && into) {
    const fromAccounts = await accountsOf(db, from);
    const intoAccounts = await accountsOf(db, into);
    console.log(`${from} was uploaded by: ${fromAccounts.join(', ') || 'nobody'}`);
    console.log(`${into} was uploaded by: ${intoAccounts.join(', ') || 'nobody'}`);
    const strangers = fromAccounts.filter((a) => !intoAccounts.includes(a));
    if (strangers.length > 0 && !force) {
      console.error(
        `refused: ${strangers.join(', ')} uploaded ${from} but never ${into} (another player?). --force to merge anyway`,
      );
      process.exitCode = 1;
    } else {
      try {
        await db.transaction(async (tx) => {
          await lockRunGroups(tx);
          const r = await mergeCharacter(tx, from, into, 'merge', fromAccounts);
          for (const table of Object.keys(r.moved)) {
            const m = r.moved[table]!;
            const d = r.dropped[table]!;
            if (m || d)
              console.log(`${table}: ${m} moved${d ? `, ${d} already there (dropped)` : ''}`);
          }
          console.log(
            apply ? `merged ${from} into ${into}` : 'dry run: nothing changed (add --apply)',
          );
          if (!apply) throw new DryRun();
        });
      } catch (err) {
        if (err instanceof MergeRefused) {
          console.error(`refused: ${err.message}`);
          process.exitCode = 1;
        } else if (!(err instanceof DryRun)) throw err;
      }
    }
  } else if (command === 'aliases') {
    for (const a of await db.select().from(characterAliases).orderBy(characterAliases.aliasKey)) {
      console.log(
        `${a.account}: ${a.aliasKey}  ->  ${a.canonicalKey}   (${a.reason}, ${chicagoIso(a.createdAt)})`,
      );
    }
  } else {
    console.error(USAGE);
    process.exitCode = 2;
  }
} finally {
  await database.pool.end();
}
