import { createHash } from 'node:crypto';
import {
  ADDON_NAME,
  addonAssetName,
  addonDownloadUrl,
  addonTag,
  compareVersions,
  INT4_MAX,
  isAddonVersion,
  MAX_ADDON_BYTES,
  verifyAddonZip,
} from '@forever-ledger/contracts';
import type { AddonManifest } from '@forever-ledger/contracts';
import { and, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import type { Db } from './db/client.js';
import { addonPins, addonReleases } from './db/schema.js';

type AddonRelease = typeof addonReleases.$inferSelect;

/** Largest value an int4 column (builds in pins, every id) can hold; one definition, in contracts. */
export { INT4_MAX };

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

export interface PublishOptions {
  /** GitHub `owner/name` holding the `addon-v*` releases. */
  repo: string;
  fetchImpl?: typeof fetch;
  /** Optional GitHub token (raises API rate limits). Sent to api.github.com only, never logged. */
  token?: string;
}

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

interface GitHubAsset {
  name?: unknown;
  browser_download_url?: unknown;
  size?: unknown;
}

/**
 * Registers GitHub release `addon-v<version>` as an active addon release. Downloads its zip, checks it the way the
 * uploader will (sha256, entry paths, .toc version) and upserts the row. A version's bytes never change: publishing
 * again only re-activates a release with the same sha256.
 */
export async function publishRelease(
  db: Db,
  version: string,
  { repo, fetchImpl = fetch, token }: PublishOptions,
): Promise<AddonManifest> {
  if (!isAddonVersion(version)) throw new Error(`not an x.y.z version: ${version}`);
  if (!REPO_RE.test(repo) || repo.split('/').some((p) => p === '.' || p === '..')) {
    throw new Error(`GitHub repo must be owner/name: ${repo}`);
  }
  const tag = addonTag(version);
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'forever-ledger-server',
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, {
    headers,
  });
  if (res.status === 404) throw new Error(`no GitHub release ${tag} in ${repo}`);
  if (!res.ok) throw new Error(`GitHub API answered ${res.status} for release ${tag}`);
  const body = (await res.json()) as { assets?: unknown };
  const assets = Array.isArray(body.assets) ? (body.assets as GitHubAsset[]) : [];

  const name = addonAssetName(version);
  const asset = assets.find((a) => a.name === name);
  if (!asset) throw new Error(`GitHub release ${tag} has no asset ${name}`);
  // The uploader only accepts this exact url, so anything else can't be served.
  const url = addonDownloadUrl(version);
  if (asset.browser_download_url !== url) {
    throw new Error(
      `asset ${name} has download url ${String(asset.browser_download_url)}, expected ${url}`,
    );
  }
  if (typeof asset.size !== 'number' || asset.size <= 0 || asset.size > MAX_ADDON_BYTES) {
    throw new Error(`asset ${name} has size ${String(asset.size)}; limit is ${MAX_ADDON_BYTES}`);
  }

  // Public download: no token, so it can't leak through the redirect to GitHub's storage host.
  const dl = await fetchImpl(url, { headers: { 'user-agent': 'forever-ledger-server' } });
  if (!dl.ok) throw new Error(`downloading ${url} failed with ${dl.status}`);
  const bytes = new Uint8Array(await dl.arrayBuffer());
  if (bytes.byteLength !== asset.size) {
    throw new Error(`downloaded ${bytes.byteLength} bytes of ${name}, GitHub says ${asset.size}`);
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  verifyAddonZip(bytes, { version, sha256 });

  const [row] = await db
    .insert(addonReleases)
    .values({ version, url, sha256, size: bytes.byteLength, status: 'active' })
    .onConflictDoUpdate({
      target: addonReleases.version,
      set: { url, size: bytes.byteLength, status: 'active' },
      setWhere: eq(addonReleases.sha256, sha256),
    })
    .returning();
  if (!row) {
    throw new Error(
      `addon ${version} is already published with a different sha256; release a new version instead`,
    );
  }
  return toManifest(row);
}

/** Pins client builds [buildMin, buildMax] (null = open-ended) to `version`. Returns the pin id. */
export async function pinVersion(
  db: Db,
  buildMin: number,
  buildMax: number | null,
  version: string,
): Promise<number> {
  const isBuild = (b: number) => Number.isInteger(b) && b > 0 && b <= INT4_MAX;
  if (!isBuild(buildMin) || (buildMax !== null && (!isBuild(buildMax) || buildMax < buildMin))) {
    throw new Error(`bad build range ${buildMin}-${buildMax ?? ''}`);
  }
  const [release] = await db
    .select({ version: addonReleases.version })
    .from(addonReleases)
    .where(eq(addonReleases.version, version));
  if (!release) throw new Error(`no release ${version}; publish it first`);
  const [row] = await db
    .insert(addonPins)
    .values({ buildMin, buildMax, version })
    .returning({ id: addonPins.id });
  return row!.id;
}

/** Deletes a pin; false when there was none. */
export async function unpin(db: Db, id: number): Promise<boolean> {
  const rows = await db
    .delete(addonPins)
    .where(eq(addonPins.id, id))
    .returning({ id: addonPins.id });
  return rows.length > 0;
}

/** Stops serving `version` (pins to it are skipped); false when it isn't an active release. */
export async function yankVersion(db: Db, version: string): Promise<boolean> {
  const rows = await db
    .update(addonReleases)
    .set({ status: 'yanked' })
    .where(and(eq(addonReleases.version, version), eq(addonReleases.status, 'active')))
    .returning({ version: addonReleases.version });
  return rows.length > 0;
}

/** Every release (newest version first) and every pin (oldest first). */
export async function listAddon(db: Db) {
  const releases = await db.select().from(addonReleases);
  releases.sort((a, b) => compareVersions(b.version, a.version));
  const pins = await db.select().from(addonPins).orderBy(addonPins.id);
  return { releases, pins };
}
