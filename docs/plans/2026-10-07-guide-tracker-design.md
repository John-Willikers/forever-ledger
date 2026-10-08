# Guide in Blizzard's quest tracker + TomTom arrow: design

> Owner: John-Willikers <harlanbmiltonjr@gmail.com> · 2026-10-07 23:58 CDT · validated with Harlan section by section
> Plan and progress: `project-plans/forever-ledger-guide-tracker.md`. Client facts: `CLAUDE.md` (probe 0.5.0 rows),
> `fixtures/real/probe-70245-tracker.json`.

## Decisions

- **The guide takes over the tracked quests**: only the current step's quests are watched; the player's own list is
  saved and restored when the guide is hidden or finished.
- **Non-quest steps show in a "Guide" section inside Blizzard's tracker** (a real `ObjectiveTrackerModule`, above
  Quests), with header clicks: left Next, right Back, shift-click Hide (no menu: Blizzard's context menu crashes the beta client).
- **Our own TomTom-style arrow** to the step's spot. The Pin button and the old window go away.

## Pieces

`GuideViewer.lua` keeps the brain (`current`, `advance`, `stepDone`, "Later" notes, events, `/fl guide …`, `G.view()`).
New files, loaded after it:

1. **`GuideTracker.lua`**: a frame from `ObjectiveTrackerModuleTemplate` mixed with `ObjectiveTrackerModuleMixin`,
   header "Guide", `uiOrder` 0. `LayoutContents` draws one block (`GetBlock` / `SetHeader` / `AddObjective` /
   `LayoutBlock`) from `G.view()`: the step line, place, "Later" notes, "Step i of n · X's run". Registered with
   `ObjectiveTrackerManager:SetModuleContainer(module, ObjectiveTrackerFrame)`. Fallback: a lookalike frame anchored
   to `ObjectiveTrackerFrame`; with no tracker at all, the old window.
2. **`GuideWatches.lua`**: save the watch list once (`ForeverLedgerGuideState.savedWatches`, only when empty), make the
   watch list exactly the step's in-log quests, super-track the first, restore on hide / finish (skipping quests no
   longer in the log).
3. **`GuideArrow.lua`**: a movable frame (arrow texture, "142 yd", short label). Throttled `OnUpdate` (~20/s):
   `dx = (tx − px)·worldW`, `dy = (ty − py)·worldH` (`C_Map.GetMapWorldSize`), bearing `atan2(−dx, −dy)`
   (counter-clockwise from north, as `GetPlayerFacing`), rotation `bearing − facing`. Checkmark within 10 yd; text
   "Go to <zone>" when the step's map isn't the player's; hidden with no spot, no facing, or in an instance.

## Flow

Every step change (Next / Back, `QUEST_ACCEPTED`, `QUEST_TURNED_IN`, throttled `QUEST_LOG_UPDATE`, level up) calls
`G.sync()`: watches → super-track → `module:MarkDirty()` → `arrow.setTarget(step)`. The auto-watch on accept
(`autoQuestWatch` = 1) is undone by the same sync. A hand-added watch stays until the next step change.

## Combat and taint

- In combat `G.sync()` only records that a sync is owed; `PLAYER_REGEN_ENABLED` runs it. Watch, super-track and
  `MarkDirty` calls happen out of combat only.
- `LayoutContents` touches only our block and lines (never item buttons, other modules or Blizzard tables) and is
  wrapped in `pcall`: an error is printed once in chat.
- `ADDON_ACTION_BLOCKED` naming ForeverLedger: the guide moves to its own window at once and the module is taken out
  of the tracker (after combat), with one chat line. Our `AddModule` leaves the tracker's tables tainted, so quest
  items may stay blocked until a `/reload`; the line says so. The block is remembered per client build
  (`ForeverLedgerGuideState.trackerBlocked`): later sessions on that build use the window, a new build tries again.
- `/fl guide tracker off` keeps the window for good (`trackerOff`; the module is taken out once out of combat);
  `/fl guide tracker on` clears both flags and asks for a `/reload` (it never re-attaches live).
- The manager's `Init` runs after `PLAYER_ENTERING_WORLD`; until then attaching waits (window meanwhile) and the next
  sync retries.
- The arrow is our own frame and reads only positions, so it keeps working in combat.

## Testing

Lua harness (`test_guide.lua` + new suites) with stubs shaped like the probe dump: the manager, the module template
and mixin, and watch / super-track APIs over a fake watch list. Covers watch save-once / restore / reload / auto-watch,
no calls in combat + one sync after, arrow math table (four directions × facings, yards, other map, no facing,
arrival), fallbacks (no manager, `LayoutContents` error). Existing guide tests keep passing.

## Auto quest

Harlan's call (2026-10-08): accepting and turning in quests is quality of life (like Leatrix Plus / Zygor), not
gameplay automation. `GuideAutoQuest.lua` acts only on the **current step's** quests, when the player opens the NPC's
window: an accept step accepts its quests not yet in the log or done, a turn-in step turns its quests in (gossip and
greeting windows select them, `QUEST_DETAIL` accepts, `QUEST_PROGRESS` completes, `QUEST_COMPLETE` with no choices
calls `GetQuestReward(0)`).

- **A reward choice is always the player's**: anything but exactly 0 choices (one or more, nil, an error) prints
  "pick your reward" once and waits.
- Every action runs 0.1 s later and re-checks the window and the step then: the ledger's `QUEST_COMPLETE` capture
  runs first (its `GetQuestReward` hook still sees the turn-in), and a turn-in that just moved the step counts.
- **It continues into the next step within the same conversation** (current step only, like Zygor): turning in A
  moves the step, so the follow-up B the NPC offers next is accepted if it is the new step's.
- A conversation lasts until no NPC window has been open for 1 s. Within it a quest is selected from gossip at most
  once (a detail window closed without accepting doesn't loop). **Shift** held as any of its windows opens skips the
  whole conversation, so a second NPC talked to within 1 s of closing is skipped too.
- Auto-accept quests (already in the log when their window shows) are acknowledged if they are the step's.
- `/fl guide auto off` keeps it off (`ForeverLedgerGuideState.autoQuest = false`). An `ADDON_ACTION_BLOCKED` /
  `FORBIDDEN` naming one of its calls turns it off for the session only (one chat line); the tracker is untouched.

## Release

Addon 0.6.1 → **0.7.0**; `ForeverLedgerDB` shape unchanged (no schema bump), `ForeverLedgerGuideState` gains
`savedWatches`, `arrowPoint`, `trackerBlocked`, `trackerOff` and `autoQuest`. In-game check by Harlan before `addon-cli publish 0.7.0`.
