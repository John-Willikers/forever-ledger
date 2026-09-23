import { NO_ADDON_RELEASE } from '@forever-ledger/contracts';
import type { FastifyInstance } from 'fastify';
import { resolveManifest } from '../addon.js';
import type { Db } from '../db/client.js';
import { buildFilter, requireToken } from './analysis.js';

const INT4_MAX = 2_147_483_647;

export function registerAddonRoutes(app: FastifyInstance, db: Db) {
  /** Which addon version the caller's client build should run. */
  app.get('/v1/addon/manifest', { preHandler: requireToken(db) }, async (req, reply) => {
    const build = buildFilter(req.query);
    // Pins are int4: a larger build can't match one, and Postgres would reject the comparison.
    const manifest = await resolveManifest(db, build !== null && build <= INT4_MAX ? build : null);
    // The uploader reads a 404 as "nothing published" only when the error is exactly this string.
    if (!manifest) return reply.status(404).send({ error: NO_ADDON_RELEASE });
    return manifest;
  });
}
