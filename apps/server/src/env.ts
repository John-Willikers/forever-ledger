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
  };
}
