// Admin CLI for ingest tokens: node dist/tokens-cli.js mint <label> | list | revoke <id>
import { listTokens, mintToken, revokeToken } from './auth.js';
import { openDatabase, runMigrations } from './db/client.js';
import { readEnv } from './env.js';
import { chicagoIso } from './time.js';

const [command, arg] = process.argv.slice(2);
const database = openDatabase(readEnv().databaseUrl);

try {
  await runMigrations(database.db);
  if (command === 'mint' && arg) {
    const { id, token } = await mintToken(database.db, arg);
    console.log(
      `token #${id} for "${arg}" (shown once, store it in the uploader config):\n${token}`,
    );
  } else if (command === 'list') {
    for (const t of await listTokens(database.db)) {
      const state = t.revokedAt ? `revoked ${chicagoIso(t.revokedAt)}` : 'active';
      const used = t.lastUsedAt ? chicagoIso(t.lastUsedAt) : 'never';
      console.log(
        `#${t.id}\t${t.label}\t${state}\tcreated ${chicagoIso(t.createdAt)}\tlast used ${used}`,
      );
    }
  } else if (command === 'revoke' && arg) {
    const ok = await revokeToken(database.db, Number(arg));
    console.log(ok ? `token #${arg} revoked` : `no active token #${arg}`);
    process.exitCode = ok ? 0 : 1;
  } else {
    console.error('usage: tokens-cli mint <label> | list | revoke <id>');
    process.exitCode = 2;
  }
} finally {
  await database.pool.end();
}
