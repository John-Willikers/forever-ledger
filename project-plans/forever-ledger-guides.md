# 🧭 Forever Ledger — In-game guides (objective spots, guide delivery, Zygor-style viewer)

> Owner: John-Willikers <harlanbmiltonjr@gmail.com> · 2026-10-07 21:45 CDT (America/Chicago)
> Branches `feat/objective-spots`, `feat/guide-delivery`, `feat/guide-viewer` → PRs → merge to `master`.

## 🧭 Why

`leveling_route` turns a guildie's real run into a Zygor-style guide, but it only lives in Discord and its "complete"
steps have no location. Goal: ask for a guide in Discord or on the admin page, have it land in the player's game
through the tray, `/reload`, and follow it in a window that moves on as they play.

## ✅ Decisions (Harlan, 2026-10-07)

1. **Anyone in the Discord server can send a guide to any character** the ledger knows; it goes to the tray that
   uploads that character and appears only after that player `/reload`s.
2. **Guides come from our players' real runs** (the `leveling_route` data): real NPCs, coordinates, order, and now
   objective spots. Zones nobody has played get no guide (the request says so).
3. **Viewer v1: a step window with auto-advance** (current step, objectives with live counts, NPC and coordinates,
   back / next, a map-pin button); a waypoint arrow comes later.
4. **Asking:** the Discord bot ("@Forever Ledger send Sam Willikers a guide to 20 as an undead") and a **Guides page**
   on the admin panel (build, preview, send, delete).

## 🏗️ Shape

```
Discord / admin page ──▶ server: build guide from a real run (+ objective spots) ──▶ guides table (for a character)
                                                                                         │ GET /v1/guides (upload token)
tray (polls) ──▶ writes AddOns/ForeverLedger_Guides/{ForeverLedger_Guides.toc, Guides.lua} ──▶ /reload
ForeverLedger addon: GuideViewer.lua reads ForeverLedgerGuidesData, shows the steps, advances on quest events
```

