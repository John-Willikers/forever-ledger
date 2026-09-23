-- ForeverLedger 0.2.2: reminders to /reload at natural checkpoints. They only print.
local S = require("scenario")

local ADDON = "../ForeverLedger/ForeverLedger.lua"
local NUDGE = "since your last /reload — type /reload"

local function session(H, overrides)
  local world = { items = S.items(), questLog = S.questLog() }
  for k, v in pairs(overrides or {}) do world[k] = v end
  local ctl = H.new(world)
  ctl.load(ADDON)
  ctl.login("ForeverLedger")
  return ctl
end

local function nudges(ctl)
  local out = {}
  for _, line in ipairs(ctl.world.printed) do
    if line:find(NUDGE, 1, true) then out[#out + 1] = line end
  end
  return out
end

local function printed(ctl, text)
  for _, line in ipairs(ctl.world.printed) do
    if line:find(text, 1, true) then return true end
  end
  return false
end

-- Enters the Deadmines (a run: 1 record) and loots Rockslicer from Rhahk'Zor (drop + item snapshot: 2 records).
local function enterAndLoot(ctl)
  ctl.world.instance = S.DEADMINES
  ctl.fire("PLAYER_ENTERING_WORLD", false, false)
  ctl.world.loot = { { itemID = 872, sourceGUID = S.NPC_RHAHK } }
  ctl.fire("LOOT_OPENED")
  ctl.world.loot = {}
end

return function(H)
  H.test("nudge: boss kill out of combat prints one reminder with the record count", function()
    local c = session(H)
    enterAndLoot(c)
    H.eq(#nudges(c), 0, "no checkpoint yet")
    c.fire("ENCOUNTER_END", 1, "Rhahk'Zor", 1, 5, 1)
    local n = nudges(c)
    H.eq(#n, 1)
    H.ok(n[1]:find("Forever Ledger:|r 3 new records since your last /reload — type /reload to save them "
      .. "(the tray app uploads within seconds).", 1, true), n[1])
  end)

  H.test("nudge: a wipe is not a checkpoint", function()
    local c = session(H)
    enterAndLoot(c)
    c.fire("ENCOUNTER_END", 1, "Rhahk'Zor", 1, 5, 0)
    H.eq(#nudges(c), 0)
  end)

  H.test("nudge: nothing new, nothing printed", function()
    local c = session(H)
    c.fire("ENCOUNTER_END", 1, "Rhahk'Zor", 1, 5, 1)
    c.fire("LFG_COMPLETION_REWARD")
    H.eq(#nudges(c), 0)
  end)

  H.test("nudge: in combat it waits for PLAYER_REGEN_ENABLED", function()
    local c = session(H)
    enterAndLoot(c)
    c.world.inCombat = true
    c.fire("ENCOUNTER_END", 1, "Rhahk'Zor", 1, 5, 1)
    H.eq(#nudges(c), 0, "deferred in combat")
    c.world.inCombat = false
    c.fire("PLAYER_REGEN_ENABLED")
    H.eq(#nudges(c), 1, "printed after combat")
    c.advance(600)
    c.fire("PLAYER_REGEN_ENABLED")
    H.eq(#nudges(c), 1, "leaving combat alone is not a checkpoint")
  end)

  H.test("nudge: UnitAffectingCombat also counts as combat", function()
    local c = session(H)
    enterAndLoot(c)
    c.env.InCombatLockdown = function() return false end
    c.env.UnitAffectingCombat = function() return true end
    c.fire("ENCOUNTER_END", 1, "Rhahk'Zor", 1, 5, 1)
    H.eq(#nudges(c), 0)
  end)

  H.test("nudge: at most one per 5 minutes", function()
    local c = session(H)
    enterAndLoot(c)
    c.fire("ENCOUNTER_END", 1, "Rhahk'Zor", 1, 5, 1)
    H.eq(#nudges(c), 1)
    c.advance(60)
    c.fire("QUEST_TURNED_IN", 1234, 850, 500)
    c.advance(200)
    c.fire("LFG_COMPLETION_REWARD")
    H.eq(#nudges(c), 1, "throttled")
    c.advance(40)
    c.fire("QUEST_TURNED_IN", 1235, 900, 500)
    local n = nudges(c)
    H.eq(#n, 2)
    H.ok(n[2]:find("|r 5 new records", 1, true), n[2])
  end)

  H.test("nudge: closing a run and a dungeon finder reward are checkpoints", function()
    local c = session(H)
    enterAndLoot(c)
    c.world.instance = nil
    c.fire("ZONE_CHANGED_NEW_AREA")
    H.eq(#nudges(c), 1, "run closed")
    local d = session(H)
    enterAndLoot(d)
    d.fire("LFG_COMPLETION_REWARD")
    H.eq(#nudges(d), 1, "LFG reward")
  end)

  H.test("nudge: /fl nudge off and on", function()
    local c = session(H)
    enterAndLoot(c)
    c.slash("FOREVERLEDGER", "nudge off")
    c.fire("ENCOUNTER_END", 1, "Rhahk'Zor", 1, 5, 1)
    H.eq(#nudges(c), 0)
    c.slash("FOREVERLEDGER", "")
    H.ok(printed(c, "3 new records since your last /reload (saved on the next /reload); reminders off."),
      "status shows the count and the switch")
    c.slash("FOREVERLEDGER", "nudge on")
    c.fire("ENCOUNTER_END", 2, "Edwin VanCleef", 1, 5, 1)
    H.eq(#nudges(c), 1)
  end)

  H.test("nudge: a full session counts every new record once", function()
    local c = H.new({ items = S.items(), questLog = S.questLog() })
    c.load(ADDON)
    S.play(c, "ForeverLedger")
    c.world.printed = {}
    c.slash("FOREVERLEDGER", "")
    -- detail obs, 2 item snapshots (5555, 5556), accept obs, run, drop, snapshot 872, complete obs, turn-in.
    -- Not counted: the reopened corpse, the resumed run, refreshed observations and already-snapshotted items.
    H.ok(printed(c, "|r 9 new records since your last /reload"), table.concat(c.world.printed, "\n"))
    -- scanning the log adds one "log" observation
    c.world.printed = {}
    c.slash("FOREVERLEDGER", "scanlog")
    c.slash("FOREVERLEDGER", "")
    H.ok(printed(c, "|r 10 new records"), table.concat(c.world.printed, "\n"))
  end)

  H.test("nudge: bookkeeping stays out of SavedVariables", function()
    local c = session(H)
    enterAndLoot(c)
    c.fire("ENCOUNTER_END", 1, "Rhahk'Zor", 1, 5, 1)
    c.slash("FOREVERLEDGER", "nudge off")
    local d = c.env.ForeverLedgerDB
    local keys = {}
    for k in pairs(d) do keys[#keys + 1] = k end
    table.sort(keys)
    H.eq(table.concat(keys, ","), "chars,drops,items,meta,quests,runs,turnIns")
    local meta = {}
    for k in pairs(d.meta) do meta[#meta + 1] = k end
    table.sort(meta)
    H.eq(table.concat(meta, ","), "addonVersion,build,buildDate,interface,lastChar,schemaVersion,version")
    H.eq(d.meta.schemaVersion, 2)
  end)
end
