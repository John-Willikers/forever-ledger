import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull, or } from 'drizzle-orm';
import type { Db } from './db/client.js';
import { apiTokens, users } from './db/schema.js';

const PREFIX = 'flt_';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Creates a token, optionally owned by a panel user; the plaintext is returned once and only its hash is stored.
 * Upload scope by default (ingest, error reports, addon manifest); `canRead` adds every /v1 read route, `canFetch` the
 * knowledge fetch routes (lease URLs, post page snapshots). Never log the returned `token`.
 */
export async function mintToken(
  db: Db | Tx,
  label: string,
  opts: {
    userId?: number | null;
    canRead?: boolean;
    canFetch?: boolean;
    helper?: { of: number; dailyBudget: number; sites: string[] };
  } = {},
) {
  // A fetch token lives on the fetch worker: it may lease and post pages, and nothing else.
  if (opts.canFetch && opts.canRead) throw new Error('a fetch token cannot also read');
  const token = PREFIX + randomBytes(32).toString('base64url');
  const [row] = await db
    .insert(apiTokens)
    .values({
      label,
      tokenHash: hashToken(token),
      userId: opts.userId ?? null,
      canRead: opts.canRead ?? false,
      canFetch: opts.canFetch ?? Boolean(opts.helper),
      ...(opts.helper
        ? {
            helperStatus: 'pending' as const,
            helperOf: opts.helper.of,
            fetchDailyBudget: opts.helper.dailyBudget,
            fetchSites: opts.helper.sites,
          }
        : {}),
    })
    .returning({ id: apiTokens.id });
  return { id: row!.id, token };
}

/** Revokes a token and, with it, every tray helper that enrolled through it. False when it was already revoked. */
export async function revokeToken(db: Db, id: number) {
  const rows = await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(or(eq(apiTokens.id, id), eq(apiTokens.helperOf, id)), isNull(apiTokens.revokedAt)))
    .returning({ id: apiTokens.id });
  return rows.some((r) => r.id === id);
}

export async function listTokens(db: Db) {
  return db
    .select({
      id: apiTokens.id,
      label: apiTokens.label,
      createdAt: apiTokens.createdAt,
      revokedAt: apiTokens.revokedAt,
      lastUsedAt: apiTokens.lastUsedAt,
      canRead: apiTokens.canRead,
      canFetch: apiTokens.canFetch,
    })
    .from(apiTokens)
    .orderBy(apiTokens.id);
}

/** Sets whether a token may read; false when there is no such token (or it is a fetch token). Revoked tokens stay revoked. */
export async function setTokenCanRead(db: Db, id: number, canRead: boolean) {
  const rows = await db
    .update(apiTokens)
    .set({ canRead })
    .where(and(eq(apiTokens.id, id), eq(apiTokens.canFetch, false)))
    .returning({ id: apiTokens.id });
  return rows.length > 0;
}

export interface VerifiedToken {
  id: number;
  label: string;
  canRead: boolean;
  canFetch: boolean;
  helperStatus: 'pending' | 'approved' | 'paused' | null;
  fetchDailyBudget: number | null;
  fetchHourlyBudget: number | null;
  fetchSites: string[] | null;
}

/** The id and scopes of a valid, unrevoked bearer token (and marks it used), else null. */
export async function verifyBearerToken(
  db: Db,
  header: string | undefined,
): Promise<VerifiedToken | null> {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  if (!m?.[1]?.startsWith(PREFIX)) return null;
  const [row] = await db
    .update(apiTokens)
    .set({ lastUsedAt: new Date() })
    .where(and(eq(apiTokens.tokenHash, hashToken(m[1])), isNull(apiTokens.revokedAt)))
    .returning({
      id: apiTokens.id,
      label: apiTokens.label,
      canRead: apiTokens.canRead,
      canFetch: apiTokens.canFetch,
      helperStatus: apiTokens.helperStatus,
      fetchDailyBudget: apiTokens.fetchDailyBudget,
      fetchHourlyBudget: apiTokens.fetchHourlyBudget,
      fetchSites: apiTokens.fetchSites,
    });
  return row ?? null;
}

/**
 * Returns the token id for a valid, unrevoked upload or reader token (the upload routes). Fetch tokens are refused:
 * they only lease URLs and post pages.
 */
export async function verifyBearer(db: Db, header: string | undefined): Promise<number | null> {
  const token = await verifyBearerToken(db, header);
  return token && !token.canFetch ? token.id : null;
}

/** Whether a token belongs to an admin user (the MCP server's write tools are theirs only). */
export async function tokenOwnerIsAdmin(db: Db, tokenId: number): Promise<boolean> {
  const [row] = await db
    .select({ role: users.role })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(and(eq(apiTokens.id, tokenId), isNull(apiTokens.revokedAt)));
  return row?.role === 'admin';
}