- **Objective spots (schema 9, addon 0.6.0):** each time a quest objective's count goes up (`QUEST_WATCH_UPDATE` →
  `QUEST_LOG_UPDATE`, compared with the last read), `db.objectiveProgress[#+1] = { build, char, questID, index, text,
  have, need, time, mapID, zone, subzone, x, y }`. Server table `quest_objective_progress`; a guide's "complete" step
  gets the middle of where that objective was progressed (by the route's character first, then anyone).
- **Guide document (contracts `GuideDoc`):** `{ id, char, title, createdAt, fromLevel, toLevel, basedOn, steps: [{
  action, npc, zone, subzone, mapId, x, y, quests: [{ questId, title, objectives }], levelAfter }] }`.
- **Delivery:** `guides` table (target character key, the tray token that uploads it, doc, requested by, created,
  delivered). `GET /v1/guides` (upload token) lists that tray's guides; the tray writes them as a generated data addon
  `ForeverLedger_Guides` (Lua literal only, every string escaped; Interface number copied from the installed
  ForeverLedger.toc) and acks. The game loads it at the next `/reload` or login.
- **Viewer (`GuideViewer.lua` in ForeverLedger):** picks the newest guide for the logged-in character, skips steps
  already done (`IsQuestFlaggedCompleted`, `IsOnQuest`, `ReadyForTurnIn`), advances on `QUEST_ACCEPTED`,
  `QUEST_TURNED_IN` and objective updates; position per character in `## SavedVariablesPerCharacter:
  ForeverLedgerGuideState` (a separate file the uploader never reads). `/fl guide` show / hide / list / use N / next /
  back / reset. It only shows things and sets a map pin when clicked: no automation.
- **Requests:** MCP `send_guide(character, start, toLevel, fromLevel?)` (any read token; a few per character per hour),
  used by the bot; admin page Guides (list, build + preview, send, delete).
- **Release:** tray v0.3.0 (schema 9 + guide delivery), then addon 0.6.0 (schema 9 + viewer).

## ✅ Progress checks

Legend: ⬜ todo · 🟡 in progress · ✅ done · ⛔ blocked. Times America/Chicago.

- ✅ 0 📝 Plan and decisions — 21:45 CDT; Forever API checked in the dump (QUEST_WATCH_UPDATE,
  C_QuestLog.GetQuestObjectives / IsQuestFlaggedCompleted / ReadyForTurnIn, C_Map.SetUserWaypoint,
  C_SuperTrack.SetSuperTrackedUserWaypoint all present)
- ✅ 1 🎯 Objective spots: addon 0.6.0 records each objective increment (`QUEST_WATCH_UPDATE` → read on the next
  `QUEST_LOG_UPDATE` or 0.5 s later; baselines at login and on accept), `test_objectives.lua`, `session-v9.lua`,
  0.5.0 frozen (session-v8 byte-identical); contracts schema 9 `ObjectiveProgress`; migration 0020
  `quest_objective_progress`; guide "complete" steps placed at the middle of the route character's own increments
  (else anyone's), per objective, and every step carries `mapId`/`x`/`y` for a map pin — 22:03 CDT (PR #66)
- ✅ 2 📦 Guide delivery: contracts `GuideDoc`; migration 0021 `guides` (target character, the tray token whose
  uploads carry it, doc, requested by, delivered, deleted); `createGuide` (exact character, its tray, 6 per hour,
  newest 5 kept, already-done quests left out, preview mode); `GET /v1/guides` + `POST /v1/guides/ack` (upload
  token); admin `GET/POST /admin/api/guides` + delete and a **Guides** page (build, preview, send, list, delete); MCP
  `send_guide` + bot prompt; uploader `syncGuides` writes `ForeverLedger_Guides/{toc, Guides.lua}` (Lua data only,
  every string byte-escaped, Interface copied from ForeverLedger.toc; removed when no guides are left; `no-addon` when
  ForeverLedger isn't installed) and acks; tray checks 1 min after start, then every 5 min, and toasts new guides.
  Fixed the uploader's flaky `renameDirWithRetry` test (its in-place delete raced the rename). `pnpm check` 1115
  tests — 22:14 CDT
- ✅ 3 🖥️ Viewer: `GuideViewer.lua` in ForeverLedger (toc: `## SavedVariablesPerCharacter: ForeverLedgerGuideState`):
  this character's newest guide (full-name key, else first name), steps already behind the player skipped
  (`IsOnQuest` / `IsQuestFlaggedCompleted` / `ReadyForTurnIn`), advances on `QUEST_ACCEPTED` / `QUEST_TURNED_IN` and
  throttled `QUEST_LOG_UPDATE`; Back holds the step until Next or real progress; live objective counts; Pin sets
  `C_Map.SetUserWaypoint` + super-track (falls back to "go to …"); plain frames when BackdropTemplate /
  UIPanelButtonTemplate are missing; `/fl guide show|hide|list|use N|next|back|pin|reset`. `test_guide.lua` (7 tests,
  harness gains UI objects for parented frames); a 0.6.0 zip passes the release check; the uploader never reads the
  per-character file — 22:20 CDT
- ⬜ 4 🔍 Review → PRs → merge → deploy (backup first: migrations)
- ⬜ 5 🚀 Tray v0.3.0, addon 0.6.0; Harlan sends Sam a guide, `/reload`s, and follows a few steps in game

## ⚠️ Risks

- **UI on an unfamiliar client:** Forever's FrameXML templates (BackdropTemplate, UIPanelButtonTemplate) aren't in the
  API dump; the viewer falls back to plain frames if a template is missing. First in-game look may need a fix.
- **Guides only where someone played:** a druid at 30 gets a guide only for zones and levels a guildie has done.
- **The tray writes Lua the game runs:** the data file is generated from a fixed shape with escaped strings only;
  never code, never text from the request.
