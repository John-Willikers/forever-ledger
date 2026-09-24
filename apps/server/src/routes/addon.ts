import { LEGACY_ADDON_SCHEMA, NO_ADDON_RELEASE } from '@forever-ledger/contracts';
import type { FastifyInstance } from 'fastify';
import { INT4_MAX, resolveManifest } from '../addon.js';
import type { Db } from '../db/client.js';
import { positiveInt, requireToken } from './analysis.js';

export function registerAddonRoutes(app: FastifyInstance, db: Db) {
  /**
   * Which addon version the caller's client build should run. `?schema=` is the newest SavedVariables schema the tray
   * reads; missing or not a positive integer (trays older than the gate don't send it) → LEGACY_ADDON_SCHEMA.
   */
  app.get('/v1/addon/manifest', { preHandler: requireToken(db) }, async (req, reply) => {
    // Lenient on purpose (the tray app sends it): pins are int4, so a larger build just matches no pin.
    const build = positiveInt(req.query, 'build');
    const maxSchema = positiveInt(req.query, 'schema') ?? LEGACY_ADDON_SCHEMA;
    const manifest = await resolveManifest(
      db,
      build !== null && build <= INT4_MAX ? build : null,
      maxSchema,
    );
    // The uploader reads a 404 as "nothing published" only when the error is exactly this string.
    if (!manifest) return reply.status(404).send({ error: NO_ADDON_RELEASE });
    return manifest;
  });
}
