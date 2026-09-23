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
  };
}
