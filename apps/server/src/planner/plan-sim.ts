// The planner loop's simulation state (plan.ts): one character's clock, position, level, XP, quest log and hearthstone
// on the way through an atlas, plus the questions the loop asks about it (what is takeable at a hub, which log quests
// one objective loop does, where an objective is done, how long a trip takes). Pure; every mutation is by plan-*.ts.
import { canTake, isClassQuest, type Taker } from './available.js';
import { distance, mapInfo, toWorld } from './geo.js';
import { buildHubs, type Hub } from './hubs.js';
import { route, MOUNT_SPEED, RUN_SPEED, type TravelData } from './travel.js';
import type {
  Atlas,
  AtlasObjective,
  AtlasQuest,
  CharacterState,
  MapSpot,
  ObjectiveKind,
  PlanStep,
  QuestPoint,
  WorldPos,
} from './types.js';
import { gain, isGrey, mobXp } from './xp.js';

export interface PlanOptions {
  toLevel: number;
  /** Stop after this many steps (default MAX_STEPS). */
  maxSteps?: number;
}

export const MAX_STEPS = 300;
/** Seconds per unit of an objective when our players' timestamps don't say. */
export const DEFAULT_SECONDS: Record<ObjectiveKind, number> = {
  kill: 30,
  collect: 40,
  object: 20,
  explore: 0,
  talk: 0,
  other: 30,
};
/** Log quests whose remaining objectives all lie this close (yards) to a hub join its objective loop. */
export const LOOP_RADIUS = 600;
/** A walk on one map shorter than this (yards) is no step of its own: its time folds into the next step. */
export const FOLD_WALK = 200;
/** Objective spots this close (yards) are one stop. */
const STOP_MERGE = 40;
/** Within this many yards of a hub the character is there, not "elsewhere" (level-gated pickups). */
export const AT_HUB = 300;

export interface Part {
  q: AtlasQuest;
  obj: AtlasObjective;
}
export interface Stop {
  pos: WorldPos;
  spot: MapSpot;
  parts: Part[];
}
interface Trip {
  seconds: number;
  hearth: boolean;
}
interface Placed {
  spot: MapSpot;
  pos: WorldPos;
}

export const byId = (a: { id: number }, b: { id: number }) => a.id - b.id;
export const zoneOf = (s: MapSpot) => mapInfo(s.mapId)?.name ?? null;
const spotKey = (s: MapSpot) => `${s.mapId}:${s.x.toFixed(2)}:${s.y.toFixed(2)}`;

export class Sim {
  readonly steps: PlanStep[] = [];
  readonly gaps: string[] = [];
  readonly maxSteps: number;
  readonly toLevel: number;
  readonly speed: number;

  clock = 0;
  pos: MapSpot;
  level: number;
  xp: number;
  /** XP gained since the plan start. */
  gained = 0;
  readonly completed: Set<number>;
  readonly log = new Map<number, number[]>();
  readonly hearth: { spot: MapSpot; readyAt: number } | null;

  /** Hubs by id, and which hub gives / ends each quest (no ender: turned in at the giver). */
  readonly hubs: Hub[];
  readonly giverHub = new Map<number, Hub>();
  readonly enderHub = new Map<number, Hub>();
  /** Level-gated quests not worth a special trip: taken only when the plan is at their hub anyway. */
  readonly noTrip = new Set<number>();
  /** Quests whose objectives or turn-in turned out unreachable: out of the plan. */
  readonly abandoned = new Set<number>();
  /** Level-gated quests left behind: quest id → its giver hub. */
  readonly gated = new Map<number, Hub>();
  /** Hubs a visit made no progress at. */
  readonly stuck = new Set<number>();

  private readonly placed = new Map<string, Placed | null>();
  private readonly routes = new Map<string, Trip | null>();
  /** For the grouped gap lines: quests done near the giver for want of spots, quests the plan took, hubs to bind at. */
  readonly noSpots = new Set<number>();
  readonly taken = new Set<number>();
  readonly hearthHubs = new Set<Hub>();
  private readonly reach = new Map<number, boolean>();

