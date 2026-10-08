// Planned guides (docs/plans/2026-10-08-route-planner.md, phase 5): the route planner run for one character from its
// stored state (character-state.ts) over the quest atlas (atlas-load.ts), and its steps as in-game guide steps
// (contracts GuideStep, format 2: travel steps included). Guides (guides.ts) and leveling_route use it.
import type { GuideStep } from '@forever-ledger/contracts';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import type { AtlasBuild } from '../planner/atlas-build.js';
import { mapInfo } from '../planner/geo.js';
import { plan, MAX_STEPS } from '../planner/plan.js';
import type { TravelData } from '../planner/travel.js';
import type { Atlas, MapSpot, PlanStep } from '../planner/types.js';
import { rows } from '../routes/adminData.js';
import { loadAtlas } from './atlas-load.js';
import { loadCharacter } from './character-state.js';
import { clip } from './guide-text.js';
import { levelingRoute, ROUTE_STEPS_MAX, type LevelingQuery } from './leveling.js';
import { findCharacters } from './upgrades.js';

/** The atlas is rebuilt from Postgres at most this often (it takes seconds; a plan takes milliseconds). */
export const ATLAS_TTL_MS = 10 * 60 * 1000;
const atlases = new WeakMap<Db, { at: number; build: Promise<AtlasBuild> }>();

/** The quest atlas, cached per database for ATLAS_TTL_MS. */
export function cachedAtlas(db: Db, now = Date.now()): Promise<AtlasBuild> {
  const hit = atlases.get(db);
  if (hit && now - hit.at < ATLAS_TTL_MS) return hit.build;
  const build = loadAtlas(db);
  atlases.set(db, { at: now, build });
  // A failed load is not kept.
  build.catch(() => {
    if (atlases.get(db)?.build === build) atlases.delete(db);
  });
  return build;
}

/** Drops the cached atlas (tests, or after new quest data). */
export function forgetAtlas(db: Db): void {
  atlases.delete(db);
}

/** Whether the character has a stored state (addon 0.8.0): only then can the planner plan for it. */
export async function hasState(db: Db, charKey: string): Promise<boolean> {
  const found = await rows<{ one: number }>(
    db,
    sql`select 1 as one from character_state where char = ${charKey} limit 1`,
  );
  return found.length > 0;
}

const pct = (v: number) => Math.round(v * 100) / 100;
const sameSpot = (a: MapSpot, b: MapSpot) =>
  a.mapId === b.mapId && Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

/** Map pin of a spot; all null unless it is a known map id with percent coordinates. */
function pin(s: MapSpot | null): Pick<GuideStep, 'mapId' | 'x' | 'y'> {
  if (!s || !Number.isInteger(s.mapId) || s.mapId <= 0) return { mapId: null, x: null, y: null };
  const ok = (v: number) => Number.isFinite(v) && v >= 0 && v <= 100;
  if (!ok(s.x) || !ok(s.y)) return { mapId: null, x: null, y: null };
  return { mapId: s.mapId, x: pct(s.x), y: pct(s.y) };
}

export interface StepContext {
  atlas: Atlas;
  travel: TravelData;
  /** GetBindLocation: where a hearth lands. */
  bindName: string | null;
}

/**
 * Arrows the game font may not draw become ASCII: "→" (and its kin) "->", "↔" "to". Accented letters stay (the font has
 * them).
 */
export const asciiArrows = (t: string | null): string | null =>
  t === null ? null : t.replace(/\s*[↔⇔⟷]\s*/g, ' to ').replace(/[→⇒➔⟶]/g, '->');

/**
 * Where a travel step lands, as a name: the flight master, the transport's end, the inn's town, the NPC the next step
 * is at (a walk), else the zone.
 */
function destination(s: PlanStep, next: PlanStep | undefined, ctx: StepContext): string | null {
  const zone = s.zone ?? (s.spot ? (mapInfo(s.spot.mapId)?.name ?? null) : null);
  if (s.how === 'fly' && s.spot) {
    const node = ctx.travel.flightNodes.find((n) => sameSpot(n.spot, s.spot!));
    if (node) return node.name;
    const end = s.note?.split('→').pop()?.trim();
    if (end) return end;
  }
  if (s.how === 'boat' && s.spot) {
    const t = ctx.travel.transports.find((x) => x.name === s.note);
    const [a, b] = t ? t.name.split('↔').map((p) => p.trim()) : [];
    if (t && a && sameSpot(t.a, s.spot)) return a;
    if (t && b && sameSpot(t.b, s.spot)) return b;
  }
  if (s.how === 'hearth' && ctx.bindName) return ctx.bindName;
  if (
    next &&
    next.action !== 'travel' &&
    next.npc &&
    next.spot &&
    s.spot &&
    sameSpot(next.spot, s.spot)
  )
    return next.npc;
  return zone;
}

/** A transport step's note: "<kind>: <route>", e.g. "zeppelin: Tirisfal Glades to Durotar". */
function transportNote(s: PlanStep, ctx: StepContext): string | undefined {
  const t = s.how === 'boat' ? ctx.travel.transports.find((x) => x.name === s.note) : undefined;
  return t ? `${t.kind}: ${t.name}` : s.note;
}

