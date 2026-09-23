import rateLimit from '@fastify/rate-limit';
import {
  isSupportedSchemaVersion,
  SUPPORTED_SCHEMA_VERSIONS,
  UploadBatch,
} from '@forever-ledger/contracts';
import { sql } from 'drizzle-orm';
import Fastify from 'fastify';
import type { FastifyServerOptions } from 'fastify';
import { verifyBearer } from './auth.js';
import type { Database } from './db/client.js';
import { ingestBatch } from './ingest.js';
import { registerAddonRoutes } from './routes/addon.js';
import { registerAnalysisRoutes } from './routes/analysis.js';
import { registerExportRoutes } from './routes/export.js';
import { chicagoIso } from './time.js';

export interface AppOptions {
  database: Database;
  logger?: FastifyServerOptions['logger'];
  /** Max request body in bytes (default 5 MB). */
  bodyLimit?: number;
  /** Ingest requests per minute per token (default 120). */
  ingestPerMinute?: number;
}

export const DEFAULT_BODY_LIMIT = 5 * 1024 * 1024;

/** pino options: America/Chicago timestamps, never log bearer tokens. */
export const loggerOptions = {
  level: process.env.LOG_LEVEL ?? 'info',
  timestamp: () => `,"time":"${chicagoIso()}"`,
  redact: ['req.headers.authorization'],
};

export async function buildApp(opts: AppOptions) {
  const { db } = opts.database;
  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: opts.bodyLimit ?? DEFAULT_BODY_LIMIT,
    trustProxy: '127.0.0.1',
  });

  await app.register(rateLimit, { global: false });

  app.setErrorHandler((err, req, reply) => {
    const e = err as { statusCode?: number; message?: string };
    const status = e.statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    const message =
      status === 413
        ? 'payload too large'
        : status >= 500
          ? 'internal error'
          : (e.message ?? 'error');
    return reply.status(status).send({ error: message });
  });

  app.get('/v1/health', async (_req, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { ok: true, time: chicagoIso() };
    } catch {
      return reply.status(503).send({ ok: false, time: chicagoIso() });
    }
  });

  app.post(
    '/v1/ingest',
    {
      config: {
        rateLimit: {
          max: opts.ingestPerMinute ?? 120,
          timeWindow: '1 minute',
          keyGenerator: (req) => req.headers.authorization ?? req.ip,
        },
      },
    },
    async (req, reply) => {
      const tokenId = await verifyBearer(db, req.headers.authorization);
      if (tokenId === null) return reply.status(401).send({ error: 'invalid or revoked token' });

      const body = req.body as { schemaVersion?: unknown } | null;
      if (typeof body !== 'object' || body === null) {
        return reply.status(400).send({ error: 'expected a JSON UploadBatch' });
      }
      if (!isSupportedSchemaVersion(body.schemaVersion)) {
        return reply.status(409).send({
          error: `unsupported schemaVersion ${String(body.schemaVersion)}; this server accepts ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}`,
        });
      }
      const parsed = UploadBatch.safeParse(body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'invalid UploadBatch',
          issues: parsed.error.issues
            .slice(0, 20)
            .map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
      }
      const result = await ingestBatch(db, parsed.data, { tokenId });
      req.log.info(
        {
          batchId: result.batchId,
          records: result.acknowledged.length,
          account: parsed.data.account,
        },
        'ingested batch',
      );
      return result;
    },
  );

  registerAnalysisRoutes(app, db);
  registerExportRoutes(app, db);
  registerAddonRoutes(app, db);

  return app;
}
