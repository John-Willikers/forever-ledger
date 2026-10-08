-- The guide viewer (GuideViewer.lua): guides the tray wrote into ForeverLedgerGuidesData, shown a step at a time and
-- moved on as quests are accepted, finished and turned in.
local RUDE, MINDLESS, DAMNED = 363, 364, 376
local ME = "Thibodeaux Willikers-Bayou"

local function guide(id, char, title)
  return {
    id = id, char = char, title = title or "Undead 1-4 (Rot's run)", fromLevel = 1, toLevel = 4, basedOn = "Rot",
    steps = {
      { action = "accept", npc = "Undertaker Mordo", zone = "Tirisfal Glades", subzone = "Deathknell", mapId = 1420,
        x = 30.2, y = 71.6, quests = { { questId = RUDE, title = "Rude Awakening" } } },
      { action = "turn_in", npc = "Shadow Priest Sarvis", zone = "Tirisfal Glades", subzone = "Deathknell",
        mapId = 1420, x = 30.8, y = 66.2, quests = { { questId = RUDE, title = "Rude Awakening" } }, levelAfter = 2 },
      { action = "accept", npc = "Shadow Priest Sarvis", zone = "Tirisfal Glades", quests = {
          { questId = MINDLESS, title = "The Mindless Ones" }, { questId = DAMNED, title = "The Damned" } } },
      { action = "complete", zone = "Tirisfal Glades", subzone = "Deathknell", mapId = 1420, x = 34, y = 62,
        quests = { { questId = MINDLESS, title = "The Mindless Ones", objectives = { "Mindless Zombie slain: 8" } } } },
      { action = "turn_in", npc = "Shadow Priest Sarvis",
        quests = { { questId = MINDLESS, title = "The Mindless Ones" } }, levelAfter = 3 },
    },
  }
end

local ADDON = "../ForeverLedger/ForeverLedger.lua"
local GUIDE_FILES = { "../ForeverLedger/GuideViewer.lua", "../ForeverLedger/GuideWatches.lua",
                      "../ForeverLedger/GuideArrow.lua", "../ForeverLedger/GuideTracker.lua",
                      "../ForeverLedger/GuideAutoQuest.lua" }

