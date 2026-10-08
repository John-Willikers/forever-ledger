// In-game guides (project-plans/forever-ledger-guides.md): a guide is planned for a character by the route planner
// (plan-guide.ts, when the character has stored state) or replays one of our players' real runs (leveling_route). It
// is held for the tray token that uploads that character, and written by that tray into the generated
// ForeverLedger_Guides addon. Anyone may send a guide to any character; it only shows up in that player's
// game after they /reload, and a character gets at most a few per hour.
import { GuideDoc } from '@forever-ledger/contracts';
import type { GuideStep } from '@forever-ledger/contracts';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { apiTokens, guides } from '../db/schema.js';
import { iso, rows } from '../routes/adminData.js';
import { chicagoIso } from '../time.js';
import { clean, clip } from './guide-text.js';
import { levelingRoute } from './leveling.js';
import { planGuide, plannedTitle } from './plan-guide.js';
import { findCharacters } from './upgrades.js';

export class GuideError extends Error {}

/** Steps an in-game guide carries at most (a long route is cut, and the title says so). */
export const GUIDE_STEPS_MAX = 300;
/** Guides one character can be sent per hour, and one requester can send per hour. */
export const GUIDES_PER_HOUR = 6;
export const GUIDES_PER_REQUESTER_HOUR = 12;
/** Guides kept for a character; sending another retires the oldest. */
export const GUIDES_KEPT = 5;
/** `basedOn` of a planned guide. */
export const PLANNER = 'the route planner';

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

/**
 * The level each quest can be picked up at: Wowhead's required level (a `req_level` claim) when the ledger has one,
 * else the lowest level one of our characters accepted it at (an upper bound: the real minimum can be lower).
 */
export async function questMinLevels(
  db: Db,
  questIds: number[],
): Promise<Map<number, { level: number; from: 'wowhead' | 'seen' }>> {
  const out = new Map<number, { level: number; from: 'wowhead' | 'seen' }>();
  const ids = [...new Set(questIds)];
  if (ids.length === 0) return out;
  const list = sql.join(
    ids.map((i) => sql`${i}`),
    sql`, `,
  );
  const found = await rows<{ quest_id: number; level: number; src: 'wowhead' | 'seen' }>(
    db,
    sql`select distinct on (quest_id) quest_id, level, src from (
          select c.entity_id as quest_id, (c.value #>> '{}')::int as level, 'wowhead' as src, 0 as pri
            from claims c
           where c.entity_type = 'quest' and c.attribute = 'req_level' and c.label <> 'FALSE'
             and c.entity_id in (${list}) and jsonb_typeof(c.value) = 'number' and (c.value #>> '{}')::int between 1 and 80
          union all
          select o.quest_id, min(o.level), 'seen', 1 from quest_observations o
           where o.quest_id in (${list}) and o.stage in ('accept', 'detail') and o.level between 1 and 80
           group by o.quest_id
        ) x order by quest_id, pri, level`,
  );
  for (const f of found) out.set(f.quest_id, { level: f.level, from: f.src });
  return out;
}

/**
 * Builds a guide and stores it for the character's tray. A character with stored state (addon 0.8.0) gets one planned
 * for it by the route planner, unless `basedOn` names a run to follow; otherwise it replays one of our players' runs.
 * Throws GuideError when it can't.
 */
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

  const built = (await plannedFor(db, target, req)) ?? (await fromRun(db, target, req));
  const { steps, from, title, basedOn, planned } = built;
  const summary = {
    character: target.name,
    title,
    steps: steps.length,
    basedOn,
    planned,
    reachedTarget: built.reachedTarget,
    ...(built.minutes !== undefined ? { minutes: built.minutes } : {}),
    gaps: built.gaps,
  };
  const docBody = {
    char: target.key,
    title,
    fromLevel: from,
    toLevel: req.toLevel,
    basedOn,
    ...(planned ? { planned: true } : {}),
    steps,
  };

  if (req.preview) {
    return { id: null, ...summary, doc: docBody, tray: tokenId !== null };
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
          ...(planned ? { planned: true } : {}),
        },
        doc: {},
        requestedBy: req.requestedBy.slice(0, 128),
      })
      .returning({ id: guides.id, createdAt: guides.createdAt });
    const doc = GuideDoc.parse({
      id: row!.id,
      ...docBody,
      createdAt: chicagoIso(row!.createdAt),
    });
    await tx.update(guides).set({ doc }).where(eq(guides.id, row!.id));
    // Only the newest few stay for the character.
    await tx.execute(sql`update guides set deleted_at = now()
       where char = ${target.key} and deleted_at is null
         and id not in (select id from guides where char = ${target.key} and deleted_at is null
                         order by id desc limit ${GUIDES_KEPT})`);
    return { id: row!.id, ...summary, doc, tray: true };
  });
}

interface BuiltSteps {
  steps: GuideStep[];
  from: number;
  title: string;
  basedOn: string;
  planned: boolean;
  reachedTarget: boolean;
  /** Planned play time (planned guides). */
  minutes?: number;
  gaps: string[];
}

/** The route planner's guide for a character with stored state, unless a run to follow was asked for. */
async function plannedFor(
  db: Db,
  target: { key: string; name: string },
  req: GuideRequest,
): Promise<BuiltSteps | null> {
  if (req.basedOn) return null;
  const p = await planGuide(db, target.key, req.toLevel, { maxSteps: GUIDE_STEPS_MAX });
  if (!p) return null;
  if (p.fromLevel >= req.toLevel)
    throw new GuideError(`${target.name} is already level ${p.fromLevel}`);
  if (!p.steps.some((s) => s.action !== 'travel')) {
    throw new GuideError(
      `no guide to build: the route planner found no quests for ${target.name}${p.gaps.length ? ` (${p.gaps[p.gaps.length - 1]})` : ''}`,
    );
  }
  return {
    steps: p.steps,
    from: p.fromLevel,
    title: plannedTitle(p),
    basedOn: PLANNER,
    planned: true,
    reachedTarget: p.reachedTarget,
    minutes: Math.round(p.seconds / 60),
    gaps: p.gaps,
  };
}

/** A guide that replays one of our players' runs (leveling_route). */
async function fromRun(
  db: Db,
  target: { key: string; name: string },
  req: GuideRequest,
): Promise<BuiltSteps> {
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
  const minLevels = await questMinLevels(
    db,
    r.route.guide
      .filter((s) => s.action === 'accept')
      .flatMap((s) => s.quests.map((q) => q.questId)),
  );
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
      ...(s.action === 'accept' && minLevels.has(q.questId)
        ? {
            minLevel: minLevels.get(q.questId)!.level,
            minLevelFrom: minLevels.get(q.questId)!.from,
          }
        : {}),
    })),
    ...(s.action === 'turn_in' ? { levelAfter: s.levelAfter ?? null } : {}),
  }));
  const from = r.fromLevel;
  const where = clean(r.race ? (req.start ?? '') : (req.start ?? r.route.character));
  const label = where ? `${where.charAt(0).toUpperCase()}${where.slice(1)} ` : '';
  const basedOn = clip(r.route.character, 128) ?? '?';
  return {
    steps,
    from,
    title: clip(`${label}${from}-${req.toLevel} (${basedOn}'s run)`, 120)!,
    basedOn,
    planned: false,
    reachedTarget: r.route.reachedTarget,
    gaps: r.gaps,
  };
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
    planned: (g.doc as GuideDoc).planned === true,
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
