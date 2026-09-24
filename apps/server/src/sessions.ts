// Admin panel users and sessions. The session cookie holds a random value; the database stores only its sha256
// (like API tokens), so a database leak can't be replayed as a login.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, lt, ne, sql } from 'drizzle-orm';
import { hashToken } from './auth.js';
import type { Db } from './db/client.js';
import { sessions, users } from './db/schema.js';
import { BOOTSTRAP_LOCK } from './locks.js';

export const SESSION_TTL_MS = 7 * 86_400_000;
/** Absolute lifetime from login: sliding renewal never extends a session past this. */
export const SESSION_MAX_AGE_MS = 30 * 86_400_000;
/** Sliding expiry: once a session has used more than this, a request pushes it back to the full TTL. */
export const SESSION_RENEW_AFTER_MS = 86_400_000;
/** last_seen_at is refreshed at most this often, so reads don't write on every request. */
const LAST_SEEN_EVERY_MS = 5 * 60_000;

export type Role = 'admin' | 'member';

export interface SessionUser {
  id: number;
  battletag: string;
  role: Role;
}

export interface ActiveSession {
  /** sha256 of the cookie value (the sessions primary key). */
  id: string;
  user: SessionUser;
  /** The expiry was pushed back: the caller re-sends the cookie. */
  renewed: boolean;
  expiresAt: Date;
}

/** Who becomes admin at login (see upsertUser). */
export interface AdminPolicy {
  /** BattleTags made admin only while no admin exists yet: a first-login bootstrap. */
  adminBattletags?: readonly string[];
  /** Battle.net account ids (`sub`) that are always admin. */
  adminBnetSubs?: readonly string[];
}

/**
 * Creates the user on first login and refreshes the BattleTag on later ones (the `sub` is the identity). Roles:
 * a sub in `adminBnetSubs` is always admin; a BattleTag in `adminBattletags` becomes admin only while no admin exists
 * (checked in the same transaction, under a lock, so two first logins can't both bootstrap). Otherwise the stored
 * role is kept: once an admin exists, roles change only in the database.
 */
export async function upsertUser(
  db: Db,
  bnet: { sub: string; battletag: string },
  policy: AdminPolicy = {},
): Promise<SessionUser> {
  return db.transaction(async (tx) => {
    let admin = policy.adminBnetSubs?.includes(bnet.sub) ?? false;
    if (!admin && policy.adminBattletags?.includes(bnet.battletag)) {
      await tx.execute(sql`select pg_advisory_xact_lock(${BOOTSTRAP_LOCK})`);
      const [existing] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, 'admin'))
        .limit(1);
      admin = existing === undefined;
    }
    const [row] = await tx
      .insert(users)
      .values({
        bnetSub: bnet.sub,
        battletag: bnet.battletag,
        role: admin ? 'admin' : 'member',
        lastLoginAt: new Date(),
      })
      .onConflictDoUpdate({
        target: users.bnetSub,
        set: {
          battletag: bnet.battletag,
          lastLoginAt: new Date(),
          role: admin ? 'admin' : sql`${users.role}`,
        },
      })
      .returning({ id: users.id, battletag: users.battletag, role: users.role });
    return row!;
  });
}

/** Starts a session; returns the cookie value (shown to the browser only). */
export async function createSession(
  db: Db,
  userId: number,
  meta: { userAgent?: string; ip?: string },
) {
  // Opportunistic cleanup; the table stays tiny.
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  const value = randomBytes(32).toString('base64url');
  await db.insert(sessions).values({
    id: hashToken(value),
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    userAgent: meta.userAgent?.slice(0, 512) ?? null,
    ip: meta.ip ?? null,
  });
  return value;
}

/**
 * The live session for a cookie value, with sliding renewal capped at SESSION_MAX_AGE_MS from login; null when
 * unknown, expired, or older than that.
 */
export async function loadSession(db: Db, value: string): Promise<ActiveSession | null> {
  const id = hashToken(value);
  const [row] = await db
    .select({
      createdAt: sessions.createdAt,
      expiresAt: sessions.expiresAt,
      lastSeenAt: sessions.lastSeenAt,
      userId: users.id,
      battletag: users.battletag,
      role: users.role,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id));
  const now = Date.now();
  if (!row) return null;
  const hardEnd = row.createdAt.getTime() + SESSION_MAX_AGE_MS;
  if (row.expiresAt.getTime() <= now || hardEnd <= now) return null;

  let expiresAt = row.expiresAt;
  const next = Math.min(now + SESSION_TTL_MS, hardEnd);
  const renewed =
    row.expiresAt.getTime() - now < SESSION_TTL_MS - SESSION_RENEW_AFTER_MS &&
    next > row.expiresAt.getTime();
  if (renewed) {
    expiresAt = new Date(next);
    await db
      .update(sessions)
      .set({ expiresAt, lastSeenAt: new Date(now) })
      .where(eq(sessions.id, id));
  } else if (now - row.lastSeenAt.getTime() > LAST_SEEN_EVERY_MS) {
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date(now) })
      .where(eq(sessions.id, id));
  }
  return {
    id,
    user: { id: row.userId, battletag: row.battletag, role: row.role },
    renewed,
    expiresAt,
  };
}

/**
 * Sets a user's role. Demoting the last admin is refused (the panel would lock everyone out); the check runs under
 * the bootstrap lock so two concurrent demotions can't both pass it.
 */
export async function setUserRole(
  db: Db,
  userId: number,
  role: Role,
): Promise<'ok' | 'not-found' | 'last-admin'> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${BOOTSTRAP_LOCK})`);
    const [user] = await tx
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .for('update');
    if (!user) return 'not-found';
    if (user.role === 'admin' && role !== 'admin') {
      const [other] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.role, 'admin'), ne(users.id, userId)))
        .limit(1);
      if (!other) return 'last-admin';
    }
    await tx.update(users).set({ role }).where(eq(users.id, userId));
    return 'ok';
  });
}

export async function deleteSession(db: Db, id: string) {
  await db.delete(sessions).where(eq(sessions.id, id));
}

/** Double-submit CSRF token bound to one session. */
export const csrfToken = (secret: string, sessionId: string) =>
  createHmac('sha256', secret).update(`csrf:${sessionId}`).digest('base64url');

export function checkCsrf(secret: string, sessionId: string, header: unknown) {
  if (typeof header !== 'string') return false;
  const want = Buffer.from(csrfToken(secret, sessionId));
  const got = Buffer.from(header);
  return got.length === want.length && timingSafeEqual(got, want);
}
