# Route Planner Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A pure-TypeScript planner that turns a quest atlas plus one character's state into a leveling guide: hub
batches, objective loops, class quests, level-gated pickups that pay, and real travel (walk, learned flights,
boats / zeppelins, hearthstone).

**Architecture:** New folder `apps/server/src/planner/`, no database access, no I/O: every input is a plain object
(`Atlas`, `CharacterState`, `TravelData`), the output is `PlanStep[]`. Small modules, each with its own vitest file:
geometry (client map catalog → world yards), XP, travel network (Dijkstra on time), stop ordering, availability, hubs,
the planner loop, then the atlas builder that turns `wowhead@5` claims into `AtlasQuest`s. Wiring into `createGuide`,
the addon's `travel` step and character state upload are later phases (design phases 3 and 5).

**Tech Stack:** TypeScript (NodeNext ESM, `.js` import suffixes), vitest, the server package's conventions
(`apps/server/src/knowledge/*.ts` for style). Run tests with `pnpm --filter @forever-ledger/server exec vitest run
test/planner-<name>.test.ts`; whole gate `pnpm check`.

**Design:** `docs/plans/2026-10-08-quest-atlas-planner-design.md`. **Client facts** (build 70245): `CLAUDE.md` probe
rows and `fixtures/real/probe-70245-travel.json` — map catalog (60 uiMaps with world size and world corners), taxi
nodes, speeds (run 7 yd/s, flight 30.52 yd/s), hearth cooldown 3600 s, zeppelin Tirisfal → Durotar ~52 s + 9 s load.

**Rules for every task:** TDD (test first, see it fail, then code). Git identity
`John-Willikers <harlanbmiltonjr@gmail.com>`; branch `feat/route-planner`; each commit ends with a blank line +
`Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Times shown to humans are America/Chicago.
Never commit the untracked files in the repo root. Push with
`GIT_ASKPASS= VSCODE_GIT_ASKPASS_NODE= git -c credential.helper= -c credential.helper='!gh auth git-credential' push`.

---

### Task 1: Types and geometry (map catalog → world yards)

**Files:**

- Create: `apps/server/src/planner/types.ts`, `apps/server/src/planner/maps.ts`, `apps/server/src/planner/geo.ts`
- Create: `apps/server/scripts/planner-maps.ts` (one-off generator, kept for the next probe run)
- Test: `apps/server/test/planner-geo.test.ts`

**Facts.** Each catalog row is `[id, name, mapType, parentMapID, width, height, c0, x0, y0, c1, x1, y1]` (yards; corners
are `GetWorldPosFromMapPos(id, (0,0))` and `(1,1)`; `c` = continent instance). World X grows **north**, world Y grows
**west**. A map position `(u, v)` (0..1, u east, v south) is in world yards:

```
wx = x0 + v * (x1 - x0)
wy = y0 + u * (y1 - y0)
```

Guide / Wowhead coordinates are percent (0..100): divide by 100 first.

**Step 1: types.ts** (the shared vocabulary; later tasks add nothing here without a reason):

```ts
/** A point in the world: continent instance (0 Eastern Kingdoms, 1 Kalimdor, …) and world yards (x north, y west). */
export interface WorldPos {
  continent: number;
  x: number;
  y: number;
}

/** A spot on a client map: uiMapID and percent coordinates (0-100), as guides and the atlas store them. */
export interface MapSpot {
  mapId: number;
  x: number;
  y: number;
}

export type ObjectiveKind = 'kill' | 'collect' | 'object' | 'explore' | 'talk' | 'other';

export interface AtlasObjective {
  index: number;
  kind: ObjectiveKind;
  /** What the quest log says, e.g. "Mindless Zombie slain: 8". */
  text: string;
  count: number;
  /** Where it is done (mob spawns, objects, areas). Empty when unknown. */
  spots: MapSpot[];
  /** Seconds per unit when our players' progress timestamps say so; else the planner's default. */
  secondsEach?: number;
}

