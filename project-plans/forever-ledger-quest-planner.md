# 🧭 Forever Ledger — Quest atlas + route planner (handmade guides per character)

> Owner: John-Willikers <harlanbmiltonjr@gmail.com> · 2026-10-08 04:34 CDT (America/Chicago)
> Branch `feat/quest-atlas` (phases 1, 2, 4, 5 server-side from `master`); addon work after 0.7.0 merges → PRs →
> merge to `master`. Design: `docs/plans/2026-10-08-quest-atlas-planner-design.md`.

## 🎯 Goal

Guides planned from quest data for one character (where it is, what it has done, level, class, flight paths, hearth):
hub batches, few run-backs, real travel (flights, boats, hearth). Runs become timing data and validation.

## ✅ Decisions (Harlan, 2026-10-08)

1. 📚 Wowhead Forever quest data (giver / turn-in / objective spots / Series), corrected by our uploads.
2. 🌍 Both factions, levels 1–30 first; 60 before launch (Nov 4).
3. 🧙 Class quests for all 9 classes from Wowhead's class lists; always in the player's guide.
4. 🚀 Fetch budget 900/day, 60/hour for this job, then back to 400/25.
5. ⚖️ Level-gated pickups: return only if it pays (XP/min ≥ the route's average).
6. ✈️ Travel planned: walk, mount, learned flight paths, boats / zeppelins, hearthstone.
7. 🧠 Full plan per character (replaces the run replay; run builder stays as fallback).

## 📋 Progress

- ✅ 0 🤝 Design agreed section by section — 2026-10-08 04:34 CDT
- 🟡 1 🔬 Probe 0.6.0 built + reviewed (2026-10-08 04:49 CDT, `cb03f9b`), **waiting on Harlan**: `C_TaxiMap` nodes + learned state, `GetBindLocation`, hearthstone cooldown, mount state,
  transports, every uiMap's size in yards → Harlan runs it
- 🟡 2 📚 Atlas (parser v5 building in parallel, 2026-10-08 04:36 CDT): parser `wowhead@5` (mapper start/end/objectives, series, restrictions) → list pages (9 class + ~40
  zone) → quest pages (starter zones first) → `atlas_quests` → boats list + flight network
- ⏳ 3 🧍 Addon 0.8.0 / schema 10: completed quests, last position, flight paths, bind + hearth, mount, recorded trips,
  `travel` steps (after 0.7.0 merges)
- ⏳ 4 🧠 Planner + travel network (unit tests on hand-made atlases, golden undead 1–6 test)
- ⏳ 5 🧾 Delivery: `createGuide` uses the planner, `leveling_route` planned mode, Discord / admin
- ⏳ 6 🎮 Harlan follows a planned guide in-game

## 🔬 Probe 0.6.0 questions

| Question                                   | Answer |
| ------------------------------------------ | ------ |
| `C_TaxiMap.GetAllTaxiNodes` shape / learned |        |
| Flight time observable (start / end)       |        |
| `GetBindLocation`, hearth item + cooldown  |        |
| Mounted / mount owned                      |        |
| Boat / zeppelin: how a trip shows          |        |
| Map sizes (yards) for all uiMaps           |        |
