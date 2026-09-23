# 🛠️ Forever Ledger — Professions (addon 0.3.0, schema 4)

> Owner: John-Willikers <harlanbmiltonjr@gmail.com> · Approved 2026-09-23 (America/Chicago) · Branch `feat/professions`

## 📌 Context

The user wants professions tracked: skills and ranks, recipes, crafts and gathering, and where recipes come from
(trainers, vendors, drops). The build 69913 API dump shows Forever runs the **retail (Dragonflight-style) profession
system**: `C_TradeSkillUI` (recipe info/schematics, crafted-result events), `C_SkillInfo` skill lines, trainer and
vendor APIs (`C_MerchantFrame.GetItemInfo`), crafting quality/concentration and `C_ProfSpecs` also exist. The Classic
craft globals (`GetTradeSkillInfo`, `GetCraftInfo`, global `GetSkillLineInfo`, `GetMerchantItemInfo`) are **absent**.
The dump names structs like `ProfessionInfo`, `TradeSkillRecipeInfo`, `CraftingRecipeSchematic`,
`CraftingItemResultData` **without their fields**, so the addon must read fields defensively and we verify on the live
client before trusting the data (see 🧪 API samples).

Constraints: passive observer only (read APIs/events, `hooksecurefunc` post-hooks at most; nothing automated). Forever
doesn't load SavedVariables back, so per-session counters use the 0.2.4 session id and are summed server-side. Any SV
shape change ⇒ schema bump (4), and the rollout order is server → tray app → addon.

**Prerequisite:** addon 0.2.4 (schema 3) is published after the user's tray reaches v0.1.2, and the drop repair
(`scripts/repair/2026-09-23-drop-sessions.sql`) runs. This work starts from that master.

## ✅ Progress checks

Legend: ⬜ todo · 🟡 in progress · ✅ done · ⛔ blocked. Times America/Chicago.

- ✅ 0 Prerequisite — addon 0.2.4 published 17:12 CDT, drop repair run (Linen Cloth back to 6, no legacy rows)
- ✅ 1 📦 Contracts + server + uploader (schema 4) — 17:29 CDT (f940169; 13 tables, migration 0004 dry-run clean on live copy)
- ✅ 2 🧪 Addon: skills, recipes, learned, API samples — 17:38 CDT (cfc5f6e)
- ✅ 3 ⚒️ Addon: crafts + gathering — 17:38 CDT (e20fa8a)
- ✅ 4 🏪 Addon: trainers + vendors — 17:38 CDT (c08d433; 140 Lua tests, old creature data byte-identical)
- ✅ 5 🔖 Addon release plumbing — 17:44 CDT (75c65b1, 2001717; real addon output validates with zero problems across all 13 kinds)
- ✅ 6 📊 Server routes (`/v1/professions/*`) — 17:29 CDT (f17b8d4)
- ✅ 7 🖥️ Tray v0.1.3 — 17:29 CDT (3109503, not released yet)
- ⬜ 8 🚀 Rollout (server → tray → addon 0.3.0)
- ⬜ 9 🔍 Live verification (api_samples, then data)

> Execution note: two parallel lanes in separate worktrees — lane A = phases 1, 6, 7 (TypeScript), lane B = phases
> 2–4 (Lua). Phase 5 happens after both merge, since the fixtures feed the contracts tests.

## 🧭 What gets recorded (SavedVariables, schema 4, all additive)

