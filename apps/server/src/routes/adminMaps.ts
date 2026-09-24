// Zone maps: admin-uploaded map art (exported with wow.export from the uploader's own client) per uiMapID, drawn under
// the panel's points. Uploads are checked by magic bytes (PNG/WebP/JPEG only, see images.ts) and stored in Postgres;
// the image is served back to admin sessions only, with the mime found at upload, never the one the client sent.
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/client.js';
import { aspectWarning, ImageError, inspectImage, MAX_IMAGE_BYTES } from '../images.js';
import type { ReadGuard } from './analysis.js';
import { buildFilter } from './analysis.js';
import { iso, rows } from './adminData.js';
import { badRequest, idParam, textParam } from './shared.js';
import { jarr, jint, jlen, jtext } from './sqlJson.js';

/** Longest zone name accepted with `?name=`. */
export const MAP_NAME_MAX = 100;
/** Browsers keep a served map a day; the panel adds `?v=<sha256>` so a new upload shows at once. */
const IMAGE_CACHE = 'private, max-age=86400';

type Session = (
  req: FastifyRequest,
  reply: FastifyReply,
) => Promise<{ user: { id: number } } | null>;

interface ImageRow {
  ui_map_id: number;
  name: string | null;
  mime: string;
  width: number;
  height: number;
  size: number;
  sha256: string;
  build: number | null;
  uploaded_at: Date;
  uploaded_by: string | null;
}

const IMAGE_META = sql`z.ui_map_id, z.name, z.mime, z.width, z.height, octet_length(z.bytes)::int as size,
  z.sha256, z.build, z.uploaded_at, u.battletag as uploaded_by`;

const imageMeta = (r: ImageRow) => ({
  uiMapId: r.ui_map_id,
  name: r.name,
  mime: r.mime,
  width: r.width,
  height: r.height,
  size: r.size,
  sha256: r.sha256,
  build: r.build,
  uploadedAt: iso(r.uploaded_at),
  uploadedBy: r.uploaded_by,
  aspectWarning: aspectWarning(r.width, r.height),
});

/**
 * The newest zone name uploads gave each uiMapID (quest locations, quest NPCs, vendors, trainers), as a CTE `zone_names
 * (map_id, zone)`.
 */
const ZONE_NAMES = sql`zone_names as (
  select distinct on (map_id) map_id, zone from (
    select ${jint(sql`loc->'mapID'`)} as map_id, ${jtext(sql`loc`, 'zone')} as zone, observed_at as at
      from quest_observations
    union all
    select ${jint(sql`npc_loc->'mapID'`)}, ${jtext(sql`npc_loc`, 'zone')}, observed_at from quest_observations
    union all
    select ${jint(sql`loc->'mapID'`)}, ${jtext(sql`loc`, 'zone')}, seen_at from vendors
    union all
    select ${jint(sql`loc->'mapID'`)}, ${jtext(sql`loc`, 'zone')}, seen_at from trainers
  ) z
  where map_id > 0 and zone is not null and zone <> ''
  order by map_id, at desc nulls last
)`;

/**
 * `If-None-Match` names this ETag (a list, weak or strong, or `*`). The ETag is `"<sha256>"`.
 */
