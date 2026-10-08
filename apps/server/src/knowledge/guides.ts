// In-game guides (project-plans/forever-ledger-guides.md): a guide is one of our players' real runs (leveling_route)
// built for a character, held for the tray token that uploads that character, and written by that tray into the
// generated ForeverLedger_Guides addon. Anyone may send a guide to any character; it only shows up in that player's
// game after they /reload, and a character gets at most a few per hour.
import { GuideDoc } from '@forever-ledger/contracts';
import type { GuideStep } from '@forever-ledger/contracts';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { apiTokens, guides } from '../db/schema.js';
import { iso, rows } from '../routes/adminData.js';
import { chicagoIso } from '../time.js';
import { levelingRoute } from './leveling.js';
import { findCharacters } from './upgrades.js';

export class GuideError extends Error {}

/** Steps an in-game guide carries at most (a long route is cut, and the title says so). */
export const GUIDE_STEPS_MAX = 300;
/** Guides one character can be sent per hour, and one requester can send per hour. */
export const GUIDES_PER_HOUR = 6;
export const GUIDES_PER_REQUESTER_HOUR = 12;
/** Guides kept for a character; sending another retires the oldest. */
export const GUIDES_KEPT = 5;

export interface GuideRequest {
  /** The character it is for (full name, first name or key). */
  character: string;
  /** A race ("undead") or a zone: whose runs to follow. */
  start?: string;
  /** Follow this character's run instead. */
  basedOn?: string;
  toLevel: number;
  fromLevel?: number;
  /** "discord:<user id>" or "admin:<battletag>". */
  requestedBy: string;
  /** Build it and return it without storing or sending it (the admin page's preview). */
  preview?: boolean;
}

/**
 * Text shown in the game: control characters (newlines included) become spaces and WoW's "|" escape character is
 * dropped, so an uploaded name can't color text, add links or textures, or fake a chat line. The viewer escapes "|"
 * again before showing anything.
 */
const clean = (s: string) =>
  s
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\|/g, '')
    .trim();
const clip = (s: string | null | undefined, max: number) => {
  if (s === null || s === undefined) return null;
  const c = clean(s);
  return c.length > max ? c.slice(0, max) : c;
};

/**
 * The tray that uploads this character: the account that first uploaded it (or one of its old keys, before a merge)
 * owns it, and that account's newest live token gets the guides. Someone else uploading a file that claims the same
 * character never takes its guides over.
 */
export async function trayFor(db: Db, key: string): Promise<number | null> {
  const [row] = await rows<{ token_id: number }>(
    db,
    sql`with keys as (
          select ${key}::text as k
          union select alias_key from character_aliases where canonical_key = ${key}
        ), hits as (
          select r.id, r.account, r.token_id from raw_uploads r
           where exists (select 1 from keys
                          where r.payload->'records'->'characters' @> jsonb_build_array(jsonb_build_object('key', keys.k)))
        ), owner as (select account from hits order by id limit 1)
        select h.token_id from hits h join api_tokens t on t.id = h.token_id
         where h.account = (select account from owner) and t.revoked_at is null and not t.can_fetch
         order by h.id desc limit 1`,
  );
  return row?.token_id ?? null;
}

/** Guides waiting on a revoked token (a reinstalled tray) move to the character's current tray. */
async function rehome(db: Db) {
  const stranded = await rows<{ id: number; char: string }>(
    db,
    sql`select g.id, g.char from guides g join api_tokens t on t.id = g.token_id
         where g.deleted_at is null and t.revoked_at is not null`,
  );
  for (const g of stranded) {
    const tokenId = await trayFor(db, g.char);
    if (tokenId !== null) await db.update(guides).set({ tokenId }).where(eq(guides.id, g.id));
  }
}