/** The planner's steps as guide steps (format 2). Everything shown in the game goes through `clip`. */
export function guideSteps(steps: PlanStep[], ctx: StepContext): GuideStep[] {
  const out: GuideStep[] = [];
  for (const [i, s] of steps.entries()) {
    const zone = clip(
      asciiArrows(s.zone ?? (s.spot ? (mapInfo(s.spot.mapId)?.name ?? null) : null)),
      120,
    );
    const note = clip(asciiArrows(transportNote(s, ctx) ?? null), 120);
    const base = {
      action: s.action,
      ...(s.action === 'travel' && s.how ? { how: s.how } : {}),
      ...(note ? { note } : {}),
      npc: clip(
        asciiArrows(s.action === 'travel' ? destination(s, steps[i + 1], ctx) : s.npc),
        120,
      ),
      zone,
      subzone: null,
      ...pin(s.spot),
    };
    const quests = s.quests.slice(0, 20).map((q) => {
      const aq = ctx.atlas.quests.get(q.questId);
      const req = aq?.reqLevel;
      // "Mottled Boar slain" → "Mottled Boar slain: 10", as run-based guides say it.
      const what = (o: string) => {
        const n = aq?.objectives.find((x) => x.text === o)?.count;
        return n && n > 0 && !/:\s*\d+$|^\d+ × /.test(o) ? `${o}: ${n}` : o;
      };
      return {
        questId: q.questId,
        title: clip(q.title, 200),
        ...(s.action === 'complete' && q.objectives?.length
          ? { objectives: q.objectives.slice(0, 12).map((o) => clip(what(o), 200) ?? '') }
          : {}),
        ...(s.action === 'accept' &&
        req !== undefined &&
        Number.isInteger(req) &&
        req >= 1 &&
        req <= 80
          ? { minLevel: req, minLevelFrom: 'wowhead' as const }
          : {}),
      };
    });
    if (s.action !== 'travel' && quests.length === 0) continue;
    out.push({
      ...base,
      quests: s.action === 'travel' ? [] : quests,
      ...(s.action === 'turn_in'
        ? { levelAfter: s.level >= 1 && s.level <= 80 ? s.level : null }
        : {}),
    });
  }
  return out;
}

export interface PlannedGuide {
  steps: GuideStep[];
  /** The character's and the planner's gaps, in words. */
  gaps: string[];
  fromLevel: number;
  toLevel: number;
  /** Planned play time. */
  seconds: number;
  /** The zone the character stands in (the guide's title). */
  startZone: string | null;
  reachedTarget: boolean;
}

/**
 * A guide planned for the character from its stored state: null when it has none (no addon 0.8.0 upload yet).
 * `maxSteps` caps the plan (planner default MAX_STEPS).
 */
export async function planGuide(
  db: Db,
  charKey: string,
  toLevel: number,
  opts: { maxSteps?: number; now?: number } = {},
): Promise<PlannedGuide | null> {
  if (!(await hasState(db, charKey))) return null;
  const [loaded, { atlas }] = await Promise.all([
    loadCharacter(db, charKey, opts.now),
    cachedAtlas(db),
  ]);
  if (!loaded) return null;
  const { ch, travel, xpCurve, bindName } = loaded;
  const r = plan(atlas, ch, travel, {
    toLevel,
    maxSteps: opts.maxSteps ?? MAX_STEPS,
    ...(xpCurve.size ? { xpCurve } : {}),
  });
  const last = r.steps[r.steps.length - 1];
  return {
    steps: guideSteps(r.steps, { atlas, travel, bindName }),
    gaps: [...loaded.gaps, ...r.gaps],
    fromLevel: ch.level,
    toLevel,
    seconds: Math.round(r.seconds),
    startZone: mapInfo(ch.position.mapId)?.name ?? null,
    reachedTarget: ch.level >= toLevel || (last?.level ?? 0) >= toLevel,
  };
}

/** A planned guide's title: "Planned: Durotar 10–12". */
export const plannedTitle = (g: Pick<PlannedGuide, 'startZone' | 'fromLevel' | 'toLevel'>) =>
  clip(`Planned: ${g.startZone ? `${g.startZone} ` : ''}${g.fromLevel}–${g.toLevel}`, 120)!;

/**
 * leveling_route: our players' recorded runs and, when the asking character (`forCharacter`) has a stored state, a
 * route planned for it (`planned`: its steps, play time and gaps), unless a run to follow was named.
 */
export async function levelingAnswer(db: Db, q: LevelingQuery) {
  const route = await levelingRoute(db, q);
  if (!q.forCharacter || q.character) return route;
  // An exact name or key match first (as createGuide), else the best loose match.
  const found = await findCharacters(db, q.forCharacter);
  const ref = q.forCharacter.trim().toLowerCase();
  const exact = found.filter((c) => c.name.toLowerCase() === ref || c.key.toLowerCase() === ref);
  const me = exact.length === 1 ? exact[0] : found[0];
  const p = me ? await planGuide(db, me.key, q.toLevel) : null;
  if (!me || !p) return route;
  const quests = p.steps.filter((s) => s.action !== 'travel');
  const planned = {
    character: me.name,
    title: plannedTitle(p),
    fromLevel: p.fromLevel,
    toLevel: p.toLevel,
    minutes: Math.round(p.seconds / 60),
    reachedTarget: p.reachedTarget,
    stepCount: p.steps.length,
    questSteps: quests.length,
    travelSteps: p.steps.length - quests.length,
    steps: p.steps.slice(0, ROUTE_STEPS_MAX),
    gaps: [
      ...p.gaps,
      ...(p.steps.length > ROUTE_STEPS_MAX
        ? [`planned route cut to its first ${ROUTE_STEPS_MAX} of ${p.steps.length} steps`]
        : []),
      'planned by the route planner from the character’s stored state: times are estimates',
    ],
  };
  return { planned, ...route };
}
