// The MCP endpoint end to end: a real MCP client against the HTTP server and a real Postgres (testcontainers).
import type { AddressInfo } from 'node:net';
import { mintToken, openDatabase, runMigrations } from '@forever-ledger/server';
import { importSeed } from '@forever-ledger/server';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMcpHttpServer } from '../src/http.js';

describe('forever-ledger MCP endpoint (real Postgres)', () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof openDatabase>;
  let server: ReturnType<typeof createMcpHttpServer>;
  let url = '';
  const tokens = { reader: '', admin: '', upload: '', fetch: '' };

  async function connect(token: string) {
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
    );
    return client;
  }
  const post = (token: string | null, headers: Record<string, string> = {}) =>
    fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:18-alpine').start();
    database = openDatabase(container.getConnectionUri());
    await runMigrations(database.db);
    const { rows } = await database.pool.query(
      `insert into users (bnet_sub, battletag, role) values ('sub-a', 'Admin#1', 'admin') returning id`,
    );
    tokens.reader = (await mintToken(database.db, 'discord bot', { canRead: true })).token;
    tokens.admin = (
      await mintToken(database.db, 'harlan claude', { canRead: true, userId: rows[0].id })
    ).token;
    tokens.upload = (await mintToken(database.db, 'tray')).token;
    tokens.fetch = (await mintToken(database.db, 'cruiser', { canFetch: true })).token;
    await database.pool.query(`insert into items (item_id, name) values (7973, 'Big-mouth Clam')`);
    await importSeed(database.db, {
      sources: [{ key: 'seed:wh', url: 'https://www.wowhead.com/classic/item=7973' }],
      claims: [
        {
          source: 'seed:wh',
          entityType: 'item',
          entityId: 7973,
          attribute: 'fished_in',
          value: { name: 'Tanaris', count: 10 },
          label: 'CLASSIC',
        },
      ],
    });
    server = createMcpHttpServer({
      db: database.db,
      log: pino({ level: 'silent' }),
      allowedHosts: ['127.0.0.1'],
      perMinute: 1000,
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  });
  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await database?.pool.end();
    await container?.stop();
  });

  it('a read token gets the read tools and the answer contract in its instructions', async () => {
    const client = await connect(tokens.reader);
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'check_claim',
      'fishing_yield',
      'lookup_item',
      'lookup_npc',
      'lookup_quest',
      'lookup_zone',
      'search',
      'where_to_get',
    ]);
    expect(client.getInstructions()).toContain('Answer from these only');
    await client.close();
  });

  it('answers from the ledger, with labels and gaps', async () => {
    const client = await connect(tokens.reader);
    const res = await client.callTool({ name: 'where_to_get', arguments: { item: 'big-mouth' } });
    const answer = JSON.parse((res.content as { text: string }[])[0]!.text);
    expect(answer.entity).toMatchObject({ id: 7973, name: 'Big-mouth Clam' });
    expect(answer.facts).toMatchObject([
      { attribute: 'fished_in', label: 'CLASSIC', tier: 5, source: { site: 'wowhead.com' } },
    ]);
    expect(answer.gaps).toContain(
      'no first-party observations in the ledger yet (none of our uploads saw it)',
    );
    const missing = await client.callTool({
      name: 'lookup_item',
      arguments: { item: 'Thunderfury' },
    });
    expect(JSON.parse((missing.content as { text: string }[])[0]!.text).gaps).toEqual([
      'the ledger has no item matching "Thunderfury"',
    ]);
    await client.close();
  });

  it("an admin's token also gets the write tools, and logs first-party observations", async () => {
    const client = await connect(tokens.admin);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['log_observation', 'add_claim']));
    const res = await client.callTool({
      name: 'log_observation',
      arguments: {
        observedAt: '2026-10-07T20:00:00-05:00',
        method: 'fishing',
        location: { zone: 'Tanaris' },
        result: { casts: 60, bigMouthClams: 0 },
        claims: [
          {
            entityType: 'item',
            entityId: 7973,
            attribute: 'fishing_yield',
            value: { zone: 'Tanaris', casts: 60, caught: 0 },
          },
        ],
      },
    });
    expect(res.isError).toBeFalsy();
    const where = await client.callTool({ name: 'where_to_get', arguments: { item: '7973' } });
    const answer = JSON.parse((where.content as { text: string }[])[0]!.text);
    expect(answer.facts[0]).toMatchObject({
      tier: 1,
      label: 'VERIFIED',
      attribute: 'fishing_yield',
    });
    // A claim must quote a fetched page.
    const claim = await client.callTool({
      name: 'add_claim',
      arguments: {
        source: 'seed:wh',
        entityType: 'item',
        entityId: 7973,
        attribute: 'req_skill',
        value: 205,
        quote: 'requires 205',
      },
    });
    expect(claim.isError).toBe(true);
    await client.close();
  });

  it('turns away missing, upload-only and fetch tokens, other hosts and browsers', async () => {
    expect((await post(null)).status).toBe(401);
    expect((await post('flt_nope')).status).toBe(401);
    expect((await post(tokens.upload)).status).toBe(403);
    expect((await post(tokens.fetch)).status).toBe(403);
    expect((await post(tokens.reader, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await post(tokens.reader)).status).toBe(200);
    const other = await fetch(url.replace('/mcp', '/other'));
    expect(other.status).toBe(404);
  });
});