/** Builds a guide from a run and stores it for the character's tray. Throws GuideError when it can't. */
export async function createGuide(db: Db, req: GuideRequest) {
  const found = await findCharacters(db, req.character);
  const exact = found.filter(
    (c) =>
      c.name.toLowerCase() === req.character.trim().toLowerCase() ||
      c.key.toLowerCase() === req.character.trim().toLowerCase(),
  );
  const target = exact.length === 1 ? exact[0]! : found.length === 1 ? found[0]! : null;
  if (!target) {
    throw new GuideError(
      found.length === 0
        ? `the ledger has no character named "${req.character}"`
        : `several characters match "${req.character}": ${found.map((c) => c.name).join(', ')}`,
    );
  }
  const tokenId = await trayFor(db, target.key);
  if (tokenId === null && !req.preview) {
    throw new GuideError(
      `no Forever Ledger tray uploads ${target.name}, so there is nowhere to send a guide`,
    );
  }
  const limits = async (conn: Db) => {
    const [recent] = await rows<{ forChar: number; byRequester: number }>(
      conn,
      sql`select count(*) filter (where char = ${target.key})::int as "forChar",
                 count(*) filter (where requested_by = ${req.requestedBy})::int as "byRequester"
            from guides where created_at > now() - interval '1 hour'`,
    );
    if ((recent?.forChar ?? 0) >= GUIDES_PER_HOUR)
      throw new GuideError(
        `${target.name} has been sent ${GUIDES_PER_HOUR} guides this hour; try again later`,
      );
    if ((recent?.byRequester ?? 0) >= GUIDES_PER_REQUESTER_HOUR)
      throw new GuideError(
        `you've sent ${GUIDES_PER_REQUESTER_HOUR} guides this hour; try again later`,
      );
  };
  if (!req.preview) await limits(db);
  if (!req.start && !req.basedOn)
    throw new GuideError('say where the guide starts (a race or a zone) or whose run to follow');

  const r = await levelingRoute(db, {
    start: req.start,
    character: req.basedOn,
    toLevel: req.toLevel,
    fromLevel: req.fromLevel,
    forCharacter: target.key,
    stepsMax: GUIDE_STEPS_MAX,
  });
  if (r.route && r.route.guide.length === 0 && (r.forCharacter?.questsAlreadyDone ?? 0) > 0) {
    throw new GuideError(
      `${target.name} has already turned in every quest of ${r.route.character}'s run to ${req.toLevel}`,
    );
  }
  if (!r.route || r.route.guide.length === 0) {
    throw new GuideError(
      `no guide to build: ${r.gaps.find((g) => !g.startsWith('routes are what') && !g.startsWith('where objectives')) ?? 'none of our players has a run like that'}`,
    );
  }
  const steps: GuideStep[] = r.route.guide.map((s) => ({
    action: s.action,
    npc: clip(s.npc, 120),
    zone: clip(s.zone, 120),
    subzone: clip(s.subzone, 120),
    mapId: typeof s.mapId === 'number' && s.mapId > 0 ? s.mapId : null,
    x: typeof s.x === 'number' && s.x >= 0 && s.x <= 100 ? s.x : null,
    y: typeof s.y === 'number' && s.y >= 0 && s.y <= 100 ? s.y : null,
    quests: s.quests.slice(0, 20).map((q) => ({
      questId: q.questId,
      title: clip(q.title, 200),
      ...(q.objectives?.length
        ? { objectives: q.objectives.slice(0, 12).map((o) => clip(o, 200) ?? '') }
        : {}),
    })),
    ...(s.action === 'turn_in' ? { levelAfter: s.levelAfter ?? null } : {}),
  }));
  const from = r.fromLevel;
  const where = clean(r.race ? (req.start ?? '') : (req.start ?? r.route.character));
  const label = where ? `${where.charAt(0).toUpperCase()}${where.slice(1)} ` : '';
  const basedOn = clip(r.route.character, 128) ?? '?';
  const title = clip(`${label}${from}-${req.toLevel} (${basedOn}'s run)`, 120)!;

  if (req.preview) {
    return {
      id: null,
      character: target.name,
      title,
      steps: steps.length,
      basedOn,
      reachedTarget: r.route.reachedTarget,
      gaps: r.gaps,
      doc: {
        char: target.key,
        title,
        fromLevel: from,
        toLevel: req.toLevel,
        basedOn,
        steps,
      },
      tray: tokenId !== null,
    };
  }
  return db.transaction(async (tx) => {
    // One guide at a time per character: the limits are checked again under the lock.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`guide:${target.key}`}))`);
    await limits(tx as unknown as Db);
    const [row] = await tx
      .insert(guides)
      .values({
        char: target.key,
        tokenId: tokenId!,
        title,
        request: {
          start: req.start,
          basedOn: req.basedOn,
          toLevel: req.toLevel,
          fromLevel: req.fromLevel,
        },
        doc: {},
        requestedBy: req.requestedBy.slice(0, 128),
      })
      .returning({ id: guides.id, createdAt: guides.createdAt });
    const doc = GuideDoc.parse({
      id: row!.id,
      char: target.key,
      title,
      createdAt: chicagoIso(row!.createdAt),
      fromLevel: from,
      toLevel: req.toLevel,
      basedOn,
      steps,
    });
    await tx.update(guides).set({ doc }).where(eq(guides.id, row!.id));
    // Only the newest few stay for the character.
    await tx.execute(sql`update guides set deleted_at = now()
       where char = ${target.key} and deleted_at is null
         and id not in (select id from guides where char = ${target.key} and deleted_at is null
                         order by id desc limit ${GUIDES_KEPT})`);
    return {
      id: row!.id,
      character: target.name,
      title,
      steps: steps.length,
      basedOn,
      reachedTarget: r.route!.reachedTarget,
      gaps: r.gaps,
      doc,
      tray: true,
    };
  });
}

