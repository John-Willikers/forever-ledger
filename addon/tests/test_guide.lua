-- The guide viewer (GuideViewer.lua): guides the tray wrote into ForeverLedgerGuidesData, shown a step at a time and
-- moved on as quests are accepted, finished and turned in.
local ADDON = "../ForeverLedger/ForeverLedger.lua"
local VIEWER = "../ForeverLedger/GuideViewer.lua"

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

-- A Forever character with a surname, its quest log state in `q` (onQuest / done / ready / objectives).
local function viewer(H, opts)
  opts = opts or {}
  local c = H.new({ rejectTemplates = opts.rejectTemplates or {} })
  c.world.player.surname = "Willikers"
  local q = { onQuest = {}, done = opts.done or {}, ready = {}, objectives = {}, pins = {} }
  c.q = q
  c.env.C_QuestLog = {
    IsQuestFlaggedCompleted = function(id) return q.done[id] == true end,
    IsOnQuest = function(id) return q.onQuest[id] == true end,
    ReadyForTurnIn = function(id) return q.ready[id] == true end,
    IsComplete = function() return false end,
    GetQuestObjectives = function(id) return q.objectives[id] or {} end,
  }
  c.env.C_Map = {
    CanSetUserWaypointOnMap = function() return true end,
    SetUserWaypoint = function(p) q.pins[#q.pins + 1] = p end,
  }
  c.env.UiMapPoint = { CreateFromCoordinates = function(m, x, y) return { map = m, x = x, y = y } end }
  c.env.C_SuperTrack = { SetSuperTrackedUserWaypoint = function(v) q.tracked = v end }
  c.env.ForeverLedgerGuidesData = { version = 1, written = 1, guides = opts.guides or { guide(7, ME) } }
  c.env.ForeverLedgerGuideState = opts.state
  c.load(ADDON)
  c.load(VIEWER)
  c.login("ForeverLedger")
  c.advance(4)
  return c
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
end
