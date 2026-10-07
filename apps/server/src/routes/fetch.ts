import { FetchEnrollRequest, FetchLeaseRequest, FetchReport } from '@forever-ledger/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { mintToken, revokeToken, verifyBearerToken } from '../auth.js';
import type { VerifiedToken } from '../auth.js';
import type { Db } from '../db/client.js';
import { FetchReportError, leaseTargets, recordFetchReport } from '../knowledge/store.js';
import type { FetchBudget, LeaseFence } from '../knowledge/store.js';
import { sql } from 'drizzle-orm';

export interface FetchRouteOptions {
  /** Requests per minute per token on each fetch route (default 60). */
  perMinute?: number;
  /** URLs leased per Chicago day and per hour (default 400 / 25), unless the token sets its own. */
  budget?: FetchBudget;
}

/** A friend's tray helper: 200 pages a Chicago day, Wowhead entity pages only (tray helper plan, 2026-10-07). */
export const HELPER_DAILY_BUDGET = 200;
export const HELPER_SITES = ['wowhead.com'];
/** Pages an hour for a daily budget when the token has no hourly one: the day spread over ~16 waking hours. */
export const hourlyFor = (daily: number) => Math.max(1, Math.ceil(daily / 16));

const issues = (e: { issues: { path: PropertyKey[]; message: string }[] }) =>
  e.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message }));

/** The budget a token works under: its own numbers, else a helper's 200 a day, else the server's. */
export function budgetOf(token: VerifiedToken, fallback: FetchBudget): FetchBudget {
  const daily =
    token.fetchDailyBudget ?? (token.helperStatus ? HELPER_DAILY_BUDGET : fallback.daily);
  const hourly =
    token.fetchHourlyBudget ??
    (token.fetchDailyBudget !== null || token.helperStatus ? hourlyFor(daily) : fallback.hourly);
  return { daily, hourly };
}

export const fenceOf = (token: VerifiedToken): LeaseFence => ({
  sites: token.fetchSites,
  entityPagesOnly: token.helperStatus !== null,
});

/**
 * The knowledge fetch routes. Fetch tokens: cruiser's (`tokens-cli mint --fetch`) and friends' tray helpers, which ask
 * for their own with POST /v1/fetch/enroll (upload token) and can't lease until an admin approves them.
 *   POST /v1/fetch/enroll    upload token → a new helper token, pending approval (replaces this tray's old one)
 *   POST /v1/fetch/unenroll  helper token → revoked (the tray turned the helper off)
 *   GET  /v1/fetch/status    fetch token → approval status and budget left
 *   POST /v1/fetch/lease     due URLs, within the token's budget and sites
 *   POST /v1/fetch/snapshots what one fetch produced
 */
export function registerFetchRoutes(app: FastifyInstance, db: Db, opts: FetchRouteOptions = {}) {
  const fallback = opts.budget ?? { daily: 400, hourly: 25 };
  const config = {
    rateLimit: {
      max: opts.perMinute ?? 60,
      timeWindow: '1 minute',
      keyGenerator: (req: FastifyRequest) => req.headers.authorization ?? req.ip,
    },
  };

  /** A fetch token, any helper status (null after answering 401/403). */
  async function anyFetchToken(req: FastifyRequest, reply: FastifyReply) {
    const token = await verifyBearerToken(db, req.headers.authorization);
    if (token === null) {
      await reply.status(401).send({ error: 'invalid or revoked token' });
      return null;
    }
    if (!token.canFetch) {
      await reply.status(403).send({ error: 'token cannot fetch' });
      return null;
    }
    return token;
  }

  /** A fetch token that may fetch now: not a helper waiting for approval or paused. */
  async function fetcher(req: FastifyRequest, reply: FastifyReply) {
    const token = await anyFetchToken(req, reply);
    if (token === null) return null;
    if (token.helperStatus === 'pending') {
      await reply.status(403).send({ error: 'helper waiting for approval', status: 'pending' });
      return null;
    }
    if (token.helperStatus === 'paused') {
      await reply.status(403).send({ error: 'helper paused', status: 'paused' });
      return null;
    }
    return token;
  }

  app.post(
    '/v1/fetch/enroll',
    { config: { rateLimit: { ...config.rateLimit, max: 10 } } },
    async (req, reply) => {
      const upload = await verifyBearerToken(db, req.headers.authorization);
      if (upload === null) return reply.status(401).send({ error: 'invalid or revoked token' });
      if (upload.canFetch) return reply.status(403).send({ error: 'enroll with an upload token' });
      const parsed = FetchEnrollRequest.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: 'invalid enroll request', issues: issues(parsed.error) });
      }
      // One helper per tray: a new enrollment (lost token, reinstall) replaces the old one and waits for approval again.
      const { id, token, replaced } = await db.transaction(async (tx) => {
        const old = await tx.execute(
          sql`update api_tokens set revoked_at = now()
               where helper_of = ${upload.id} and revoked_at is null returning id`,
        );
        const minted = await mintToken(tx, `helper: ${upload.label}`.slice(0, 100), {
          helper: { of: upload.id, dailyBudget: HELPER_DAILY_BUDGET, sites: HELPER_SITES },
        });
        return { ...minted, replaced: old };
      });
      req.log.info(
        { helperTokenId: id, uploadTokenId: upload.id, replaced: replaced.rowCount ?? 0 },
        'helper enrolled (pending approval)',
      );
      return reply.status(201).send({ token, status: 'pending' });
    },
  );

  // A helper hands its own key back when its user turns it off. Only helper tokens: cruiser's isn't revoked this way.
  app.post('/v1/fetch/unenroll', { config }, async (req, reply) => {
    const token = await anyFetchToken(req, reply);
    if (token === null) return reply;
    if (token.helperStatus === null) return reply.status(403).send({ error: 'not a helper token' });
    await revokeToken(db, token.id);
    req.log.info({ helperTokenId: token.id }, 'helper unenrolled');
    return { status: 'revoked' };
  });

  app.get('/v1/fetch/status', { config }, async (req, reply) => {
    const token = await anyFetchToken(req, reply);
    if (token === null) return reply;
    const { budget } = await leaseTargets(db, token.id, 'status', 0, budgetOf(token, fallback));
    return { status: token.helperStatus ?? 'approved', budget };
  });

  app.post('/v1/fetch/lease', { config }, async (req, reply) => {
    const token = await fetcher(req, reply);
    if (token === null) return reply;
    const parsed = FetchLeaseRequest.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: 'invalid lease request', issues: issues(parsed.error) });
    }
    const { leases, budget } = await leaseTargets(
      db,
      token.id,
      parsed.data.worker,
      parsed.data.max,
      budgetOf(token, fallback),
      fenceOf(token),
    );
    if (leases.length > 0)
      req.log.info({ worker: parsed.data.worker, n: leases.length, budget }, 'fetch lease');
    return { leases, budget };
  });

  app.post('/v1/fetch/snapshots', { config }, async (req, reply) => {
    const token = await fetcher(req, reply);
    if (token === null) return reply;
    const parsed = FetchReport.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: 'invalid fetch report', issues: issues(parsed.error) });
    }
    try {
      const result = await recordFetchReport(db, token.id, parsed.data);
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
