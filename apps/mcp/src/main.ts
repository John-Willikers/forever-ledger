// forever-ledger-mcp (PM2, 127.0.0.1:3411, nginx /mcp on ledger.willikers.dev). The API server owns migrations; this
// process only reads the ledger (and, for admin-owned tokens, adds observations and claims).
import { loggerOptions, openDatabase } from '@forever-ledger/server';
import { pino } from 'pino';
import { createMcpHttpServer } from './http.js';

process.env.TZ ??= 'America/Chicago';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const host = process.env.MCP_HOST ?? '127.0.0.1';
const port = Number(process.env.MCP_PORT ?? 3411);
const allowedHosts = (process.env.MCP_ALLOWED_HOSTS ?? 'ledger.willikers.dev,localhost,127.0.0.1')
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean);

const log = pino(loggerOptions);
const database = openDatabase(databaseUrl);
const server = createMcpHttpServer({
  db: database.db,
  log,
  allowedHosts,
  perMinute: Number(process.env.MCP_PER_MINUTE ?? 120),
});

const shutdown = (signal: string) => {
  log.info({ signal }, 'shutting down');
  server.close(() => void database.pool.end().then(() => process.exit(0)));
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

server.listen(port, host, () =>
  log.info({ host, port, allowedHosts }, 'forever-ledger-mcp listening'),
);
