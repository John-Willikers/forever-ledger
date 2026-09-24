// Admin panel users and sessions. The session cookie holds a random value; the database stores only its sha256
// (like API tokens), so a database leak can't be replayed as a login.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq, lt, sql } from 'drizzle-orm';
import { hashToken } from './auth.js';
import type { Db } from './db/client.js';
import { sessions, users } from './db/schema.js';

export const SESSION_TTL_MS = 7 * 86_400_000;
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
}

/**
 * Creates the user on first login, refreshes the BattleTag on later ones (the `sub` is the identity), and makes the
 * user admin when their BattleTag is listed. Never demotes.
 */
export async function upsertUser(
  db: Db,
  bnet: { sub: string; battletag: string },
  adminBattletags: readonly string[],
): Promise<SessionUser> {
  const bootstrap = adminBattletags.includes(bnet.battletag);
  const [row] = await db
    .insert(users)
    .values({
      bnetSub: bnet.sub,
      battletag: bnet.battletag,
      role: bootstrap ? 'admin' : 'member',
      lastLoginAt: new Date(),
    })
    .onConflictDoUpdate({
      target: users.bnetSub,
      set: {
        battletag: bnet.battletag,
        lastLoginAt: new Date(),
        role: bootstrap ? 'admin' : sql`${users.role}`,
      },
    })
    .returning({ id: users.id, battletag: users.battletag, role: users.role });
  return row!;
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

/** The live session for a cookie value, with sliding renewal; null when unknown or expired. */
export async function loadSession(db: Db, value: string): Promise<ActiveSession | null> {
  const id = hashToken(value);
  const [row] = await db
    .select({
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
  if (!row || row.expiresAt.getTime() <= now) return null;

  const renewed = row.expiresAt.getTime() - now < SESSION_TTL_MS - SESSION_RENEW_AFTER_MS;
  if (renewed) {
    await db
      .update(sessions)
      .set({ expiresAt: new Date(now + SESSION_TTL_MS), lastSeenAt: new Date(now) })
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
  };
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
