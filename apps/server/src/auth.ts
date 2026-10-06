import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from './db/client.js';
import { apiTokens } from './db/schema.js';

const PREFIX = 'flt_';

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Creates a token, optionally owned by a panel user; the plaintext is returned once and only its hash is stored.
 * Upload scope by default (ingest, error reports, addon manifest); `canRead` adds every /v1 read route, `canFetch` the
 * knowledge fetch routes (lease URLs, post page snapshots). Never log the returned `token`.
 */
export async function mintToken(
  db: Db,
  label: string,
  opts: { userId?: number | null; canRead?: boolean; canFetch?: boolean } = {},
) {
  const token = PREFIX + randomBytes(32).toString('base64url');
  const [row] = await db
    .insert(apiTokens)
    .values({
      label,
      tokenHash: hashToken(token),
      userId: opts.userId ?? null,
      canRead: opts.canRead ?? false,
      canFetch: opts.canFetch ?? false,
    })
    .returning({ id: apiTokens.id });
  return { id: row!.id, token };
}

export async function revokeToken(db: Db, id: number) {
  const rows = await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiTokens.id, id), isNull(apiTokens.revokedAt)))
    .returning({ id: apiTokens.id });
  return rows.length > 0;
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

/** Sets whether a token may read; false when there is no such token. Revoked tokens stay revoked. */
export async function setTokenCanRead(db: Db, id: number, canRead: boolean) {
  const rows = await db
    .update(apiTokens)
    .set({ canRead })
    .where(eq(apiTokens.id, id))
    .returning({ id: apiTokens.id });
  return rows.length > 0;
}

/** The id and scopes of a valid, unrevoked bearer token (and marks it used), else null. */
export async function verifyBearerToken(
  db: Db,
  header: string | undefined,
): Promise<{ id: number; canRead: boolean; canFetch: boolean } | null> {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  if (!m?.[1]?.startsWith(PREFIX)) return null;
  const [row] = await db
    .update(apiTokens)
    .set({ lastUsedAt: new Date() })
    .where(and(eq(apiTokens.tokenHash, hashToken(m[1])), isNull(apiTokens.revokedAt)))
    .returning({ id: apiTokens.id, canRead: apiTokens.canRead, canFetch: apiTokens.canFetch });
  return row ?? null;
}

/** Returns the token id for a valid, unrevoked bearer token (any scope: the upload routes). */
export async function verifyBearer(db: Db, header: string | undefined): Promise<number | null> {
  return (await verifyBearerToken(db, header))?.id ?? null;
}
