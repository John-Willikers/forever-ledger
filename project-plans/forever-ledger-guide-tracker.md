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
3. **Probe first.** The API dump has the watch / super-track functions but not frames or templates, so
   `ForeverLedgerProbe` 0.5.0 asks the client before any design.

## 🔬 Probe 0.5.0 — what it asks

| Command                  | Records (in `ForeverLedgerProbeDB.tracker`)                                                                                                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/flprobe tracker`       | Every `ObjectiveTracker*` / `QuestWatch*` / `SuperTrack*` / `Navigation` / `Waypoint` global; `ObjectiveTrackerFrame` (type, shown, anchor, modules, methods); tracker templates an addon can build from; quest-watch APIs, `Enum.QuestWatchType`, watched quests, per-quest watch type and `GetNextWaypoint`; quests on the current map; user waypoint and `C_Navigation` state; facing and position; tracker CVars. |
| `/flprobe tracker watch` | Out of combat: watches + super-tracks one unwatched quest, reads both back, then restores both. Answers "can an addon set the tracked quests?". UI state only.                                                                  |
| `/flprobe arrow`         | 20 samples, 1 s apart, of `GetPlayerFacing`, map x/y, `C_Map.GetWorldPosFromMapPos`, `UnitPosition`, `C_Navigation` distance. Turn a full circle, then walk: tells us if a TomTom arrow can be computed.                       |

## 📋 Progress

- ✅ 0 🔬 Probe 0.5.0: `tracker`, `tracker watch`, `arrow` + 5 harness tests; `pnpm check` green — 2026-10-07 23:31 CDT
- 🟡 1 🎮 **Waiting on Harlan:** install probe 0.5.0, take a quest or two, run `/flprobe tracker`,
  `/flprobe tracker watch`, `/flprobe arrow` (turn around, walk), `/reload`, send back `ForeverLedgerProbe.lua`
- ⏳ 2 📝 Record the answers in `CLAUDE.md` (open questions table) and pick the design:
  - Is it the retail module tracker (`ObjectiveTrackerManager`) or the 10.x / Classic one?
  - Do `C_QuestLog.AddQuestWatch` / `RemoveQuestWatch` work from an addon, outside combat?
  - Does `GetPlayerFacing` return a value in the open world (TomTom arrow), and is `C_Navigation` live (native
    waypoint marker)?
- ⏳ 3 🛠️ Viewer rework: guide drives quest watches + arrow (design after step 2)
- ⏳ 4 🚀 Release a new addon version (`addon-vX` → `addon-cli publish X`)
