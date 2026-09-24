// Admin CLI for API tokens: node dist/tokens-cli.js mint <label> [--read] | list | revoke <id>
// Tokens upload only (ingest, error reports, addon manifest) unless minted with --read (every /v1 read route too).
import { listTokens, mintToken, revokeToken } from './auth.js';
import { openDatabase, runMigrations } from './db/client.js';
import { readEnv } from './env.js';
import { chicagoIso } from './time.js';

const args = process.argv.slice(2);
const canRead = args.includes('--read');
const [command, arg] = args.filter((a) => a !== '--read');
const database = openDatabase(readEnv().databaseUrl);

try {
  await runMigrations(database.db);
  if (command === 'mint' && arg) {
    const { id, token } = await mintToken(database.db, arg, { canRead });
    const scope = canRead ? 'upload + read all data' : 'upload only';
    console.log(
      `token #${id} for "${arg}" (${scope}; shown once, store it in the uploader config):\n${token}`,
    );
  } else if (command === 'list') {
    for (const t of await listTokens(database.db)) {
      const state = t.revokedAt ? `revoked ${chicagoIso(t.revokedAt)}` : 'active';
      const used = t.lastUsedAt ? chicagoIso(t.lastUsedAt) : 'never';
      const scope = t.canRead ? 'upload+read' : 'upload';
      console.log(
        `#${t.id}\t${t.label}\t${scope}\t${state}\tcreated ${chicagoIso(t.createdAt)}\tlast used ${used}`,
      );
    }
  } else if (command === 'revoke' && arg) {
    const ok = await revokeToken(database.db, Number(arg));
    console.log(ok ? `token #${arg} revoked` : `no active token #${arg}`);
    process.exitCode = ok ? 0 : 1;
  } else {
    console.error('usage: tokens-cli mint <label> [--read] | list | revoke <id>');
    process.exitCode = 2;
  }
} finally {
  await database.pool.end();
}