| SV table | Filled from | Record kind → server table |
|---|---|---|
| `skills[char][skillLineID] = {name, rank, maxRank, modifier, parentID, lastSeen}` | `C_SkillInfo.GetNumSkillLines/GetSkillLineInfo` (documented fields) on login + `SKILL_LINES_CHANGED`; profession details from `C_TradeSkillUI.GetProfessionInfoBySkillLineID` when a window is open | `skill` → `skills` (char+skillLine, upsert) |
| `skillUps[] = {char, skillLineID, from, to, build, time, recipeID?}` (cap 2000) | rank delta on `SKILL_LINES_CHANGED`; `recipeID` = last craft/gather within 5 s | `skillUp` → `skill_ups` |
| `recipes[recipeID] = {name, skillLineID, categoryID, byBuild[build] = {outputItemID, qtyMin, qtyMax, reagents[], maxTrivial?, sourceText?}}` | `TRADE_SKILL_SHOW`/`LIST_UPDATE` (throttled, only own profession: skip when `IsTradeSkillLinked/Guild`, `IsNPCCrafting`, `IsDataSourceChanging`) → `GetAllRecipeIDs` → `GetRecipeInfo` + `GetRecipeSchematic` once per recipe per build; reagent/output items go through `scanItem` | `recipe` (keepKnown) + `recipeSnapshot` (recipe+build) |
| `recipeSeen[build][char][recipeID] = {learned, rank, difficulty, numSkillUps}` → per difficulty keep `minRank/maxRank` | same scan; `relativeDifficulty` at the character's current rank ⇒ over time gives the orange/yellow/green/gray thresholds | `recipeDifficulty` (recipe+build+char+difficulty: minRank, maxRank) |
| `learned[] = {char, recipeID, build, time, via = "trainer:<npcID>" / "item:<itemID>" / "unknown"}` | `NEW_RECIPE_LEARNED` (+ trainer window open, or a Recipe-class item used in the last 5 s) | `recipeLearned` |
| `crafts[build][recipeID] = {casts, qty, procs, skillUps}` (per session) | `TRADE_SKILL_CRAFT_BEGIN` + `TRADE_SKILL_ITEM_CRAFTED_RESULT` (quantity, multicraft/crit); fallback `UNIT_SPELLCAST_SUCCEEDED` with `UnitCastingInfo(...).isTradeskill` and "You create" lines (`LOOT_ITEM_CREATED_SELF*` templates, same pattern builder as 0.2.4) | `craft` → `crafts` (recipe+build+uploader+account+session) |
| `nodes[build][objectID] = {opened, name?, rankMin, mapIDs{}, spots[] (cap 50/zone, 1-unit dedupe)}` + `nodeLoot[item][build][objectID] = {n, qty}` (per session) | loot windows whose source GUID is `GameObject-…` (today `npcIDFromGUID` drops these to npc 0); `IsFishingLoot()` → pseudo object 0 keyed by mapID; player position + gathering skill rank at loot time | `node` + `nodeLoot` (per session, like `corpses`/`drops`) |
| `trainers[build][npcID] = {name, loc, profession, services[] = {name, type, cost, skill, skillRank, level}}` | `TRAINER_SHOW`/`TRAINER_UPDATE` when `IsTradeskillTrainer()`; `GetNumTrainerServices` + `GetTrainerService{Info,Cost,SkillReq,LevelReq,ItemLink}` | `trainer` (npc+build, replaced whole) |
| `vendors[build][npcID] = {name, loc, items[] = {itemID, price, stack, numAvailable, currency?}}` | `MERCHANT_SHOW`/`UPDATE`: `GetMerchantNumItems` + `C_MerchantFrame.GetItemInfo` + `GetMerchantItemID`; every item → `scanItem` (tooltip already captures "Teaches you how to…") | `vendor` (npc+build, replaced whole) |
| `items[id].classID/subclassID` (new optional fields) | `C_Item.GetItemInfo` returns 12/13 | `items.class_id/subclass_id` (keepKnown) — lets the server find Recipe-class drops |
| `apiSamples[api] = {build, time, sample}` (1 per API per build, strings trimmed) | first successful call of each profession API / event payload above | `apiSample` → `api_samples` — so we can check real field names on the server without asking the user for files |

Nudge counts new records; `/fl` status shows professions/recipes/nodes counts; `reset confirm` wipes the new tables.

## 🗺️ Implementation phases (branch `feat/professions`, one PR per phase, merge only when all checks are green)

