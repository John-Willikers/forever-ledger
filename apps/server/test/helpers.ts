import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalize } from '@forever-ledger/contracts';
import type { UploadBatch } from '@forever-ledger/contracts';
import { parseSavedVariables } from '@forever-ledger/lua-sv-parser';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { buildApp, mintToken, openDatabase, runMigrations } from '../src/index.js';
import type { AppOptions } from '../src/index.js';

export async function startServer(opts: Partial<AppOptions> = {}) {
  const container = await new PostgreSqlContainer('postgres:18-alpine').start();
  const database = openDatabase(container.getConnectionUri());
  await runMigrations(database.db);
  const app = await buildApp({ database, ...opts });
  const { token } = await mintToken(database.db, 'test');
  return {
    app,
    database,
    token,
    auth: { authorization: `Bearer ${token}` },
    async count(table: string) {
      const res = await database.pool.query(`select count(*)::int as n from ${table}`);
      return res.rows[0].n as number;
    },
    async stop() {
      await app.close();
      await database.pool.end();
      await container.stop();
    },
  };
}

export function batchFromFixture(
  name: string,
  account = 'ACCOUNT1',
  uploaderId = 'pc-1',
): UploadBatch {
  const file = readFileSync(
    fileURLToPath(new URL(`../../../fixtures/synthetic/${name}`, import.meta.url)),
  );
  const { meta, records } = normalize(parseSavedVariables(file).ForeverLedgerDB);
  return structuredClone({ schemaVersion: 1, uploaderId, account, meta, records });
}