  constructor(
    readonly atlas: Atlas,
    readonly ch: CharacterState,
    readonly travel: TravelData,
    opts: PlanOptions,
  ) {
    this.maxSteps = opts.maxSteps ?? MAX_STEPS;
    this.toLevel = opts.toLevel;
    this.speed = ch.mounted ? MOUNT_SPEED : RUN_SPEED;
    this.pos = ch.position;
    this.level = ch.level;
    this.xp = ch.xp;
    this.completed = new Set(ch.completed);
    this.hearth = ch.hearth ? { spot: ch.hearth.spot, readyAt: ch.hearth.readyAt } : null;
    if (!toWorld(ch.position))
      this.gap(`start position is on an unknown map (${ch.position.mapId})`);
    for (const [id, counts] of [...ch.log].sort((a, b) => a[0] - b[0])) {
      if (atlas.quests.has(id)) {
        this.log.set(id, [...counts]);
        this.taken.add(id);
      } else this.gap(`quest ${id} in the log is not in the atlas: left out`);
    }

    this.hubs = buildHubs(atlas).sort(byId);
    for (const h of this.hubs) {
      for (const id of h.givers) this.giverHub.set(id, h);
      for (const id of h.enders) this.enderHub.set(id, h);
    }
    for (const [id, h] of this.giverHub) if (!this.enderHub.has(id)) this.enderHub.set(id, h);
  }

  gap(line: string): void {
    if (!this.gaps.includes(line)) this.gaps.push(line);
  }

  taker(): Taker {
    return {
      level: this.level,
      className: this.ch.className,
      race: this.ch.race,
      faction: this.ch.faction,
      completed: this.completed,
      log: this.log,
    };
  }

  traveller() {
    return {
      faction: this.ch.faction,
      flightPaths: this.ch.flightPaths,
      hearth: this.hearth,
      mounted: this.ch.mounted,
    };
  }

  here(): WorldPos {
    return toWorld(this.pos) ?? { continent: -1, x: 0, y: 0 };
  }

  /** Gain XP (quest or kills), levelling up on the way. */
  addXp(xp: number): void {
    const next = gain(this, xp);
    this.gained += xp;
    this.level = next.level;
    this.xp = next.xp;
  }

  quest(id: number): AtlasQuest {
    return this.atlas.quests.get(id)!;
  }

  /** Who takes the quest back: its ender when that NPC is on a known map, else its giver. */
  enderOf(q: AtlasQuest): QuestPoint | null {
    const spot = q.ender?.spots[0];
    return q.ender && spot && toWorld(spot) ? q.ender : q.giver;
  }

  /** A class quest for this character's class. */
  isMine(q: AtlasQuest): boolean {
    return isClassQuest(q) && q.classes!.includes(this.ch.className);
  }

  /** Where an objective is done: the spot nearest the quest's turn-in hub; none known → the giver's spot. */
  place(q: AtlasQuest, obj: AtlasObjective): Placed | null {
    const key = `${q.id}:${obj.index}`;
    if (this.placed.has(key)) return this.placed.get(key)!;
    const anchor = (this.enderHub.get(q.id) ?? this.giverHub.get(q.id))?.pos ?? this.here();
    let best: Placed | null = null;
    let bestD = Infinity;
    for (const spot of obj.spots) {
      const pos = toWorld(spot);
      if (!pos) continue;
      const d = distance(anchor, pos);
      if (!best || d < bestD) {
        best = { spot, pos };
        bestD = d;
      }
    }
    if (!best) {
      this.noSpots.add(q.id);
      const spot = (q.giver ?? q.ender)?.spots[0];
      const pos = spot ? toWorld(spot) : null;
      best = spot && pos ? { spot, pos } : null;
    }
    this.placed.set(key, best);
    return best;
  }

  need(o: AtlasObjective): number {
    return Math.max(1, o.count);
  }
  left(q: AtlasQuest, o: AtlasObjective): number {
    return Math.max(0, this.need(o) - (this.log.get(q.id)?.[o.index] ?? 0));
  }
  open(q: AtlasQuest): AtlasObjective[] {
    return q.objectives.filter((o) => this.left(q, o) > 0);
  }
  finished(q: AtlasQuest): boolean {
    return this.log.has(q.id) && this.open(q).length === 0;
  }
  /** Seconds per unit: measured, else the default — doubled when the objective has no known spot (a guess). */
  unitSeconds(o: AtlasObjective): number {
    if (o.secondsEach !== undefined) return o.secondsEach;
    const known = o.spots.some((s) => toWorld(s) !== null);
    return DEFAULT_SECONDS[o.kind] * (known ? 1 : 2);
  }
  objSeconds(q: AtlasQuest, o: AtlasObjective): number {
    return this.left(q, o) * this.unitSeconds(o);
  }
  /** No objectives, or an objective without a known spot: the plan's estimate for it is a guess. */
  dataPoor(q: AtlasQuest): boolean {
    return !q.objectives.length || q.objectives.some((o) => !o.spots.some((s) => toWorld(s)));
  }
  killXp(q: AtlasQuest, o: AtlasObjective): number {
    return o.kind === 'kill' && !isGrey(q.level, this.level) ? this.left(q, o) * mobXp(q.level) : 0;
  }

