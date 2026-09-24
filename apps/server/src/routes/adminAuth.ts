// Battle.net login for the admin panel, session guards, and CSRF. Never log codes, states, tokens or cookies.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyBearer } from '../auth.js';
import { authorizeUrl, BnetError, fetchBnetUser } from '../bnet.js';
import type { BnetConfig } from '../bnet.js';
import type { Db } from '../db/client.js';
import {
  checkCsrf,
  createSession,
  csrfToken,
  deleteSession,
  loadSession,
  SESSION_TTL_MS,
  upsertUser,
} from '../sessions.js';
import type { ActiveSession } from '../sessions.js';

export const SESSION_COOKIE = 'fl_session';
export const STATE_COOKIE = 'fl_oauth_state';
const STATE_PATH = '/admin/auth';
const STATE_TTL_SECS = 600;
const PANEL = '/admin/';

export interface AdminAuthOptions {
  /** Battle.net client; without it /admin/auth/login answers 503. */
  bnet?: BnetConfig;
  /** Exact BattleTags that become admin on login. */
  adminBattletags?: readonly string[];
  /** Signs cookies and CSRF tokens. */
  cookieSecret: string;
  /** Local http development only: no Secure flag. */
  cookieInsecure?: boolean;
  /** Requests per minute per IP on /admin/auth/* (default 60). */
  authPerMinute?: number;
  /** Injected for tests. */
  fetch?: typeof fetch;
}

type PreHandler = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

export interface AdminGuards {
  /** /v1 reads: a valid bearer token, or the session of an admin. */
  requireReader: PreHandler;
  /** /admin/api/*: the session of an admin, plus the CSRF header on writes. */
  requireAdmin: PreHandler;
  /** The request's session (cached per request), null when not logged in. */
  session(req: FastifyRequest, reply: FastifyReply): Promise<ActiveSession | null>;
}

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const failed = (reply: FastifyReply, message: string) =>
  reply.redirect(`${PANEL}?${new URLSearchParams({ error: message }).toString()}`);

export function registerAdminAuth(
  app: FastifyInstance,
  db: Db,
  opts: AdminAuthOptions,
): AdminGuards {
  const secure = !opts.cookieInsecure;
  const adminTags = opts.adminBattletags ?? [];
  const fetchImpl = opts.fetch ?? fetch;
  const sessionCookie: CookieSerializeOptions = {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    signed: true,
    maxAge: SESSION_TTL_MS / 1000,
  };
  const cache = new WeakMap<FastifyRequest, Promise<ActiveSession | null>>();

  async function resolveSession(req: FastifyRequest, reply: FastifyReply) {
    const raw = req.cookies[SESSION_COOKIE];
    if (!raw) return null;
    const unsigned = req.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return null;
    const s = await loadSession(db, unsigned.value);
    if (s?.renewed) reply.setCookie(SESSION_COOKIE, unsigned.value, sessionCookie);
    return s;
  }

  const session = (req: FastifyRequest, reply: FastifyReply) => {
    let p = cache.get(req);
    if (!p) {
      p = resolveSession(req, reply);
      cache.set(req, p);
    }
    return p;
  };

  const requireReader: PreHandler = async (req, reply) => {
    // A bearer header decides on its own (the uploader and scripts); browsers use the session.
    if (req.headers.authorization !== undefined) {
      if ((await verifyBearer(db, req.headers.authorization)) !== null) return;
      return reply.status(401).send({ error: 'invalid or revoked token' });
    }
    const s = await session(req, reply);
    if (!s) return reply.status(401).send({ error: 'invalid or revoked token' });
    if (s.user.role !== 'admin') return reply.status(403).send({ error: 'not authorized' });
  };

  const requireAdmin: PreHandler = async (req, reply) => {
    const s = await session(req, reply);
    if (!s) return reply.status(401).send({ error: 'not logged in' });
    if (s.user.role !== 'admin') return reply.status(403).send({ error: 'not authorized' });
    if (
      req.method !== 'GET' &&
      req.method !== 'HEAD' &&
      !checkCsrf(opts.cookieSecret, s.id, req.headers['x-csrf-token'])
    ) {
      return reply.status(403).send({ error: 'invalid csrf token' });
    }
  };

  const rateLimit = {
    max: opts.authPerMinute ?? 60,
    timeWindow: '1 minute',
    keyGenerator: (req: FastifyRequest) => req.ip,
  };

  app.get('/admin/auth/login', { config: { rateLimit } }, async (_req, reply) => {
    if (!opts.bnet) return reply.status(503).send({ error: 'Battle.net login not configured' });
    const state = randomBytes(32).toString('base64url');
    reply.setCookie(STATE_COOKIE, state, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: STATE_PATH,
      signed: true,
      maxAge: STATE_TTL_SECS,
    });
    return reply.redirect(authorizeUrl(opts.bnet, state));
  });

  app.get('/admin/auth/callback', { config: { rateLimit } }, async (req, reply) => {
    if (!opts.bnet) return reply.status(503).send({ error: 'Battle.net login not configured' });
    const q = req.query as Record<string, unknown>;
    const rawState = req.cookies[STATE_COOKIE];
    reply.clearCookie(STATE_COOKIE, { path: STATE_PATH, httpOnly: true, secure, sameSite: 'lax' });

    const unsigned = rawState ? req.unsignCookie(rawState) : null;
    const expected = unsigned?.valid ? unsigned.value : null;
    if (!expected || typeof q.state !== 'string' || !safeEqual(q.state, expected)) {
      req.log.warn('battle.net callback with a missing or mismatched state');
      return failed(reply, 'Your login expired or was started elsewhere. Please try again.');
    }
    if (typeof q.error === 'string') {
      req.log.info({ bnetError: q.error.slice(0, 64) }, 'battle.net login not completed');
      return failed(
        reply,
        q.error === 'access_denied'
          ? 'Battle.net login was cancelled.'
          : 'Battle.net login failed.',
      );
    }
    if (typeof q.code !== 'string' || q.code === '' || q.code.length > 2048) {
      return failed(reply, 'Battle.net login failed.');
    }

    let bnetUser;
    try {
      bnetUser = await fetchBnetUser(opts.bnet, q.code, fetchImpl);
    } catch (err) {
      const reason = err instanceof BnetError ? err.message : 'unexpected error';
      req.log.warn({ reason }, 'battle.net login failed');
      return failed(reply, 'Battle.net login failed. Please try again.');
    }

    const user = await upsertUser(db, bnetUser, adminTags);
    const value = await createSession(db, user.id, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    req.log.info({ userId: user.id, role: user.role }, 'admin login');
    reply.setCookie(SESSION_COOKIE, value, sessionCookie);
    return reply.redirect(PANEL);
  });

  app.post('/admin/auth/logout', { config: { rateLimit } }, async (req, reply) => {
    const s = await session(req, reply);
    if (s) {
      if (!checkCsrf(opts.cookieSecret, s.id, req.headers['x-csrf-token'])) {
        return reply.status(403).send({ error: 'invalid csrf token' });
      }
      await deleteSession(db, s.id);
      req.log.info({ userId: s.user.id }, 'admin logout');
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, secure, sameSite: 'lax' });
    return reply.status(204).send();
  });

  app.get('/admin/auth/me', { config: { rateLimit } }, async (req, reply) => {
    reply.header('cache-control', 'no-store');
    const s = await session(req, reply);
    return {
      user: s ? s.user : null,
      csrf: s ? csrfToken(opts.cookieSecret, s.id) : null,
      loginConfigured: opts.bnet !== undefined,
    };
  });

  return { requireReader, requireAdmin, session };
}
