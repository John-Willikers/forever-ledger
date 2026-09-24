import { randomBytes } from 'node:crypto';
import cookie from '@fastify/cookie';
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
import { serializeRequest } from './logging.js';
import { registerAddonRoutes } from './routes/addon.js';
import { registerAdminApiRoutes } from './routes/adminApi.js';
import { registerAdminAuth } from './routes/adminAuth.js';
import { registerAdminBuildsRoutes } from './routes/adminBuilds.js';
import { registerAdminQuestRoutes } from './routes/adminQuests.js';
import { registerAdminLootRoutes } from './routes/adminLoot.js';
import { registerAdminMapsRoutes } from './routes/adminMaps.js';
import { registerAdminRunRoutes } from './routes/adminRuns.js';
import { registerAdminProfessionsRoutes } from './routes/adminProfessions.js';
import type { AdminAuthOptions } from './routes/adminAuth.js';
import { registerAdminStatic } from './routes/adminStatic.js';
import { registerAnalysisRoutes } from './routes/analysis.js';
import { recordIngestError, registerDiagnosticsRoutes } from './routes/diagnostics.js';
import { registerExportRoutes } from './routes/export.js';
import { chicagoIso } from './time.js';

export interface AppOptions {
  database: Database;
  logger?: FastifyServerOptions['logger'];
  /** Max request body in bytes (default 5 MB). */
  bodyLimit?: number;
  /** Ingest requests per minute per token (default 120). */
  ingestPerMinute?: number;
  /** Error reports per minute per token (default 30). */
  diagnosticsPerMinute?: number;
  /** Max error report body in bytes (default 256 KB). */
  diagnosticsBodyLimit?: number;
  /** Admin panel: Battle.net login, sessions, static SPA. */
  admin?: AdminOptions;
}

export interface AdminOptions extends Partial<AdminAuthOptions> {
  /** Built admin SPA directory (default apps/admin/dist). */
  distDir?: string;
}

export const DEFAULT_BODY_LIMIT = 5 * 1024 * 1024;

/** pino options: America/Chicago timestamps, never log bearer tokens, cookies or OAuth codes. */
export const loggerOptions = {
  level: process.env.LOG_LEVEL ?? 'info',
  timestamp: () => `,"time":"${chicagoIso()}"`,
  redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
  serializers: { req: serializeRequest },
};

export async function buildApp(opts: AppOptions) {
  const { db } = opts.database;
  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: opts.bodyLimit ?? DEFAULT_BODY_LIMIT,
    trustProxy: '127.0.0.1',
    // Path params up to 512 chars (default 100) so 128-char character keys and 256-char run ids reach their routes,
    // which enforce their own caps with a 400.
    maxParamLength: 512,
  });

  await app.register(rateLimit, { global: false });
  // Without COOKIE_SECRET nobody can log in (env requires it with Battle.net), so a per-process secret is fine.
  const cookieSecret = opts.admin?.cookieSecret ?? randomBytes(32).toString('hex');
  await app.register(cookie, { secret: cookieSecret });

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

      // Refused batches are kept (without the token) so problems on users' PCs show up in GET /v1/diagnostics.
      const refuse = async (
        status: 400 | 409,
        error: string,
        issues?: { path: string; message: string }[],
      ) => {
        try {
          await recordIngestError(db, { tokenId, body: req.body, status, error, issues });
        } catch (err) {
          req.log.error({ err }, 'cannot record the ingest error');
        }
        req.log.warn({ status, error }, 'ingest refused');
        return reply.status(status).send(issues ? { error, issues } : { error });
      };

      const body = req.body as { schemaVersion?: unknown } | null;
      if (typeof body !== 'object' || body === null) {
        return refuse(400, 'expected a JSON UploadBatch');
      }
      if (!isSupportedSchemaVersion(body.schemaVersion)) {
        return refuse(
          409,
          `unsupported schemaVersion ${String(body.schemaVersion)}; this server accepts ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}`,
        );
      }
      const parsed = UploadBatch.safeParse(body);
      if (!parsed.success) {
        return refuse(
          400,
          'invalid UploadBatch',
          parsed.error.issues
            .slice(0, 20)
            .map((i) => ({ path: i.path.join('.'), message: i.message })),
        );
      }
      const result = await ingestBatch(db, parsed.data, { tokenId, log: req.log });
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

  const guards = registerAdminAuth(app, db, { ...opts.admin, cookieSecret });
  registerAnalysisRoutes(app, db, guards.requireReader);
  registerExportRoutes(app, db, guards.requireReader);
  registerAddonRoutes(app, db);
  registerDiagnosticsRoutes(app, db, {
    perMinute: opts.diagnosticsPerMinute,
    bodyLimit: opts.diagnosticsBodyLimit,
    reader: guards.requireReader,
  });
  registerAdminApiRoutes(app, db, guards);
  registerAdminQuestRoutes(app, db, guards.requireAdmin);
  registerAdminLootRoutes(app, db, guards.requireAdmin);
  registerAdminRunRoutes(app, db, guards.requireAdmin);
  registerAdminProfessionsRoutes(app, db, guards.requireAdmin);
  registerAdminBuildsRoutes(app, db, guards.requireAdmin);
  await registerAdminMapsRoutes(app, db, guards.requireAdmin, guards.session);
  await registerAdminStatic(app, opts.admin?.distDir);

  return app;
}