/** The guides a tray should have written: active ones for the characters it uploads, newest first. */
export async function guidesForTray(db: Db, tokenId: number): Promise<GuideDoc[]> {
  await rehome(db);
  const found = await db
    .select({ doc: guides.doc })
    .from(guides)
    .where(and(eq(guides.tokenId, tokenId), isNull(guides.deletedAt)))
    .orderBy(desc(guides.id))
    .limit(20);
  return found.map((g) => g.doc as GuideDoc);
}

/** The tray wrote these guides into the game. */
export async function ackGuides(db: Db, tokenId: number, ids: number[]) {
  if (ids.length === 0) return 0;
  const res = await db
    .update(guides)
    .set({ deliveredAt: sql`coalesce(${guides.deliveredAt}, now())` })
    .where(and(eq(guides.tokenId, tokenId), inArray(guides.id, ids)))
    .returning({ id: guides.id });
  return res.length;
}

/** The admin page's list: every guide, newest first. */
export async function listGuides(db: Db, opts: { includeDeleted?: boolean; limit?: number } = {}) {
  const found = await db
    .select({
      id: guides.id,
      char: guides.char,
      title: guides.title,
      request: guides.request,
      doc: guides.doc,
      requestedBy: guides.requestedBy,
      createdAt: guides.createdAt,
      deliveredAt: guides.deliveredAt,
      deletedAt: guides.deletedAt,
      tray: apiTokens.label,
    })
    .from(guides)
    .leftJoin(apiTokens, eq(apiTokens.id, guides.tokenId))
    .where(opts.includeDeleted ? undefined : isNull(guides.deletedAt))
    .orderBy(desc(guides.id))
    .limit(opts.limit ?? 100);
  return found.map((g) => ({
    ...g,
    steps: (g.doc as GuideDoc).steps?.length ?? 0,
    createdAt: iso(g.createdAt),
    deliveredAt: iso(g.deliveredAt),
    deletedAt: iso(g.deletedAt),
  }));
}

/** Retires a guide: the tray drops it from the game at its next check. */
export async function deleteGuide(db: Db, id: number) {
  const res = await db
    .update(guides)
    .set({ deletedAt: new Date() })
    .where(and(eq(guides.id, id), isNull(guides.deletedAt)))
    .returning({ id: guides.id });
  return res.length > 0;
}
