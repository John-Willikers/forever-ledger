import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';

/**
 * Attributes with one true value per entity and build: two sources that differ on one of these disagree. Lists such
 * as `dropped_by` hold many values per entity, so a different value there is just another row, not a dispute.
 */
export const SINGLE_VALUED = [
  'name',
  'level_range',
  'zone',
  'req_level',
  'req_skill',
  'level_cap',
  'skill_cap',
  'faction',
] as const;

export interface Dispute {
  entityType: string;
  entityKey: string;
  attribute: string;
  /** The claim a more trusted source contradicts, or one labeled FALSE. */
  claimId: number;
  value: unknown;
  label: string;
  tier: number;
  url: string | null;
  /** The more trusted claim, null when the dispute is the FALSE label itself. */
  byClaimId: number | null;
  byValue: unknown;
  byLabel: string | null;
  byTier: number | null;
  byUrl: string | null;
}

/**
 * Claims that are labeled FALSE, or that a lower-tier (more trusted) source contradicts on a single-valued attribute
 * for the same build (a claim without a build matches any build).
 */
export async function findDisputes(
  db: Db,
  filter: { entityType?: string; entityKey?: string; limit?: number } = {},
): Promise<Dispute[]> {
  const where = sql.join(
    [
      sql`true`,
      ...(filter.entityType ? [sql`c.entity_type = ${filter.entityType}`] : []),
      ...(filter.entityKey ? [sql`c.entity_key = ${filter.entityKey.toLowerCase()}`] : []),
    ],
    sql` and `,
  );
  const singles = sql.join(
    SINGLE_VALUED.map((a) => sql`${a}`),
    sql`, `,
  );
  const res = await db.execute<Record<string, unknown>>(sql`
    select c.entity_type, c.entity_key, c.attribute, c.id as claim_id, c.value, c.label, s.tier, s.url,
           b.id as by_claim_id, b.value as by_value, b.label as by_label, bs.tier as by_tier, bs.url as by_url
      from claims c
      join sources s on s.id = c.source_id
      join claims b on b.entity_type = c.entity_type and b.entity_key = c.entity_key
                   and b.attribute = c.attribute and b.value_hash <> c.value_hash
                   and b.label <> 'FALSE'
                   and (b.observed_build is null or c.observed_build is null
                        or b.observed_build = c.observed_build)
      join sources bs on bs.id = b.source_id and bs.tier < s.tier
     where ${where} and c.attribute in (${singles})
    union all
    select c.entity_type, c.entity_key, c.attribute, c.id, c.value, c.label, s.tier, s.url,
           null, null, null, null, null
      from claims c join sources s on s.id = c.source_id
     where ${where} and c.label = 'FALSE'
     order by 1, 2, 3, 4
     limit ${filter.limit ?? 500}`);
  return res.rows.map((r) => ({
    entityType: r.entity_type as string,
    entityKey: r.entity_key as string,
    attribute: r.attribute as string,
    claimId: r.claim_id as number,
    value: r.value,
    label: r.label as string,
    tier: r.tier as number,
    url: (r.url as string | null) ?? null,
    byClaimId: (r.by_claim_id as number | null) ?? null,
    byValue: r.by_value ?? null,
    byLabel: (r.by_label as string | null) ?? null,
    byTier: (r.by_tier as number | null) ?? null,
    byUrl: (r.by_url as string | null) ?? null,
  }));
}
