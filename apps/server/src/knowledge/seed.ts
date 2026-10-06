import { classifySource, SeedFile } from '@forever-ledger/contracts';
import type { SourceTier } from '@forever-ledger/contracts';
import type { Db } from '../db/client.js';
import { fieldObservations, sources } from '../db/schema.js';
import { enqueueUrl, insertClaims } from './store.js';

/** Imports a `knowledge/seed/*.json` file (contracts `SeedFile`). Idempotent: every row has a natural key. */
export async function importSeed(db: Db, input: unknown) {
  const seed = SeedFile.parse(input);
  return db.transaction(async (tx) => {
    const byKey = new Map<
      string,
      { id: number; tier: SourceTier; gameVersion: 'forever' | 'classic' | 'unknown' }
    >();
    for (const s of seed.sources) {
      const cls = s.url ? classifySource(s.url) : null;
      const site = s.site ?? cls?.site;
      if (!site) throw new Error(`${s.key}: needs a url or a site`);
      const row = {
        key: s.key,
        kind: 'seed' as const,
        url: s.url ?? null,
        site,
        tier: s.tier ?? cls?.tier ?? 6,
        gameVersion: s.gameVersion ?? cls?.gameVersion ?? 'unknown',
        title: s.title ?? null,
        note: s.note ?? null,
      };
      const [r] = await tx
        .insert(sources)
        .values(row)
        .onConflictDoUpdate({ target: sources.key, set: row })
        .returning({ id: sources.id, tier: sources.tier, gameVersion: sources.gameVersion });
      byKey.set(s.key, { ...r!, tier: r!.tier as SourceTier });
    }

    let claimsAdded = 0;
    for (const c of seed.claims) {
      const src = byKey.get(c.source);
      if (!src)
        throw new Error(`claim on ${c.entityName ?? c.entityId}: unknown source ${c.source}`);
      claimsAdded += await insertClaims(tx, { ...src, build: null }, [c], 'seed');
    }

    for (const o of seed.observations) {
      const { claims: oc, ...obs } = o;
      const row = { ...obs, observedAt: new Date(obs.observedAt) };
      await tx
        .insert(fieldObservations)
        .values(row)
        .onConflictDoUpdate({ target: fieldObservations.key, set: row });
      const srcRow = {
        key: `observation:${o.key}`,
        kind: 'first_party' as const,
        site: 'forever-ledger',
        tier: 1,
        gameVersion: o.gameVersion,
        build: o.build ?? null,
        title: `Field observation ${o.key}`,
        note: o.notes ?? null,
        fetchedAt: new Date(o.observedAt),
      };
      const [src] = await tx
        .insert(sources)
        .values(srcRow)
        .onConflictDoUpdate({ target: sources.key, set: srcRow })
        .returning({ id: sources.id });
      claimsAdded += await insertClaims(
        tx,
        { id: src!.id, tier: 1, gameVersion: o.gameVersion, build: o.build ?? null },
        oc,
        'observation',
      );
    }

    let queued = 0;
    for (const t of seed.targets) {
      if (await enqueueUrl(tx, { url: t.url, priority: t.priority, addedBy: 'seed' })) queued++;
    }
    return {
      sources: seed.sources.length,
      claims: claimsAdded,
      observations: seed.observations.length,
      queued,
    };
  });
}
