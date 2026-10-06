import { z } from 'zod';

/**
 * The knowledge pipeline: web pages fetched by a real browser on cruiser (POST /v1/fetch/lease, /v1/fetch/snapshots),
 * the sources they become, and the claims parsed from them. Every claim carries a confidence label, its source's tier
 * and the build it applies to, so answers can say where a fact came from and how far to trust it.
 */

/** How far a claim can be trusted, from its source and game version. */
export const CLAIM_LABELS = ['VERIFIED', 'CLASSIC', 'ANECDOTE', 'UNVERIFIED', 'FALSE'] as const;
export type ClaimLabel = (typeof CLAIM_LABELS)[number];

export const GAME_VERSIONS = ['forever', 'classic', 'unknown'] as const;
export type GameVersion = (typeof GAME_VERSIONS)[number];

/**
 * Source tiers, most trusted first; a lower tier wins a conflict on the same build.
 * 1 first-party addon data and logged observations · 2 Blizzard posts and patch notes · 3 datamined client data ·
 * 4 guide sites tested on the Forever beta · 5 Classic-era data · 6 forum posts and comments · 7 boost/gold sellers.
 */
export const SOURCE_TIERS = [1, 2, 3, 4, 5, 6, 7] as const;
export type SourceTier = (typeof SOURCE_TIERS)[number];