1. **📦 Contracts + server + uploader (schema 4):** zod schemas for the 11 kinds above in `packages/contracts/src/schemas.ts` (added to `Records` before `runs`), `SCHEMA_VERSION = 4`, `SUPPORTED_SCHEMA_VERSIONS = [1,2,3,4]` + the separate `schemaVersion` union; `normalize.ts` readers (reuse `entries/list/child/num`, `add()`); `keys.ts` cases (session suffix for `craft`, `node`, `nodeLoot`); `emptyRecords()` in `apps/uploader/src/batches.ts`; server tables in `apps/server/src/db/schema.ts` following `drops`/`corpses` (per-session) and `questObservations`/`itemSnapshots` (natural keys), migration `0004_professions` via `db:generate` (inspect SQL), ingest blocks in `apps/server/src/ingest.ts` (`upsert` with `keepKnown` for `recipes`/`items`), `EXPORT_TABLES`, tests (ingest per kind, 409 for schema 5, CSV headers).
2. **🧪 Addon: skills, recipes, learned, API samples:** in `addon/ForeverLedger/ForeverLedger.lua` — `initDB` defaults, a defensive `field(t, ...)` reader that tries retail field names and records misses in `apiSamples`, scan throttle, `.luacheckrc` globals. Harness stubs in `addon/tests/harness.lua` (`C_SkillInfo`, `C_TradeSkillUI`, events), new `test_professions.lua` added to `run.lua`.
3. **⚒️ Addon: crafts + gathering:** craft counters and skill-up attribution; GameObject sources in `onLootOpened`/`lootSources` (extend `npcIDFromGUID` into a source parser returning `{kind="npc"|"object"|"fishing", id}`; creature behaviour unchanged); node spots/rank.
4. **🏪 Addon: trainers + vendors:** frame scans, NPC id from `UnitGUID("npc")`, location via existing `where()`.
5. **🔖 Addon release plumbing:** copy 0.2.4 to `addon/tests/legacy/ForeverLedger-0.2.4.lua`, generate `session-v3.lua` from it and `session-v4.lua` from 0.3.0, update test_ledger/test_migration/test_nudge asserts (top-level keys, record counts, schema 4), VERSION 0.3.0 in `.lua`/`.toc`, README addon section.
6. **📊 Server routes** in `apps/server/src/routes/analysis.ts`: `GET /v1/professions/recipes?skillLine=&build=` (reagents, output, observed difficulty thresholds, how learned), `GET /v1/professions/sources?itemId=|recipeId=` (trainers with cost/rank, vendors with price/stock, drop sources via `items.class_id = 9`), `GET /v1/professions/gathering?build=` (node types: opens, yield per open, min rank seen, zones). Tests in `apps/server/test/analysis.test.ts`.
7. **🖥️ Tray v0.1.3:** bump `apps/desktop/package.json` (bundles the schema-4 contracts).
8. **🚀 Rollout:** deploy server (migration 0004 runs at startup; pg_dump backup first) → tag `v0.1.3` → user updates tray (check the v0.1.3 installer download count before continuing) → tag `addon-v0.3.0` → `addon-cli publish 0.3.0`.

Each addon phase ends with a reviewer pass (spec + quality); the schema/server phase gets a migration dry run on a restored copy of the live DB, as for 0.2.4.

## ✅ Verification

- `pnpm check` (luacheck, Lua harness incl. new `test_professions.lua`, vitest incl. real-Postgres ingest/analysis tests) on every PR; CI Linux + Windows smoke green before each merge.
- Migration 0004 dry run: restore the latest `~/backups/forever-ledger/*.sql.gz` into a throwaway `postgres:18-alpine`, run `runMigrations`, check tables and that old rows are untouched.
- Live, after publish: user opens a profession window, a trainer and a vendor, crafts a few items, gathers a few nodes, `/reload`. On the server: `api_samples` rows show the real field names (fix readers if any are nil), then `skills`, `recipes`/`recipe_snapshots`, `crafts`, `nodes`/`node_loot`, `trainers`, `vendors` have rows; `/v1/professions/*` routes return sensible data.
- Progress checks updated live in `project-plans/forever-ledger-professions.md`; ntfy at milestones.

## ⚠️ Risks / open points

- Retail field names are unverified on Forever → defensive readers + `apiSamples`; a quick 0.3.1 may follow to fix a reader.
- `TRADE_SKILL_ITEM_CRAFTED_RESULT` may not fire for Classic-style crafts → fallbacks (spellcast + "You create").
- Recipe item → recipe mapping (e.g. "Pattern: X" teaches recipe X) is done server-side by name/learn events, not guaranteed for every item.
- Required skill for a node is inferred as the lowest rank seen gathering it (no tooltip parsing).

## 📐 Appendix — exact shapes (both lanes build against this)

**SavedVariables (addon writes, schema 4).** `char` = `Name-Realm` (`charKey()`), `build` = number, times = epoch secs.
Difficulty strings are the lower-cased `Enum.TradeskillRelativeDifficulty` key (`optimal`, `medium`, `easy`,
`trivial`), or the number as a string if the enum is missing. Session = `db.meta.session` (per-session tables below).

