import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;

export interface Database {
  db: Db;
  pool: pg.Pool;
}

/**
 * Opens a pool whose sessions render timestamps in America/Chicago. An idle client that Postgres drops (restart,
 * admin shutdown) emits 'error' on the pool; without a listener that is an uncaught exception that kills the process.
 * The pool discards the client and connects a new one on the next query.
 */
export function openDatabase(
  url: string,
  onIdleError: (err: Error) => void = (err) =>
    process.stderr.write(`postgres idle client error: ${err.message}\n`),
): Database {
  const pool = new pg.Pool({
    connectionString: url,
    max: 10,
    options: '-c timezone=America/Chicago',
  });
  pool.on('error', onIdleError);
  return { pool, db: drizzle(pool, { schema }) };
}

/** Folder with drizzle-kit migrations; resolves the same from src/ (dev) and dist/ (built). */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../drizzle', import.meta.url));

export async function runMigrations(db: Db) {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}
