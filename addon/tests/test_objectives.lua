-- Schema 9: where quest objectives get done (db.objectiveProgress), for guides' "complete" steps.
local P = require("professions_world")

local ZOMBIES, RATTLE = 364, 3901

local function questing(H)
  local c = P.session(H, {
    api = "forever", -- C_QuestLog.GetQuestObjectives, as on Forever
    questLog = {
      { title = "Tirisfal Glades", isHeader = true },
      { title = "The Mindless Ones", level = 2, questID = ZOMBIES,
        objectives = { "0/8 Mindless Zombie slain", "0/8 Wretched Zombie slain" } },
    },
  })
  c.world.zone = { zone = "Tirisfal Glades", subzone = "Deathknell", mapID = 1420, x = 0.312, y = 0.684 }
  c.advance(4) -- the login's baseline read
  return c
end

local function entry(c, questID)
  for _, e in ipairs(c.world.questLog) do
    if e.questID == questID then return e end
  end
end

return function(H)
  H.test("objectives: each increment is recorded where it happened", function()
    local c = questing(H)
    local d = c.env.ForeverLedgerDB
    H.eq(#d.objectiveProgress, 0, "the baseline records nothing")
    entry(c, ZOMBIES).objectives[1] = "1/8 Mindless Zombie slain"
    c.fire("QUEST_WATCH_UPDATE", ZOMBIES)
    c.fire("QUEST_LOG_UPDATE")
    H.eq(#d.objectiveProgress, 1)
    local p = d.objectiveProgress[1]
    H.eq(p.questID, ZOMBIES)
    H.eq(p.index, 1)
    H.eq(p.have, 1)
    H.eq(p.need, 8)
    H.eq(p.text, "1/8 Mindless Zombie slain")
    H.eq(p.subzone, "Deathknell")
    H.eq(p.mapID, 1420)
    H.eq(p.x, 31.2)
    H.eq(p.y, 68.4)
    H.ok(p.char and p.build and p.time, "char, build, time")
  end)

  H.test("objectives: read half a second after the watch event; a log update alone records nothing", function()
    local c = questing(H)
    local d = c.env.ForeverLedgerDB
    entry(c, ZOMBIES).objectives[2] = "2/8 Wretched Zombie slain"
    c.fire("QUEST_LOG_UPDATE")
    H.eq(#d.objectiveProgress, 0, "only a watched quest is compared")
    c.fire("QUEST_WATCH_UPDATE", ZOMBIES)
    c.advance(1)
    H.eq(#d.objectiveProgress, 1)
    H.eq(d.objectiveProgress[1].index, 2)
    c.fire("QUEST_WATCH_UPDATE", ZOMBIES)
    c.fire("QUEST_LOG_UPDATE")
    H.eq(#d.objectiveProgress, 1, "the same count again is not progress")
  end)

  H.test("objectives: a new quest's first read only sets its counts", function()
    local c = questing(H)
    local d = c.env.ForeverLedgerDB
    table.insert(c.world.questLog, { title = "Rattling the Rattlecages", level = 3, questID = RATTLE,
                                     objectives = { "3/12 Rattlecage Skeleton slain" } })
    c.fire("QUEST_ACCEPTED", RATTLE)
    H.eq(#d.objectiveProgress, 0)
    entry(c, RATTLE).objectives[1] = "4/12 Rattlecage Skeleton slain"
    c.fire("QUEST_WATCH_UPDATE", RATTLE)
    c.fire("QUEST_LOG_UPDATE")
    H.eq(#d.objectiveProgress, 1)
    H.eq(d.objectiveProgress[1].have, 4)
  end)

  H.test("objectives: /fl reset confirm wipes them", function()
    local c = questing(H)
    entry(c, ZOMBIES).objectives[1] = "1/8 Mindless Zombie slain"
    c.fire("QUEST_WATCH_UPDATE", ZOMBIES)
    c.fire("QUEST_LOG_UPDATE")
    c.slash("FOREVERLEDGER", "reset confirm")
    H.eq(next(c.env.ForeverLedgerDB.objectiveProgress), nil)
  end)
end