-- A fake retail 11.x tracker, shaped like Blizzard_ObjectiveTracker (probe 0.5.0 on build 70245).
-- `notReady`: the manager hasn't run Init yet (before PLAYER_ENTERING_WORLD), so SetModuleContainer does nothing.
local function installTracker(c, notReady)
  local t = { dirty = 0, blocks = {}, setCalls = 0 }
  t.container = { RemoveModule = function(_, m) t.removed = m end }
  c.env.ObjectiveTrackerFrame = t.container
  c.env.OBJECTIVE_DASH_STYLE_HIDE = 2
  c.env.ObjectiveTrackerModuleMixin = {
    SetHeader = function(self, text) self.header = text end,
    MarkDirty = function() t.dirty = t.dirty + 1 end,
    GetBlock = function(_, id)
      if t.failBlock then error("GetBlock broke") end
      local b = { id = id, lines = {}, full = {}, dash = {} }
      function b:SetHeader(text) self.header = text end
      function b:AddObjective(_, text, _, useFullHeight, dashStyle)
        local n = #self.lines + 1
        self.lines[n], self.full[n], self.dash[n] = text, useFullHeight, dashStyle
      end
      t.blocks[#t.blocks + 1] = b
      return b
    end,
    LayoutBlock = function(_, b) t.laidOut = b; return true end,
  }
  t.manager = { containers = notReady and {} or { [t.container] = true } }
  c.env.ObjectiveTrackerManager = t.manager
  t.manager.SetModuleContainer = function(self, m, container)
    t.setCalls = t.setCalls + 1
    if self.containers[container] then t.module, t.attachedTo = m, container end
  end
  t.manager.GetContainerForModule = function(_, m) return m == t.module and t.attachedTo or nil end
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
  local c = H.new({ rejectTemplates = opts.rejectTemplates or {}, buildInfo = opts.buildInfo })
  c.world.player.surname = "Willikers"
  local q = { onQuest = opts.onQuest or {}, done = opts.done or {}, ready = {}, objectives = {}, pins = {},
              watches = opts.watches or {}, calls = {}, types = {}, super = opts.super }
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
    -- The type AddQuestWatch got (yours: Manual 1, the default); tests mark the game's auto-watches 0 (Automatic).
    GetQuestWatchType = function(id) return watchIndex(id) and (q.types[id] or 1) or nil end,
    AddQuestWatch = function(id, watchType)
      q.calls[#q.calls + 1] = "add " .. id
      q.types[id] = watchType
      if not watchIndex(id) then q.watches[#q.watches + 1] = id end
      return true
    end,
    RemoveQuestWatch = function(id)
      q.calls[#q.calls + 1] = "remove " .. id
      local i = watchIndex(id)
      if i then table.remove(q.watches, i) end
      q.types[id] = nil
      return true
    end,
  }
  c.env.C_Map = {
    CanSetUserWaypointOnMap = function() return true end,
    SetUserWaypoint = function(p) q.pins[#q.pins + 1] = p end,
  }
  c.env.UiMapPoint = { CreateFromCoordinates = function(m, x, y) return { map = m, x = x, y = y } end }
  c.env.C_SuperTrack = { SetSuperTrackedUserWaypoint = function(v) q.tracked = v end,
                         SetSuperTrackedQuestID = function(id) q.super = id end,
                         GetSuperTrackedQuestID = function() return q.super end }
  c.env.ForeverLedgerGuidesData = { version = 1, written = 1, guides = opts.guides or { guide(7, ME) } }
  c.env.ForeverLedgerGuideState = opts.state
  if opts.tracker then c.tracker = installTracker(c, opts.trackerNotReady) end
  if opts.beforeStart then
    -- The client's C_Timer: the login timer (start, 3 s) hasn't run when this returns.
    c.world.timers = {}
    c.env.C_Timer = { After = function(secs, fn) c.world.timers[#c.world.timers + 1] = { at = c.world.clock + secs,
                                                                                         fn = fn } end }
  end
  c.load(ADDON)
  for _, f in ipairs(GUIDE_FILES) do c.load(f) end
  c.login("ForeverLedger")
  if not opts.beforeStart then c.advance(4) end
  return c
end

-- The game's auto-watch (on accept or progress): an Automatic watch.
local function autoWatch(c, id)
  c.q.watches[#c.q.watches + 1] = id
  c.q.types[id] = 0
end

local function sortedWatches(c)
  local w = {}
  for i, id in ipairs(c.q.watches) do w[i] = id end
  table.sort(w)
  return table.concat(w, ",")
end

local function body(c) return c.env.ForeverLedgerGuideFrame.body.text or "" end
local function counter(c) return c.env.ForeverLedgerGuideFrame.counter.text or "" end
local function printed(c, pattern)
  for _, l in ipairs(c.world.printed) do
    if l:find(pattern) then return true end
  end
  return false
end

-- The NPC windows (GuideAutoQuest.lua): gossip, the old greeting window and the quest frame. `c.npc` holds what the
-- NPC offers ({ questID=, title=, isComplete= }); the quest frame is the harness's world.questFrame; `c.did` lists
-- every select/accept/complete call made.
local function npcWindows(c)
  local n = { available = {}, active = {}, autoAccept = false, completable = true }
  c.npc, c.did = n, {}
  local function did(s) c.did[#c.did + 1] = s end
  c.env.C_GossipInfo = {
    GetAvailableQuests = function() return n.available end,
    GetActiveQuests = function() return n.active end,
    SelectAvailableQuest = function(id) did("gossip accept " .. id) end,
    SelectActiveQuest = function(id) did("gossip turn in " .. id) end,
  }
  c.env.GetNumAvailableQuests = function() return #n.available end
  c.env.GetAvailableQuestInfo = function(i) return false, 0, false, false, n.available[i].questID end
  c.env.SelectAvailableQuest = function(i) did("greeting accept " .. i) end
  c.env.GetNumActiveQuests = function() return #n.active end
  c.env.GetActiveQuestID = function(i) return n.active[i].questID end
  c.env.GetActiveTitle = function(i) return n.active[i].title, n.active[i].isComplete end
  c.env.SelectActiveQuest = function(i) did("greeting turn in " .. i) end
  c.env.QuestGetAutoAccept = function() return n.autoAccept end
  c.env.AcceptQuest = function() did("accept " .. c.env.GetQuestID()) end
  c.env.AcknowledgeAutoAcceptQuest = function() did("acknowledge " .. c.env.GetQuestID()) end
  c.env.IsQuestCompletable = function() return n.completable end
  c.env.CompleteQuest = function() did("complete " .. c.env.GetQuestID()) end
  c.env.IsShiftKeyDown = function() return n.shift == true end
end

-- Opens the quest frame on questID at `event` (QUEST_DETAIL / QUEST_PROGRESS / QUEST_COMPLETE).
local function questWindow(c, event, questID, choices)
  c.world.questFrame = { questID = questID, title = "Quest " .. questID, xp = 100, money = 10, choices = choices }
  c.fire(event)
end

local function did(c) return table.concat(c.did, "; ") end

-- A planned guide (format 2): travel steps between the quest steps. Spots on 1420 (Tirisfal, 1000 x 1000 yd in
-- these tests) and 1411 (Durotar).
local function travelGuide(id, char)
  return {
    id = id, char = char, title = "Undead 1-12 (planned)", fromLevel = 1, toLevel = 12, basedOn = "the planner",
    steps = {
      { action = "accept", npc = "Undertaker Mordo", zone = "Tirisfal Glades", subzone = "Deathknell", mapId = 1420,
        x = 30.2, y = 71.6, quests = { { questId = RUDE, title = "Rude Awakening" } } },
      { action = "travel", how = "walk", note = "Travel Form", npc = "Brill", zone = "Tirisfal Glades", mapId = 1420,
        x = 60, y = 52, quests = {} },
      { action = "travel", how = "fly", note = "Brill -> Orgrimmar", npc = "Doras", zone = "Durotar", mapId = 1411,
        x = 45, y = 63, quests = {} },
      { action = "travel", how = "boat", note = "Tirisfal Glades <-> Durotar", npc = "Zeppelin tower",
        zone = "Tirisfal Glades", mapId = 1420, x = 61, y = 58, quests = {} },
      { action = "travel", how = "hearth", note = "Hearthstone", npc = "Brill", zone = "Tirisfal Glades",
        mapId = 1420, x = 61, y = 52, quests = {} },
      { action = "turn_in", npc = "Shadow Priest Sarvis", zone = "Tirisfal Glades", subzone = "Deathknell",
        mapId = 1420, x = 30.8, y = 66.2, quests = { { questId = RUDE, title = "Rude Awakening" } } },
      { action = "travel", how = "fly", npc = "Doras", zone = "Durotar", mapId = 1411, x = 45, y = 63, quests = {} },
      { action = "travel", how = "walk", zone = "Durotar", mapId = 1411, x = 50, y = 50, quests = {} },
    },
  }
end

-- Puts the player on `map` at x/y (0..1); every map is 1000 x 1000 yd.
local function standAt(c, map, x, y)
  c.env.C_Map.GetBestMapForUnit = function() return map end
  c.env.C_Map.GetPlayerMapPosition = function() return { GetXY = function() return x, y end } end
  c.env.C_Map.GetMapWorldSize = function() return 1000, 1000 end
end

local function withTimers(c)
  c.world.timers = {}
  c.env.C_Timer = { After = function(secs, fn) c.world.timers[#c.world.timers + 1] = { at = c.world.clock + secs,
                                                                                       fn = fn } end }
end

local function stepNo(c) return c.env.ForeverLedgerGuide.stepIndex() end

return function(H)
  H.test("guide: shows this character's newest guide at login, from step 1", function()
    local c = viewer(H)
    local f = c.env.ForeverLedgerGuideFrame
    H.ok(f and f.shown, "window shown")
    H.eq(f.title.text, "Undead 1-4 (Rot's run)")
    H.ok(counter(c):find("Step 1 of 5", 1, true), counter(c))
    H.ok(body(c):find("Accept from Undertaker Mordo", 1, true), body(c))
    H.ok(body(c):find("Deathknell, Tirisfal Glades (30.2, 71.6)", 1, true), body(c))
    H.ok(printed(c, "guide loaded: Undead 1%-4"), "login message")
    H.ok(printed(c, "/fl guide hide to hide it"), "login message says how to hide it")
  end)

  H.test("guide: moves on as quests are accepted, finished and turned in", function()
    local c = viewer(H)
    c.q.onQuest[RUDE] = true
    c.fire("QUEST_ACCEPTED", RUDE)
    H.ok(counter(c):find("Step 2 of 5", 1, true), counter(c))
    H.ok(body(c):find("Turn in to Shadow Priest Sarvis", 1, true), body(c))
    c.q.onQuest[RUDE], c.q.done[RUDE] = nil, true
    c.fire("QUEST_TURNED_IN", RUDE, 40, 0)
    -- Step 3 wants two pickups: one isn't enough.
    c.q.onQuest[MINDLESS] = true
    c.fire("QUEST_ACCEPTED", MINDLESS)
    H.ok(counter(c):find("Step 3 of 5", 1, true), counter(c))
    c.q.onQuest[DAMNED] = true
    c.fire("QUEST_ACCEPTED", DAMNED)
    H.ok(counter(c):find("Step 4 of 5", 1, true), counter(c))
    -- The live count from the quest log, not the guide's text.
    c.q.objectives[MINDLESS] = { { text = "3/8 Mindless Zombie slain", finished = false } }
    c.advance(1)
    c.fire("QUEST_LOG_UPDATE")
    H.ok(body(c):find("3/8 Mindless Zombie slain", 1, true), body(c))
    c.q.ready[MINDLESS] = true
    c.advance(1)
    c.fire("QUEST_LOG_UPDATE")
    H.ok(counter(c):find("Step 5 of 5", 1, true), counter(c))
    c.q.done[MINDLESS] = true
    c.fire("QUEST_TURNED_IN", MINDLESS, 170, 0)
    H.ok(counter(c):find("Done: all 5 steps", 1, true), counter(c))
  end)

  H.test("guide: steps already behind the player are skipped at login", function()
    local c = viewer(H, { done = { [RUDE] = true } })
    H.ok(counter(c):find("Step 3 of 5", 1, true), counter(c))
  end)

  H.test("guide: Back holds the step until Next or real progress; the place is remembered", function()
    local c = viewer(H, { done = { [RUDE] = true } })
    c.slash("FOREVERLEDGER", "guide back")
    H.ok(counter(c):find("Step 2 of 5", 1, true), counter(c))
    c.advance(1)
    c.fire("QUEST_LOG_UPDATE")
    H.ok(counter(c):find("Step 2 of 5", 1, true), "a log update doesn't move it: " .. counter(c))
    c.slash("FOREVERLEDGER", "guide next")
    H.ok(counter(c):find("Step 3 of 5", 1, true), counter(c))
    H.eq(c.env.ForeverLedgerGuideState.steps[7], 3)
    -- After a /reload the place comes back.
    local again = viewer(H, { done = { [RUDE] = true }, state = c.env.ForeverLedgerGuideState })
    H.ok(counter(again):find("Step 3 of 5", 1, true), counter(again))
  end)

  H.test("guide: the window is our own frame, so it keeps updating in combat", function()
    local c = viewer(H)
    c.world.inCombat = true
    c.slash("FOREVERLEDGER", "guide next")
    H.ok(counter(c):find("Step 2 of 5", 1, true), counter(c))
    H.ok(body(c):find("Turn in to Shadow Priest Sarvis", 1, true), body(c))
  end)

  H.test("guide: only this character's guides; list and use switch between them", function()
    local c = viewer(H, { guides = { guide(9, ME, "Undead 4-10 (Rot's run)"), guide(8, "Someone Else-Bayou"),
                                     guide(7, ME) } })
    H.eq(c.env.ForeverLedgerGuideFrame.title.text, "Undead 4-10 (Rot's run)")
    c.slash("FOREVERLEDGER", "guide list")
    H.ok(printed(c, "1%. Undead 4%-10 %(Rot's run%) %(5 steps%)  <%- current"), "list")
    H.ok(printed(c, "2%. Undead 1%-4"), "the other guide of mine")
    H.ok(not printed(c, "Someone Else"), "never another character's")
    c.slash("FOREVERLEDGER", "guide use 2")
    H.eq(c.env.ForeverLedgerGuideFrame.title.text, "Undead 1-4 (Rot's run)")
  end)

  H.test("guide: Pin sets a map pin on the step's spot; without a spot it says where to go", function()
    local c = viewer(H)
    c.slash("FOREVERLEDGER", "guide pin")
    H.eq(#c.q.pins, 1)
    H.eq(c.q.pins[1].map, 1420)
    H.eq(c.q.pins[1].x, 0.302)
    H.eq(c.q.tracked, true)
    c.env.UiMapPoint = nil
    c.slash("FOREVERLEDGER", "guide pin")
    H.ok(printed(c, "go to Deathknell, Tirisfal Glades %(30%.2, 71%.6%)"), "falls back to text")
  end)

  H.test("guide: works without the client's frame templates, and with no guide at all", function()
    local c = viewer(H, { rejectTemplates = { BackdropTemplate = true, UIPanelButtonTemplate = true } })
    H.ok(body(c):find("Accept from Undertaker Mordo", 1, true), "plain frames still show the step")
    local none = viewer(H, { guides = {} })
    H.eq(none.env.ForeverLedgerGuideFrame, nil, "no window without a guide")
    none.slash("FOREVERLEDGER", "guide")
    H.ok(none.env.ForeverLedgerGuideFrame.body.text:find("No guide for this character yet", 1, true))
    none.slash("FOREVERLEDGER", "guide hide")
    H.eq(none.env.ForeverLedgerGuideFrame.shown, false)
  end)

  H.test("guide: WoW escape codes in guide text are shown as text, never as colors or links", function()
    local g = guide(7, ME, "Run |cffff0000[GM]|r |Hurl:x|hclick|h")
    g.steps[1].npc = "Mordo|TInterface\\Icons\\x:4000|t\nfake line"
    local c = viewer(H, { guides = { g } })
    local f = c.env.ForeverLedgerGuideFrame
    H.eq(f.title.text, "Run ||cffff0000[GM]||r ||Hurl:x||hclick||h")
    H.ok(body(c):find("Mordo||TInterface", 1, true), body(c))
    H.ok(not body(c):find("\n", 1, true) or not body(c):find("fake line\n", 1, true), "no injected line break")
    H.ok(body(c):find("Mordo||TInterface\\Icons\\x:4000||t fake line", 1, true), body(c))
  end)

  H.test("guide: a turn-in counts at once, before the quest log says it is completed", function()
    local c = viewer(H)
    c.q.onQuest[RUDE] = true
    c.fire("QUEST_ACCEPTED", RUDE)
    c.q.onQuest[RUDE] = nil -- IsQuestFlaggedCompleted still false, as the client often is at QUEST_TURNED_IN
    c.fire("QUEST_TURNED_IN", RUDE, 40, 0)
    H.ok(counter(c):find("Step 3 of 5", 1, true), counter(c))
  end)

  H.test("guide: steps say how to skip what this character can't do", function()
    local c = viewer(H)
    H.ok(body(c):find("Press Next to skip it", 1, true), "accept steps")
    c.slash("FOREVERLEDGER", "guide next")
    H.ok(body(c):find("Not in your quest log", 1, true), "a turn-in for a quest not in the log")
  end)

  H.test("guide: a pickup above your level waits as a Later note, then Ready once you level", function()
    local g = guide(7, ME)
    g.steps[3].quests[2].minLevel = 2 -- The Damned, as Timbo took it at level 2
    local c = viewer(H, { guides = { g }, done = { [RUDE] = true } })
    c.world.player.level = 1
    c.q.onQuest[MINDLESS] = true
    c.fire("QUEST_ACCEPTED", MINDLESS)
    -- Step 3 (Mindless + Damned): Damned is too high, so the guide moves on to doing The Mindless Ones.
    H.ok(counter(c):find("Step 4 of 5", 1, true), counter(c))
    H.ok(body(c):find("Later: The Damned at level 2 from Shadow Priest Sarvis", 1, true), body(c))
    c.world.player.level = 2
    c.fire("PLAYER_LEVEL_UP", 2)
    H.ok(body(c):find("Ready: pick up The Damned from Shadow Priest Sarvis", 1, true), body(c))
    c.q.onQuest[DAMNED] = true
    c.fire("QUEST_ACCEPTED", DAMNED)
    H.ok(not body(c):find("The Damned at level", 1, true) and not body(c):find("Ready:", 1, true), body(c))
  end)

  H.test("guide: pickups show their level, red when you are too low", function()
    local g = guide(7, ME)
    g.steps[1].quests[1].minLevel = 5
    local c = viewer(H, { guides = { g } })
    c.world.player.level = 10
    c.slash("FOREVERLEDGER", "guide")
    H.ok(body(c):find("Rude Awakening|r |cff9d9d9d(level 5)", 1, true), body(c))
  end)

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

  H.test("guide watches: a hand-added watch stays until the step changes; an accept undoes the auto-watch", function()
    local c = viewer(H, atStep4())
    c.q.watches[#c.q.watches + 1] = 999 -- by hand (Manual)
    c.advance(1)
    c.fire("QUEST_LOG_UPDATE")
    H.eq(sortedWatches(c), MINDLESS .. ",999", "hand-added watch kept")
    c.q.onQuest[555] = true
    autoWatch(c, 555)
    c.fire("QUEST_ACCEPTED", 555)
    c.advance(1)
    H.eq(sortedWatches(c), MINDLESS .. ",999", "auto-watch undone, hand-added watch kept")
    c.slash("FOREVERLEDGER", "guide next")
    H.eq(sortedWatches(c), tostring(MINDLESS), "the step changed: hand-added watch undone")
  end)

  H.test("guide watches: finishing the guide gives your watches back", function()
    local c = viewer(H, atStep4())
    H.eq(sortedWatches(c), tostring(MINDLESS))
    -- Mindless turned in (out of the log, done): steps 4 and 5 are behind the player, so the guide is finished. Damned
    -- and 999 are still in the log, so your saved list comes back whole; Mindless was never in it.
    c.q.onQuest[MINDLESS], c.q.done[MINDLESS] = nil, true
    c.fire("QUEST_TURNED_IN", MINDLESS, 170, 0)
    H.ok(counter(c):find("Done: all 5 steps", 1, true), counter(c))
    H.eq(sortedWatches(c), DAMNED .. ",999", "your list is back")
    H.eq(c.env.ForeverLedgerGuideState.savedWatches, nil)
  end)

  H.test("guide watches: an accept during combat is re-watched after combat", function()
    local c = viewer(H, atStep4())
    c.world.inCombat = true
    local calls = #c.q.calls
    c.q.onQuest[555] = true
    autoWatch(c, 555)
    c.fire("QUEST_ACCEPTED", 555)
    c.advance(1)
    H.eq(sortedWatches(c), MINDLESS .. ",555", "nothing touched in combat")
    H.eq(#c.q.calls, calls, "no watch calls in combat")
    c.world.inCombat = false
    c.fire("PLAYER_REGEN_ENABLED")
    H.eq(sortedWatches(c), tostring(MINDLESS), "auto-watch undone after combat")
  end)

  H.test("guide watches: a bad saved list from an old or hand-edited file is replaced, never breaks", function()
    for _, bad in ipairs({ "x", true }) do
      local c = viewer(H, atStep4({ state = { savedWatches = bad } }))
      H.ok(not printed(c, "error"), table.concat(c.world.printed, "\n"))
      H.eq(sortedWatches(c), tostring(MINDLESS), "the guide takes over")
      c.slash("FOREVERLEDGER", "guide hide")
      H.ok(not printed(c, "error"), table.concat(c.world.printed, "\n"))
      H.eq(c.env.ForeverLedgerGuideState.savedWatches, nil)
      H.eq(sortedWatches(c), DAMNED .. ",999", "your list is back")
    end
  end)

  H.test("guide watches: your list comes back at login when the tray removed the running guide", function()
    local c = viewer(H, { guides = {}, state = { savedWatches = { DAMNED } }, onQuest = { [DAMNED] = true } })
    H.eq(sortedWatches(c), tostring(DAMNED))
    H.eq(c.env.ForeverLedgerGuideState.savedWatches, nil)
  end)

  H.test("guide watches: a quest log update before the guide starts leaves the watches alone", function()
    -- A /reload mid-guide: the tracker holds the guide's list, your list is saved, and 999 isn't in the log yet.
    local c = viewer(H, atStep4({ beforeStart = true, watches = { MINDLESS },
                                  onQuest = { [MINDLESS] = true, [DAMNED] = true },
                                  state = { savedWatches = { DAMNED, 999 } } }))
    local calls = #c.q.calls
    c.fire("QUEST_LOG_UPDATE")
    H.eq(#c.q.calls, calls, "no watch calls before the guide starts")
    H.eq(table.concat(c.env.ForeverLedgerGuideState.savedWatches, ","), DAMNED .. ",999", "your list kept")
    c.q.onQuest[999] = true
    c.advance(4)
    H.eq(sortedWatches(c), tostring(MINDLESS), "the guide runs")
    c.slash("FOREVERLEDGER", "guide hide")
    H.eq(sortedWatches(c), DAMNED .. ",999", "your whole list is back")
  end)

  H.test("guide watches: your list comes back at login when the guide was hidden", function()
    local c = viewer(H, atStep4({ watches = { MINDLESS }, state = { hidden = true, savedWatches = { DAMNED, 999 } } }))
    H.eq(sortedWatches(c), DAMNED .. ",999")
    H.eq(c.env.ForeverLedgerGuideState.savedWatches, nil)
    H.ok(printed(c, "/fl guide to show it"), "login message says how to show it")
  end)

  H.test("guide: an error in the login start prints a line instead of breaking", function()
    local c = viewer(H, { beforeStart = true })
    c.env.ForeverLedgerGuide.advance = function() error("boom") end
    c.advance(4)
    H.ok(printed(c, "guide viewer error"), "printed")
  end)

  H.test("guide watches: progress auto-watches are undone (once per burst); your hand-added watch stays", function()
    local c = viewer(H, atStep4())
    -- The harness has C_Timer only with professionAPI: this test needs the delayed sync.
    local w = c.world
    w.timers = {}
    c.env.C_Timer = { After = function(secs, fn) w.timers[#w.timers + 1] = { at = w.clock + secs, fn = fn } end }
    local syncs, st = 0, c.env.C_SuperTrack -- each guide sync with a rewatch super-tracks the step's quest
    local set = st.SetSuperTrackedQuestID
    st.SetSuperTrackedQuestID = function(id) syncs = syncs + 1; set(id) end
    c.q.watches[#c.q.watches + 1] = 999 -- by hand (Manual)
    c.q.onQuest[555] = true
    autoWatch(c, 555)
    c.fire("QUEST_WATCH_UPDATE", 555)
    c.fire("QUEST_WATCH_UPDATE", 555)
    c.fire("QUEST_WATCH_UPDATE", MINDLESS)
    H.eq(sortedWatches(c), MINDLESS .. ",555,999", "not at once")
    c.advance(1)
    H.eq(syncs, 1, "one sync for the burst")
    H.eq(sortedWatches(c), MINDLESS .. ",999", "auto-watch undone, hand-added watch kept")
    c.fire("QUEST_WATCH_UPDATE", MINDLESS)
    c.advance(1)
    H.eq(syncs, 2, "the next burst gets its own sync")
    c.slash("FOREVERLEDGER", "guide next")
    H.eq(sortedWatches(c), tostring(MINDLESS), "the step changed: hand-added watch undone")
  end)

  H.test("guide watches: your list comes back as manual watches, your super-tracked quest too", function()
    local c = viewer(H, atStep4({ super = DAMNED }))
    c.env.Enum.QuestWatchType = { Automatic = 0, Manual = 1 }
    H.eq(c.q.super, MINDLESS)
    c.slash("FOREVERLEDGER", "guide hide")
    H.eq(sortedWatches(c), DAMNED .. ",999")
    H.eq(c.q.types[DAMNED], 1, "manual")
    H.eq(c.q.types[999], 1, "manual")
    H.eq(c.q.super, DAMNED, "super-track back")
    H.eq(c.env.ForeverLedgerGuideState.savedSuperTrack, nil)
  end)

  H.test("guide watches: a super-tracked quest you no longer have isn't super-tracked again", function()
    local c = viewer(H, atStep4({ super = 999 }))
    c.q.onQuest[999] = nil
    c.slash("FOREVERLEDGER", "guide hide")
    H.eq(c.q.super, 0)
  end)

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
    me.facing, me.width = 0, 0
    H.eq(A.compute(at(50, 50.5), me).state, "none", "a map with no size in yards is not 'arrived'")
    -- Another map on the same continent (a city inside its zone): world yards, X grows north and Y grows west.
    local inCity = { mapId = 1458, x = 0.5, y = 0.5, facing = 0, continent = 0, wx = 1000, wy = 2000 }
    local spot = at(50, 40)
    local across = A.compute(spot, inCity, { continent = 0, x = 1100, y = 2000 })
    H.eq(across.state, "point")
    H.ok(near(across.rotation, 0), "north across maps, got " .. tostring(across.rotation))
    H.ok(near(across.yards, 100), "100 yd across maps")
    H.ok(near(A.compute(spot, inCity, { continent = 0, x = 1000, y = 1900 }).rotation, 3 * math.pi / 2), "east")
    H.eq(A.compute(spot, inCity, { continent = 1, x = 1100, y = 2000 }).state, "elsewhere", "other continent")
    H.eq(A.compute(spot, inCity).state, "elsewhere", "no world position for the step")
    local noSize = { mapId = 1420, x = 0.5, y = 0.5, width = 0, height = 0, facing = 0, continent = 0,
                     wx = 1000, wy = 2000 }
    H.ok(near(A.compute(spot, noSize, { continent = 0, x = 1100, y = 2000 }).yards, 100), "same map, no size: world")
  end)

  H.test("guide arrow: shows yards to the step, 'Go to' on another map, and hides with the guide", function()
    local c = viewer(H)
    local map, facing = 1420, 0
    c.env.C_Map.GetBestMapForUnit = function() return map end
    c.env.C_Map.GetPlayerMapPosition = function() return { GetXY = function() return 0.302, 0.75 end } end
    c.env.C_Map.GetMapWorldSize = function() return 4518.75, 3012.5 end
    c.env.GetPlayerFacing = function() return facing end
    local f = c.env.ForeverLedgerGuideArrow
    local A = c.env.ForeverLedgerGuide.arrow
    H.ok(f and f.shown, "arrow shown for step 1 (Undertaker Mordo, 30.2 71.6)")
    function f:EnableMouse(on) self.mouse = on end
    f.scripts.OnUpdate(f, 0.1)
    H.eq(f.dist.text, "102 yd") -- (0.716 - 0.75) * 3012.5 = 102.4 yd north
    H.eq(f.label.text, "Undertaker Mordo")
    H.ok(near(A.last.rotation, 0), "north")
    H.eq(f.mouse, true, "draggable while it points")
    map = 1421
    f.scripts.OnUpdate(f, 0.1)
    H.eq(f.dist.text, "Go to Tirisfal Glades")
    map = 1420
    c.env.C_Map.GetPlayerMapPosition = function() return { GetXY = function() return 0.302, 0.716 end } end
    f.scripts.OnUpdate(f, 0.1)
    H.eq(f.dist.text, "Arrived")
    c.env.C_Map.GetPlayerMapPosition = function() return nil end
    f.scripts.OnUpdate(f, 0.1)
    H.eq(A.last.state, "none", "no map position")
    H.eq(f.dist.text, "")
    H.eq(f.label.shown, false, "no label without an arrow")
    H.ok(f.shown, "stays shown so OnUpdate keeps running")
    H.eq(f.mouse, false, "but lets clicks through")
    c.slash("FOREVERLEDGER", "guide hide")
    H.eq(f.shown, false)
    H.eq(A.last, nil, "forgets the last reading")
  end)

  H.test("guide arrow: an error hides the arrow for the session and prints one line", function()
    local c = viewer(H)
    local f = c.env.ForeverLedgerGuideArrow
    c.env.C_Map.GetBestMapForUnit = function() return 1420 end
    c.env.C_Map.GetPlayerMapPosition = function() return { GetXY = function() error("boom") end } end
    f.scripts.OnUpdate(f, 0.1)
    H.eq(f.shown, false, "hidden")
    f.scripts.OnUpdate(f, 0.1)
    local n = 0
    for _, l in ipairs(c.world.printed) do
      if l:find("guide arrow error", 1, true) then n = n + 1 end
    end
    H.eq(n, 1, "printed once")
    c.slash("FOREVERLEDGER", "guide next")
    H.eq(f.shown, false, "stays hidden")
    H.ok(not printed(c, "guide viewer error"), "never breaks the guide")
  end)

  H.test("guide arrow: from a city map, points through world yards to a step on the zone map", function()
    local c = viewer(H)
    -- Step 1 (1420, 30.2 71.6) sits 50 yd west of the player, who is on Undercity (1458).
    c.env.CreateVector2D = function(x, y) return { x = x, y = y } end
    c.env.C_Map.GetWorldPosFromMapPos = function(mapId, v)
      if mapId == 1420 then return 0, { GetXY = function() return v.x * 1000, v.y * 1000 + 50 end } end
      return 0, { x = 0.302 * 1000, y = 0.716 * 1000 }
    end
    c.env.C_Map.GetBestMapForUnit = function() return 1458 end
    c.env.C_Map.GetPlayerMapPosition = function() return { GetXY = function() return 0.5, 0.5 end } end
    c.env.GetPlayerFacing = function() return 0 end
    c.slash("FOREVERLEDGER", "guide hide")
    c.slash("FOREVERLEDGER", "guide show")
    local f, A = c.env.ForeverLedgerGuideArrow, c.env.ForeverLedgerGuide.arrow
    f.scripts.OnUpdate(f, 0.1)
    H.eq(f.dist.text, "50 yd")
    H.ok(near(A.last.rotation, math.pi / 2), "west, got " .. tostring(A.last.rotation))
  end)

  H.test("guide arrow: a step with no npc or quest title is labelled with its subzone or zone", function()
    local g = guide(7, ME)
    g.steps[1].npc, g.steps[1].quests[1].title = nil, nil
    local c = viewer(H, { guides = { g } })
    H.eq(c.env.ForeverLedgerGuideArrow.label.text, "Deathknell")
  end)

  ---------------------------------------------------------------- tracker
  H.test("guide tracker: the step shows in a Guide section of the quest tracker, not a window", function()
    local c = viewer(H, { tracker = true })
    local t = c.tracker
    H.eq(t.attachedTo, c.env.ObjectiveTrackerFrame)
    H.eq(t.module.uiOrder, 2.5, "after Scenario and widgets, above Campaign and Quests")
    H.eq(type(rawget(t.module, "usedBlocks")), "table", "what the mixin's OnLoad sets up")
    H.eq(t.module.header, "Guide")
    H.eq(c.env.ForeverLedgerGuideFrame, nil, "no window")
    H.ok(t.dirty > 0, "asked the tracker to redraw")
    local b = t.draw()
    H.eq(b.header, "Undead 1-4 (Rot's run)")
    H.ok(b.lines[1]:find("Accept from Undertaker Mordo", 1, true), b.lines[1])
    H.ok(b.lines[#b.lines]:find("Step 1 of 5", 1, true), b.lines[#b.lines])
    H.eq(b.full[1], true, "body lines aren't cut at two lines")
    for i = 1, #b.lines do H.eq(b.dash[i], c.env.OBJECTIVE_DASH_STYLE_HIDE, "no dash on line " .. i) end
    -- A Do step: its live objectives keep Blizzard's dash (like the Quests module) instead of the indent.
    local d = viewer(H, atStep4({ tracker = true }))
    d.q.objectives[MINDLESS] = { { text = "Mindless Zombie slain: 3/8", finished = false } }
    local db, n = d.tracker.draw(), 0
    for i, l in ipairs(db.lines) do
      if l:find("Mindless Zombie slain: 3/8", 1, true) then
        n = n + 1
        H.eq(l:sub(1, 1), "|", "indent stripped: " .. l)
        H.eq(db.dash[i], nil, "objective keeps the dash")
      else
        H.eq(db.dash[i], d.env.OBJECTIVE_DASH_STYLE_HIDE, "no dash on " .. l)
      end
    end
    H.eq(n, 1, "the objective is drawn")
  end)

  -- Blizzard's context menu crashes Forever's beta client when its owner is our module (build 70245, 2026-10-08:
  -- assertion in ldebug.c from Menu.lua AcquireMenu), so header clicks never open a menu.
  H.test("guide tracker: header clicks: left is Next, right Back, shift hides; never Blizzard's menu", function()
    local c = viewer(H, { tracker = true })
    local t, shift = c.tracker, false
    c.env.MenuUtil = { CreateContextMenu = function() error("never open Blizzard's menu") end }
    c.env.IsShiftKeyDown = function() return shift end
    t.module:OnBlockHeaderClick(nil, "LeftButton")
    H.ok(t.draw().lines[#t.laidOut.lines]:find("Step 2 of 5", 1, true), "left-click is Next")
    t.module:OnBlockHeaderClick(nil, "RightButton")
    H.ok(t.draw().lines[#t.laidOut.lines]:find("Step 1 of 5", 1, true), "right-click is Back")
    shift = true
    t.module:OnBlockHeaderClick(nil, "LeftButton")
    H.eq(t.draw(), nil, "shift-click hides the guide")
    H.ok(not printed(c, "guide viewer error"), "no error")
  end)

  H.test("guide tracker: a blocked action moves the guide to its window", function()
    local c = viewer(H, { tracker = true })
    c.fire("ADDON_ACTION_BLOCKED", "ForeverLedger", "UseQuestLogSpecialItem()")
    H.ok(printed(c, "moves to its own window"), "says so")
    H.eq(c.tracker.removed, c.tracker.module, "module taken out of the tracker")
    H.ok(body(c):find("Accept from Undertaker Mordo", 1, true), "window shows the step")
    H.ok(printed(c, "/reload"), "says quest items may need a reload")
    H.eq(c.env.ForeverLedgerGuideState.trackerBlocked, "61582", "remembered for this build")
    c.fire("ADDON_ACTION_BLOCKED", "SomeOtherAddon", "x")
    local d = viewer(H, { tracker = true, buildInfo = {} })
    d.fire("ADDON_ACTION_BLOCKED", "ForeverLedger", "UseQuestLogSpecialItem()")
    H.eq(d.env.ForeverLedgerGuideState.trackerBlocked, nil, "an unreadable build is never remembered")
  end)

  H.test("guide tracker: a forbidden action (a quest item out of combat) moves the guide to its window", function()
    local c = viewer(H, { tracker = true })
    c.fire("ADDON_ACTION_FORBIDDEN", "SomeOtherAddon", "x")
    H.eq(c.tracker.removed, nil, "another addon's: ignored")
    c.fire("ADDON_ACTION_FORBIDDEN", "ForeverLedger", "UseQuestLogSpecialItem()")
    H.ok(printed(c, "moves to its own window"), "says so")
    H.eq(c.tracker.removed, c.tracker.module, "module taken out of the tracker")
    H.ok(body(c):find("Accept from Undertaker Mordo", 1, true), "window shows the step")
  end)

  H.test("guide tracker: a block is remembered for the build; a new build tries the tracker again", function()
    local c = viewer(H, { tracker = true, state = { trackerBlocked = "61582" } })
    H.eq(c.tracker.setCalls, 0, "never put in the tracker")
    H.ok(body(c):find("Accept from Undertaker Mordo", 1, true), "window")
    local d = viewer(H, { tracker = true, state = { trackerBlocked = "61000" } })
    H.eq(d.tracker.attachedTo, d.env.ObjectiveTrackerFrame, "new build: in the tracker")
    H.eq(d.env.ForeverLedgerGuideFrame, nil, "no window")
  end)

  H.test("guide tracker: /fl guide tracker off uses the window and is kept; on clears it for a reload", function()
    local c = viewer(H, { tracker = true })
    c.slash("FOREVERLEDGER", "guide tracker off")
    H.eq(c.tracker.removed, c.tracker.module, "module taken out")
    H.ok(body(c):find("Accept from Undertaker Mordo", 1, true), "window")
    H.eq(c.env.ForeverLedgerGuideState.trackerOff, true)
    local d = viewer(H, { tracker = true, state = { trackerOff = true } })
    H.eq(d.tracker.setCalls, 0, "off stays off after a reload")
    d.env.ForeverLedgerGuideState.trackerBlocked = "61582"
    d.slash("FOREVERLEDGER", "guide tracker on")
    H.eq(d.env.ForeverLedgerGuideState.trackerOff, nil)
    H.eq(d.env.ForeverLedgerGuideState.trackerBlocked, nil)
    H.ok(printed(d, "/reload to put the guide back in the quest tracker"), "says to reload")
    H.eq(d.tracker.setCalls, 0, "not put back live")
  end)

  H.test("guide tracker: before the tracker is set up the window shows; the next sync moves the guide in", function()
    local c = viewer(H, { tracker = true, trackerNotReady = true })
    H.eq(c.tracker.setCalls, 0, "waits for the tracker")
    H.eq(c.env.ForeverLedgerGuideTracker, nil, "no module frame yet")
    H.ok(body(c):find("Accept from Undertaker Mordo", 1, true), "window meanwhile")
    c.tracker.manager.containers[c.tracker.container] = true
    c.slash("FOREVERLEDGER", "guide next")
    H.eq(c.tracker.attachedTo, c.env.ObjectiveTrackerFrame, "in the tracker")
    H.eq(c.env.ForeverLedgerGuideFrame.shown, false, "window hidden")
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
    H.ok(d.env.ForeverLedgerGuideFrame and d.env.ForeverLedgerGuideFrame.shown, "the window takes over")
    H.ok(body(d):find("Accept from Undertaker Mordo", 1, true), "window shows the step")
    d.slash("FOREVERLEDGER", "guide next")
    H.eq(d.tracker.removed, d.tracker.module, "module taken out on the next sync")
    H.eq(d.env.ForeverLedgerGuideState.trackerBlocked, nil, "not remembered past this session")
  end)

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

  ---------------------------------------------------------------- auto quest (GuideAutoQuest.lua)
  H.test("auto quest: gossip selects the accept step's quest and nothing else", function()
    local c = viewer(H)
    npcWindows(c)
    c.npc.available = { { questID = 999, title = "Someone Else's Quest" },
                        { questID = RUDE, title = "Rude Awakening" } }
    c.fire("GOSSIP_SHOW")
    H.eq(did(c), "gossip accept " .. RUDE)
    -- A quest already in the log isn't picked up again.
    c.did = {}
    c.q.onQuest[RUDE] = true
    c.fire("GOSSIP_SHOW")
    H.eq(did(c), "")
  end)

  H.test("auto quest: QUEST_DETAIL accepts the step's quest (auto-accept ones are acknowledged), others not", function()
    local c = viewer(H)
    npcWindows(c)
    questWindow(c, "QUEST_DETAIL", 999)
    H.eq(did(c), "", "not the guide's quest")
    questWindow(c, "QUEST_DETAIL", RUDE)
    H.eq(did(c), "accept " .. RUDE)
    -- An auto-accept quest is already in the log when its window shows: it is still acknowledged.
    c.did = {}
    c.npc.autoAccept = true
    c.q.onQuest[RUDE] = true
    questWindow(c, "QUEST_DETAIL", RUDE)
    H.eq(did(c), "acknowledge " .. RUDE)
    -- The turn-in step's quest isn't accepted from a detail window either: only the accept step's are.
    local d = viewer(H, { onQuest = { [RUDE] = true } })
    npcWindows(d)
    questWindow(d, "QUEST_DETAIL", MINDLESS)
    H.eq(did(d), "", "the next step's quest waits for its step")
  end)

  H.test("auto quest: turn-in step: gossip, progress and a reward window without choices", function()
    local c = viewer(H, { onQuest = { [RUDE] = true } })
    npcWindows(c)
    c.npc.active = { { questID = 999, title = "Other", isComplete = true },
                     { questID = RUDE, title = "Rude Awakening", isComplete = false } }
    c.fire("GOSSIP_SHOW")
    H.eq(did(c), "", "not complete yet")
    c.npc.active[2].isComplete = true
    c.fire("GOSSIP_SHOW")
    H.eq(did(c), "gossip turn in " .. RUDE)
    c.did = {}
    c.npc.completable = false
    questWindow(c, "QUEST_PROGRESS", RUDE)
    H.eq(did(c), "", "not completable")
    c.npc.completable = true
    questWindow(c, "QUEST_PROGRESS", 999)
    H.eq(did(c), "", "not the guide's quest")
    questWindow(c, "QUEST_PROGRESS", RUDE)
    H.eq(did(c), "complete " .. RUDE)
    questWindow(c, "QUEST_COMPLETE", 999)
    H.eq(#c.world.questRewardCalls, 0, "not the guide's quest")
    questWindow(c, "QUEST_COMPLETE", RUDE)
    H.eq(table.concat(c.world.questRewardCalls, ","), "0", "turned in with no reward picked")
  end)

  H.test("auto quest: never picks a reward; says so once per window", function()
    local c = viewer(H, { onQuest = { [RUDE] = true } })
    npcWindows(c)
    local two = { { id = 5555, count = 1 }, { id = 5556, count = 1 } }
    c.world.questFrame = { questID = RUDE, title = "Rude Awakening", choices = two }
    c.fire("QUEST_COMPLETE")
    c.fire("QUEST_COMPLETE")
    H.eq(#c.world.questRewardCalls, 0, "GetQuestReward never called")
    local n = 0
    for _, l in ipairs(c.world.printed) do
      if l:find("pick your reward for Rude Awakening.", 1, true) then n = n + 1 end
    end
    H.eq(n, 1, "printed once")
    -- A single choice is still the player's.
    c.fire("QUEST_FINISHED")
    c.world.questFrame.choices = { two[1] }
    c.fire("QUEST_COMPLETE")
    H.eq(#c.world.questRewardCalls, 0, "one choice is still a choice")
  end)

  H.test("auto quest: fails closed when the choice count can't be read", function()
    local c = viewer(H, { onQuest = { [RUDE] = true } })
    npcWindows(c)
    c.env.GetNumQuestChoices = function() return nil end
    c.world.questFrame = { questID = RUDE, title = "Rude Awakening" }
    c.fire("QUEST_COMPLETE")
    H.eq(#c.world.questRewardCalls, 0, "GetQuestReward never called")
    H.ok(printed(c, "pick your reward for Rude Awakening"), "the player picks")
    -- It breaks by the time the beat runs (the ledger's own capture reads it first).
    c.fire("QUEST_FINISHED")
    c.world.timers = {}
    c.env.C_Timer = { After = function(secs, fn) c.world.timers[#c.world.timers + 1] = { at = c.world.clock + secs,
                                                                                         fn = fn } end }
    c.env.GetNumQuestChoices = function() return 0 end
    c.fire("QUEST_COMPLETE")
    c.env.GetNumQuestChoices = function() error("no choices API") end
    c.advance(0.2)
    H.eq(#c.world.questRewardCalls, 0, "an error is not 0 choices")
  end)

  H.test("auto quest: Shift skips the whole conversation; the next one is handled again", function()
    local c = viewer(H)
    npcWindows(c)
    c.npc.available = { { questID = RUDE, title = "Rude Awakening" } }
    c.npc.shift = true
    c.fire("GOSSIP_SHOW")
    c.npc.shift = false
    -- The player picks the quest by hand: the game closes gossip and opens the detail window.
    c.fire("GOSSIP_CLOSED")
    questWindow(c, "QUEST_DETAIL", RUDE)
    H.eq(did(c), "", "same conversation: not accepted")
    c.fire("QUEST_FINISHED")
    c.advance(5)
    c.fire("GOSSIP_SHOW")
    H.eq(did(c), "gossip accept " .. RUDE, "a new conversation")
    questWindow(c, "QUEST_DETAIL", RUDE)
    H.eq(did(c), "gossip accept " .. RUDE .. "; accept " .. RUDE)
  end)

  H.test("auto quest: a block on an auto-quest call stops auto quest for the session, not the tracker", function()
    local c = viewer(H, { tracker = true, onQuest = { [RUDE] = true } })
    npcWindows(c)
    c.fire("ADDON_ACTION_BLOCKED", "ForeverLedger", "GetQuestReward()")
    H.eq(c.env.ForeverLedgerGuideState.trackerBlocked, nil, "tracker not blocked")
    H.ok(c.env.ForeverLedgerGuide.tracker.active(), "tracker still active")
    H.ok(printed(c, "the game blocked auto quest %(GetQuestReward%(%)%): accept and turn in by hand this session"),
         "one line")
    questWindow(c, "QUEST_COMPLETE", RUDE)
    H.eq(#c.world.questRewardCalls, 0, "auto quest stopped")
    H.eq(c.env.ForeverLedgerGuideState.autoQuest, nil, "not persisted")
    c.fire("ADDON_ACTION_FORBIDDEN", "ForeverLedger", "C_GossipInfo.SelectActiveQuest()")
    H.eq(c.env.ForeverLedgerGuideState.trackerBlocked, nil, "FORBIDDEN too")
  end)

  H.test("auto quest: a quest is selected once per conversation", function()
    local c = viewer(H)
    npcWindows(c)
    c.npc.available = { { questID = RUDE, title = "Rude Awakening" } }
    c.fire("GOSSIP_SHOW")
    H.eq(did(c), "gossip accept " .. RUDE)
    -- The player closed the detail window without accepting; gossip comes back.
    c.fire("QUEST_FINISHED")
    c.fire("GOSSIP_SHOW")
    H.eq(did(c), "gossip accept " .. RUDE, "not selected again")
    c.fire("GOSSIP_CLOSED")
    c.advance(5)
    c.fire("GOSSIP_SHOW")
    H.eq(did(c), "gossip accept " .. RUDE .. "; gossip accept " .. RUDE, "a new conversation selects it again")
  end)

  H.test("auto quest: a multi-quest accept step takes the second quest when gossip reopens", function()
    local c = viewer(H, { done = { [RUDE] = true } })
    npcWindows(c)
    c.npc.available = { { questID = MINDLESS, title = "The Mindless Ones" },
                        { questID = DAMNED, title = "The Damned" } }
    c.fire("GOSSIP_SHOW")
    questWindow(c, "QUEST_DETAIL", MINDLESS)
    c.q.onQuest[MINDLESS] = true
    c.fire("QUEST_ACCEPTED", MINDLESS)
    c.fire("QUEST_FINISHED")
    c.npc.available = { { questID = DAMNED, title = "The Damned" } }
    c.fire("GOSSIP_SHOW")
    questWindow(c, "QUEST_DETAIL", DAMNED)
    H.eq(did(c), "gossip accept " .. MINDLESS .. "; accept " .. MINDLESS .. "; gossip accept " .. DAMNED
         .. "; accept " .. DAMNED)
  end)

  H.test("auto quest: a chain follow-up offered before the turn-in lands is accepted", function()
    local c = viewer(H, { onQuest = { [RUDE] = true } })
    npcWindows(c)
    c.world.timers = {}
    c.env.C_Timer = { After = function(secs, fn) c.world.timers[#c.world.timers + 1] = { at = c.world.clock + secs,
                                                                                         fn = fn } end }
    questWindow(c, "QUEST_COMPLETE", RUDE)
    c.advance(0.2)
    H.eq(table.concat(c.world.questRewardCalls, ","), "0")
    -- The NPC offers the next step's quest at once; QUEST_TURNED_IN moves the step before the beat runs.
    questWindow(c, "QUEST_DETAIL", MINDLESS)
    c.q.onQuest[RUDE], c.q.done[RUDE] = nil, true
    c.fire("QUEST_TURNED_IN", RUDE, 40, 0)
    c.advance(0.2)
    H.eq(did(c), "accept " .. MINDLESS)
  end)

  H.test("auto quest: the reward line falls back to the quest ID", function()
    local c = viewer(H, { guides = { { id = 9, char = ME, title = "T", steps = {
      { action = "turn_in", quests = { { questId = RUDE } } } } } }, onQuest = { [RUDE] = true } })
    npcWindows(c)
    c.world.questFrame = { questID = RUDE, choices = { { id = 5555, count = 1 } } }
    c.fire("QUEST_COMPLETE")
    H.ok(printed(c, "pick your reward for " .. RUDE .. "%."), "quest ID")
  end)

  H.test("auto quest: the greeting window selects by index", function()
    local c = viewer(H)
    npcWindows(c)
    c.npc.available = { { questID = 999 }, { questID = RUDE } }
    c.fire("QUEST_GREETING")
    H.eq(did(c), "greeting accept 2")
    local d = viewer(H, { onQuest = { [RUDE] = true } })
    npcWindows(d)
    d.npc.active = { { questID = 999, title = "Other", isComplete = true },
                     { questID = RUDE, title = "Rude Awakening", isComplete = true } }
    d.fire("QUEST_GREETING")
    H.eq(did(d), "greeting turn in 2")
  end)

  H.test("auto quest: /fl guide auto off stops it (kept per character); Shift or a hidden guide skips it", function()
    local c = viewer(H)
    npcWindows(c)
    c.slash("FOREVERLEDGER", "guide auto off")
    H.eq(c.env.ForeverLedgerGuideState.autoQuest, false, "persisted")
    questWindow(c, "QUEST_DETAIL", RUDE)
    H.eq(did(c), "", "off")
    c.slash("FOREVERLEDGER", "guide auto on")
    H.eq(c.env.ForeverLedgerGuideState.autoQuest, nil, "on is the default")
    questWindow(c, "QUEST_DETAIL", RUDE)
    H.eq(did(c), "accept " .. RUDE, "back on")
    c.did = {}
    c.npc.shift = true
    questWindow(c, "QUEST_DETAIL", RUDE)
    H.eq(did(c), "", "Shift held")
    c.npc.shift = false
    c.slash("FOREVERLEDGER", "guide hide")
    questWindow(c, "QUEST_DETAIL", RUDE)
    H.eq(did(c), "", "guide hidden")
    local d = viewer(H, { state = { autoQuest = false } })
    npcWindows(d)
    questWindow(d, "QUEST_DETAIL", RUDE)
    H.eq(did(d), "", "off after a reload")
  end)

  H.test("auto quest: acts a beat later, only if the same window is still open", function()
    local c = viewer(H)
    npcWindows(c)
    c.world.timers = {}
    c.env.C_Timer = { After = function(secs, fn) c.world.timers[#c.world.timers + 1] = { at = c.world.clock + secs,
                                                                                         fn = fn } end }
    questWindow(c, "QUEST_DETAIL", RUDE)
    H.eq(did(c), "", "not at once")
    c.advance(0.2)
    H.eq(did(c), "accept " .. RUDE)
    c.did = {}
    questWindow(c, "QUEST_DETAIL", RUDE)
    c.world.questFrame = nil -- closed before the beat
    c.advance(0.2)
    H.eq(did(c), "", "window gone")
  end)

  H.test("auto quest: the ledger still records the auto turn-in", function()
    local c = viewer(H, { onQuest = { [RUDE] = true } })
    npcWindows(c)
    c.world.timers = {}
    c.env.C_Timer = { After = function(secs, fn) c.world.timers[#c.world.timers + 1] = { at = c.world.clock + secs,
                                                                                         fn = fn } end }
    local db = c.env.ForeverLedgerDB
    local turnIns = #db.turnIns
    questWindow(c, "QUEST_COMPLETE", RUDE)
    c.advance(0.2)
    H.eq(table.concat(c.world.questRewardCalls, ","), "0", "the hooked GetQuestReward ran")
    local seen = false
    for key in pairs(db.quests[RUDE].obs) do
      if key:find(":complete:", 1, true) then seen = true end
    end
    H.ok(seen, "the reward window was recorded")
    c.world.questFrame = nil
    c.q.onQuest[RUDE], c.q.done[RUDE] = nil, true
    c.fire("QUEST_TURNED_IN", RUDE, 40, 0)
    H.eq(#db.turnIns, turnIns + 1, "turn-in recorded")
    H.eq(db.turnIns[#db.turnIns].questID, RUDE)
  end)

  ---------------------------------------------------------------- travel steps (guide format 2)
  local function travelViewer(opts)
    opts = opts or {}
    opts.guides = opts.guides or { travelGuide(9, ME) }
    local c = viewer(H, opts)
    c.env.ForeverLedgerGuidesData.version = 2
    return c
  end

  H.test("guide travel: walk, fly, boat and hearth steps say how to get there", function()
    local c = travelViewer({ onQuest = { [RUDE] = true } })
    local G = c.env.ForeverLedgerGuide
    local g = G.current()
    H.eq(stepNo(c), 2, "accepted: on to the walk")
    H.ok(body(c):find("Go to Brill (Travel Form)", 1, true), body(c))
    H.ok(body(c):find("Tirisfal Glades (60.0, 52.0)", 1, true), body(c))
    H.ok(G.stepText(g.steps[3], g.steps[2]):find("Fly to Doras|r", 1, true), "after a walk: at a flight master")
    H.ok(G.stepText(g.steps[3], g.steps[2]):find("Brill -> Orgrimmar", 1, true), "the flight")
    H.ok(G.stepText(g.steps[4], g.steps[3]):find("Take the Tirisfal Glades <-> Durotar to Zeppelin tower", 1, true),
      G.stepText(g.steps[4], g.steps[3]))
    H.ok(G.stepText(g.steps[5], g.steps[4]):find("Hearth to Brill|r", 1, true), G.stepText(g.steps[5], g.steps[4]))
    H.ok(not G.stepText(g.steps[5], g.steps[4]):find("Hearthstone", 1, true), "the plain note isn't repeated")
    H.ok(G.stepText(g.steps[7], g.steps[6]):find("Fly to Doras from the flight master", 1, true), "after a quest step")
    H.ok(G.stepText(g.steps[8], g.steps[7]):find("Go to Durotar|r", 1, true), "no npc: the zone")
    local boat = { action = "travel", how = "boat", npc = "Booty Bay", quests = {} }
    H.ok(G.stepText(boat):find("Take the boat to Booty Bay", 1, true), "no note: the boat")
    H.ok(G.stepText(g.steps[3], g.steps[4]):find("Fly to Doras from the flight master", 1, true), "after a boat")
    H.ok(G.stepText(g.steps[3]):find("from the flight master", 1, true), "the first step")
    local rude = { action = "travel", how = "walk", npc = "A|cffff0000B", note = "x|r", quests = {} }
    H.ok(G.stepText(rude):find("Go to A||cffff0000B (x||r)", 1, true), "escaped")
    H.ok(not body(c):find("Not in your quest log", 1, true), "no quest lines")
    H.ok(not body(c):find("Can't get one", 1, true), "no accept line")
  end)

  H.test("guide travel: done within 60 yd of the spot, checked on the quest-log refresh", function()
    local c = travelViewer({ onQuest = { [RUDE] = true } })
    standAt(c, 1420, 0.60, 0.60) -- 80 yd south of Brill (60, 52)
    c.fire("QUEST_LOG_UPDATE")
    H.eq(stepNo(c), 2, "80 yd: not there yet")
    H.eq(c.env.ForeverLedgerGuide.stepDone(c.env.ForeverLedgerGuide.current().steps[2]), false)
    c.advance(1)
    standAt(c, 1420, 0.60, 0.57) -- 50 yd
    c.fire("QUEST_LOG_UPDATE")
    H.eq(stepNo(c), 3, "50 yd: there")
    standAt(c, 1420, 0.45, 0.63) -- 1420 at Doras' coordinates: another map
    c.advance(1)
    c.fire("QUEST_LOG_UPDATE")
    H.eq(stepNo(c), 3, "the spot's map only")
  end)

  H.test("guide travel: a 2 s check runs only while the step is travel", function()
    local c = travelViewer()
    withTimers(c)
    standAt(c, 1420, 0.302, 0.716)
    c.advance(10)
    H.eq(#c.world.timers, 0, "accept step: no check")
    c.q.onQuest[RUDE] = true
    c.fire("QUEST_ACCEPTED", RUDE)
    c.advance(1)
    H.eq(stepNo(c), 2)
    H.eq(#c.world.timers, 1, "travel step: one check pending")
    c.advance(2)
    H.eq(stepNo(c), 2, "still far")
    H.eq(#c.world.timers, 1, "one check, not a pile")
    c.fire("QUEST_LOG_UPDATE")
    H.eq(#c.world.timers, 1, "a sync doesn't start a second one")
    standAt(c, 1420, 0.605, 0.52)
    c.advance(2)
    H.eq(stepNo(c), 3, "the check moved it on")
    standAt(c, 1411, 0.45, 0.63)
    c.advance(2)
    H.eq(stepNo(c), 4, "the fly step too")
    c.slash("FOREVERLEDGER", "guide use 1")
    c.env.ForeverLedgerGuideState.steps[9] = 6
    c.slash("FOREVERLEDGER", "guide show")
    H.eq(stepNo(c), 6, "a quest step")
    c.advance(2)
    c.advance(2)
    H.eq(#c.world.timers, 0, "the check stopped")
  end)

  H.test("guide travel: after a flight lands or a loading screen, on the spot's map within 300 yd", function()
    local c = travelViewer({ onQuest = { [RUDE] = true } })
    withTimers(c)
    c.slash("FOREVERLEDGER", "guide next")
    H.eq(stepNo(c), 3, "the fly step")
    standAt(c, 1411, 0.45, 0.88) -- 250 yd from Doras
    c.advance(2)
    H.eq(stepNo(c), 3, "250 yd walking: not there")
    standAt(c, 1420, 0.45, 0.63)
    c.fire("PLAYER_CONTROL_GAINED")
    H.eq(stepNo(c), 3, "landed on another map")
    c.advance(20)
    standAt(c, 1411, 0.45, 0.30) -- 330 yd
    c.fire("PLAYER_CONTROL_GAINED")
    H.eq(stepNo(c), 3, "landed too far")
    c.advance(20)
    standAt(c, 1411, 0.45, 0.88)
    c.fire("PLAYER_CONTROL_GAINED")
    H.eq(stepNo(c), 4, "landed 250 yd away: there")
    -- The boat (61, 58 on 1420): the loading screen ends before the position is known, the check after it finds it.
    c.env.C_Map.GetPlayerMapPosition = function() return nil end
    c.fire("LOADING_SCREEN_DISABLED")
    H.eq(stepNo(c), 4)
    standAt(c, 1420, 0.61, 0.80) -- 220 yd
    c.advance(2)
    H.eq(stepNo(c), 5, "the check after the loading screen, and only for the boat: the hearth spot is 280 yd off")
    standAt(c, 1420, 0.61, 0.80)
    c.advance(30)
    H.eq(stepNo(c), 5, "the window is over: 60 yd again")
  end)

  H.test("guide travel: progress past it (a quest beyond turned in) moves on; Back holds it; Next skips it", function()
    local c = travelViewer({ onQuest = { [RUDE] = true } })
    H.eq(stepNo(c), 2)
    c.q.onQuest[RUDE], c.q.done[RUDE] = nil, true
    c.fire("QUEST_TURNED_IN", RUDE, 40, 0)
    H.eq(stepNo(c), 7, "the travel steps before the turn-in are behind you")
    standAt(c, 1411, 0.45, 0.63)
    c.fire("QUEST_LOG_UPDATE")
    H.eq(stepNo(c), 8)
    c.slash("FOREVERLEDGER", "guide back")
    c.advance(1)
    c.fire("QUEST_LOG_UPDATE")
    H.eq(stepNo(c), 7, "went back by hand: stays though you stand there")
    c.slash("FOREVERLEDGER", "guide next")
    H.eq(stepNo(c), 8)
    c.slash("FOREVERLEDGER", "guide next")
    H.ok(counter(c):find("Done: all 8 steps", 1, true), counter(c))
  end)

  H.test("guide travel: the watch list stays as it was; the arrow points at the spot", function()
    local c = travelViewer()
    c.q.onQuest[RUDE] = true
    autoWatch(c, RUDE)
    c.fire("QUEST_ACCEPTED", RUDE)
    H.eq(stepNo(c), 2)
    H.eq(sortedWatches(c), tostring(RUDE), "the accepted quest stays watched")
    c.q.watches[#c.q.watches + 1] = 999
    c.slash("FOREVERLEDGER", "guide next")
    H.eq(sortedWatches(c), RUDE .. ",999", "nothing changed on a travel step")
    local A = c.env.ForeverLedgerGuide.arrow
    H.eq(A.target.npc, "Doras")
    H.eq(c.env.ForeverLedgerGuideArrow.label.text, "Doras")
    c.slash("FOREVERLEDGER", "guide next")
    c.slash("FOREVERLEDGER", "guide next")
    c.slash("FOREVERLEDGER", "guide next")
    H.eq(stepNo(c), 6)
    H.eq(sortedWatches(c), tostring(RUDE), "a quest step sets them again")
  end)

  H.test("guide travel: auto quest does nothing on a travel step", function()
    local c = travelViewer({ onQuest = { [RUDE] = true } })
    npcWindows(c)
    H.eq(stepNo(c), 2)
    questWindow(c, "QUEST_COMPLETE", RUDE)
    questWindow(c, "QUEST_DETAIL", MINDLESS)
    H.eq(did(c), "")
  end)

  H.test("guide travel: the tracker section shows the travel step", function()
    local c = travelViewer({ onQuest = { [RUDE] = true }, tracker = true })
    local b = c.tracker.draw()
    H.ok(b.lines[1]:find("Go to Brill (Travel Form)", 1, true), b.lines[1])
  end)
end
