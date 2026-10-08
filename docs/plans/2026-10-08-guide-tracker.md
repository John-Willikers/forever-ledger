# Guide Tracker + Arrow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move the guide from its own window into Blizzard's quest tracker. A "Guide" module sits above Quests, the
guide takes over the quest watch list, and a TomTom-style arrow points to the step's spot.

**Architecture:** `GuideViewer.lua` keeps the step logic and gains `G.sync()`, the one place that brings watches,
the tracker section and the arrow in line with the step. Three new files hang off the `ForeverLedgerGuide` table:
`GuideWatches.lua` (save / apply / restore watches), `GuideArrow.lua` (pure math + its own frame) and
`GuideTracker.lua` (an `ObjectiveTrackerModuleTemplate` frame registered with `ObjectiveTrackerManager`). The old
window stays as the fallback when the module can't register or gets blocked by taint.

**Tech Stack:** WoW Lua 5.1 (Forever 1.60, interface 16001, retail 11.x tracker), Lua harness `addon/tests`
(`lua5.1 run.lua`), luacheck, `pnpm check`.

**Design:** `docs/plans/2026-10-07-guide-tracker-design.md`. **Client facts:** `CLAUDE.md` (probe 0.5.0 rows),
`fixtures/real/probe-70245-tracker.json`. **Blizzard source used:** Gethe/wow-ui-source `live`
`Blizzard_ObjectiveTracker{Module,Manager,Container,Block}.lua`:

- `ObjectiveTrackerModuleMixin:OnLoad` calls `self:SetHeader(self.headerText)`.
- `Update` → `BeginLayout` → **`LayoutContents`** (override) → `EndLayout`. The module hides itself when no block was
  laid out.
- `GetBlock(id)` → `block:SetHeader(text)`, `block:AddObjective(key, text)`, then `module:LayoutBlock(block)`, which
  returns false when the block doesn't fit.
- `ObjectiveTrackerManager:SetModuleContainer(module, container)` → `container:AddModule` (sorted by `uiOrder`).
  `GetContainerForModule(module)` reads the result back. `container:RemoveModule(module)` exists.
- `module:OnBlockHeaderClick(block, mouseButton)` is the click hook.

**Deviation from the design (YAGNI):** the fallback is the **existing window** (minus its Pin button), not a new
lookalike frame. It is already tested and does the same job.

**Rules for every task:** run commands from the repo root. Lua tests run with `cd addon/tests && lua5.1 run.lua`
(prints `addon tests: N passed, 0 failed`). Commit on branch `feat/guide-tracker` with identity
`John-Willikers <harlanbmiltonjr@gmail.com>`, and end each message with
`Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Update the 📋 Progress list in
`project-plans/forever-ledger-guide-tracker.md` (America/Chicago time) after each task.

---

### Task 1: Test helpers for watches, tracker and arrow

**Files:**

- Modify: `addon/tests/test_guide.lua` (the `viewer()` helper, lines ~31-55)

**Step 1: Extend `viewer()`**

The helper loads all guide files, keeps a fake watch list and super-track, and can install a fake 11.x tracker.
Replace the helper with:

```lua
local ADDON = "../ForeverLedger/ForeverLedger.lua"
local GUIDE_FILES = { "../ForeverLedger/GuideViewer.lua", "../ForeverLedger/GuideWatches.lua",
                      "../ForeverLedger/GuideArrow.lua", "../ForeverLedger/GuideTracker.lua" }