```lua
db.skills[char][skillLineID] = { name=, rank=, maxRank=, modifier=, parentID=, lastSeen= }
db.skillUps = { { char=, skillLineID=, from=, to=, build=, time=, recipeID= }, ... }            -- cap 2000
db.recipes[recipeID] = { id=, name=, skillLineID=, categoryID=,
  byBuild = { [build] = { outputItemID=, qtyMin=, qtyMax=, reagents = { { itemID=, qty= }, ... },
                          maxTrivial=, sourceText=, firstSeen= } } }
db.recipeSeen[build][char][recipeID] = { learned=, difficulty=, rank=, seenAt=,
  byDifficulty = { [difficulty] = { minRank=, maxRank= } } }
db.learned = { { char=, recipeID=, build=, time=, via= }, ... }   -- via "trainer:<npcID>" | "item:<itemID>" | "unknown"; cap 2000
db.crafts[build][recipeID] = { casts=, qty=, procs=, skillUps= }                                 -- per session
db.nodes[build][objectID] = { opened=, name=, rankMin=, skillLineID=, spots = { [mapID] = { "x,y", ... } } }  -- per session; fishing = objectID 0; ≤50 spots per map
db.nodeLoot[itemID][build][objectID] = { n=, qty= }                                             -- per session
db.trainers[build][npcID] = { name=, loc=, skillLineID=, seenAt=,
  services = { { name=, type=, cost=, skill=, skillRank=, level=, itemID= }, ... } }
db.vendors[build][npcID] = { name=, loc=, seenAt=,
  items = { { itemID=, price=, stack=, numAvailable=, currencyID=, extendedCost= }, ... } }
db.items[itemID].classID / .subclassID                                                           -- new optional fields
db.apiSamples[api] = { build=, time=, sample= }   -- api e.g. "C_TradeSkillUI.GetRecipeInfo"; sample = the returned table,
                                                  -- depth ≤ 2, ≤ 60 keys, strings ≤ 200 chars, functions/userdata dropped
```

`loc` is the table `where()` already returns (`zone, subzone, mapID, x, y`).

**Records (contracts, camelCase; `itemID`→`itemId` etc.).** Order in `Records`: after `corpses`, before `runs`.

| kind | fields | key (`keys.ts`) |
|---|---|---|
| `skills` | char, skillLineId, name, rank, maxRank, modifier?, parentId?, lastSeen | `skill:char:skillLineId` |
| `skillUps` | char, skillLineId, from, to, build, time, recipeId? | `skillup:char:skillLineId:time:to` |
| `recipes` | recipeId, name, skillLineId?, categoryId? | `recipe:recipeId` |
| `recipeSnapshots` | recipeId, build, outputItemId?, qtyMin?, qtyMax?, reagents[{itemId, qty}], maxTrivial?, sourceText? | `rsnap:recipeId:build` |
| `recipeStatus` | recipeId, build, char, learned, difficulty?, rank?, seenAt | `rstat:recipeId:build:char` |
| `recipeDifficulty` | recipeId, build, char, difficulty, minRank, maxRank | `rdiff:recipeId:build:char:difficulty` |
| `recipesLearned` | char, recipeId, build, time, via | `rlearn:char:recipeId:time` |
| `crafts` | recipeId, build, session, casts, qty, procs, skillUps | `craft:recipeId:build` + session suffix |
| `nodes` | objectId, build, session, opened, name?, rankMin?, skillLineId?, spots[{mapId, points[[x,y]]}] | `node:objectId:build` + session suffix |
| `nodeLoot` | itemId, objectId, build, session, count, quantity | `nloot:itemId:objectId:build` + session suffix |
| `trainers` | npcId, build, name?, loc?, skillLineId?, seenAt, services[{name, type?, cost?, skill?, skillRank?, level?, itemId?}] | `trainer:npcId:build` |
| `vendors` | npcId, build, name?, loc?, seenAt, items[{itemId, price?, stack?, numAvailable?, currencyId?, extendedCost?}] | `vendor:npcId:build` |
| `apiSamples` | api, build, time, sample (json) | `api:api:build` |
| `items` (existing) | + classId?, subclassId? | unchanged |

Server tables (snake_case): `skills`, `skill_ups`, `recipes` (keepKnown), `recipe_snapshots` (reagents jsonb),
`recipe_status`, `recipe_difficulty`, `recipes_learned`, `crafts` / `nodes` / `node_loot` (PK includes uploader_id,
account, session like `drops`/`corpses`; nodes.spots jsonb), `trainers` / `vendors` (services/items/loc jsonb, row
replaced), `api_samples` (sample jsonb), `items.class_id/subclass_id`.
