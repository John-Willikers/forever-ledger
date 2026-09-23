-- ForeverLedger 0.2.3: the chosen quest reward, and item objectives that come back without a name.
local S = require("scenario")

local ADDON = "../ForeverLedger/ForeverLedger.lua"
local FOREVER_BUILD = { "1.60.1", "69977", "Sep 22 2026", 16001 }

local function session(H, overrides)
  local world = { items = S.items(), questLog = S.questLog() }
  for k, v in pairs(overrides or {}) do world[k] = v end
  local ctl = H.new(world)
  ctl.load(ADDON)
  ctl.login("ForeverLedger")
  return ctl
end

-- Opens the reward window for questID, optionally clicks Complete with `pick`, then the server confirms turnedIn.
local function turnIn(ctl, questID, choices, pick, turnedIn)
  local w = ctl.world
  w.npc = { name = "Marshal Dughan", guid = S.NPC_DUGHAN }
  w.questFrame = { questID = questID, title = "Quest " .. questID, xp = 100, money = 10, choices = choices }
  ctl.fire("QUEST_COMPLETE")
  if pick then ctl.env.GetQuestReward(pick) end
  w.questFrame, w.npc = nil, nil
  ctl.fire("QUEST_TURNED_IN", turnedIn or questID, 100, 10)
  local list = ctl.env.ForeverLedgerDB.turnIns
  return list[#list]
end

local TWO_CHOICES = { { id = 5555, count = 1 }, { id = 5556, count = 1 } }

-- Sarkoth-style log: a blank item objective next to a kill objective quest.
local function blankLog()
  return {
    { title = "Durotar", isHeader = true },
    { title = "Sarkoth", level = 4, questID = 790, objectives = { "0/1  " } },
    { title = "Vile Familiars", level = 3, questID = 792, objectives = { "0/12 Vile Familiar slain" } },
  }
end

local function logEntryFor(ctl, questID)
  for _, e in ipairs(ctl.world.questLog) do
    if e.questID == questID then return e end
  end
end

local function count(list, value)
  local n = 0
  for _, v in ipairs(list) do if v == value then n = n + 1 end end
  return n
end

return function(H)
  ---------------------------------------------------------------- chosen reward
  H.test("choice: the picked reward is recorded on the turn-in with index and itemID", function()
    local c = session(H)
    local t = turnIn(c, 1234, TWO_CHOICES, 2)
    H.eq(t.choice.index, 2)
    H.eq(t.choice.itemID, 5556)
    H.eq(c.world.questRewardCalls[1], 2, "the original GetQuestReward still ran")
  end)

  H.test("choice: falls back to the reward window link when QUEST_COMPLETE was missed", function()
    local c = session(H)
    c.world.questFrame = { questID = 1234, choices = TWO_CHOICES }
    c.env.GetQuestReward(1)
    c.world.questFrame = nil
    c.fire("QUEST_TURNED_IN", 1234, 100, 10)
    local t = c.env.ForeverLedgerDB.turnIns[1]
    H.eq(t.choice.index, 1)
    H.eq(t.choice.itemID, 5555)
  end)

  H.test("choice: none when the quest had no choices", function()
    local c = session(H)
    H.eq(turnIn(c, 1234, nil, 0).choice, nil)
    H.eq(turnIn(c, 1235, nil, 1).choice, nil)
    H.eq(turnIn(c, 1236, {}, nil).choice, nil)
  end)

  H.test("choice: not attached to a different quest's turn-in, kept for its own", function()
    local c = session(H)
    local other = turnIn(c, 1234, TWO_CHOICES, 1, 999)
    H.eq(other.questID, 999)
    H.eq(other.choice, nil)
    c.fire("QUEST_TURNED_IN", 1234, 100, 10)
    local t = c.env.ForeverLedgerDB.turnIns[2]
    H.eq(t.choice.itemID, 5555)
    c.advance(1)
    c.fire("QUEST_TURNED_IN", 1234, 100, 10)
    H.eq(c.env.ForeverLedgerDB.turnIns[3].choice, nil, "a pick is used once")
  end)

  H.test("choice: a pick older than 60 s is dropped", function()
    local c = session(H)
    c.world.questFrame = { questID = 1234, choices = TWO_CHOICES }
    c.fire("QUEST_COMPLETE")
    c.env.GetQuestReward(1)
    c.world.questFrame = nil
    c.advance(61)
    c.fire("QUEST_TURNED_IN", 1234, 100, 10)
    H.eq(c.env.ForeverLedgerDB.turnIns[1].choice, nil)
  end)

  H.test("choice: an out-of-range index is ignored", function()
    local c = session(H)
    H.eq(turnIn(c, 1234, TWO_CHOICES, 3).choice, nil)
  end)

  H.test("choice: clients without hooksecurefunc or GetQuestReward still record turn-ins", function()
    for _, name in ipairs({ "hooksecurefunc", "GetQuestReward" }) do
      local c = session(H, { missing = { [name] = true } })
      local t = turnIn(c, 1234, TWO_CHOICES, nil)
      H.eq(t.questID, 1234, name)
      H.eq(t.choice, nil, name)
    end
  end)

  H.test("choice: a turn-in with a choice is still one new record", function()
    local function newRecordsAfter(pick)
      local c = session(H)
      turnIn(c, 1234, TWO_CHOICES, pick)
      c.world.printed = {}
      c.slash("FOREVERLEDGER", "")
      for _, line in ipairs(c.world.printed) do
        local n = line:match("(%d+) new records? since your last /reload %(saved")
        if n then return tonumber(n) end
      end
    end
    H.ok(newRecordsAfter(nil), "count printed")
    H.eq(newRecordsAfter(1), newRecordsAfter(nil))
  end)

  ---------------------------------------------------------------- objectives
  H.test("objectives: blank item objective is filled after QUEST_DATA_LOAD_RESULT", function()
    local c = session(H, { api = "forever", buildInfo = FOREVER_BUILD, questLog = blankLog() })
    c.fire("QUEST_ACCEPTED", 790)
    local q = c.env.ForeverLedgerDB.quests[790]
    H.eq(q.objectives[1], "0/1  ")
    H.eq(count(c.world.questLoadRequests, 790), 1)
    c.fire("QUEST_ACCEPTED", 790)
    H.eq(count(c.world.questLoadRequests, 790), 1, "load is requested once")

    logEntryFor(c, 790).objectives = { "0/1 Sarkoth's Mangled Claw" }
    c.fire("QUEST_DATA_LOAD_RESULT", 790, true)
    H.eq(q.objectives[1], "0/1 Sarkoth's Mangled Claw")

    -- filled: no longer tracked, later progress text is not copied in
    logEntryFor(c, 790).objectives = { "1/1 Sarkoth's Mangled Claw" }
    c.advance(5)
    c.fire("QUEST_LOG_UPDATE")
    c.fire("QUEST_WATCH_UPDATE", 790)
    H.eq(q.objectives[1], "0/1 Sarkoth's Mangled Claw")
  end)

  H.test("objectives: QUEST_WATCH_UPDATE re-reads a blank quest", function()
    local c = session(H, { api = "forever", buildInfo = FOREVER_BUILD, questLog = blankLog() })
    c.fire("QUEST_ACCEPTED", 790)
    logEntryFor(c, 790).objectives = { "0/1 Sarkoth's Mangled Claw" }
    c.fire("QUEST_WATCH_UPDATE", 790)
    H.eq(c.env.ForeverLedgerDB.quests[790].objectives[1], "0/1 Sarkoth's Mangled Claw")
  end)

  H.test("objectives: QUEST_LOG_UPDATE re-reads at most once per 2 s", function()
    local c = session(H, { api = "forever", buildInfo = FOREVER_BUILD, questLog = blankLog() })
    c.fire("QUEST_ACCEPTED", 790)
    local q = c.env.ForeverLedgerDB.quests[790]
    c.fire("QUEST_LOG_UPDATE") -- re-reads, still blank
    logEntryFor(c, 790).objectives = { "0/1 Sarkoth's Mangled Claw" }
    c.fire("QUEST_LOG_UPDATE")
    H.eq(q.objectives[1], "0/1  ", "throttled")
    c.advance(2)
    c.fire("QUEST_LOG_UPDATE")
    H.eq(q.objectives[1], "0/1 Sarkoth's Mangled Claw")
  end)

  H.test("objectives: kill objectives are not tracked or re-read", function()
    local c = session(H, { api = "forever", buildInfo = FOREVER_BUILD, questLog = blankLog() })
    c.fire("QUEST_ACCEPTED", 792)
    local q = c.env.ForeverLedgerDB.quests[792]
    H.eq(q.objectives[1], "0/12 Vile Familiar slain")
    H.eq(#c.world.questLoadRequests, 0)
    logEntryFor(c, 792).objectives = { "5/12 Vile Familiar slain" }
    c.advance(5)
    c.fire("QUEST_LOG_UPDATE")
    c.fire("QUEST_DATA_LOAD_RESULT", 792, true)
    H.eq(q.objectives[1], "0/12 Vile Familiar slain")
  end)

  H.test("objectives: a named objective is never replaced by a blank one", function()
    local log = blankLog()
    log[2].objectives = { "0/10 Scorpid Worker Tail", "0/6  " }
    local c = session(H, { api = "forever", buildInfo = FOREVER_BUILD, questLog = log })
    c.fire("QUEST_ACCEPTED", 790)
    local q = c.env.ForeverLedgerDB.quests[790]
    logEntryFor(c, 790).objectives = { "0/10  ", "0/6 Cactus Apple" }
    c.fire("QUEST_DATA_LOAD_RESULT", 790, true)
    H.eq(q.objectives[1], "0/10 Scorpid Worker Tail")
    H.eq(q.objectives[2], "0/6 Cactus Apple")
  end)

  H.test("objectives: a quest that leaves the log stops being tracked", function()
    local c = session(H, { api = "forever", buildInfo = FOREVER_BUILD, questLog = blankLog() })
    c.fire("QUEST_ACCEPTED", 790)
    local e = table.remove(c.world.questLog, 2)
    c.advance(5)
    c.fire("QUEST_LOG_UPDATE")
    e.objectives = { "0/1 Sarkoth's Mangled Claw" }
    table.insert(c.world.questLog, 2, e)
    c.fire("QUEST_DATA_LOAD_RESULT", 790, true)
    H.eq(c.env.ForeverLedgerDB.quests[790].objectives[1], "0/1  ")
  end)

  H.test("objectives: Classic leaderboard fallback without C_QuestLog", function()
    local c = session(H, { questLog = blankLog() })
    c.fire("QUEST_ACCEPTED", 2, 790)
    local q = c.env.ForeverLedgerDB.quests[790]
    H.eq(q.objectives[1], "0/1  ")
    logEntryFor(c, 790).objectives = { "Sarkoth's Mangled Claw: 0/1" }
    c.advance(2)
    c.fire("QUEST_LOG_UPDATE")
    H.eq(q.objectives[1], "Sarkoth's Mangled Claw: 0/1")
  end)

  H.test("objectives: bookkeeping stays out of SavedVariables", function()
    local c = session(H, { api = "forever", buildInfo = FOREVER_BUILD, questLog = blankLog() })
    c.fire("QUEST_ACCEPTED", 790)
    local q = c.env.ForeverLedgerDB.quests[790]
    local keys = {}
    for k in pairs(q) do keys[#keys + 1] = k end
    table.sort(keys)
    H.eq(table.concat(keys, ","), "category,id,level,objectives,obs,title")
  end)
end
