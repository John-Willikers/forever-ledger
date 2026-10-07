// Admin panel access management: tokens (list, mint, revoke, owner, read scope) and users (list, role).
// A minted token's plaintext goes into the one response that creates it; it is never logged or stored.
import { sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { mintToken, revokeToken, setTokenCanRead } from '../auth.js';
import type { Db } from '../db/client.js';
import { setUserRole } from '../sessions.js';
import type { Role } from '../sessions.js';
import { chicagoIso } from '../time.js';
import type { ReadGuard } from './analysis.js';
import { iso, rows } from './adminData.js';

export const TOKEN_LABEL_MAX = 100;
const ROLES: readonly Role[] = ['admin', 'member'];

/** A `:id` route parameter as a positive int4, else null. */
export function idParam(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^\d{1,9}$/.test(raw)) return null;
  const n = Number(raw);
  return n > 0 ? n : null;
}

const bodyOf = (req: FastifyRequest) =>
  typeof req.body === 'object' && req.body !== null && !Array.isArray(req.body)
    ? (req.body as Record<string, unknown>)
    : null;

const isPositiveInt = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 2_147_483_647;

async function userById(db: Db, id: number) {
  const [u] = await rows<{ id: number; battletag: string }>(
    db,
    sql`select id, battletag from users where id = ${id}`,
  );
  return u ?? null;
}

const badRequest = (reply: FastifyReply, error: string) => reply.status(400).send({ error });