export const ENTITY_TYPES = [
  'item',
  'quest',
  'npc',
  'object',
  'spell',
  'zone',
  'dungeon',
  'race',
  'class',
  'profession',
  'page',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const MAX_URL = 2048;

/** A URL the fetcher may visit: http(s) only, no credentials, no fragment. */
export const FetchUrl = z
  .string()
  .max(MAX_URL)
  .refine((s) => {
    try {
      const u = new URL(s);
      return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password;
    } catch {
      return false;
    }
  }, 'expected an http(s) URL without credentials');

/** Canonical form of a URL for the queue: lowercase host, no fragment, no trailing slash on a bare path. */
export function normalizeUrl(raw: string): string {
  const u = new URL(raw);
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
  return u.toString();
}

export interface SourceClass {
  /** Registrable site, e.g. `wowhead.com`. */
  site: string;
  tier: SourceTier;
  gameVersion: GameVersion;
}

/** Sites we know, by host suffix. Unknown sites default to tier 6 / unknown version until classified by hand. */
const SITES: { host: string; tier: SourceTier; gameVersion?: GameVersion }[] = [
  { host: 'news.blizzard.com', tier: 2 },
  { host: 'us.forums.blizzard.com', tier: 6 },
  { host: 'eu.forums.blizzard.com', tier: 6 },
  { host: 'mobalytics.gg', tier: 4 },
  { host: 'wow-professions.com', tier: 4 },
  { host: 'wow4evernews.com', tier: 4 },
  { host: 'zockify.com', tier: 4 },
  { host: 'icy-veins.com', tier: 4 },
  { host: 'method.gg', tier: 4 },
  { host: 'games.gg', tier: 4 },
  { host: 'warcraft.wiki.gg', tier: 5, gameVersion: 'classic' },
  { host: 'blizzardwatch.com', tier: 5, gameVersion: 'classic' },
  { host: 'expcarry.com', tier: 7 },
  { host: 'u4gm.com', tier: 7 },
  { host: 'wowhead.com', tier: 3 },
];

/** Site, tier and game version of a URL from its host and path. */
export function classifySource(url: string): SourceClass {
  const u = new URL(url);
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const path = u.pathname.toLowerCase();
  const known = SITES.find((s) => host === s.host || host.endsWith(`.${s.host}`));
  const site = known?.host ?? host;
  const saysForever = /(^|[/\-_])(forever|wow-forever)([/\-_]|$)/.test(path);
  const saysClassic = /(^|\/)(classic|cata|mop-classic|tbc)(\/|$)/.test(path);

  if (site === 'wowhead.com') {
    // Wowhead's Forever database is datamined client data (tier 3); its Classic pages are Classic-era data (tier 5).
    if (saysForever) return { site, tier: 3, gameVersion: 'forever' };
    if (saysClassic) return { site, tier: 5, gameVersion: 'classic' };
    return { site, tier: 5, gameVersion: 'unknown' };
  }
  const tier = known?.tier ?? 6;
  const gameVersion =
    known?.gameVersion ?? (saysForever ? 'forever' : saysClassic ? 'classic' : 'unknown');
  return { site, tier, gameVersion };
}

/** The label a claim gets from where it came from, unless someone sets one by hand. */
export function defaultLabel(tier: SourceTier, gameVersion: GameVersion): ClaimLabel {
  if (tier >= 7) return 'UNVERIFIED';
  if (tier === 6) return 'ANECDOTE';
  if (gameVersion === 'classic' || tier === 5) return 'CLASSIC';
  if (gameVersion === 'forever') return 'VERIFIED';
  return 'UNVERIFIED';
}

/** POST /v1/fetch/lease: the worker asks for up to `max` URLs. */
export const FetchLeaseRequest = z.object({
  worker: z.string().min(1).max(128),
  max: z.number().int().min(1).max(10).default(3),
});
export type FetchLeaseRequest = z.infer<typeof FetchLeaseRequest>;

export const FetchLease = z.object({
  url: z.string(),
  site: z.string(),
  entityType: z.enum(ENTITY_TYPES).nullable(),
  entityId: z.number().int().nullable(),
  /** ISO time the lease runs out; after it the URL can go to another worker. */
  leaseUntil: z.string(),
});
export type FetchLease = z.infer<typeof FetchLease>;

export const FetchLeaseResponse = z.object({ leases: z.array(FetchLease) });

export const FETCH_OUTCOMES = ['ok', 'challenge', 'http_error', 'error'] as const;
export type FetchOutcome = (typeof FETCH_OUTCOMES)[number];

/** Gzipped HTML, base64. ~4 MB of base64 keeps the request under the 5 MB body limit. */
export const MAX_HTML_GZ_BASE64 = 4 * 1024 * 1024;
/** Largest page we keep, uncompressed. */
export const MAX_HTML_BYTES = 16 * 1024 * 1024;

/**
 * POST /v1/fetch/snapshots: what one fetch produced. `ok` carries the page; `challenge` means a Cloudflare-style
 * interstitial never cleared (the URL waits for a human), `http_error` a 4xx/5xx document, `error` anything else.
 */
export const FetchReport = z
  .object({
    url: FetchUrl,
    worker: z.string().min(1).max(128),
    outcome: z.enum(FETCH_OUTCOMES),
    finalUrl: FetchUrl.optional(),
    httpStatus: z.number().int().min(100).max(599).optional(),
    /** ISO-8601 with an offset, e.g. `2026-10-06T07:12:03-05:00`. */
    fetchedAt: z.iso.datetime({ offset: true }),
    /** sha256 hex of the uncompressed HTML. */
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    htmlGzBase64: z.string().max(MAX_HTML_GZ_BASE64).optional(),
    fetcher: z.string().min(1).max(64),
    error: z.string().max(500).optional(),
  })
  .refine(
    (r) =>
      r.outcome !== 'ok' ||
      (r.htmlGzBase64 !== undefined && r.sha256 !== undefined && r.finalUrl !== undefined),
    { message: 'an ok report needs finalUrl, sha256 and htmlGzBase64' },
  );
export type FetchReport = z.infer<typeof FetchReport>;

export const FetchReportResponse = z.object({
  /** `stored` new snapshot, `unchanged` same content as before, `challenge` stored nothing, `recorded` other outcomes. */
  result: z.enum(['stored', 'unchanged', 'challenge', 'recorded']),
  snapshotId: z.number().int().optional(),
  claims: z.number().int().optional(),
});

/**
 * Hand-entered knowledge (`knowledge/seed/*.json`): sources that have not been fetched yet, the claims a person read
 * off them (with the label they gave), first-party field observations, and URLs to queue. Idempotent: every row has a
 * natural key, so importing the same file twice changes nothing.
 */
export const SeedSource = z.object({
  key: z.string().regex(/^seed:[\w.-]+$/),
  url: FetchUrl.optional(),
  /** Without a URL (an AI answer, a chat), name the site. */
  site: z.string().min(1).max(128).optional(),
  title: z.string().max(500).optional(),
  tier: z
    .number()
    .int()
    .refine((n) => (SOURCE_TIERS as readonly number[]).includes(n))
    .optional(),
  gameVersion: z.enum(GAME_VERSIONS).optional(),
  note: z.string().max(2000).optional(),
});

export const SeedClaim = z
  .object({
    source: z.string(),
    entityType: z.enum(ENTITY_TYPES),
    entityId: z.number().int().nonnegative().optional(),
    entityName: z.string().min(1).max(200).optional(),
    attribute: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    value: z.json(),
    label: z.enum(CLAIM_LABELS),
    quote: z.string().max(2000).optional(),
    observedBuild: z.number().int().positive().optional(),
  })
  .refine((c) => c.entityId !== undefined || c.entityName !== undefined, {
    message: 'a claim needs entityId or entityName',
  });

export const SeedObservation = z.object({
  key: z.string().regex(/^[\w.-]+$/),
  character: z.string().max(128).optional(),
  faction: z.string().max(32).optional(),
  race: z.string().max(64).optional(),
  class: z.string().max(64).optional(),
  level: z.number().int().min(1).max(80).optional(),
  build: z.number().int().positive().optional(),
  gameVersion: z.enum(GAME_VERSIONS).default('forever'),
  observedAt: z.iso.datetime({ offset: true }),
  durationMins: z.number().int().positive().optional(),
  location: z.json().optional(),
  method: z.string().min(1).max(64),
  setup: z.json().optional(),
  result: z.json(),
  notes: z.string().max(4000).optional(),
  /** Claims the observation supports, on its own tier 1 source. */
  claims: z
    .array(
      z.object({
        entityType: z.enum(ENTITY_TYPES),
        entityId: z.number().int().nonnegative().optional(),
        entityName: z.string().min(1).max(200).optional(),
        attribute: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
        value: z.json(),
      }),
    )
    .default([]),
});

export const SeedFile = z.object({
  sources: z.array(SeedSource).default([]),
  claims: z.array(SeedClaim).default([]),
  observations: z.array(SeedObservation).default([]),
  targets: z
    .array(z.object({ url: FetchUrl, priority: z.number().int().min(-100).max(100).default(0) }))
    .default([]),
});
export type SeedFile = z.infer<typeof SeedFile>;
