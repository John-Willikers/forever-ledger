# 🗺️ Forever Ledger — Guide in Blizzard's quest tracker + waypoint arrow

> Owner: John-Willikers <harlanbmiltonjr@gmail.com> · 2026-10-07 23:31 CDT (America/Chicago)
> Branches `feat/probe-tracker` (probe 0.5.0), then the viewer rework → PRs → merge to `master`.

## 🧭 Why

The guide viewer (`GuideViewer.lua`, PR #66) is its own window. Harlan wants it to feel like the game: the guide's
current quests show in **Blizzard's quest objectives tracker** on the right, and a **TomTom-style arrow** points to
the step's spot.

## ✅ Decisions (Harlan, 2026-10-07)

1. **Use Blizzard's tracker, not a new window.** The guide controls **which quests are watched** (add the step's
   quests, remove guide-added watches when the step moves on). The native tracker does the drawing.
2. **A TomTom-style arrow** for the step's coordinates (works for steps that aren't quests too: "go to X", "pick up
   from Y").
3. **Takes over the watch list** (2026-10-07 23:58): your watches are saved once and restored on hide / finish.
4. **A real "Guide" module in the tracker** for the step text, with Next / Back / Pick guide / Hide in its menu.
5. **Probe first.** The API dump has the watch / super-track functions but not frames or templates, so
   `ForeverLedgerProbe` 0.5.0 asks the client before any design.

## 🔬 Probe 0.5.0 — what it asks

| Command                  | Records (in `ForeverLedgerProbeDB.tracker`)                                                                                                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/flprobe tracker`       | Every `ObjectiveTracker*` / `QuestWatch*` / `SuperTrack*` / `Navigation` / `Waypoint` global; `ObjectiveTrackerFrame` (type, shown, anchor, modules, methods); tracker templates an addon can build from; quest-watch APIs, `Enum.QuestWatchType`, watched quests, per-quest watch type and `GetNextWaypoint`; quests on the current map; user waypoint and `C_Navigation` state; facing and position; tracker CVars. |
| `/flprobe tracker watch` | Out of combat: watches + super-tracks one unwatched quest, reads both back, then restores both. Answers "can an addon set the tracked quests?". UI state only.                                                                  |
| `/flprobe arrow`         | 20 samples, 1 s apart, of `GetPlayerFacing`, map x/y, `C_Map.GetWorldPosFromMapPos`, `UnitPosition`, `C_Navigation` distance. Turn a full circle, then walk: tells us if a TomTom arrow can be computed.                       |

## 📋 Progress

- ✅ 0 🔬 Probe 0.5.0: `tracker`, `tracker watch`, `arrow` + 5 harness tests; `pnpm check` green — 2026-10-07 23:31 CDT
- ✅ 1 🎮 Harlan ran all three on build 70245 (Tirisfal, 2 quests, 2026-10-07 23:38 CDT); dump in
  `fixtures/real/probe-70245-tracker.json`
- ✅ 2 📝 Answers recorded in `CLAUDE.md` — 2026-10-07 23:45 CDT:
  - **Tracker:** retail 11.x module tracker (`ObjectiveTrackerManager`, 11 modules); all 11.x templates build.
  - **Watches:** `C_QuestLog.AddQuestWatch` / `RemoveQuestWatch` and `C_SuperTrack.SetSuperTrackedQuestID` work from
    an addon out of combat. `autoQuestWatch` is on, so the game also watches every accepted quest.
  - **Arrow:** `GetPlayerFacing`, `C_Map.GetMapWorldSize` (yards), `UnitPosition` all work in the open world: a
    TomTom arrow is doable. The native waypoint marker (`SuperTrackedFrame`) also works.
  - **No quest waypoints:** `C_QuestLog.GetNextWaypoint` is empty, so the arrow uses the guide's own coordinates.
  - 🐞 Probe nit: `tracker watch` restores the super-tracked *quest* but not a super-tracked *user waypoint* (it
    was on before the test, off after). Harmless; the viewer rework must restore it properly.
- ✅ 2½ 🤔 Design agreed with Harlan, section by section — 2026-10-07 23:58 CDT: guide **takes over** the watch list
  (yours saved and restored), a real **"Guide" tracker module** above Quests (fallback: lookalike frame), **our own
  TomTom arrow** (Pin and the old window go). Design: `docs/plans/2026-10-07-guide-tracker-design.md`
- ✅ 3 🛠️ Viewer rework on `feat/guide-tracker`: implementation plan written (7 tasks, built on Blizzard's real 11.x
  tracker source) — `docs/plans/2026-10-08-guide-tracker.md` — 2026-10-08 00:05 CDT. Run here, task by task.
  - ✅ T1 test helpers (2026-10-08 00:08 CDT) · ✅ T2 `G.sync` + combat guard (2026-10-08 00:09 CDT) ·
    ✅ T3 watches (2026-10-08 00:16 CDT) · ✅ T4 arrow (2026-10-08 00:25 CDT) ·
    ✅ T5 tracker module (2026-10-08 00:32 CDT) · ✅ T6 wire-up + 0.7.0 (2026-10-08 00:43 CDT) ·
    ✅ T7 final review passed after fixes (login watch race, ADDON_ACTION_FORBIDDEN, layout and arrow errors
    contained) — draft PR #75 — 2026-10-08 00:52 CDT
- 🟡 4 🎮 **Waiting on Harlan's in-game test** (pinged 2026-10-08 00:52 CDT): close the tray first (it would reinstall 0.6.1);
  `/console taintLog 1`; Guide section + header menu; accept a quest (watch list changes), hide (yours come back),
  `/reload` mid-guide; arrow walking/turning + Undercity ↔ Tirisfal; use a quest item in and out of combat; send
  `Logs/taint.log` lines naming ForeverLedger (if any)
  - 🐞 2026-10-08 02:11 CDT: clicking the Guide header **crashed the client** (Harlan, 01:48 CDT). Crash log: Blizzard's
    `MenuUtil.CreateContextMenu` → `Menu.lua:2212 AcquireMenu` → C assertion in `ldebug.c(747)`; our menu code never
    ran. Fix: no menu. Left-click Next, right-click Back, shift-click Hide. Recorded in `CLAUDE.md`. Re-test needed.
- ✅ 4½ 🤝 T8 auto quest (Harlan, 2026-10-08): `GuideAutoQuest.lua` accepts and turns in the current step's quests at
  the NPC, never picks a reward (prints "pick your reward" and waits); Shift skips, `/fl guide auto off` keeps it off;
  hard rule reworded in `CLAUDE.md`; 8 harness tests — 2026-10-08 02:28 CDT. Review follow-ups:
  rewards fail closed (only exactly 0 choices turns in), Shift skips the whole conversation — 02:32 CDT. In-game check joins step 4's re-test.
- ⏳ 5 🚀 Addon 0.7.0 (`addon-v0.7.0` → `addon-cli publish 0.7.0`)
