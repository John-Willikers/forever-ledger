// In-game guides over HTTP (project-plans/forever-ledger-guides.md).
//   GET  /v1/guides          upload token → the guides for the characters this tray uploads (it writes them into the game)
//   POST /v1/guides/ack      upload token → { ids } the tray wrote
//   GET  /admin/api/guides   the admin page's list
//   POST /admin/api/guides   { character, start?, basedOn?, toLevel, fromLevel?, preview? } → build (and send)
//   POST /admin/api/guides/:id/delete
import { GuidesAck } from '@forever-ledger/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyBearer } from '../auth.js';
import type { Db } from '../db/client.js';
import {
  ackGuides,
  createGuide,
  deleteGuide,
  GuideError,
  guidesForTray,
  listGuides,
} from '../knowledge/guides.js';
import type { ActiveSession } from '../sessions.js';
import type { ReadGuard } from './analysis.js';

type SessionOf = (req: FastifyRequest, reply: FastifyReply) => Promise<ActiveSession | null>;

const int = (v: unknown, min: number, max: number) =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined;
const str = (v: unknown, max: number) =>
  typeof v === 'string' && v.trim() !== '' && v.length <= max ? v.trim() : undefined;

export function registerGuideRoutes(
  app: FastifyInstance,
  db: Db,
  admin: ReadGuard,
  session: SessionOf,
) {
  const tray = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };

  app.get('/v1/guides', tray, async (req, reply) => {
    const tokenId = await verifyBearer(db, req.headers.authorization);
    if (tokenId === null) return reply.status(401).send({ error: 'invalid or revoked token' });
    return { guides: await guidesForTray(db, tokenId) };
  });

  app.post('/v1/guides/ack', tray, async (req, reply) => {
    const tokenId = await verifyBearer(db, req.headers.authorization);
    if (tokenId === null) return reply.status(401).send({ error: 'invalid or revoked token' });
    const parsed = GuidesAck.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'expected { ids: number[] }' });
    return { acked: await ackGuides(db, tokenId, parsed.data.ids) };
  });

  app.get('/admin/api/guides', { preHandler: admin }, async (req) => {
    const all = (req.query as Record<string, unknown>).all === '1';
    return { items: await listGuides(db, { includeDeleted: all }) };
  });

  app.post('/admin/api/guides', { preHandler: admin }, async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const character = str(b.character, 128);
    const toLevel = int(b.toLevel, 2, 80);
    if (!character || !toLevel) {
      return reply.status(400).send({ error: 'character and toLevel (2-80) are required' });
    }
    const me = await session(req, reply);
    try {
      const made = await createGuide(db, {
        character,
        start: str(b.start, 64),
        basedOn: str(b.basedOn, 128),
        toLevel,
        fromLevel: int(b.fromLevel, 1, 80),
        requestedBy: `admin:${me?.user.battletag ?? me?.user.id ?? '?'}`,
        preview: b.preview === true,
      });
      return reply.status(b.preview === true ? 200 : 201).send(made);
    } catch (err) {
      if (err instanceof GuideError) return reply.status(422).send({ error: err.message });
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>(
    '/admin/api/guides/:id/delete',
    { preHandler: admin },
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0)
        return reply.status(400).send({ error: 'bad guide id' });
      if (!(await deleteGuide(db, id))) return reply.status(404).send({ error: 'no such guide' });
      return { id, deleted: true };
    },
  );
}
