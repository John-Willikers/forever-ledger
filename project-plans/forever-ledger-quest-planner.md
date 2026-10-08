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
- ✅ 1 🔬 Probe 0.6.0 run by Harlan (2026-10-08 04:53 CDT), answers below + `CLAUDE.md` (zeppelin + hearth cooldown added 05:04 CDT): `C_TaxiMap` nodes + learned state, `GetBindLocation`, hearthstone cooldown, mount state,
  transports, every uiMap's size in yards → Harlan runs it
- 🟡 2 📚 Atlas: ✅ parser `wowhead@5` reviewed + merged (2026-10-08 05:03 CDT, `a51437d`: mapper start/end/objectives, series, restrictions, hostile-page caps, Forever-only zone lists, series follows) → ✅ deployed + 44 lists queued + 68 pages re-parsed + budget 900/60 live (2026-10-08 05:09 CDT; queued item/NPC pages moved to priority 15 so the atlas goes first) → fetching → parser `wowhead@5` (mapper start/end/objectives, series, restrictions) → list pages (9 class + ~40
  zone) → quest pages (starter zones first) → `atlas_quests` → boats list + flight network
- ⏳ 3 🧍 Addon 0.8.0 / schema 10: completed quests, last position, flight paths, bind + hearth, mount, recorded trips,
  `travel` steps (after 0.7.0 merges)
- ⏳ 4 🧠 Planner + travel network (unit tests on hand-made atlases, golden undead 1–6 test)
- ⏳ 5 🧾 Delivery: `createGuide` uses the planner, `leveling_route` planned mode, Discord / admin
- ⏳ 6 🎮 Harlan follows a planned guide in-game

## 🔬 Probe 0.6.0 questions

| Question                                    | Answer (build 70245, 2026-10-08 04:53 CDT)                                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `C_TaxiMap.GetAllTaxiNodes` shape / learned | Only with a flight master's map open: `state` 0 current, 1 learned, 2 not learned. `GetTaxiNodesForMap` anywhere, no learned flag |
| Flight time observable (start / end)        | Yes: `TakeTaxiNode` hook + `PLAYER_CONTROL_LOST` → `_GAINED` (Org → Splintertree 89.7 s, 30.52 yd/s)          |
| `GetBindLocation`, hearth item + cooldown   | "Undercity"; `C_Item.GetItemCount`, `C_Container/C_Item.GetItemCooldown(6948)`, `C_Spell.GetSpellCooldown(8690)`; **cooldown 3600 s** |
| Mounted / mount owned                       | `IsMounted`, `GetUnitSpeed`; `C_MountJournal` (136 mounts, isCollected = 11th return)                        |
| Boat / zeppelin: how a trip shows           | No events; position moves while `GetUnitSpeed` = 0 (not on a taxi); crossing continents adds a loading screen. Tirisfal → Durotar: ~52 s + 9 s load + arrival |
| Map sizes (yards) for all uiMaps            | 60 maps with world size + world corners; Forever-only maps: Zephras Isle, Darkspear Islands, Riverglades, Shen'dralas, Mount Hyjal |
