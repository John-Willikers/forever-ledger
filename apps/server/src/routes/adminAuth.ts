// Battle.net login for the admin panel, session guards, and CSRF. Never log codes, states, tokens or cookies.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hashToken, verifyBearerToken } from '../auth.js';
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
import { isAdminApiPath } from './adminStatic.js';

/**
 * Cookie names. Over https they carry the `__Host-` prefix (the browser then insists on Secure, Path=/ and no Domain,
 * so a sibling subdomain can't plant or shadow them); COOKIE_INSECURE (local http dev) uses the plain names.
 */
export const cookieNames = (secure: boolean) =>
  secure
    ? { session: '__Host-fl_session', state: '__Host-fl_oauth_state' }
    : { session: 'fl_session', state: 'fl_oauth_state' };

/** A login must come back from Battle.net within this; the state carries its issued-at and is refused after. */
export const STATE_TTL_SECS = 600;
const PANEL = '/admin/';

/**
 * The only values of `?error=` on the panel redirect; the SPA maps each to a fixed message. `unauthorized` is
 * reserved for refusing an account at login.
 */
export type LoginErrorCode = 'state' | 'cancelled' | 'failed' | 'unauthorized';

export interface AdminAuthOptions {
  /** Battle.net client; without it /admin/auth/login answers 503. */
  bnet?: BnetConfig;
  /** Exact BattleTags that become admin on login while no admin exists yet (first-login bootstrap). */
  adminBattletags?: readonly string[];
  /** Battle.net account ids that are always admin. */
  adminBnetSubs?: readonly string[];
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
  /** /v1 reads: a valid bearer token with read scope (`can_read`), or the session of an admin. */
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

const failed = (reply: FastifyReply, code: LoginErrorCode) =>
  reply.redirect(`${PANEL}?error=${code}`);

const nowSecs = () => Math.floor(Date.now() / 1000);

/** The nonce of a signed-cookie state value `<nonce>.<issued-at>`, or null when malformed or too old. */
function freshState(value: string): string | null {
  const m = /^([A-Za-z0-9_-]{32,})\.(\d{1,12})$/.exec(value);
  if (!m) return null;
  const age = nowSecs() - Number(m[2]);
  return age >= 0 && age <= STATE_TTL_SECS ? m[1]! : null;
}

export function registerAdminAuth(
  app: FastifyInstance,
  db: Db,
  opts: AdminAuthOptions,
): AdminGuards {
  const secure = !opts.cookieInsecure;
  const names = cookieNames(secure);
  const policy = { adminBattletags: opts.adminBattletags, adminBnetSubs: opts.adminBnetSubs };
  const fetchImpl = opts.fetch ?? fetch;
  const sessionCookie = (maxAgeSecs = SESSION_TTL_MS / 1000): CookieSerializeOptions => ({
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    signed: true,
    maxAge: maxAgeSecs,
  });
  const cache = new WeakMap<FastifyRequest, Promise<ActiveSession | null>>();

  async function resolveSession(req: FastifyRequest, reply: FastifyReply) {
    const raw = req.cookies[names.session];
    if (!raw) return null;
    const unsigned = req.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return null;
    const s = await loadSession(db, unsigned.value);
    if (s?.renewed) {
      const left = Math.round((s.expiresAt.getTime() - Date.now()) / 1000);
      reply.setCookie(names.session, unsigned.value, sessionCookie(Math.max(left, 0)));
    }
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
    // A bearer header decides on its own (scripts); browsers use the session. Upload tokens (the tray app) can't read.
    if (req.headers.authorization !== undefined) {
      const token = await verifyBearerToken(db, req.headers.authorization);
      if (token === null) return reply.status(401).send({ error: 'invalid or revoked token' });
      if (!token.canRead) return reply.status(403).send({ error: 'token cannot read' });
      return;
    }
    // A browser read: never kept in a shared or disk cache.
    reply.header('cache-control', 'no-store');
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

  // Every /admin/api and /admin/auth response (JSON, redirects, errors, 404s, 429s): private, never sniffed.
  app.addHook('onSend', async (req, reply) => {
    if (isAdminApiPath(req.url)) {
      reply.header('cache-control', 'no-store');
      reply.header('x-content-type-options', 'nosniff');
    }
  });

  const rateLimit = {
    max: opts.authPerMinute ?? 60,
    timeWindow: '1 minute',
    keyGenerator: (req: FastifyRequest) => req.ip,
  };

  app.get('/admin/auth/login', { config: { rateLimit } }, async (_req, reply) => {
    if (!opts.bnet) return reply.status(503).send({ error: 'Battle.net login not configured' });
    const state = randomBytes(32).toString('base64url');
    // Signed, with its issued-at: the browser drops it after Max-Age, the server refuses it after STATE_TTL_SECS.
    reply.setCookie(names.state, `${state}.${nowSecs()}`, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      signed: true,
      maxAge: STATE_TTL_SECS,
    });
    return reply.redirect(authorizeUrl(opts.bnet, state));
  });

  app.get('/admin/auth/callback', { config: { rateLimit } }, async (req, reply) => {
    // The state is single-use: cleared on every callback response, whatever the outcome.
    const rawState = req.cookies[names.state];
    reply.clearCookie(names.state, { path: '/', httpOnly: true, secure, sameSite: 'lax' });
    if (!opts.bnet) return reply.status(503).send({ error: 'Battle.net login not configured' });
    const q = req.query as Record<string, unknown>;

    const unsigned = rawState ? req.unsignCookie(rawState) : null;
    const expected = unsigned?.valid && unsigned.value ? freshState(unsigned.value) : null;
    if (!expected || typeof q.state !== 'string' || !safeEqual(q.state, expected)) {
      req.log.warn('battle.net callback with a missing, expired or mismatched state');
      return failed(reply, 'state');
    }
    if (typeof q.error === 'string') {
      req.log.info({ bnetError: q.error.slice(0, 64) }, 'battle.net login not completed');
      return failed(reply, q.error === 'access_denied' ? 'cancelled' : 'failed');
    }
    if (typeof q.code !== 'string' || q.code === '' || q.code.length > 2048) {
      return failed(reply, 'failed');
    }

    let bnetUser;
    try {
      bnetUser = await fetchBnetUser(opts.bnet, q.code, fetchImpl);
    } catch (err) {
      const reason = err instanceof BnetError ? err.message : 'unexpected error';
      req.log.warn({ reason }, 'battle.net login failed');
      return failed(reply, 'failed');
    }

    const user = await upsertUser(db, bnetUser, policy);
    // No session fixation: a session the browser already carried ends here.
    const previous = req.cookies[names.session];
    const prev = previous ? req.unsignCookie(previous) : null;
    if (prev?.valid && prev.value) await deleteSession(db, hashToken(prev.value));
    const value = await createSession(db, user.id, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    req.log.info({ userId: user.id, role: user.role }, 'admin login');
    reply.setCookie(names.session, value, sessionCookie());
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
    reply.clearCookie(names.session, { path: '/', httpOnly: true, secure, sameSite: 'lax' });
    return reply.status(204).send();
  });

  app.get('/admin/auth/me', { config: { rateLimit } }, async (req, reply) => {
    const s = await session(req, reply);
    return {
      user: s ? s.user : null,
      csrf: s ? csrfToken(opts.cookieSecret, s.id) : null,
      loginConfigured: opts.bnet !== undefined,
    };
  });

  return { requireReader, requireAdmin, session };
}