export interface AtlasQuest {
  id: number;
  title: string;
  level: number;
  reqLevel: number;
  side: 'Alliance' | 'Horde' | 'both';
  /** null = any class / race. Class and race names as the client's English tokens ('WARLOCK', 'Scourge'). */
  classes: string[] | null;
  races: string[] | null;
  giver: { id: number; name: string; spots: MapSpot[] } | null;
  ender: { id: number; name: string; spots: MapSpot[] } | null;
  /** Quests that must be turned in first (from the Wowhead series). */
  prereqs: number[];
  objectives: AtlasObjective[];
  xp: number;
}

export interface Atlas {
  quests: Map<number, AtlasQuest>;
}

export interface CharacterState {
  level: number;
  /** XP into the current level. */
  xp: number;
  className: string;
  race: string;
  faction: 'Alliance' | 'Horde';
  completed: Set<number>;
  /** Quests in the log now, with objective counts done. */
  log: Map<number, number[]>;
  position: MapSpot;
  /** Flight master node ids the character has learned. */
  flightPaths: Set<number>;
  /** Hearthstone: where it goes (a spot) and when it is ready (seconds from now, 0 = ready). */
  hearth: { spot: MapSpot; readyIn: number } | null;
  mounted: boolean;
}

export type PlanAction = 'travel' | 'accept' | 'complete' | 'turn_in';

export interface PlanStep {
  action: PlanAction;
  /** travel: how ('walk' | 'fly' | 'boat' | 'hearth' | 'learn_flight' | 'set_hearth'). */
  how?: string;
  npc: string | null;
  zone: string | null;
  spot: MapSpot | null;
  quests: { questId: number; title: string; objectives?: string[] }[];
  /** Planned clock at the end of the step (seconds from the start) and the level then. */
  at: number;
  level: number;
  note?: string;
}
```

**Step 2: the generator and maps.ts.** `apps/server/scripts/planner-maps.ts` reads
`fixtures/real/probe-70245-travel.json` (`snapshot.maps.rows`) and writes `apps/server/src/planner/maps.ts`:

```ts
// Generated by apps/server/scripts/planner-maps.ts from fixtures/real/probe-70245-travel.json (probe 0.6.0, build
// 70245). Rows: [id, name, mapType, parentMapID, width, height, c0, x0, y0, c1, x1, y1] (yards). Do not edit by hand.
export const MAP_ROWS: readonly (readonly [
  number,
  string,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
])[] = [
  // … one line per row …
];
```

Run it with `pnpm --filter @forever-ledger/server exec tsx scripts/planner-maps.ts` and commit the output (60 rows).
Skip rows whose corner fields are `false`.

**Step 3: write the failing test** `apps/server/test/planner-geo.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { distance, mapInfo, toWorld } from '../src/planner/geo.js';

describe('planner geometry', () => {
  it('knows the client maps', () => {
    expect(mapInfo(1420)?.name).toBe('Tirisfal Glades');
    expect(mapInfo(1420)?.continent).toBe(0);
    expect(mapInfo(99999)).toBeNull();
  });

  it('turns map percent into world yards (x north, y west)', () => {
    const nw = toWorld({ mapId: 1420, x: 0, y: 0 })!;
    expect(nw).toEqual({ continent: 0, x: 3837.5, y: 3033.3 });
    const se = toWorld({ mapId: 1420, x: 100, y: 100 })!;
    expect(se.x).toBeCloseTo(825, 1);
    expect(se.y).toBeCloseTo(-1485.4, 1);
  });

  it('measures yards on one map like the arrow does', () => {
    // Harlan's probe walk (2026-10-07): map y 0.6551 → 0.6322 on Tirisfal is ~69 yd north.
    const a = toWorld({ mapId: 1420, x: 31.76, y: 65.51 })!;
    const b = toWorld({ mapId: 1420, x: 31.76, y: 63.22 })!;
    expect(distance(a, b)).toBeCloseTo(69, 0);
  });

  it('measures across maps of one continent and refuses across continents', () => {
    const brill = toWorld({ mapId: 1420, x: 61, y: 52 })!;
    const uc = toWorld({ mapId: 1458, x: 50, y: 50 })!;
    expect(distance(brill, uc)).toBeGreaterThan(100);
    expect(distance(brill, uc)).toBeLessThan(1000);
    const org = toWorld({ mapId: 1454, x: 50, y: 50 })!;
    expect(distance(brill, org)).toBe(Infinity);
  });
});
```

**Step 4: run it** → FAIL (module missing).

**Step 5: geo.ts**

```ts
import { MAP_ROWS } from './maps.js';
import type { MapSpot, WorldPos } from './types.js';

