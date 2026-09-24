import { buildApp, loggerOptions } from './app.js';
import { openDatabase, runMigrations } from './db/client.js';
import { readEnv } from './env.js';
import { backfillRunGroups } from './runGroups.js';

process.env.TZ ??= 'America/Chicago';

const env = readEnv();
const database = openDatabase(env.databaseUrl);
await runMigrations(database.db);
// Runs stored before migration 0010 have no run group yet; ingest groups every run it stores, so this is a no-op
// (one indexed lookup) after the first start.
const regrouped = await backfillRunGroups(database.db);

const app = await buildApp({
  database,
  logger: loggerOptions,
  bodyLimit: env.bodyLimit,
  ingestPerMinute: env.ingestPerMinute,
  admin: env.admin,
});
if (regrouped > 0) app.log.info({ runs: regrouped }, 'run groups backfilled');
app.log.info(
  {
    battleNetLogin: env.admin.bnet !== undefined,
    adminBattletags: env.admin.adminBattletags.length,
    adminBnetSubs: env.admin.adminBnetSubs.length,
  },
  'admin panel settings',
);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await database.pool.end();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: env.host, port: env.port });
