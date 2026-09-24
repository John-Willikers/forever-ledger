import { ADDON_REPO } from '@forever-ledger/contracts';

/** Server settings from the environment (see deploy/.env.example). */
export function readEnv(env = process.env) {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  return {
    databaseUrl,
    host: env.HOST ?? '127.0.0.1',
    port: Number(env.PORT ?? 3410),
    bodyLimit: env.BODY_LIMIT ? Number(env.BODY_LIMIT) : undefined,
    ingestPerMinute: env.INGEST_PER_MINUTE ? Number(env.INGEST_PER_MINUTE) : undefined,
    /** GitHub repo whose `addon-v*` releases `addon-cli publish` reads. */
    githubRepo: env.GITHUB_REPO ?? ADDON_REPO,
    /** Optional; only raises GitHub API rate limits. Never log it. */
    githubToken: env.GITHUB_TOKEN || undefined,
    admin: readAdminEnv(env),
  };
}

export const DEFAULT_BNET_REDIRECT_URI = 'https://ledger.willikers.dev/admin/auth/callback';
const MIN_COOKIE_SECRET = 32;

/**
 * Admin panel settings. Battle.net login is on only when BNET_CLIENT_ID is set; it then needs the client secret and
 * COOKIE_SECRET. None of these values may ever be logged.
 */
function readAdminEnv(env: NodeJS.ProcessEnv) {
  const cookieSecret = env.COOKIE_SECRET || undefined;
  if (cookieSecret !== undefined && cookieSecret.length < MIN_COOKIE_SECRET) {
    throw new Error(`COOKIE_SECRET must be at least ${MIN_COOKIE_SECRET} characters`);
  }
  const clientId = env.BNET_CLIENT_ID || undefined;
  let bnet: { clientId: string; clientSecret: string; redirectUri: string } | undefined;
  if (clientId) {
    const clientSecret = env.BNET_CLIENT_SECRET;
    if (!clientSecret) throw new Error('BNET_CLIENT_SECRET is required when BNET_CLIENT_ID is set');
    if (!cookieSecret) throw new Error('COOKIE_SECRET is required when BNET_CLIENT_ID is set');
    bnet = {
      clientId,
      clientSecret,
      redirectUri: env.BNET_REDIRECT_URI || DEFAULT_BNET_REDIRECT_URI,
    };
  }
  const adminBattletags = (env.ADMIN_BATTLETAGS ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  for (const tag of adminBattletags) {
    // An unquoted `Name#1234` in a .env file loses everything from `#` on (read as a comment).
    if (!/^[^#\s]+#\d+$/.test(tag)) {
      throw new Error(
        `ADMIN_BATTLETAGS entry "${tag}" is not a BattleTag like Name#1234 (quote the value in deploy/.env)`,
      );
    }
  }
  const adminBnetSubs = (env.ADMIN_BNET_SUBS ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  for (const sub of adminBnetSubs) {
    if (!/^\d+$/.test(sub)) {
      throw new Error(
        `ADMIN_BNET_SUBS entry "${sub}" is not a Battle.net account id (digits only)`,
      );
    }
  }
  return {
    bnet,
    /** Exact BattleTags (case-sensitive, with #number) made admin at login while no admin exists yet. */
    adminBattletags,
    /** Battle.net account ids (`sub`) always made admin at login. */
    adminBnetSubs,
    cookieSecret,
    /** Local http development only: drops the Secure flag from cookies. */
    cookieInsecure: env.COOKIE_INSECURE === '1' || env.COOKIE_INSECURE === 'true',
    /** Built admin SPA (default: apps/admin/dist next to this package). */
    distDir: env.ADMIN_DIST_DIR || undefined,
  };
}