export function etagMatches(header: string | string[] | undefined, etag: string) {
  const value = Array.isArray(header) ? header.join(',') : header;
  if (!value) return false;
  return value
    .split(',')
    .map((t) => t.trim().replace(/^W\//, ''))
    .some((t) => t === '*' || t === etag);
}

export async function registerAdminMapsRoutes(
  app: FastifyInstance,
  db: Db,
  requireAdmin: ReadGuard,
  session: Session,
) {
  /**
   * Every uiMapID our data has a point on, and every uploaded map: the zone name uploads gave it, point counts
   * (gathering = node spots recorded, quests = quest observations located there by the NPC or the player, npcs =
   * vendors/trainers there) and the uploaded image's metadata, most points first. `latestBuild` is the newest client
   * build seen (the upload form's default).
   */
  app.get('/admin/api/maps', { preHandler: requireAdmin }, async () => {
    const [list, latest] = await Promise.all([
      rows<{
        map_id: number;
        zone: string | null;
        gathering: number;
        quests: number;
        npcs: number;
      }>(
        db,
        sql`with ${ZONE_NAMES},
        gathering as (
          select m.map_id, sum(m.points)::int as n from (
            select ${jint(sql`s.value->'mapId'`)} as map_id, ${jlen(sql`s.value->'points'`)} as points
            from nodes n, jsonb_array_elements(${jarr(sql`n.spots`)}) s
          ) m
          where m.map_id > 0
          group by m.map_id
        ),
        quests as (
          select map_id, count(*)::int as n from (
            select distinct quest_id, build, stage, char, map_id from (
              select quest_id, build, stage, char, ${jint(sql`loc->'mapID'`)} as map_id from quest_observations
              union all
              select quest_id, build, stage, char, ${jint(sql`npc_loc->'mapID'`)} from quest_observations
            ) o
            where map_id > 0
          ) d
          group by map_id
        ),
        npcs as (
          select map_id, count(distinct kind || npc_id)::int as n from (
            select 'v' as kind, npc_id, ${jint(sql`loc->'mapID'`)} as map_id from vendors
            union all
            select 't', npc_id, ${jint(sql`loc->'mapID'`)} from trainers
          ) x
          where map_id > 0
          group by map_id
        ),
        ids as (
          select map_id from gathering union select map_id from quests union select map_id from npcs
          union select ui_map_id from zone_maps
        )
        select ids.map_id, zn.zone, coalesce(g.n, 0) as gathering, coalesce(q.n, 0) as quests,
               coalesce(v.n, 0) as npcs
        from ids
        left join zone_names zn on zn.map_id = ids.map_id
        left join gathering g on g.map_id = ids.map_id
        left join quests q on q.map_id = ids.map_id
        left join npcs v on v.map_id = ids.map_id`,
      ),
      rows<{ build: number | null }>(db, sql`select max(build) as build from builds`),
    ]);
    const images = await rows<ImageRow>(
      db,
      sql`select ${IMAGE_META} from zone_maps z left join users u on u.id = z.uploaded_by`,
    );
    const byId = new Map(images.map((r) => [r.ui_map_id, imageMeta(r)]));
    const maps = list
      .map((r) => {
        const image = byId.get(r.map_id) ?? null;
        return {
          uiMapId: r.map_id,
          zone: r.zone ?? image?.name ?? null,
          points: {
            gathering: r.gathering,
            quests: r.quests,
            npcs: r.npcs,
            total: r.gathering + r.quests + r.npcs,
          },
          image,
        };
      })
      .sort((a, b) => b.points.total - a.points.total || a.uiMapId - b.uiMapId);
    return { latestBuild: latest[0]?.build ?? null, maps };
  });

  /** The uploaded maps only (no bytes): what the panel's map views need to decide between an image and the grid. */
  app.get('/admin/api/map-images', { preHandler: requireAdmin }, async () => {
    const list = await rows<{
      ui_map_id: number;
      name: string | null;
      width: number;
      height: number;
      sha256: string;
    }>(db, sql`select ui_map_id, name, width, height, sha256 from zone_maps order by ui_map_id`);
    return {
      images: list.map((r) => ({
        uiMapId: r.ui_map_id,
        name: r.name,
        width: r.width,
        height: r.height,
        sha256: r.sha256,
      })),
    };
  });

  // Uploads: the raw image is the body. In their own scope every content type reads as a Buffer (up to 8 MB), so an
  // SVG, HTML or JSON body reaches the magic-byte check and gets its 400 there. The admin check runs on onRequest,
  // before the body is read.
  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser(
      '*',
      { parseAs: 'buffer', bodyLimit: MAX_IMAGE_BYTES },
      (_req, body, done) => done(null, body),
    );

    /**
     * Upload (or replace) the map of a uiMapID: body = PNG, WebP or JPEG bytes. `?build=` records the client build the
     * art came from; `?name=` names the zone (else the name our data has). Answers the stored metadata and warnings
     * (aspect ratio off 1002:668).
     */
    scope.put(
      '/admin/api/maps/:uiMapId',
      { onRequest: requireAdmin, bodyLimit: MAX_IMAGE_BYTES },
      async (req, reply) => {
        const uiMapId = idParam((req.params as { uiMapId: string }).uiMapId, 'map');
        const build = buildFilter(req.query);
        const name = textParam(req.query, 'name', MAP_NAME_MAX);
        const body = req.body;
        if (!Buffer.isBuffer(body) || body.length === 0) {
          throw badRequest('expected a PNG, WebP or JPEG image body');
        }
        let info;
        try {
          info = inspectImage(body);
        } catch (err) {
          if (err instanceof ImageError) {
            return reply.status(err.status).send({ error: err.message });
          }
          throw err;
        }
        const s = await session(req, reply);
        const sha256 = createHash('sha256').update(body).digest('hex');
        await db.execute(sql`with ${ZONE_NAMES}
          insert into zone_maps (ui_map_id, name, mime, width, height, bytes, sha256, build, uploaded_by, uploaded_at)
          values (${uiMapId},
                  coalesce(${name}::text, (select zone from zone_names where map_id = ${uiMapId})),
                  ${info.mime}, ${info.width}, ${info.height}, ${body}, ${sha256}, ${build}::int,
                  ${s?.user.id ?? null}::int, now())
          on conflict (ui_map_id) do update set
            name = coalesce(excluded.name, zone_maps.name),
            mime = excluded.mime, width = excluded.width, height = excluded.height, bytes = excluded.bytes,
            sha256 = excluded.sha256, build = excluded.build, uploaded_by = excluded.uploaded_by,
            uploaded_at = excluded.uploaded_at`);
        const [row] = await rows<ImageRow>(
          db,
          sql`select ${IMAGE_META} from zone_maps z left join users u on u.id = z.uploaded_by
              where z.ui_map_id = ${uiMapId}`,
        );
        const map = imageMeta(row!);
        req.log.info(
          { uiMapId, mime: info.mime, width: info.width, height: info.height, size: body.length },
          'zone map uploaded',
        );
        return { map, warnings: map.aspectWarning ? [map.aspectWarning] : [] };
      },
    );
  });

  app.delete('/admin/api/maps/:uiMapId', { onRequest: requireAdmin }, async (req, reply) => {
    const uiMapId = idParam((req.params as { uiMapId: string }).uiMapId, 'map');
    const res = await db.execute(sql`delete from zone_maps where ui_map_id = ${uiMapId}`);
    if (res.rowCount === 0) return reply.status(404).send({ error: 'no map uploaded' });
    req.log.info({ uiMapId }, 'zone map deleted');
    return reply.status(204).send();
  });

  /**
   * The uploaded image, for admin sessions (an `<img>` sends the cookie): stored mime, ETag = "<sha256>" with
   * If-None-Match → 304, cached privately for a day. Errors are JSON and never cached.
   */
  app.get(
    '/admin/maps/:uiMapId',
    {
      onRequest: [
        async (_req, reply) => {
          reply.header('cache-control', 'no-store');
          reply.header('x-content-type-options', 'nosniff');
        },
        requireAdmin,
      ],
    },
    async (req, reply) => {
      const uiMapId = idParam((req.params as { uiMapId: string }).uiMapId, 'map');
      const [meta] = await rows<{ mime: string; sha256: string }>(
        db,
        sql`select mime, sha256 from zone_maps where ui_map_id = ${uiMapId}`,
      );
      if (!meta) return reply.status(404).send({ error: 'no map uploaded' });
      const etag = `"${meta.sha256}"`;
      reply.header('etag', etag);
      reply.header('cache-control', IMAGE_CACHE);
      if (etagMatches(req.headers['if-none-match'], etag)) return reply.status(304).send();
      const [img] = await rows<{ bytes: Buffer }>(
        db,
        sql`select bytes from zone_maps where ui_map_id = ${uiMapId} and sha256 = ${meta.sha256}`,
      );
      if (!img) {
        reply.header('cache-control', 'no-store');
        return reply.status(404).send({ error: 'no map uploaded' });
      }
      return reply
        .header('content-type', meta.mime)
        .header('content-security-policy', "default-src 'none'; sandbox")
        .header('cross-origin-resource-policy', 'same-origin')
        .send(img.bytes);
    },
  );
}
