// Schema 9: where quest objectives went up, stored one row per increment (real Postgres).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { batchFromFixture, startServer } from './helpers.js';

describe('objective progress ingest (real Postgres)', () => {
  let s: Awaited<ReturnType<typeof startServer>>;
  const ingest = async (batch: object) => {
    const res = await s.app.inject({
      method: 'POST',
      url: '/v1/ingest',
      headers: s.auth,
      payload: batch,
    });
    expect(res.statusCode, res.body).toBe(200);
  };
  beforeAll(async () => {
    s = await startServer();
    await ingest(batchFromFixture('session-v9.lua'));
  });
  afterAll(() => s?.stop());

  it('stores each increment with where it happened, and a re-upload changes nothing', async () => {
    const q = () =>
      s.database.pool.query(
        `select char, quest_id, idx, have, need, map_id, subzone, x, y from quest_objective_progress order by have`,
      );
    const { rows } = await q();
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      char: 'Thibodeaux Willikers-Bayou',
      quest_id: 364,
      idx: 1,
      have: 2,
      need: 8,
    });
    expect(rows[1].x).toBeTypeOf('number');
    await ingest(batchFromFixture('session-v9.lua'));
    expect((await q()).rows).toHaveLength(2);
  });
});
