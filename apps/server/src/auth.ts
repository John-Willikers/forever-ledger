import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from './db/client.js';
import { apiTokens } from './db/schema.js';

const PREFIX = 'flt_';

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Creates a token, optionally owned by a panel user; the plaintext is returned once and only its hash is stored.
 * Never log the returned `token`.
 */
export async function mintToken(db: Db, label: string, opts: { userId?: number | null } = {}) {
  const token = PREFIX + randomBytes(32).toString('base64url');
  const [row] = await db
    .insert(apiTokens)
    .values({ label, tokenHash: hashToken(token), userId: opts.userId ?? null })
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
    })
    .from(apiTokens)
    .orderBy(apiTokens.id);
}

/** Returns the token id for a valid, unrevoked bearer token. */
export async function verifyBearer(db: Db, header: string | undefined): Promise<number | null> {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  if (!m?.[1]?.startsWith(PREFIX)) return null;
  const [row] = await db
    .update(apiTokens)
    .set({ lastUsedAt: new Date() })
    .where(and(eq(apiTokens.tokenHash, hashToken(m[1])), isNull(apiTokens.revokedAt)))
    .returning({ id: apiTokens.id });
  return row?.id ?? null;
}
