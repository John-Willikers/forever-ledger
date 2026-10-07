// The MCP endpoint over HTTP (stateless): POST /mcp with a Forever Ledger read token. The token is checked here, in
// front of the SDK's handler, which never verifies tokens itself; the tools offered depend on the token's owner.
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { tokenOwnerIsAdmin, verifyBearerToken } from '@forever-ledger/server';
import type { Db } from '@forever-ledger/server';
import { createMcpHandler } from '@modelcontextprotocol/server';
import type { AuthInfo } from '@modelcontextprotocol/server';
import { toWebRequest } from '@modelcontextprotocol/node';
import type { Logger } from 'pino';
import { buildServer } from './tools.js';

export const MCP_PATH = '/mcp';
/** Tool arguments are small; nothing legitimate comes near this. */
export const MAX_BODY_BYTES = 256 * 1024;

export interface McpHttpOptions {
  db: Db;
  log: Logger;
  /** Hosts the endpoint answers to (the public name behind nginx, and localhost). */
  allowedHosts: string[];
  /** Calls per token per minute. */
  perMinute?: number;
  now?: () => Date;
}

type Caller = { tokenId: number; label: string; canWrite: boolean };

function send(
  res: ServerResponse,
  status: number,
  body: object,
  headers: Record<string, string> = {},
) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

/** A fixed one-minute window per token: plenty for a person or a bot, not for a scraper. */
function limiter(perMinute: number) {
  const windows = new Map<number, { start: number; n: number }>();
  return (tokenId: number, now: number) => {
    const w = windows.get(tokenId);
    if (!w || now - w.start >= 60_000) {
      windows.set(tokenId, { start: now, n: 1 });
      return true;
    }
    w.n += 1;
    return w.n <= perMinute;
  };
}

export function createMcpHttpServer(opts: McpHttpOptions) {
  const { db, log } = opts;
  const allowed = new Set(opts.allowedHosts.map((h) => h.toLowerCase()));
  const allow = limiter(opts.perMinute ?? 120);
  const handler = createMcpHandler(
    ({ authInfo }) => {
      const caller = authInfo?.extra as Caller;
      return buildServer({ db, canWrite: caller.canWrite, caller: caller.label, now: opts.now });
    },
    {
      onerror: (err) => log.warn({ err: err.message }, 'mcp error'),
      responseMode: 'json',
    },
  );

  /** The caller of a request, or the HTTP answer that turns it away. */
  async function authenticate(req: IncomingMessage, res: ServerResponse): Promise<Caller | null> {
    const token = await verifyBearerToken(db, req.headers.authorization);
    if (token === null) {
      send(
        res,
        401,
        { error: 'a Forever Ledger read token is required' },
        {
          'www-authenticate': 'Bearer realm="forever-ledger"',
        },
      );
      return null;
    }
    if (!token.canRead || token.canFetch) {
      send(res, 403, { error: 'this token cannot read the ledger' });
      return null;
    }
    if (!allow(token.id, Date.now())) {
      send(res, 429, { error: 'too many calls; try again in a minute' }, { 'retry-after': '60' });
      return null;
    }
    return {
      tokenId: token.id,
      label: token.label,
      canWrite: await tokenOwnerIsAdmin(db, token.id),
    };
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/health') return send(res, 200, { ok: true });
    if (url.pathname !== MCP_PATH) return send(res, 404, { error: 'not found' });
    const host = (req.headers.host ?? '').toLowerCase().replace(/:\d+$/, '');
    if (!allowed.has(host)) return send(res, 403, { error: 'unknown host' });
    // Browsers never call this: a page on another site must not reach it with someone's token.
    if (req.headers.origin) return send(res, 403, { error: 'browser calls are not accepted' });
    const caller = await authenticate(req, res);
    if (!caller) return;
    const started = Date.now();
    let request: Request;
    try {
      request = await toWebRequest(req, undefined, { maxRequestBodySize: MAX_BODY_BYTES });
    } catch (err) {
      const status = (err as { status?: number }).status === 413 ? 413 : 400;
      return send(res, status, { error: status === 413 ? 'request too large' : 'bad request' });
    }
    const authInfo: AuthInfo = {
      token: 'verified',
      clientId: String(caller.tokenId),
      scopes: caller.canWrite ? ['read', 'write'] : ['read'],
      extra: caller,
    };
    const response = await handler.fetch(request, { authInfo });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) {
      Readable.fromWeb(response.body as NodeReadableStream).pipe(res);
    } else {
      res.end();
    }
    log.info(
      { token: caller.tokenId, status: response.status, ms: Date.now() - started },
      'mcp request',
    );
  }

  return createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      log.error({ err: err instanceof Error ? err.message : String(err) }, 'mcp request failed');
      if (!res.headersSent) send(res, 500, { error: 'internal error' });
      else res.end();
    });
  });
}
