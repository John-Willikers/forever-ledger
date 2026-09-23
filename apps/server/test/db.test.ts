import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer } from './helpers.js';

type Server = Awaited<ReturnType<typeof startServer>>;

describe('database pool', () => {
  let s: Server;
  beforeAll(async () => {
    s = await startServer();
  });
  afterAll(async () => {
    await s?.stop();
  });

  it('survives Postgres dropping idle connections (restart, admin shutdown)', async () => {
    // Warm up a few idle clients, then terminate them from a separate session, like a Postgres restart would.
    await Promise.all([1, 2, 3].map(() => s.database.pool.query('select 1')));
    const { rows } = await s.database.pool.query('select pg_backend_pid() as pid');
    const own = rows[0].pid as number;
    await s.database.pool.query(
      'select pg_terminate_backend(pid) from pg_stat_activity where datname = current_database() and pid <> $1',
      [own],
    );
    await new Promise((r) => setTimeout(r, 200));
    // Without a pool 'error' listener the dropped idle clients throw an uncaught error and kill the process.
    const res = await s.app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
  });
});