export interface MapInfo {
  id: number;
  name: string;
  parent: number;
  continent: number;
  width: number;
  height: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const MAPS = new Map<number, MapInfo>(
  MAP_ROWS.map(([id, name, , parent, width, height, c0, x0, y0, , x1, y1]) => [
    id,
    { id, name, parent, continent: c0, width, height, x0, y0, x1, y1 },
  ]),
);

export const mapInfo = (id: number): MapInfo | null => MAPS.get(id) ?? null;

/** A map spot (percent) in world yards; null when the map is unknown. */
export function toWorld(s: MapSpot): WorldPos | null {
  const m = MAPS.get(s.mapId);
  if (!m) return null;
  const u = s.x / 100;
  const v = s.y / 100;
  return { continent: m.continent, x: m.x0 + v * (m.x1 - m.x0), y: m.y0 + u * (m.y1 - m.y0) };
}

/** Straight-line yards; Infinity across continents. */
export function distance(a: WorldPos, b: WorldPos): number {
  if (a.continent !== b.continent) return Infinity;
  return Math.hypot(a.x - b.x, a.y - b.y);
}
```

Round `toWorld` output only in tests (`toBeCloseTo`) — never in code. If the first test's exact `toEqual` fails on
float noise, switch it to `toBeCloseTo` per field.

**Step 6: run** → PASS. **Step 7: commit** `feat(planner): types and map geometry from the client map catalog`.

---

### Task 2: XP and levels

**Files:** Create `apps/server/src/planner/xp.ts`; Test `apps/server/test/planner-xp.test.ts`.

**Facts (Classic 1.12; Forever uploads may override later):**

- XP to next level, levels 1–29: `400, 900, 1400, 2100, 2800, 3600, 4500, 5400, 6500, 7600, 8800, 10100, 11400, 12900,
14400, 16000, 17700, 19400, 21300, 23200, 25200, 27300, 29400, 31700, 34000, 36400, 38900, 41400, 44300`. Level cap
  30 on the beta (CLAUDE.md): at the cap XP gain is 0.
- Quest XP by level difference `d = playerLevel - questLevel`: d ≤ 5 → 100 %, 6 → 80 %, 7 → 60 %, 8 → 40 %, 9 → 20 %,
  ≥ 10 → 10 %; round down to the nearest 5 XP (Classic rounds; keep it simple: `Math.floor(x / 5) * 5`).
- Grey quest: `questLevel < playerLevel - greyGap(playerLevel)` with `greyGap = level <= 5 ? 5 : level <= 39 ? 5 +
Math.floor(level / 10) : …` (only 1–30 matters now; leave a comment for 40+).
- Mob kill XP (same level, Azeroth): `45 + 5 * mobLevel` (use the quest level as the mob level; a planning estimate).

**Step 1: failing tests** — `xpToNext(1) === 400`, `xpToNext(30) === 0`; `questXp(1000, 10, 15) === 1000`,
`questXp(1000, 10, 16) === 800`, `questXp(1000, 10, 25) === 100`; `isGrey(5, 12) === true`, `isGrey(8, 12) === false`;
`mobXp(10) === 95`; `gain({ level: 1, xp: 300 }, 250)` → `{ level: 2, xp: 150 }`; a gain crossing two levels; a gain at
the cap stays at 30 with xp 0.

**Step 2–4: implement** `xpToNext(level)`, `questXp(baseXp, questLevel, playerLevel)`, `isGrey(questLevel, playerLevel)`,
`mobXp(mobLevel)`, `gain(state: { level: number; xp: number }, xp: number, cap = 30)` (pure, returns a new object).

**Step 5: commit** `feat(planner): Classic XP table, quest XP scaling, grey quests, kill XP`.

---

### Task 3: Travel network (walk, flights, boats, hearth)

**Files:** Create `apps/server/src/planner/travel.ts`, `apps/server/src/planner/transports.ts`; Test
`apps/server/test/planner-travel.test.ts`.

**Facts.** Run 7 yd/s on foot (mounted: 14 yd/s, Classic 100 % mount; only when `CharacterState.mounted`). Flights:
30.52 yd/s; in Classic any learned node reaches any other learned node of the same continent and faction (multi-hop is
automatic), so a flight edge exists between every pair of learned nodes on one continent; time = straight distance ×
1.25 (route detour) / 30.52 + 15 s (take-off / landing). Calibrate with the probe: Orgrimmar → Splintertree Post took
89.7 s (`fixtures/real/probe-70245-travel.json` trip 1; node positions in `snapshot.taxi["1414"].forMap.nodes` are
continent-map 1414 coords 0..1 → `toWorld({mapId: 1414, x: 100*px, y: 100*py})`); keep the test tolerant (±40 %) and
write the measured ratio in a comment. Hearth: from anywhere to `hearth.spot`, 10 s cast + 10 s load, only when
`readyIn` ≤ the planner clock; afterwards ready again 3600 s later.

**transports.ts** — hand-curated Classic transports (data, not code). Each:
`{ name, kind: 'zeppelin' | 'boat', a: MapSpot, b: MapSpot, crossing: number, wait: number, faction: 'Horde' |
'Alliance' | 'both', confidence: 'measured' | 'guess' }`. Include at least: Tirisfal (Undercity) ↔ Durotar (Orgrimmar)
zeppelin — `a` = `{ mapId: 1420, x: 60.7, y: 58.8 }` (Harlan boarded there), `crossing` 70, `wait` 150, measured;
Tirisfal ↔ Grom'gol (Stranglethorn), Durotar ↔ Grom'gol, Booty Bay ↔ Ratchet, Menethil ↔ Theramore, Menethil ↔
Auberdine, Auberdine ↔ Rut'theran Village — with best-known coordinates and `confidence: 'guess'` (comment: replace
from atlas NPC spots / recorded trips).

**travel.ts API:**

```ts
export interface TravelData {
  /** Flight master nodes: id, name, faction ('Horde' | 'Alliance' | 'both'), spot on a client map. */
  flightNodes: { id: number; name: string; faction: string; spot: MapSpot }[];
  transports: Transport[];
}
export interface Leg {
  how: 'walk' | 'fly' | 'boat' | 'hearth';
  from: MapSpot;
  to: MapSpot;
  seconds: number;
  note?: string;
}
/** Fastest way from one spot to another at clock `now`; hearth only if ready by then. */
export function route(
  from: MapSpot,
  to: MapSpot,
  ch: Pick<CharacterState, 'faction' | 'flightPaths' | 'hearth' | 'mounted'>,
  data: TravelData,
  now: number,
): { seconds: number; legs: Leg[] } | null;
```

Implementation: build a small graph per call — nodes = `from`, `to`, the character's learned flight nodes of its
faction (or 'both'), transport ends of its faction (or 'both'), the hearth spot; edges = walk between any two nodes on
one continent (distance / speed), fly between learned nodes on one continent, transport a↔b (`wait + crossing`),
hearth `from → hearth.spot` when ready. Dijkstra on seconds (the graph has < 100 nodes; a simple O(n²) Dijkstra is fine).
Merge consecutive walk legs. `null` when unreachable (e.g. another continent with no transport).

**Step 1: failing tests** (hand-made `TravelData`, real map ids):

1. Same map, no flights: one walk leg, seconds = yards / 7.
2. Two learned nodes far apart on Kalimdor: route uses walk → fly → walk and is faster than walking.
3. An unlearned node is never used (`flightPaths` without it → walk only).
4. Another continent: Tirisfal → Durotar uses the zeppelin (boat leg) — Horde only; an Alliance character gets null
   (no Alliance transport in that test data).
5. Hearth: ready (readyIn 0) and the bind spot is next to the target → a hearth leg; `readyIn` 1800 with `now` 0 → no
   hearth leg; same with `now` 1800 → hearth leg.
6. Calibration: Orgrimmar → Splintertree Post flight estimate within ±40 % of 89.7 s (positions from the fixture).

**Step 2–4: implement, run, pass. Step 5: commit** `feat(planner): travel network — walk, learned flights, transports,
hearth`.

---

### Task 4: Stop order (objective loop)

**Files:** Create `apps/server/src/planner/tour.ts`; Test `apps/server/test/planner-tour.test.ts`.

`orderStops<T extends { pos: WorldPos }>(start: WorldPos, stops: T[], end: WorldPos | null): T[]` — nearest-neighbor
from `start`, then 2-opt improvement (open path to `end` if given, else open path). Stops on another continent than
`start` keep their relative order at the end (the travel network handles them). Tests: points on a line come out in
line order; a square visited without crossing (total length ≤ the NN order's); `end` near the first stop reverses the
order; empty and single-stop inputs. Commit `feat(planner): nearest-neighbour + 2-opt stop order`.

---

### Task 5: Availability

**Files:** Create `apps/server/src/planner/available.ts`; Test `apps/server/test/planner-available.test.ts`.

`canTake(q: AtlasQuest, ch: { level, className, race, faction, completed, log }, level: number): boolean` — side
(`'both'` or the faction), classes / races (null = any), not completed, not in the log, every prereq completed,
`level >= q.reqLevel`, not grey for `level`, `q.level <= level + 3`. `isClassQuest(q)` = `q.classes !== null &&
q.classes.length < 9`. Tests: one per rule, plus a class quest for the right class (taken) and wrong class (not), a
chain (B needs A), a quest 4 levels up (not yet), a grey quest (skipped). Commit
`feat(planner): which quests a character can take`.

Class quests (`isClassQuest`) skip the grey and +3 rules but still need `reqLevel` (Harlan: class quests always). Order:
`reqLevel` → class quest → grey → +3.

---

### Task 6: Hubs

**Files:** Create `apps/server/src/planner/hubs.ts`; Test `apps/server/test/planner-hubs.test.ts`.

`buildHubs(atlas: Atlas): Hub[]` with `Hub = { id: number; pos: WorldPos; spot: MapSpot; name: string;
givers: number[] /* quest ids */; enders: number[] }` — single-link clustering of every giver and ender spot (first spot
of each) within 150 yd on one continent; hub position = centroid; name = the most common giver/ender NPC zone + subzone
is not known, so use the first NPC's name ("near Deathguard Simmer") until subzones are in the atlas. Tests: three NPCs
within 50 yd make one hub; one 400 yd away makes another; another continent never joins; a quest given and ended at
different hubs is listed in both. Commit `feat(planner): quest hubs`.

---

### Task 7: The planner loop

**Files:** Create `apps/server/src/planner/plan.ts`; Test `apps/server/test/planner-plan.test.ts` (+ a small
`apps/server/test/planner-fixtures.ts` builder for hand-made atlases).

`plan(atlas: Atlas, ch: CharacterState, travel: TravelData, opts: { toLevel: number; maxSteps?: number }): { steps:
PlanStep[]; gaps: string[]; seconds: number; xp: number }`

Simulation state: clock (s), position (MapSpot), level + xp, log (quest → objectives done), completed, hearth readiness.
Defaults: kill objective `secondsEach` 30 s per unit, collect 40 s, object 20 s, explore / talk 0 s + travel, missing
spots → the giver's spot with a gap line ("no objective spots for Quest X: done near the giver").

Loop until `level >= toLevel` or no work or `maxSteps` (default 300):

1. **Candidate hubs:** hubs with takeable quests (Task 5 at the current level) or turn-ins of finished log quests. For
   each: travel (Task 3) + accept all takeable there + their objectives' time (objective loop, Task 4) + return + turn
   in → expected XP (quest XP Task 2 + kill XP) per minute. Pick the best. Class quests for the character's class get a
   ×2 score bonus (Harlan: always do them; they must not lose to normal quests).
2. **Emit** travel steps (one per leg, `how` from the leg: 'walk' legs only when they cross maps or exceed 200 yd, else
   folded into the next step), `accept` (all quests from one NPC in one step), `complete` (one step per objective stop,
   listing the quests done there), `turn_in` (all turn-ins at one NPC in one step), with `at` and `level` filled.
3. **Objective loop:** stops = spots of every log quest whose objectives are within 600 yd of the hub (so quests from
   earlier hubs done on the way join), ordered by Task 4 from the hub back to the hub.
4. **Turn in** everything finished at this hub; accept follow-ups (prereqs now done) and loop on the same hub while it
   has work.
5. **Level-gated pickups:** a quest whose only reason not to be taken was `reqLevel` / too-high level is remembered with
   its hub. When the level allows it and the character is elsewhere, schedule the trip only if `(its XP + XP of every
other turn-in / pickup at that hub) / (round-trip travel + its objective time) ≥ the run's XP per minute so far`;
   else drop it (gap line "skipped Quest X: not worth the trip").
6. **Class quests:** when a class quest becomes takeable anywhere, it is taken in the next decision even if far (travel
   uses flights / boats / hearth); write `note: 'class quest'` on its steps.
7. **Set hearth:** when leaving a hub the plan returns to later (any remembered pickup or turn-in there) and an innkeeper
   spot is known for it — out of scope until the atlas has innkeepers; add a gap line instead.

**Tests (hand-made atlases, real map ids so geometry works):**

1. Hub of 3: three quests from two NPCs 30 yd apart with objectives 300 yd north → steps: accept, accept, complete
   (one loop, nearest first), turn_in (one step per NPC) — exactly one trip out and back.
2. Chain: B needs A, both at one hub → A accepted, done, turned in, then B accepted in the same visit.
3. Two hubs 1,500 yd apart: the planner finishes hub 1 before moving; the quests ending at hub 2 are turned in when
   arriving there.
4. Level-gated, pays: a reqLevel 3 quest at hub 1 while level 2; hub 2 work takes the character to 3; the return trip is
   short and the quest XP high → the plan goes back for it. Doesn't pay: same with hub 2 4,000 yd away and low XP →
   dropped with a gap line.
5. Class quest: a WARLOCK quest whose giver is on another continent's map with a zeppelin in TravelData → planned for a
   warlock (travel steps include a boat leg), never for a warrior.
6. Flight beats walking: two hubs 5,000 yd apart with learned flight nodes next to both → a `fly` travel step.
7. Hearth on cooldown: bind next to hub 1, `readyIn` 3600 → no hearth leg within the first hour of plan time.
8. Stops at `toLevel`; `maxSteps` respected; an empty atlas → no steps and a gap line.

Commit `feat(planner): route loop — hub batches, objective loops, class quests, level-gated pickups that pay`.

---

### Task 8: Atlas builder (claims → AtlasQuest)

**Files:** Create `apps/server/src/planner/atlas-build.ts` (pure: claim rows in, `Atlas` out) and
`apps/server/src/knowledge/atlas-load.ts` (reads claims + our own quest observations from Postgres); Test
`apps/server/test/planner-atlas-build.test.ts` (pure, hand-made claim rows shaped like `wowhead@5` output — read
`apps/server/src/knowledge/parsers/wowhead-quest.ts` for the exact claim shapes).

- Wowhead zone → uiMapID by **name** against `mapInfo` names (normalise case / apostrophes: Wowhead "Zephras Isle" vs
  client "Zephras Isle"); unmapped zones go to `gaps` and their spots are dropped.
- Best claim per field: our own observations (tier 1: quest giver / turn-in NPC and spots from `quest_observations`
  `npc_loc` / `loc`, objective spots from `quest_objective_progress`, XP from `turn_ins`) beat Wowhead's; among Wowhead
  claims prefer VERIFIED over CLASSIC.
- `prereqs` = the quest just before it in its `series` (a faction-split step uses the step entry for the character's
  side — keep both, the planner filters by side).
- `classes` / `races` names → client tokens ('Warlock' → 'WARLOCK', 'Undead' → 'Scourge').
- Tests: a quest from claims only; our observation overrides Wowhead's giver spot; a series of 3 gives prereqs; an
  unmapped zone gives a gap; Classic vs Forever label preference.

Commit `feat(planner): build the atlas from wowhead@5 claims and our observations`.

---

### Task 9: Review, PR

1. `pnpm check` green.
2. Code review (superpowers:requesting-code-review) of the whole branch.
3. PR `feat(planner): route planner (phase 4)` to `master` with the 🤖 footer; merge after CI. Update
   `project-plans/forever-ledger-quest-planner.md` progress (America/Chicago time).
4. Not in this plan: golden undead 1–6 test against Rot's run (needs the fetched atlas — do it in the delivery phase),
   `createGuide` wiring, addon `travel` steps, character state upload.
