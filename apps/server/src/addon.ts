import { ADDON_NAME, compareVersions } from '@forever-ledger/contracts';
import type { AddonManifest } from '@forever-ledger/contracts';
import { and, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import type { Db } from './db/client.js';
import { addonPins, addonReleases } from './db/schema.js';

type AddonRelease = typeof addonReleases.$inferSelect;

const toManifest = (r: AddonRelease): AddonManifest => ({
  addon: ADDON_NAME,
  version: r.version,
  url: r.url,
  sha256: r.sha256,
  size: r.size,
});

/**
 * The addon version a client build should run: the newest pin covering `build` whose release is still active,
 * else the newest active release. Null when nothing is published.
 */
export async function resolveManifest(db: Db, build: number | null): Promise<AddonManifest | null> {
  const releases = await db.select().from(addonReleases).where(eq(addonReleases.status, 'active'));
  const active = new Map(releases.map((r) => [r.version, r]));
  if (build !== null) {
    const pins = await db
      .select()
      .from(addonPins)
      .where(
        and(
          lte(addonPins.buildMin, build),
          or(isNull(addonPins.buildMax), gte(addonPins.buildMax, build)),
        ),
      )
      .orderBy(desc(addonPins.id));
    for (const p of pins) {
      const r = active.get(p.version);
      if (r) return toManifest(r);
    }
  }
  const newest = [...active.values()].sort((a, b) => compareVersions(b.version, a.version))[0];
  return newest ? toManifest(newest) : null;
}