  logQuests(): AtlasQuest[] {
    return [...this.log.keys()].sort((a, b) => a - b).map((id) => this.quest(id));
  }

  /**
   * Quests the character can take at `hub` now. `trip`: for deciding where to go, so quests not worth a special trip
   * don't count; at the hub they are taken.
   */
  takeable(hub: Hub, trip = false): AtlasQuest[] {
    return hub.givers
      .filter((id) => !this.abandoned.has(id) && !(trip && this.noTrip.has(id)))
      .map((id) => this.quest(id))
      .filter((q) => canTake(q, this.taker(), this.level, this.atlas) && this.reachable(q));
  }

  /**
   * Whether every objective stop and the turn-in of `q` can be routed to from its giver's hub (from the character
   * when the quest has no giver hub). Decided once per quest.
   */
  reachable(q: AtlasQuest): boolean {
    let ok = this.reach.get(q.id);
    if (ok === undefined) {
      const from = this.giverHub.get(q.id)?.spot ?? this.pos;
      const ender = this.enderOf(q)?.spots[0];
      ok =
        ender !== undefined &&
        this.travelSeconds(from, ender) !== null &&
        q.objectives.every((o) => {
          const p = this.place(q, o);
          return p !== null && this.travelSeconds(from, p.spot) !== null;
        });
      this.reach.set(q.id, ok);
    }
    return ok;
  }

  /** Drop `q` from the plan (and the log): its objectives or turn-in can't be reached. */
  abandon(q: AtlasQuest, what: string): void {
    this.log.delete(q.id);
    this.abandoned.add(q.id);
    this.gap(`can't reach ${what} of ${q.title}: abandoned`);
  }

  /** A fingerprint of the quest log and completed set: a visit round that leaves it unchanged did nothing. */
  logState(): string {
    return `${this.completed.size}|${[...this.log].map(([id, c]) => `${id}:${c.join(',')}`).join(';')}`;
  }

  /** Quests of the log plus `extra` that one objective loop from `hub` does. */
  loopQuests(hub: Hub, extra: AtlasQuest[]): AtlasQuest[] {
    const pool = [...this.logQuests(), ...extra].sort(byId);
    return pool.filter((q) => {
      const todo = this.log.has(q.id) ? this.open(q) : q.objectives;
      if (!todo.length) return false;
      if (this.enderHub.get(q.id) === hub) return true;
      return todo.every((o) => {
        const p = this.place(q, o);
        return p !== null && distance(p.pos, hub.pos) <= LOOP_RADIUS;
      });
    });
  }

  /** The stops of `qs`' open objectives (all objectives for `fresh` quests), close spots merged. */
  stopsOf(qs: AtlasQuest[], fresh: Set<number>): Stop[] {
    const stops: Stop[] = [];
    for (const q of qs)
      for (const o of q.objectives) {
        if (!fresh.has(q.id) && this.left(q, o) === 0) continue;
        const p = this.place(q, o);
        if (!p) continue;
        const near = stops.find(
          (st) => st.spot.mapId === p.spot.mapId && distance(st.pos, p.pos) <= STOP_MERGE,
        );
        if (near) near.parts.push({ q, obj: o });
        else stops.push({ pos: p.pos, spot: p.spot, parts: [{ q, obj: o }] });
      }
    return stops;
  }

  /** Route seconds for scoring; null when unreachable. */
  travelSeconds(from: MapSpot, to: MapSpot): number | null {
    return this.trip(from, to)?.seconds ?? null;
  }

  /**
   * A route for scoring (its seconds and whether it burns the hearthstone), cached per (from, to, hearth bucket).
   * The bucket is the hearth's wait rounded up to 5 minutes: a route's time depends on that wait only through the
   * hearth leg, so within one bucket the cached time is off by under 5 min, and only when the hearth is the way.
   * Steps themselves always use a fresh route (plan-emit.ts).
   */
  trip(from: MapSpot, to: MapSpot): Trip | null {
    const h = this.hearth;
    const wait = h ? Math.max(0, h.readyAt - this.clock) : -1;
    const bucket = wait < 0 ? 'n' : wait === 0 ? 'r' : `w${Math.ceil(wait / 300)}`;
    const key = `${spotKey(from)}>${spotKey(to)}|${bucket}`;
    if (!this.routes.has(key)) {
      const r = route(from, to, this.traveller(), this.travel, this.clock);
      this.routes.set(
        key,
        r ? { seconds: r.seconds, hearth: r.legs.some((l) => l.how === 'hearth') } : null,
      );
    }
    return this.routes.get(key)!;
  }
}
