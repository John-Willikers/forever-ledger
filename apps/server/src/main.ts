import { buildApp, loggerOptions } from './app.js';
import { openDatabase, runMigrations } from './db/client.js';
import { readEnv } from './env.js';

process.env.TZ ??= 'America/Chicago';

const env = readEnv();
const database = openDatabase(env.databaseUrl);
await runMigrations(database.db);

const app = await buildApp({
  database,
  logger: loggerOptions,
  bodyLimit: env.bodyLimit,
  ingestPerMinute: env.ingestPerMinute,
  admin: env.admin,
});
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
