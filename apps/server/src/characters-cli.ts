// Character identity CLI: node dist/characters-cli.js suggest | merge <from key> <into key> [--apply] | aliases
// Build 70009 dropped surnames from UnitName, so addon 0.3.4 keyed "Sam Willikers" as "Sam-<realm>". `merge` moves
// every row of the old key onto the full-name key and records the alias (dry run unless --apply). Addon 0.4.0 keys
// by full name again and sends the GUID, so new renames merge on their own at ingest.
import { mergeCharacter, suggestMerges } from './characters.js';
import { openDatabase, runMigrations } from './db/client.js';
import { characterAliases } from './db/schema.js';
import { readEnv } from './env.js';
import { chicagoIso } from './time.js';

const USAGE = 'usage: characters-cli suggest | merge <from key> <into key> [--apply] | aliases';
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const [command, from, into] = args.filter((a) => a !== '--apply');
const database = openDatabase(readEnv().databaseUrl);
const { db } = database;

class DryRun extends Error {}

try {
  await runMigrations(db);
  if (command === 'suggest') {
    const list = await suggestMerges(db);
    for (const s of list) console.log(`${s.from}  ->  ${s.into}   (${s.why})`);
    if (list.length === 0) console.log('nothing to suggest');
  } else if (command === 'merge' && from && into) {
    try {
      await db.transaction(async (tx) => {
        const r = await mergeCharacter(tx, from, into, 'merge');
        for (const table of Object.keys(r.moved)) {
          const m = r.moved[table]!;
          const d = r.dropped[table]!;
          if (m || d)
            console.log(`${table}: ${m} moved${d ? `, ${d} already there (dropped)` : ''}`);
        }
        console.log(
          apply ? `merged ${from} into ${into}` : `dry run: nothing changed (add --apply)`,
        );
        if (!apply) throw new DryRun();
      });
    } catch (err) {
      if (!(err instanceof DryRun)) throw err;
    }
  } else if (command === 'aliases') {
    for (const a of await db.select().from(characterAliases).orderBy(characterAliases.aliasKey)) {
      console.log(
        `${a.aliasKey}  ->  ${a.canonicalKey}   (${a.reason}, ${chicagoIso(a.createdAt)})`,
      );
    }
  } else {
    console.error(USAGE);
    process.exitCode = 2;
  }
} finally {
  await database.pool.end();
}