export function registerAdminAccessRoutes(
  app: FastifyInstance,
  db: Db,
  preHandler: ReadGuard,
  whoAmI: (req: FastifyRequest, reply: FastifyReply) => Promise<{ user: { id: number } } | null>,
) {
  app.get('/admin/api/tokens', { preHandler }, async () => {
    const rs = await rows<{
      id: number;
      label: string;
      created_at: Date;
      revoked_at: Date | null;
      last_used_at: Date | null;
      owner_id: number | null;
      owner_battletag: string | null;
      can_read: boolean;
      can_fetch: boolean;
      helper_status: 'pending' | 'approved' | 'paused' | null;
      helper_of: number | null;
      fetch_daily_budget: number | null;
      fetched_today: number;
      fetched_total: number;
      uploads: number;
      last_upload_at: Date | null;
    }>(
      db,
      sql`
      select t.id, t.label, t.created_at, t.revoked_at, t.last_used_at, t.can_read, t.can_fetch,
             t.helper_status, t.helper_of, t.fetch_daily_budget,
             coalesce((select sum(b.leased) from fetch_budget b where b.token_id = t.id
                        and b.hour >= date_trunc('day', now() at time zone 'America/Chicago')
                                      at time zone 'America/Chicago'), 0)::int as fetched_today,
             (select count(*) from web_snapshots w where w.token_id = t.id)::int as fetched_total,
             usr.id as owner_id, usr.battletag as owner_battletag,
             coalesce(u.n, 0)::int as uploads, u.last_at as last_upload_at
      from api_tokens t
      left join users usr on usr.id = t.user_id
      left join (select token_id, count(*) as n, max(received_at) as last_at
                 from raw_uploads group by token_id) u on u.token_id = t.id
      order by t.id`,
    );
    return {
      items: rs.map((r) => ({
        id: r.id,
        label: r.label,
        createdAt: chicagoIso(r.created_at),
        revokedAt: iso(r.revoked_at),
        lastUsedAt: iso(r.last_used_at),
        owner: r.owner_id === null ? null : { id: r.owner_id, battletag: r.owner_battletag },
        canRead: r.can_read,
        canFetch: r.can_fetch,
        helper:
          r.helper_status === null
            ? null
            : {
                status: r.helper_status,
                of: r.helper_of,
                dailyBudget: r.fetch_daily_budget,
                fetchedToday: r.fetched_today,
                fetchedTotal: r.fetched_total,
              },
        uploads: r.uploads,
        lastUploadAt: iso(r.last_upload_at),
      })),
    };
  });

  /**
   * Mints a token `{ label, ownerUserId?, canRead? }` (upload scope unless `canRead: true`); the response is the only
   * place its plaintext ever appears.
   */
  app.post('/admin/api/tokens', { preHandler }, async (req, reply) => {
    const body = bodyOf(req);
    const label = typeof body?.label === 'string' ? body.label.trim() : '';
    if (label.length === 0 || label.length > TOKEN_LABEL_MAX)
      return badRequest(reply, `label must be 1-${TOKEN_LABEL_MAX} characters`);
    const ownerId = body?.ownerUserId ?? null;
    if (ownerId !== null && !isPositiveInt(ownerId))
      return badRequest(reply, 'ownerUserId must be a user id or null');
    const owner = ownerId === null ? null : await userById(db, ownerId);
    if (ownerId !== null && !owner) return badRequest(reply, 'unknown user');
    const canRead = body?.canRead ?? false;
    if (typeof canRead !== 'boolean') return badRequest(reply, 'canRead must be true or false');

    const { id, token } = await mintToken(db, label, { userId: owner?.id ?? null, canRead });
    const me = await whoAmI(req, reply);
    req.log.info(
      { tokenId: id, ownerUserId: owner?.id ?? null, canRead, by: me?.user.id },
      'token minted',
    );
    return reply.status(201).send({ id, label, owner, canRead, token });
  });

  app.post<{ Params: { id: string } }>(
    '/admin/api/tokens/:id/revoke',
    { preHandler },
    async (req, reply) => {
      const id = idParam(req.params.id);
      if (id === null) return badRequest(reply, 'bad token id');
      const revoked = await revokeToken(db, id);
      const [row] = await rows<{ revoked_at: Date | null }>(
        db,
        sql`select revoked_at from api_tokens where id = ${id}`,
      );
      if (!row) return reply.status(404).send({ error: 'no such token' });
      if (revoked) {
        const me = await whoAmI(req, reply);
        req.log.info({ tokenId: id, by: me?.user.id }, 'token revoked');
      }
      return { id, revokedAt: iso(row.revoked_at), alreadyRevoked: !revoked };
    },
  );

  /** Sets `{ userId }` (or null) as the token's owner: characters uploaded with it belong to that user. */
  app.post<{ Params: { id: string } }>(
    '/admin/api/tokens/:id/owner',
    { preHandler },
    async (req, reply) => {
      const id = idParam(req.params.id);
      if (id === null) return badRequest(reply, 'bad token id');
      const body = bodyOf(req);
      if (!body || !('userId' in body)) return badRequest(reply, 'userId is required (or null)');
      const userId = body.userId;
      if (userId !== null && !isPositiveInt(userId))
        return badRequest(reply, 'userId must be a user id or null');
      const owner = userId === null ? null : await userById(db, userId);
      if (userId !== null && !owner) return badRequest(reply, 'unknown user');
      const updated = await rows<{ id: number }>(
        db,
        sql`update api_tokens set user_id = ${owner?.id ?? null}::int where id = ${id} returning id`,
      );
      if (updated.length === 0) return reply.status(404).send({ error: 'no such token' });
      const me = await whoAmI(req, reply);
      req.log.info({ tokenId: id, ownerUserId: owner?.id ?? null, by: me?.user.id }, 'token owner');
      return { id, owner };
    },
  );

  /** `{ canRead }`: whether the token may also read every /v1 read route (all data, export, diagnostics). */
  app.post<{ Params: { id: string } }>(
    '/admin/api/tokens/:id/read',
    { preHandler },
    async (req, reply) => {
      const id = idParam(req.params.id);
      if (id === null) return badRequest(reply, 'bad token id');
      const canRead = bodyOf(req)?.canRead;
      if (typeof canRead !== 'boolean') return badRequest(reply, 'canRead must be true or false');
      if (!(await setTokenCanRead(db, id, canRead)))
        return reply.status(404).send({ error: 'no such token' });
      const me = await whoAmI(req, reply);
      req.log.info({ tokenId: id, canRead, by: me?.user.id }, 'token read scope');
      return { id, canRead };
    },
  );

  /**
   * A friend's tray helper: `{ status?: 'approved' | 'paused', dailyBudget?: 1-2000 }`. A helper starts `pending` and
   * leases nothing until it is approved here.
   */
  app.post<{ Params: { id: string } }>(
    '/admin/api/tokens/:id/helper',
    { preHandler },
    async (req, reply) => {
      const id = idParam(req.params.id);
      if (id === null) return badRequest(reply, 'bad token id');
      const body = bodyOf(req);
      const status = body?.status;
      const dailyBudget = body?.dailyBudget;
      if (status !== undefined && status !== 'approved' && status !== 'paused')
        return badRequest(reply, 'status must be approved or paused');
      if (
        dailyBudget !== undefined &&
        !(isPositiveInt(dailyBudget) && (dailyBudget as number) <= 2000)
      )
        return badRequest(reply, 'dailyBudget must be a whole number from 1 to 2000');
      if (status === undefined && dailyBudget === undefined)
        return badRequest(reply, 'set status or dailyBudget');
      const updated = await rows<{ helper_status: string; fetch_daily_budget: number | null }>(
        db,
        sql`update api_tokens
               set helper_status = coalesce(${status ?? null}::text, helper_status),
                   fetch_daily_budget = coalesce(${dailyBudget ?? null}::int, fetch_daily_budget),
                   fetch_hourly_budget = null
             where id = ${id} and helper_status is not null and revoked_at is null
             returning helper_status, fetch_daily_budget`,
      );
      if (updated.length === 0) return reply.status(404).send({ error: 'no such helper' });
      const me = await whoAmI(req, reply);
      req.log.info({ tokenId: id, status, dailyBudget, by: me?.user.id }, 'helper updated');
      return { id, status: updated[0]!.helper_status, dailyBudget: updated[0]!.fetch_daily_budget };
    },
  );

  app.get('/admin/api/users', { preHandler }, async () => {
    const rs = await rows<{
      id: number;
      battletag: string;
      role: Role;
      created_at: Date;
      last_login_at: Date | null;
      tokens: number;
    }>(
      db,
      sql`
      select usr.id, usr.battletag, usr.role, usr.created_at, usr.last_login_at, count(t.id)::int as tokens
      from users usr
      left join api_tokens t on t.user_id = usr.id
      group by usr.id
      order by usr.id`,
    );
    return {
      items: rs.map((r) => ({
        id: r.id,
        battletag: r.battletag,
        role: r.role,
        createdAt: chicagoIso(r.created_at),
        lastLoginAt: iso(r.last_login_at),
        tokens: r.tokens,
      })),
    };
  });

  /** `{ role }`; the last admin can't be demoted (409). */
  app.post<{ Params: { id: string } }>(
    '/admin/api/users/:id/role',
    { preHandler },
    async (req, reply) => {
      const id = idParam(req.params.id);
      if (id === null) return badRequest(reply, 'bad user id');
      const role = bodyOf(req)?.role;
      if (typeof role !== 'string' || !ROLES.includes(role as Role))
        return badRequest(reply, `role must be one of ${ROLES.join(', ')}`);
      const result = await setUserRole(db, id, role as Role);
      if (result === 'not-found') return reply.status(404).send({ error: 'no such user' });
      if (result === 'last-admin')
        return reply.status(409).send({ error: 'cannot demote the last admin' });
      const me = await whoAmI(req, reply);
      req.log.info({ userId: id, role, by: me?.user.id }, 'user role');
      return { id, role };
    },
  );
}
