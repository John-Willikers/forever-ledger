# Quest atlas + route planner: design

> Owner: John-Willikers <harlanbmiltonjr@gmail.com> · 2026-10-08 04:34 CDT · agreed with Harlan section by section.
> Plan and live progress: `project-plans/forever-ledger-quest-planner.md`.

## Why

Guides today replay one player's run in time order (`buildGuide` in `apps/server/src/knowledge/leveling.ts`), so they
inherit that player's back-and-forth: do a quest, turn it in, run back. Harlan: plan from **quest data**, not runs.
Know every quest's giver, turn-in and objective spots, then build a guide for _this_ character: where it stands, what
it has done, its level, class, flight paths and hearth. Batch by hub; go back early only for class quests and pickups
that were level-gated, when worth it. Runs become timing / XP data and validation.

## Decisions (Harlan, 2026-10-08)

1. **Quest data from Wowhead Forever** (via the fetcher), corrected by our players' uploads. Chains from Wowhead's
   quest **Series**.
2. **Scope: both factions, levels 1–30** (the beta cap); extend to 60 before launch (Nov 4).
3. **Class quests for every class indexed from Wowhead's class quest lists; always in a guide** for the player's class.
4. **Fetch budget raised for this job:** 900/day, 60/hour (from 400/25), back to 400/25 when the atlas is fetched.
5. **Level-gated pickups:** go back only if it pays (XP per minute at least the route's average), else drop.
6. **Travel is planned:** walking, mounts, learned flight paths, boats / zeppelins, hearthstone (bind + cooldown).
7. **Full plan per character** (supersedes "batch within the run's hubs").

## 📚 Atlas

- **Lists first:** 9 class quest lists + ~40 zone quest lists (Listview JSON: id, name, level, reqlevel, side,
  category). Then **quest pages**, starter zones first.
- **Parser `wowhead@5`** adds, from a quest page:
  - `starts_at` / `ends_at` from the `new Mapper({...})` block: `point: "start" | "end"`, NPC or object id, name,
    Wowhead zone id, `coord` / `coords` (percent).
  - `objective_spots`: the other mapper points (mobs / objects, coords) per objective.
  - `series`: the ordered chain from `<table class="series">` (current quest is the bold, unlinked row).
  - `class` / `race` / `side`, `level`, `req_level`, `xp` (some already parsed).
- **`atlas_quests`**: one row per quest built from the best claim per field (our Forever uploads beat Wowhead's
  Classic-era data): title, level, req_level, side, classes, races, giver and ender (id, name, uiMapID, spots),
  prereq ids, objectives (kind, targets, spots), xp, confidence, sources. Wowhead zone ids map to uiMapIDs via
  `uiMapNames.ts`.

## 🧍 Character state (addon 0.8.0, schema 10)

- `C_QuestLog.GetAllCompletedQuestIDs()` at login and after turn-ins (replaced, not appended).
- Last position at logout (uiMapID, x, y, zone, subzone, time); current quest log with objective progress.
- Known flight paths (`C_TaxiMap` when the flight map opens), bind location (`GetBindLocation`), hearthstone
  cooldown, mount owned / riding.
- Flights and boat trips taken (start, end, duration) to replace estimates with real times.
- `SCHEMA_VERSION` 9 → 10 (contracts) and addon `schemaVersion`; server keeps a `character_state` row per character
  (with its build). No fresh state → fall back to turn-ins + race start zone, said in `gaps`.

## 🧠 Planner (pure TypeScript)

1. **Available quest:** side / race / class allow it, not completed, prereqs done, projected level ≥ req_level, not
   grey, at most ~3 levels above.
2. **Hubs:** givers / enders on one map within ~150 yd (map sizes in yards from the client, probe 0.6.0).
3. **Loop from the last position:** go to the best hub (expected XP per minute incl. travel) → accept all → objective
   loop (spots of every log quest done nearby, nearest-first then smoothed) → turn in all done, accept follow-ups →
   repeat while the hub has work → next hub. Quests ending elsewhere are turned in when passing.
4. **Early returns:** class quests always (inserted when their level is reached); level-gated pickups only if they pay.
5. **Estimates:** quest XP (Classic grey/low-level scaling) + kill XP; time per objective from our
   `quest_objective_progress` timestamps, defaults where missing.

## ✈️ Travel network

Edges: walk (7 yd/s, faster when mounted), learned flight paths (nodes from the client; time estimated by distance,
replaced by recorded flights), boats / zeppelins (hand-curated Classic routes with dock coords, average wait + crossing,
corrected by recordings), hearthstone (bind location, cooldown), unlearned flight masters on the way become "grab the
flight path" steps; "set your hearth here" when a hub will be revisited. Shortest **time** paths.

## 🧾 Output

Same guide steps (accept / complete / turn in) plus **`travel`** (fly / boat / hearth / grab flight path / set hearth)
with coordinates for the arrow. Addon 0.8.0 shows `travel` steps. `createGuide` uses the planner; the run-based builder
stays as fallback; `leveling_route` (Discord / MCP) gains the planned route.

## 🧪 Testing

Unit tests on small hand-made atlases with known best routes (hub of 3, chain, level-gated pickup that pays / doesn't,
flight beats walk, hearth on cooldown, class quest trip). Golden test: undead 1–6 plan covers at least Rot's quests in
less estimated time. In-game: Harlan follows a planned guide for a level or two.

## 📦 Phases

1. 🔬 Probe 0.6.0 (taxi, bind, hearth cooldown, mount, transports, map sizes).
2. 📚 Atlas (parser v5, lists + quest pages, `atlas_quests`, boats, flight network).
3. 🧍 Addon 0.8.0 / schema 10 (after 0.7.0 merges).
4. 🧠 Planner + travel.
5. 🧾 Delivery (createGuide, leveling_route, travel steps).
