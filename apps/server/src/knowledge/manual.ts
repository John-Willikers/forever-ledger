import { CLAIM_LABELS, defaultLabel } from '@forever-ledger/contracts';
import type { ClaimLabel, EntityType, GameVersion, SourceTier } from '@forever-ledger/contracts';
import { normalizeUrl } from '@forever-ledger/contracts';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { claims, sources, webSnapshots } from '../db/schema.js';
import { chicagoIso } from '../time.js';
import { containsQuote, pageText, parseHtml } from './html.js';
import { inflate, insertClaims } from './store.js';

export class ManualClaimError extends Error {}

export interface ManualClaim {
  /** Source id, its key (`snapshot:12`, `seed:…`), or a fetched page's URL (its newest snapshot source). */
  source: number | string;
  entityType: EntityType;
  entityId?: number;
  entityName?: string;
  attribute: string;
  value: unknown;
  /** The passage the claim rests on. Must appear in the source's stored page when it has one. */
  quote: string;
  label?: ClaimLabel;
  observedBuild?: number;
  note?: string;
}

/**
 * Adds a claim a person (or a Claude session) read off a fetched page. The quote is required and is checked against
 * the stored text, so a claim cannot cite a page that does not say it. Returns the claim count added
 * (0 when the same claim already exists).
 */
export async function addManualClaim(db: Db, c: ManualClaim) {
  if (!c.quote.trim()) throw new ManualClaimError('a claim needs a quote');
  if (c.label && !CLAIM_LABELS.includes(c.label))
    throw new ManualClaimError(`bad label ${c.label}`);
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(c.attribute)) {
    throw new ManualClaimError('attribute must be snake_case');
  }
  if (c.entityId === undefined && !c.entityName?.trim()) {
    throw new ManualClaimError('a claim needs an entity id or name');
  }
  const byUrl = typeof c.source === 'string' && /^https?:\/\//i.test(c.source);
  let url = '';
  if (byUrl) {
    try {
      url = normalizeUrl(c.source as string);
    } catch {
      throw new ManualClaimError(`not a URL: ${String(c.source).slice(0, 200)}`);
    }
  }
  const [src] = await db
    .select()
    .from(sources)
    .where(
      typeof c.source === 'number'
        ? eq(sources.id, c.source)
        : byUrl
          ? and(eq(sources.url, url), isNotNull(sources.snapshotId))
          : eq(sources.key, c.source),
    )
    .orderBy(desc(sources.id))
    .limit(1);
  if (!src) throw new ManualClaimError(`no source ${c.source}`);
  // A quote is only worth something when it can be checked: claim off a fetched page (`snapshot:<id>`).
  if (src.snapshotId === null) {
    throw new ManualClaimError(
      `source ${src.key} has no stored page; queue its URL and claim off the snapshot source`,
    );
  }
  const [snap] = await db
    .select({ htmlGz: webSnapshots.htmlGz })
    .from(webSnapshots)
    .where(eq(webSnapshots.id, src.snapshotId));
  const text = pageText(parseHtml(inflate(snap!.htmlGz)));
  if (!containsQuote(text, c.quote)) {
    throw new ManualClaimError(`the quote is not on the stored page (snapshot ${src.snapshotId})`);
  }
  const tier = src.tier as SourceTier;
  const gameVersion = src.gameVersion as GameVersion;
  return insertClaims(
    db,
    { id: src.id, tier, gameVersion, build: src.build },
    [
      {
        entityType: c.entityType,
        entityId: c.entityId ?? null,
        entityName: c.entityName ?? null,
        attribute: c.attribute,
        value: c.value,
        label: c.label ?? defaultLabel(tier, gameVersion),
        observedBuild: c.observedBuild ?? null,
        quote: c.quote,
      },
    ],
    'manual',
  );
}

/**
 * Changes a claim's label (curation: a seed transcription the fetched page contradicts becomes FALSE). The claim's
 * value never changes; the reason is appended to its note with the America/Chicago time.
 */
export async function relabelClaim(db: Db, id: number, label: ClaimLabel, reason: string) {
  if (!CLAIM_LABELS.includes(label)) throw new ManualClaimError(`bad label ${label}`);
  if (!reason.trim()) throw new ManualClaimError('say why the label changes');
  const [old] = await db.select().from(claims).where(eq(claims.id, id));
  if (!old) throw new ManualClaimError(`no claim #${id}`);
  const line = `${chicagoIso()} ${old.label} → ${label}: ${reason.trim()}`;
  await db
    .update(claims)
    .set({ label, note: old.note ? `${old.note}\n${line}` : line })
    .where(eq(claims.id, id));
  return { from: old.label, to: label };
}
