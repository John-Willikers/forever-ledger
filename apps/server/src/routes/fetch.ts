import { FetchLeaseRequest, FetchReport } from '@forever-ledger/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyBearerToken } from '../auth.js';
import type { Db } from '../db/client.js';
import { FetchReportError, leaseTargets, recordFetchReport } from '../knowledge/store.js';
import type { FetchBudget } from '../knowledge/store.js';

export interface FetchRouteOptions {
  /** Requests per minute per token on each fetch route (default 60). */
  perMinute?: number;
  /** URLs leased per Chicago day and per hour (default 400 / 25). */
  budget?: FetchBudget;
}

const issues = (e: { issues: { path: PropertyKey[]; message: string }[] }) =>
  e.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message }));

/**
 * The knowledge fetch worker's routes (the browser on cruiser). Fetch-scope tokens only (`tokens-cli mint --fetch`):
 * POST /v1/fetch/lease hands out due URLs, POST /v1/fetch/snapshots takes back what each fetch produced.
 */
export function registerFetchRoutes(app: FastifyInstance, db: Db, opts: FetchRouteOptions = {}) {
  const config = {
    rateLimit: {
      max: opts.perMinute ?? 60,
      timeWindow: '1 minute',
      keyGenerator: (req: FastifyRequest) => req.headers.authorization ?? req.ip,
    },
  };

  async function fetcher(req: FastifyRequest, reply: FastifyReply) {
    const token = await verifyBearerToken(db, req.headers.authorization);
    if (token === null) {
      await reply.status(401).send({ error: 'invalid or revoked token' });
      return null;
    }
    if (!token.canFetch) {
      await reply.status(403).send({ error: 'token cannot fetch' });
      return null;
    }
    return token.id;
  }

  app.post('/v1/fetch/lease', { config }, async (req, reply) => {
    const tokenId = await fetcher(req, reply);
    if (tokenId === null) return reply;
    const parsed = FetchLeaseRequest.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: 'invalid lease request', issues: issues(parsed.error) });
    }
    const { leases, budget } = await leaseTargets(
      db,
      tokenId,
      parsed.data.worker,
      parsed.data.max,
      opts.budget,
    );
    if (leases.length > 0)
      req.log.info({ worker: parsed.data.worker, n: leases.length, budget }, 'fetch lease');
    return { leases, budget };
  });

  app.post('/v1/fetch/snapshots', { config }, async (req, reply) => {
    const tokenId = await fetcher(req, reply);
    if (tokenId === null) return reply;
    const parsed = FetchReport.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: 'invalid fetch report', issues: issues(parsed.error) });
    }
    try {
      const result = await recordFetchReport(db, tokenId, parsed.data);
      req.log.info(
        { url: parsed.data.url, outcome: parsed.data.outcome, ...result },
        'fetch report',
      );
      return result;
    } catch (err) {
      if (err instanceof FetchReportError) {
        return reply.status(err.status).send({ error: err.message });
      }
      throw err;
    }
  });
}
