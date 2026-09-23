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

/** Opens a pool whose sessions render timestamps in America/Chicago. */
export function openDatabase(url: string): Database {
  const pool = new pg.Pool({
    connectionString: url,
    max: 10,
    options: '-c timezone=America/Chicago',
  });
  return { pool, db: drizzle(pool, { schema }) };
}

/** Folder with drizzle-kit migrations; resolves the same from src/ (dev) and dist/ (built). */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../drizzle', import.meta.url));

export async function runMigrations(db: Db) {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}