-- A fake retail 11.x tracker, shaped like Blizzard_ObjectiveTracker (probe 0.5.0 on build 70245).
local function installTracker(c)
  local t = { dirty = 0, blocks = {} }
  t.container = { RemoveModule = function(_, m) t.removed = m end }
  c.env.ObjectiveTrackerFrame = t.container
  c.env.ObjectiveTrackerModuleMixin = {
    SetHeader = function(self, text) self.header = text end,
    MarkDirty = function() t.dirty = t.dirty + 1 end,
    GetBlock = function(_, id)
      if t.failBlock then error("GetBlock broke") end
      local b = { id = id, lines = {} }
      function b:SetHeader(text) self.header = text end
      function b:AddObjective(_, text) self.lines[#self.lines + 1] = text end
      t.blocks[#t.blocks + 1] = b
      return b
    end,
    LayoutBlock = function(_, b) t.laidOut = b; return true end,
  }
  c.env.ObjectiveTrackerManager = {
    SetModuleContainer = function(_, m, container) t.module, t.attachedTo = m, container end,
    GetContainerForModule = function(_, m) return m == t.module and t.attachedTo or nil end,
  }
  -- What Blizzard's next tracker update draws for our module.
  function t.draw()
    t.laidOut = nil
    t.module:LayoutContents()
    return t.laidOut
  end
  return t
end

-- A Forever character with a surname, its quest log state in `q` (onQuest / done / ready / objectives / watches).
local function viewer(H, opts)
  opts = opts or {}
  local c = H.new({ rejectTemplates = opts.rejectTemplates or {} })
  c.world.player.surname = "Willikers"
  local q = { onQuest = opts.onQuest or {}, done = opts.done or {}, ready = {}, objectives = {}, pins = {},
              watches = opts.watches or {}, calls = {} }
  c.q = q
  local function watchIndex(id)
    for i, w in ipairs(q.watches) do
      if w == id then return i end
    end
  end
  c.env.C_QuestLog = {
    IsQuestFlaggedCompleted = function(id) return q.done[id] == true end,
    IsOnQuest = function(id) return q.onQuest[id] == true end,
    ReadyForTurnIn = function(id) return q.ready[id] == true end,
    IsComplete = function() return false end,
    GetQuestObjectives = function(id) return q.objectives[id] or {} end,
    GetNumQuestWatches = function() return #q.watches end,
    GetQuestIDForQuestWatchIndex = function(i) return q.watches[i] end,
    GetQuestWatchType = function(id) return watchIndex(id) and 1 or nil end,
    AddQuestWatch = function(id)
      q.calls[#q.calls + 1] = "add " .. id
      if not watchIndex(id) then q.watches[#q.watches + 1] = id end
      return true
    end,
    RemoveQuestWatch = function(id)
      q.calls[#q.calls + 1] = "remove " .. id
      local i = watchIndex(id)
      if i then table.remove(q.watches, i) end
      return true
    end,
  }
  c.env.C_Map = {
    CanSetUserWaypointOnMap = function() return true end,
    SetUserWaypoint = function(p) q.pins[#q.pins + 1] = p end,
  }
  c.env.UiMapPoint = { CreateFromCoordinates = function(m, x, y) return { map = m, x = x, y = y } end }
  c.env.C_SuperTrack = { SetSuperTrackedUserWaypoint = function(v) q.tracked = v end,
                         SetSuperTrackedQuestID = function(id) q.super = id end }
  c.env.ForeverLedgerGuidesData = { version = 1, written = 1, guides = opts.guides or { guide(7, ME) } }
  c.env.ForeverLedgerGuideState = opts.state
  if opts.tracker then c.tracker = installTracker(c) end
  c.load(ADDON)
  for _, f in ipairs(GUIDE_FILES) do c.load(f) end
  c.login("ForeverLedger")
  c.advance(4)
  return c
end

local function sortedWatches(c)
  local w = {}
  for i, id in ipairs(c.q.watches) do w[i] = id end
  table.sort(w)
  return table.concat(w, ",")
end
```

Remove the old `local VIEWER = …` line at the top.

**Step 2: Create empty stubs so the files load**

Create `addon/ForeverLedger/GuideWatches.lua`, `GuideArrow.lua` and `GuideTracker.lua`, each containing only:

```lua
local G = ForeverLedgerGuide
if not G then return end
```

**Step 3: Run the tests**

Run: `cd addon/tests && lua5.1 run.lua 2>&1 | tail -3`
Expected: `addon tests: 257 passed, 0 failed` (nothing changed in behavior yet).

**Step 4: Commit**

```bash
git add addon/tests/test_guide.lua addon/ForeverLedger/Guide*.lua
git commit -m "test(guide): fake watch list, super-track and 11.x tracker in the viewer helper"
```

---

### Task 2: `G.sync()` and the combat guard (refactor)

**Files:**

- Modify: `addon/ForeverLedger/GuideViewer.lua`
- Test: `addon/tests/test_guide.lua`

**Step 1: Baseline.** This is a refactor: the existing guide tests are the safety net. (The combat test needs the
tracker, so it is written in Task 5.)

Run: `cd addon/tests && lua5.1 run.lua 2>&1 | tail -1`
Expected: `addon tests: 257 passed, 0 failed`

**Step 3: Implement in `GuideViewer.lua`**

Export the helpers the new files need, right after `local function state() … end`:

```lua
G.state = state
G.esc = esc
```

and after `readyToTurnIn`:

```lua
G.onQuest = onQuest
```

Add a sync section above `---------------------------------------------------------------- window`:

```lua
---------------------------------------------------------------- sync (watches, tracker section, arrow)
local function inCombat() return InCombatLockdown ~= nil and InCombatLockdown() == true end

-- The step's quests that are in the log now: what the tracker watches.
function G.stepQuests(step)
  local ids = {}
  for _, q in ipairs(step and step.quests or {}) do
    if onQuest(q.questId) then ids[#ids + 1] = q.questId end
  end
  return ids
end

-- Brings the arrow, the watch list and the tracker section in line with the step. Watches and the tracker only change
-- out of combat (taint guard): in combat the sync is owed and PLAYER_REGEN_ENABLED runs it. `rewatch` re-applies the
-- watch list even when the step didn't change (after an accept, which the game auto-watches).
function G.sync(rewatch)
  local g = G.shown and G.current() or nil
  local i = g and G.stepIndex()
  local step = g and g.steps[i] or nil
  if G.arrow then G.arrow.setTarget(step) end
  if inCombat() then
    G.owed = true
    return
  end
  G.owed = false
  local W = G.watches
  if W then
    if g then
      W.take()
      local ids = G.stepQuests(step)
      W.apply(ids, g.id .. ":" .. i .. ":" .. table.concat(ids, ","), rewatch)
    else
      W.restore()
    end
  end
  local T = G.tracker
  if T then T.refresh() end
  if not (T and T.active()) then
    if G.shown then G.frame():Show() end
    G.render()
  end
end
```

Change `G.show` / `G.hide` to:

```lua
function G.show()
  G.shown = true
  state().hidden = nil
  G.advance(false)
  if G.tracker then G.tracker.attach() end
  G.sync()
end

function G.hide()
  G.shown = false
  state().hidden = true
  if G.win then G.win:Hide() end
  G.sync()
end
```

In the window, the Back/Next buttons call `G.sync()` instead of `G.render()`, and the Pin button goes. Delete the
`f.pinB` lines, and anchor `f.close` as before:

```lua
  f.back = button(f, "Back", 56, function() G.go(-1); G.sync() end)
  f.back:SetPoint("BOTTOMLEFT", 8, 8)
  f.nextB = button(f, "Next", 56, function() G.go(1); G.sync() end)
  f.nextB:SetPoint("LEFT", f.back, "RIGHT", 4, 0)
  f.close = button(f, "Hide", 50, function() G.hide() end)
  f.close:SetPoint("BOTTOMRIGHT", -8, 8)
```

Events: `refresh` syncs, accepts re-watch (now and again after half a second, in case the game's auto-watch lands
after our handler), and combat end runs an owed sync:

```lua
local function refresh(force, rewatch)
  G.advance(force)
  G.sync(rewatch)
end
```

```lua
function handlers.QUEST_ACCEPTED()
  refresh(true, true)
  if C_Timer then C_Timer.After(0.5, function() G.sync(true) end) end
end
```

```lua
function handlers.PLAYER_REGEN_ENABLED()
  if G.owed then G.sync() end
end
```

Update the file header comment: "the arrow points to the step's spot; `/fl guide pin` still sets a map pin".

**Step 4: Stub the watch API** so `G.sync` has something to call. `GuideWatches.lua` becomes:

```lua
local G = ForeverLedgerGuide
if not G then return end
local W = {}
G.watches = W
function W.take() end
function W.apply() end
function W.restore() end
```

**Step 5: Run the tests**

Run: `cd addon/tests && lua5.1 run.lua 2>&1 | tail -3`
Expected: all existing tests pass (the window still shows: no tracker in the default helper).

**Step 6: Commit**

```bash
git add addon/ForeverLedger addon/tests/test_guide.lua
git commit -m "refactor(guide): G.sync brings watches, tracker and arrow in line; combat owes a sync"
```

---

### Task 3: `GuideWatches.lua`: take over and give back the watch list

**Files:**

- Modify: `addon/ForeverLedger/GuideWatches.lua`
- Test: `addon/tests/test_guide.lua`

**Step 1: Write the failing tests**

```lua
  -- Rude done, Mindless and Damned in the log: the guide is at step 4 (do The Mindless Ones).
  local function atStep4(extra)
    local o = { done = { [RUDE] = true }, onQuest = { [MINDLESS] = true, [DAMNED] = true, [999] = true },
                watches = { DAMNED, 999 } }
    for k, v in pairs(extra or {}) do o[k] = v end
    return o
  end

  H.test("guide watches: the guide takes over the tracked quests and gives yours back when hidden", function()
    local c = viewer(H, atStep4())
    H.eq(sortedWatches(c), tostring(MINDLESS), "only the step's quest is watched")
    H.eq(c.q.super, MINDLESS, "and super-tracked")
    local saved = c.env.ForeverLedgerGuideState.savedWatches
    H.eq(table.concat(saved, ","), DAMNED .. ",999", "your list is saved")
    c.slash("FOREVERLEDGER", "guide hide")
    H.eq(sortedWatches(c), DAMNED .. ",999", "your list is back")
    H.eq(c.env.ForeverLedgerGuideState.savedWatches, nil)
  end)

  H.test("guide watches: a reload never saves the guide's list over yours; quests you no longer have aren't restored",
    function()
      local c = viewer(H, atStep4())
      local state = c.env.ForeverLedgerGuideState
      local again = viewer(H, atStep4({ state = state, watches = { MINDLESS } }))
      H.eq(table.concat(again.env.ForeverLedgerGuideState.savedWatches, ","), DAMNED .. ",999")
      again.q.onQuest[999] = nil
      again.slash("FOREVERLEDGER", "guide hide")
      H.eq(sortedWatches(again), tostring(DAMNED))
    end)

  H.test("guide watches: a hand-added watch stays until the step changes; an accept re-applies the list", function()
    local c = viewer(H, atStep4())
    c.q.watches[#c.q.watches + 1] = 999
    c.advance(1)
    c.fire("QUEST_LOG_UPDATE")
    H.eq(sortedWatches(c), MINDLESS .. ",999", "hand-added watch kept")
    c.q.onQuest[555] = true
    c.q.watches[#c.q.watches + 1] = 555 -- the game's auto-watch
    c.fire("QUEST_ACCEPTED", 555)
    c.advance(1)
    H.eq(sortedWatches(c), tostring(MINDLESS), "auto-watch and hand-added watch undone")
  end)
```

**Step 2: Run them to make sure they fail**

Run: `cd addon/tests && lua5.1 run.lua 2>&1 | grep -c FAIL`
Expected: 3 failures (the stubs do nothing).

**Step 3: Implement `GuideWatches.lua`**

```lua
-- Forever Ledger guide watches: while a guide runs, Blizzard's quest tracker watches only the current step's quests
-- (probe 0.5.0: C_QuestLog.Add/RemoveQuestWatch and C_SuperTrack.SetSuperTrackedQuestID work from an addon, out of
-- combat). Your own watch list is saved once and given back when the guide is hidden or finished. GuideViewer's
-- G.sync calls this, never in combat.
local G = ForeverLedgerGuide
if not G then return end
local W = {}
G.watches = W

local function ql() return C_QuestLog or {} end

local function call(fn, ...)
  if type(fn) ~= "function" then return nil end
  local ok, v = pcall(fn, ...)
  if ok then return v end
end

-- The watched quest IDs, in the tracker's order.
function W.current()
  local ids = {}
  for i = 1, tonumber(call(ql().GetNumQuestWatches)) or 0 do
    local id = call(ql().GetQuestIDForQuestWatchIndex, i)
    if id then ids[#ids + 1] = id end
  end
  return ids
end

local function watched(id) return call(ql().GetQuestWatchType, id) ~= nil end

-- Makes the watch list exactly `ids`.
local function setWatches(ids)
  local want = {}
  for _, id in ipairs(ids) do want[id] = true end
  for _, id in ipairs(W.current()) do
    if not want[id] then call(ql().RemoveQuestWatch, id) end
  end
  for _, id in ipairs(ids) do
    if not watched(id) then call(ql().AddQuestWatch, id) end
  end
end

-- Saves your watch list, once: a reload while the guide runs must not save the guide's own list over it.
function W.take()
  local s = G.state()
  if s.savedWatches == nil then s.savedWatches = W.current() end
end

-- The step's quests only, the first super-tracked. `key` names the step and its quests: the same key is not applied
-- again (so a watch you add by hand stays until the step changes) unless `rewatch`.
function W.apply(ids, key, rewatch)
  if key == W.lastKey and not rewatch then return end
  W.lastKey = key
  setWatches(ids)
  if ids[1] and C_SuperTrack then call(C_SuperTrack.SetSuperTrackedQuestID, ids[1]) end
end

-- Gives your watch list back, minus quests no longer in the log.
function W.restore()
  local s = G.state()
  local saved = s.savedWatches
  if saved == nil then return end
  s.savedWatches, W.lastKey = nil, nil
  local keep = {}
  for _, id in ipairs(saved) do
    if G.onQuest(id) then keep[#keep + 1] = id end
  end
  setWatches(keep)
end
```

**Step 4: Run the tests**

Run: `cd addon/tests && lua5.1 run.lua 2>&1 | tail -3`
Expected: `0 failed`.

**Step 5: Commit**

```bash
git add addon/ForeverLedger/GuideWatches.lua addon/tests/test_guide.lua
git commit -m "feat(guide): the guide takes over the quest watch list and gives yours back"
```

---

### Task 4: `GuideArrow.lua`: the math, then the frame

**Files:**

- Modify: `addon/ForeverLedger/GuideArrow.lua`
- Test: `addon/tests/test_guide.lua`

**Step 1: Write the failing tests**

```lua
  local function near(a, b) return type(a) == "number" and math.abs(a - b) < 1e-6 end

  H.test("guide arrow: points at the spot from the map position and facing, counter-clockwise from north", function()
    local A = viewer(H).env.ForeverLedgerGuide.arrow
    local me = { mapId = 1420, x = 0.5, y = 0.5, width = 1000, height = 1000, facing = 0 }
    local function at(x, y) return { mapId = 1420, x = x, y = y } end
    local north = A.compute(at(50, 40), me)
    H.eq(north.state, "point")
    H.ok(near(north.rotation, 0), "north: straight up, got " .. tostring(north.rotation))
    H.ok(near(north.yards, 100), "100 yd")
    H.ok(near(A.compute(at(40, 50), me).rotation, math.pi / 2), "west: left")
    H.ok(near(A.compute(at(50, 60), me).rotation, math.pi), "south: down")
    H.ok(near(A.compute(at(60, 50), me).rotation, 3 * math.pi / 2), "east: right")
    me.facing = math.pi / 2 -- facing west, north is on your right
    H.ok(near(A.compute(at(50, 40), me).rotation, 3 * math.pi / 2), "turns with you")
    H.eq(A.compute(at(50.5, 50), me).state, "arrived", "5 yd away")
    H.eq(A.compute({ mapId = 1421, x = 50, y = 40 }, me).state, "elsewhere")
    me.facing = nil
    H.eq(A.compute(at(50, 40), me).state, "none", "no facing (an instance)")
    H.eq(A.compute({ mapId = 1420 }, me).state, "none", "a step with no spot")
  end)

  H.test("guide arrow: shows yards to the step, 'Go to' on another map, and hides with the guide", function()
    local c = viewer(H)
    local map, facing = 1420, 0
    c.env.C_Map.GetBestMapForUnit = function() return map end
    c.env.C_Map.GetPlayerMapPosition = function() return { GetXY = function() return 0.302, 0.75 end } end
    c.env.C_Map.GetMapWorldSize = function() return 4518.75, 3012.5 end
    c.env.GetPlayerFacing = function() return facing end
    local f = c.env.ForeverLedgerGuideArrow
    H.ok(f and f.shown, "arrow shown for step 1 (Undertaker Mordo, 30.2 71.6)")
    f.scripts.OnUpdate(f, 0.1)
    H.eq(f.dist.text, "102 yd") -- (0.716 - 0.75) * 3012.5 = 102.4 yd north
    H.eq(f.label.text, "Undertaker Mordo")
    H.ok(near(c.env.ForeverLedgerGuide.arrow.last.rotation, 0), "north")
    map = 1421
    f.scripts.OnUpdate(f, 0.1)
    H.eq(f.dist.text, "Go to Tirisfal Glades")
    c.slash("FOREVERLEDGER", "guide hide")
    H.eq(f.shown, false)
  end)
```

**Step 2: Run them to make sure they fail**

Run: `cd addon/tests && lua5.1 run.lua 2>&1 | grep -A2 "guide arrow"`
Expected: FAIL (`attempt to index field 'arrow'`).

**Step 3: Implement `GuideArrow.lua`**

```lua
-- Forever Ledger guide arrow: a TomTom-style arrow to the guide step's spot, with yards left. It only reads the
-- player's map position and facing (probe 0.5.0: GetPlayerFacing and C_Map.GetMapWorldSize work in the open world);
-- it is our own frame, so it keeps working in combat. Drag it to move it.
local G = ForeverLedgerGuide
if not G then return end
local A = {}
G.arrow = A

local ARRIVED = 10   -- yards
local EVERY = 0.05   -- seconds between updates
local TWO_PI = math.pi * 2
local ARROW_TEXTURE = "Interface\\Minimap\\MiniMap-QuestArrow"
local DONE_TEXTURE = "Interface\\RaidFrame\\ReadyCheck-Ready"

local function call(fn, ...)
  if type(fn) ~= "function" then return nil end
  local ok, a, b = pcall(fn, ...)
  if ok then return a, b end
end

-- Where the arrow points and how far. Map x/y are 0..1 and grow east and south; target x/y are the guide's 0..100.
-- Facing is radians counter-clockwise from north (GetPlayerFacing), and so is the returned rotation.
function A.compute(target, me)
  if not target or not target.mapId or not tonumber(target.x) or not tonumber(target.y) then return { state = "none" } end
  if not me or not me.mapId or not me.x then return { state = "none" } end
  if me.mapId ~= target.mapId then return { state = "elsewhere" } end
  if not me.width or not me.height or not me.facing then return { state = "none" } end
  local dx = (target.x / 100 - me.x) * me.width
  local dy = (target.y / 100 - me.y) * me.height
  local yards = math.sqrt(dx * dx + dy * dy)
  if yards <= ARRIVED then return { state = "arrived", yards = yards } end
  return { state = "point", yards = yards, rotation = (math.atan2(-dx, -dy) - me.facing) % TWO_PI }
end

-- The player's map, position, the map's size in yards and facing (nil in an instance, where it is restricted).
function A.player()
  local map = C_Map
  if not map then return nil end
  local mapId = call(map.GetBestMapForUnit, "player")
  if not mapId then return nil end
  local pos = call(map.GetPlayerMapPosition, mapId, "player")
  if type(pos) ~= "table" or type(pos.GetXY) ~= "function" then return nil end
  local x, y = pos:GetXY()
  if not x or not y then return nil end
  local w, h = call(map.GetMapWorldSize, mapId)
  local inInstance = IsInInstance and IsInInstance()
  return { mapId = mapId, x = x, y = y, width = tonumber(w), height = tonumber(h),
           facing = not inInstance and tonumber(call(GetPlayerFacing)) or nil }
end

local function label(step)
  local q = step.quests and step.quests[1]
  return G.esc(step.npc or (q and q.title) or "")
end

function A.frame()
  if A.win then return A.win end
  local f = CreateFrame("Frame", "ForeverLedgerGuideArrow", UIParent)
  f:SetSize(56, 76)
  local p = G.state().arrowPoint
  if type(p) == "table" and p[1] then
    f:SetPoint(p[1], UIParent, p[2] or p[1], p[3] or 0, p[4] or 0)
  else
    f:SetPoint("TOP", UIParent, "TOP", 0, -120)
  end
  f:SetClampedToScreen(true)
  f:SetMovable(true)
  f:EnableMouse(true)
  f:RegisterForDrag("LeftButton")
  f:SetScript("OnDragStart", function(self) self:StartMoving() end)
  f:SetScript("OnDragStop", function(self)
    self:StopMovingOrSizing()
    local point, _, relPoint, x, y = self:GetPoint(1)
    G.state().arrowPoint = { point, relPoint, x, y }
  end)
  f.icon = f:CreateTexture(nil, "ARTWORK")
  f.icon:SetSize(42, 42)
  f.icon:SetPoint("TOP")
  f.dist = f:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  f.dist:SetPoint("TOP", f.icon, "BOTTOM", 0, -2)
  f.label = f:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
  f.label:SetPoint("TOP", f.dist, "BOTTOM", 0, -1)
  f.label:SetWidth(200)
  local since = 0
  f:SetScript("OnUpdate", function(_, elapsed)
    since = since + (elapsed or 0)
    if since >= EVERY then
      since = 0
      A.tick()
    end
  end)
  A.win = f
  return f
end

-- Shows the arrow for a step with a spot; hides it for none.
function A.setTarget(step)
  A.target = step and step.mapId and tonumber(step.x) and tonumber(step.y) and step or nil
  if not A.target then
    if A.win then A.win:Hide() end
    return
  end
  A.frame():Show()
  A.tick()
end

function A.tick()
  local f, t = A.win, A.target
  if not f or not t then return end
  local r = A.compute(t, A.player())
  A.last = r
  f.label:SetText(label(t))
  if r.state == "point" then
    f.icon:SetTexture(ARROW_TEXTURE)
    f.icon:SetRotation(r.rotation)
    f.icon:Show()
    f.dist:SetText(string.format("%d yd", math.floor(r.yards + 0.5)))
  elseif r.state == "arrived" then
    f.icon:SetTexture(DONE_TEXTURE)
    f.icon:SetRotation(0)
    f.icon:Show()
    f.dist:SetText("Arrived")
  elseif r.state == "elsewhere" then
    f.icon:Hide()
    f.dist:SetText("Go to " .. G.esc(t.zone or "the step's zone"))
  else
    f.icon:Hide()
    f.dist:SetText("")
    f.label:SetText("")
  end
end
```

**Step 4: Run the tests**

Run: `cd addon/tests && lua5.1 run.lua 2>&1 | tail -3`
Expected: `0 failed`.

**Step 5: Commit**

```bash
git add addon/ForeverLedger/GuideArrow.lua addon/tests/test_guide.lua
git commit -m "feat(guide): TomTom-style arrow to the step's spot"
```

---

### Task 5: `GuideTracker.lua`: the Guide module

**Files:**

- Modify: `addon/ForeverLedger/GuideTracker.lua`, `addon/ForeverLedger/GuideViewer.lua` (events)
- Test: `addon/tests/test_guide.lua` (un-skip Task 2's combat test)

**Step 1: Write the failing tests**

```lua
  H.test("guide tracker: the step shows in a Guide section of the quest tracker, not a window", function()
    local c = viewer(H, { tracker = true })
    local t = c.tracker
    H.eq(t.attachedTo, c.env.ObjectiveTrackerFrame)
    H.eq(t.module.uiOrder, 0, "above Blizzard's modules")
    H.eq(t.module.header, "Guide")
    H.eq(c.env.ForeverLedgerGuideFrame, nil, "no window")
    H.ok(t.dirty > 0, "asked the tracker to redraw")
    local b = t.draw()
    H.eq(b.header, "Undead 1-4 (Rot's run)")
    H.ok(b.lines[1]:find("Accept from Undertaker Mordo", 1, true), b.lines[1])
    H.ok(b.lines[#b.lines]:find("Step 1 of 5", 1, true), b.lines[#b.lines])
  end)

  H.test("guide tracker: the header menu moves steps and hides; without a menu, left is Next and right Back", function()
    local c = viewer(H, { tracker = true })
    local t, buttons = c.tracker, {}
    c.env.MenuUtil = { CreateContextMenu = function(_, gen)
      local root = {}
      function root:CreateTitle() end
      function root:CreateButton(text, fn) buttons[text] = fn; return root end
      gen(nil, root)
    end }
    t.module:OnBlockHeaderClick(nil, "LeftButton")
    buttons["Next step"]()
    H.ok(t.draw().lines[#t.laidOut.lines]:find("Step 2 of 5", 1, true), "next")
    buttons["Hide guide"]()
    H.eq(t.draw(), nil, "hidden: nothing drawn")
    c.slash("FOREVERLEDGER", "guide")
    c.env.MenuUtil = nil
    t.module:OnBlockHeaderClick(nil, "RightButton")
    H.ok(t.draw().lines[#t.laidOut.lines]:find("Step 1 of 5", 1, true), "right-click is Back")
  end)

  H.test("guide tracker: a blocked action moves the guide to its window", function()
    local c = viewer(H, { tracker = true })
    c.fire("ADDON_ACTION_BLOCKED", "ForeverLedger", "UseQuestLogSpecialItem()")
    H.ok(printed(c, "moves to its own window"), "says so")
    H.eq(c.tracker.removed, c.tracker.module, "module taken out of the tracker")
    H.ok(body(c):find("Accept from Undertaker Mordo", 1, true), "window shows the step")
    c.fire("ADDON_ACTION_BLOCKED", "SomeOtherAddon", "x")
  end)

  H.test("guide tracker: a broken template or a layout error falls back or is contained", function()
    local c = viewer(H, { tracker = true, rejectTemplates = { ObjectiveTrackerModuleTemplate = true } })
    H.ok(body(c):find("Accept from Undertaker Mordo", 1, true), "window when the module can't be made")
    local d = viewer(H, { tracker = true })
    d.tracker.failBlock = true
    d.tracker.module:LayoutContents()
    d.tracker.module:LayoutContents()
    local n = 0
    for _, l in ipairs(d.world.printed) do
      if l:find("guide tracker error", 1, true) then n = n + 1 end
    end
    H.eq(n, 1, "printed once")
  end)
```

H.test("guide: in combat nothing touches watches or the tracker; one sync runs after combat", function()
local c = viewer(H, { tracker = true, done = { [RUDE] = true }, onQuest = { [MINDLESS] = true, [DAMNED] = true } })
local dirty, calls = c.tracker.dirty, #c.q.calls
c.world.inCombat = true
c.slash("FOREVERLEDGER", "guide back")
H.eq(#c.q.calls, calls, "no watch calls in combat")
H.eq(c.tracker.dirty, dirty, "no tracker redraw in combat")
c.world.inCombat = false
c.fire("PLAYER_REGEN_ENABLED")
H.ok(c.tracker.dirty > dirty, "redrawn after combat")
H.ok(#c.q.calls > calls, "watches synced after combat")
end)

**Step 2: Run them to make sure they fail**

Run: `cd addon/tests && lua5.1 run.lua 2>&1 | grep -c FAIL`
Expected: 5 failures (the combat test fails at `c.tracker.dirty` staying 0).

**Step 3: Implement `GuideTracker.lua`**

```lua
-- Forever Ledger guide section in Blizzard's quest tracker: a "Guide" module above Quests with the current step
-- (Forever has the retail 11.x module tracker, probe 0.5.0). It only lays out its own block and lines; the tracker is
-- only asked to redraw out of combat (GuideViewer's G.sync). If the module can't be made, or the game blocks an
-- action and names us (taint), the guide uses its own window instead.
local G = ForeverLedgerGuide
if not G then return end
local T = {}
G.tracker = T

local GREY = "|cff9d9d9d"

local function say(msg) print("|cff33ff99Forever Ledger:|r " .. msg) end

function T.active() return T.module ~= nil and not T.blocked end

local function lines(text)
  local out = {}
  for line in ((text or "") .. "\n"):gmatch("(.-)\n") do
    if line ~= "" then out[#out + 1] = line end
  end
  return out
end

-- Called by Blizzard's tracker update (ObjectiveTrackerModuleMixin:Update): one block, the guide's view as lines.
function T.layout(module)
  if not G.shown then return end
  local v = G.view()
  local block = module:GetBlock("guide")
  block:SetHeader(v.title)
  for i, line in ipairs(lines(v.body)) do block:AddObjective("line" .. i, line) end
  if v.counter ~= "" then block:AddObjective("counter", GREY .. v.counter .. "|r") end
  module:LayoutBlock(block)
end

function T.layoutSafe(module)
  local ok, err = pcall(T.layout, module)
  if not ok and not T.errored then
    T.errored = true
    say("guide tracker error: " .. tostring(err))
  end
end

function T.click(button)
  local menu = MenuUtil
  if type(menu) == "table" and type(menu.CreateContextMenu) == "function" then
    local ok = pcall(menu.CreateContextMenu, T.module, function(_, root)
      root:CreateTitle("Forever Ledger guide")
      root:CreateButton("Next step", function() G.go(1); G.sync() end)
      root:CreateButton("Back", function() G.go(-1); G.sync() end)
      local mine = G.myGuides()
      if #mine > 1 then
        local pick = root:CreateButton("Pick guide")
        for i, g in ipairs(mine) do pick:CreateButton(G.esc(g.title), function() G.slash("use " .. i) end) end
      end
      root:CreateButton("Hide guide", function() G.hide() end)
    end)
    if ok then return end
  end
  G.go(button == "RightButton" and -1 or 1)
  G.sync()
end

-- Makes the module and puts it in ObjectiveTrackerFrame; false (and the window is used) when it can't.
function T.attach()
  if T.module then return not T.blocked end
  if T.failed then return false end
  local manager, container, base = ObjectiveTrackerManager, ObjectiveTrackerFrame, ObjectiveTrackerModuleMixin
  if type(manager) ~= "table" or type(container) ~= "table" or type(manager.SetModuleContainer) ~= "function" then
    T.failed = true
    return false
  end
  local ok, m = pcall(CreateFrame, "Frame", "ForeverLedgerGuideTracker", UIParent, "ObjectiveTrackerModuleTemplate")
  if not ok or type(m) ~= "table" then
    T.failed = true
    return false
  end
  -- The template mixes ObjectiveTrackerModuleMixin in; copy it in if this client's didn't.
  if rawget(m, "GetBlock") == nil and type(base) == "table" then
    for k, v in pairs(base) do
      if rawget(m, k) == nil then m[k] = v end
    end
  end
  m.uiOrder = 0 -- Blizzard's run 1 (Scenario) to 11 (World Quests): first
  m.headerText = "Guide"
  pcall(m.SetHeader, m, "Guide")
  m.LayoutContents = T.layoutSafe
  m.OnBlockHeaderClick = function(_, _, button) T.click(button) end
  ok = pcall(manager.SetModuleContainer, manager, m, container)
  local getContainer = manager.GetContainerForModule
  if not ok or (type(getContainer) == "function" and getContainer(manager, m) ~= container) then
    T.failed = true
    return false
  end
  T.module = m
  return true
end

-- Out of combat only (G.sync): redraw, or take the module out once it was blocked.
function T.refresh()
  local m = T.module
  if not m then return end
  if T.blocked then
    if not T.removed then
      T.removed = true
      pcall(function()
        ObjectiveTrackerFrame:RemoveModule(m)
        m:Hide()
      end)
    end
    return
  end
  pcall(m.MarkDirty, m)
end

function T.onBlocked(func)
  if not T.module or T.blocked then return end
  T.blocked = true
  say("the game blocked an action (" .. tostring(func) .. ") while the guide was in the quest tracker: the guide "
    .. "moves to its own window" .. (InCombatLockdown and InCombatLockdown() and " after combat." or "."))
end
```

In `GuideViewer.lua` events add:

```lua
function handlers.ADDON_ACTION_BLOCKED(addon, func)
  if addon == "ForeverLedger" and G.tracker then
    G.tracker.onBlocked(func)
    G.sync()
  end
end
```

**Step 4: Run the tests**

Run: `cd addon/tests && lua5.1 run.lua 2>&1 | tail -3`
Expected: `0 failed`.

**Step 5: Commit**

```bash
git add addon/ForeverLedger addon/tests/test_guide.lua
git commit -m "feat(guide): Guide section in Blizzard's quest tracker, window fallback on failure or taint"
```

---

### Task 6: Wire up: toc, luacheck, help text, version 0.7.0

**Files:**

- Modify: `addon/ForeverLedger/ForeverLedger.toc`, `.luacheckrc`, `addon/ForeverLedger/ForeverLedger.lua` (lines 1, 5,
  `/fl` help ~2832), `addon/tests/test_ledger.lua:57`, `addon/tests/test_migration.lua:106`,
  `addon/tests/test_professions.lua:1890`, `packages/contracts/test/normalize.test.ts:1027`, `README.md`

**Step 1:** In the toc, list the files after `GuideViewer.lua` (`GuideWatches.lua`, `GuideArrow.lua`,
`GuideTracker.lua`) and set `## Version: 0.7.0`.

**Step 2:** In `.luacheckrc` `read_globals`, add `"ObjectiveTrackerManager", "ObjectiveTrackerFrame",
"ObjectiveTrackerModuleMixin", "MenuUtil", "GetPlayerFacing"`.

**Step 3:** Bump `0.6.1` → `0.7.0` in `ForeverLedger.lua` (header and `VERSION`) and the four tests. The `/fl` help
line becomes: `"/fl guide  -  the leveling guide sent to this character, in the quest tracker with an arrow (list,
use N, next, back, pin, hide)"`.

**Step 4:** Run `pnpm check`.
Expected: green. The Lua run regenerates `fixtures/synthetic/session-v9.lua` with `0.7.0`, and that file is
committed too. If luacheck flags an unused variable or line length, fix it.

**Step 5:** In the README addon table, describe the guide as "in Blizzard's quest tracker + arrow".

**Step 6: Commit**

```bash
git add -A
git commit -m "feat(addon): 0.7.0 — guide in the quest tracker with an arrow"
```

---

### Task 7: Review, PR, in-game test, release

1. Code review (superpowers:requesting-code-review) against the design. Fix what it finds.
2. Push, open the PR (🤖 footer) and merge after CI passes.
3. **Harlan tests in-game** (`/console taintLog 1` first, so taint gets logged):
   - The Guide section shows above Quests, and the header menu works.
   - Accepting a quest changes the watch list. Hiding the guide gives the old watches back. `/reload` keeps them.
   - The arrow points correctly while turning and walking, shows "Arrived" at the spot, and can be dragged.
   - A fight where you use a quest item (or any quest-item quest): no "action blocked". Check `Logs/taint.log` for
     `ForeverLedger`.
4. Only after a clean test: `git tag addon-v0.7.0 && git push origin addon-v0.7.0`. Wait for the release Action,
   then on the VPS run `node apps/server/dist/addon-cli.js publish 0.7.0`. Update the plan and memory
   (`forever-ledger-releases`).
