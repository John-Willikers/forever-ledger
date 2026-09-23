import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  contentHash,
  isSupportedSchemaVersion,
  NO_ADDON_RELEASE,
  RECORD_KINDS,
  recordKey,
  UploadBatch,
} from '@forever-ledger/contracts';
import type { Acknowledged } from '@forever-ledger/contracts';
import type { AddonRelease } from './addonRelease.js';

export interface MockReply {
  status: number;
  body?: unknown;
}

export interface MockServerOptions {
  token?: string;
  port?: number;
  bodyLimit?: number;
  /** Return a reply to override the contract behaviour for a request (after auth). */
  override?: (batch: unknown, requestNo: number) => MockReply | undefined;
}

export interface MockServer {
  url: string;
  port: number;
  /** Every accepted batch, in order. */
  batches: UploadBatch[];
  /** Record keys of every accepted record, in order (duplicates included). */
  receivedKeys: string[];
  /** Every POST /v1/ingest, accepted or not. */
  ingestRequests: number;
  /**
   * What GET /v1/addon/manifest recommends (null: nothing published). Its zip is served at the path of the release
   * url, so a client that sends https://github.com/… here downloads it.
   */
  addonRelease: AddonRelease | null;
  close(): Promise<void>;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

/** Implements the /v1/ingest + /v1/health contract the real server follows. */
export async function startMockServer(opts: MockServerOptions = {}): Promise<MockServer> {
  const token = opts.token ?? 'test-token';
  const bodyLimit = opts.bodyLimit ?? 5 * 1024 * 1024;
  let batchId = 0;
  const state = {
    batches: [] as UploadBatch[],
    receivedKeys: [] as string[],
    ingestRequests: 0,
    addonRelease: null as AddonRelease | null,
  };

  const server = createServer((req, res) => {
    void (async () => {
      if (req.method === 'GET' && req.url === '/v1/health') return send(res, 200, { ok: true });
      const release = state.addonRelease;
      if (req.method === 'GET' && req.url?.split('?')[0] === '/v1/addon/manifest') {
        if (req.headers.authorization !== `Bearer ${token}`)
          return send(res, 401, { error: 'unauthorized' });
        return release
          ? send(res, 200, release.manifest)
          : send(res, 404, { error: NO_ADDON_RELEASE });
      }
      if (req.method === 'GET' && release && req.url === new URL(release.manifest.url).pathname) {
        res.writeHead(200, { 'content-type': 'application/zip' });
        return res.end(release.zip);
      }
      if (req.method !== 'POST' || req.url !== '/v1/ingest')
        return send(res, 404, { error: 'not found' });
      state.ingestRequests++;
      const body = await readBody(req);
      if (req.headers.authorization !== `Bearer ${token}`)
        return send(res, 401, { error: 'unauthorized' });
      if (body.length > bodyLimit) return send(res, 413, { error: 'payload too large' });
      let json: unknown;
      try {
        json = JSON.parse(body.toString('utf8'));
      } catch {
        return send(res, 400, { error: 'invalid JSON' });
      }
      const override = opts.override?.(json, state.ingestRequests);
      if (override) return send(res, override.status, override.body ?? {});
      const version = (json as { schemaVersion?: unknown }).schemaVersion;
      if (!isSupportedSchemaVersion(version))
        return send(res, 409, { error: `unsupported schemaVersion ${String(version)}` });
      const parsed = UploadBatch.safeParse(json);
      if (!parsed.success) return send(res, 400, { error: parsed.error.message });

      const acknowledged: Acknowledged[] = [];
      for (const kind of RECORD_KINDS)
        for (const r of parsed.data.records[kind]) {
          const key = recordKey(kind, r as never);
          acknowledged.push({ key, hash: contentHash(r) });
          state.receivedKeys.push(key);
        }
      state.batches.push(parsed.data);
      send(res, 200, { batchId: ++batchId, acknowledged });
    })().catch((err: unknown) => send(res, 500, { error: String(err) }));
  });

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    get batches() {
      return state.batches;
    },
    get receivedKeys() {
      return state.receivedKeys;
    },
    get ingestRequests() {
      return state.ingestRequests;
    },
    get addonRelease() {
      return state.addonRelease;
    },
    set addonRelease(r: AddonRelease | null) {
      state.addonRelease = r;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
