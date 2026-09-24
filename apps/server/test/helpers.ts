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
  // An upload token (ingest, error reports, addon manifest) and a reader token (every /v1 read too).
  const { token } = await mintToken(database.db, 'test');
  const { token: readerToken } = await mintToken(database.db, 'test-reader', { canRead: true });
  return {
    app,
    database,
    token,
    auth: { authorization: `Bearer ${token}` },
    readerToken,
    readerAuth: { authorization: `Bearer ${readerToken}` },
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
  // The batch carries the file's own schema major, as the uploader sends it.
  return structuredClone({ schemaVersion: meta.schemaVersion, uploaderId, account, meta, records });
}

/** The hand-written schema 4 fixture (professions-v4.lua) as one SavedVariables session of `account`. */
export function schema4Batch(session: string, account: string) {
  const b = batchFromFixture('professions-v4.lua', account);
  const r = b.records;
  return {
    ...b,
    meta: { ...b.meta, session },
    records: {
      ...r,
      crafts: r.crafts.map((c) => ({ ...c, session })),
      nodes: r.nodes.map((n) => ({ ...n, session })),
      nodeLoot: r.nodeLoot.map((l) => ({ ...l, session })),
    },
  };
}
