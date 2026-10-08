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

local function body(c) return c.env.ForeverLedgerGuideFrame.body.text or "" end
local function counter(c) return c.env.ForeverLedgerGuideFrame.counter.text or "" end
local function printed(c, pattern)
  for _, l in ipairs(c.world.printed) do
    if l:find(pattern) then return true end
  end
  return false
end

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

  H.test("guide watches: finishing the guide gives your watches back", function()
    local c = viewer(H, atStep4())
    H.eq(sortedWatches(c), tostring(MINDLESS))
    -- Mindless turned in: it leaves the log (the fake keeps its watch, which the restore must drop), and steps 4 and 5
    -- are both behind the player. Damned and 999 are still in the log, so both come back.
    c.q.onQuest[MINDLESS], c.q.done[MINDLESS] = nil, true
    c.fire("QUEST_TURNED_IN", MINDLESS, 170, 0)
    H.ok(counter(c):find("Done: all 5 steps", 1, true), counter(c))
    H.eq(sortedWatches(c), DAMNED .. ",999", "your list is back")
    H.eq(c.env.ForeverLedgerGuideState.savedWatches, nil)
  end)

  H.test("guide watches: an accept during combat is re-watched after combat", function()
    local c = viewer(H, atStep4())
    c.world.inCombat = true
    c.q.onQuest[555] = true
    c.q.watches[#c.q.watches + 1] = 555 -- the game's auto-watch
    c.fire("QUEST_ACCEPTED", 555)
    c.advance(1)
    H.eq(sortedWatches(c), MINDLESS .. ",555", "nothing touched in combat")
    c.world.inCombat = false
    c.fire("PLAYER_REGEN_ENABLED")
    H.eq(sortedWatches(c), tostring(MINDLESS), "auto-watch undone after combat")
  end)
end
