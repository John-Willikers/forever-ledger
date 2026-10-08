-- Schema 10: where each character stands, for the route planner (db.charState, db.xpCurve), and the trips it takes
-- (db.trips). Client shapes from probe 0.6.0 on build 70245 (fixtures/real/probe-70245-travel.json).
local P = require("professions_world")

local B = P.B
local ME = "Thibodeaux-Bayou"
local ZOMBIES, RATTLE = 364, 3901
local UNDERCITY = { zone = "Undercity", subzone = "Trade Quarter", mapID = 1458, x = 0.67594, y = 0.37851 }
local BRILL = { zone = "Tirisfal Glades", subzone = "Brill", mapID = 1420, x = 0.60712, y = 0.54263 }

-- Orgrimmar's flight master (taxi map 1464): Orgrimmar is where you stand, Splintertree is learned, Sun Rock isn't.
local function orgrimmarNodes()
  return {
    { nodeID = 22, name = "Thunder Bluff, Mulgore", x = 0.4495, y = 0.5615, state = 1, slotIndex = 1 },
    { nodeID = 23, name = "Orgrimmar, Durotar", x = 0.628, y = 0.4434, state = 0, slotIndex = 2 },
    { nodeID = 29, name = "Sun Rock Retreat, Stonetalon Mountains", x = 0.408, y = 0.4726, state = 2, slotIndex = 4 },
    { nodeID = 61, name = "Splintertree Post, Ashenvale", x = 0.5544, y = 0.4177, state = 1, slotIndex = 14 },
  }
end

local function travel()
  return {
    completed = { 790, 4641, 364, 805 },
    bind = "Undercity",
    mounts = { { id = 6, collected = true }, { id = 9, collected = false }, { id = 14, collected = true } },
    mapSizes = { [1458] = { 1306.25, 870.83 }, [1420] = { 4518.75, 3012.5 }, [1411] = { 5287.5, 3525 },
                 [1454] = { 1739.37, 1159.58 }, [1440] = { 5766.67, 3843.75 }, [1414] = { 22033.4, 14689.6 } },
  }
end

local function questLog()
  return {
    { title = "Tirisfal Glades", isHeader = true },
    { title = "The Mindless Ones", level = 2, questID = ZOMBIES,
      objectives = { "3/8 Mindless Zombie slain", "0/8 Wretched Zombie slain" } },
    { title = "Rattling the Rattlecages", level = 3, questID = RATTLE,
      objectives = { "12/12 Rattlecage Skeleton slain" } },
  }
end

-- A Forever client with the travel APIs, logged in at Brill.
local function login(H, overrides)
  local o = { api = "forever", travelAPI = true, travel = travel(), questLog = questLog(), zone = BRILL }
  for k, v in pairs(overrides or {}) do o[k] = v end
  return P.session(H, o)
end

local function stateOf(c) return c.env.ForeverLedgerDB.charState[ME] end

local function errors(c)
  local e = c.env.ForeverLedgerDB.apiSamples["ForeverLedger.errors"]
  if not e then return "" end
  local out = {}
  for place, x in pairs(e.sample) do out[#out + 1] = place .. ": " .. x.msg end
  return table.concat(out, "; ")
end

local function printed(c, text)
  for _, line in ipairs(c.world.printed) do
    if line:find(text, 1, true) then return true end
  end
  return false
end

return function(H)
  H.test("state: login records level, xp, completed quests, bind zone and mounts", function()
    local c = login(H)
    local s = stateOf(c)
    H.ok(s, "a state per character")
    H.eq(s.build, B)
    H.eq(s.level, 10)
    H.eq(s.xp, 0)
    H.eq(s.xpMax, 7600)
    H.eq(table.concat(s.completed, ","), "364,790,805,4641", "sorted quest ids")
    H.eq(s.completedAt, c.world.clock)
    H.eq(s.bind.zone, "Undercity")
    H.eq(s.bind.spot, nil, "no spot until the hearth is set")
    H.eq(s.mount.owned, 2)
    H.eq(s.mount.mounted, false)
    H.eq(c.env.ForeverLedgerDB.xpCurve[B][10], 7600, "xp curve: XP needed for level 10")
    H.eq(errors(c), "")
  end)

  H.test("state: a turn-in refreshes the completed quests at most once per 10 s", function()
    local c = login(H)
    H.eq(c.world.calls.GetAllCompletedQuestIDs, 1)
    table.insert(c.world.travel.completed, 365)
    c.advance(30)
    c.fire("QUEST_TURNED_IN", 365, 450, 0)
    table.insert(c.world.travel.completed, 366)
    c.fire("QUEST_TURNED_IN", 366, 450, 0)
    H.eq(c.world.calls.GetAllCompletedQuestIDs, 1, "read a moment later, not in the event")
    c.advance(10)
    H.eq(c.world.calls.GetAllCompletedQuestIDs, 2, "two turn-ins, one read")
    H.eq(table.concat(stateOf(c).completed, ","), "364,365,366,790,805,4641")
    c.fire("QUEST_TURNED_IN", 790, 100, 0)
    c.advance(5)
    H.eq(c.world.calls.GetAllCompletedQuestIDs, 2, "within 10 s of the last read")
    c.advance(6)
    H.eq(c.world.calls.GetAllCompletedQuestIDs, 3)
  end)

  H.test("state: logout records position, quest log, hearth cooldown and mount", function()
    local c = login(H)
    c.world.zone = UNDERCITY
    c.world.travel.mounted = true
    c.advance(1)
    c.world.travel.hearthCD = { c.world.clock - 3000, 3600 } -- used 50 min ago: 600 s left
    c.fire("PLAYER_LOGOUT")
    local s = stateOf(c)
    H.eq(s.pos.mapID, 1458)
    H.eq(s.pos.x, 0.6759, "0..1, 4 places")
    H.eq(s.pos.y, 0.3785)
    H.eq(s.pos.zone, "Undercity")
    H.eq(s.pos.subzone, "Trade Quarter")
    H.eq(s.pos.at, c.world.clock)
    H.eq(#s.log, 2)
    H.eq(s.log[1].id, ZOMBIES)
    H.eq(table.concat(s.log[1].done, ","), "3,0")
    H.eq(s.log[2].id, RATTLE)
    H.eq(table.concat(s.log[2].done, ","), "12")
    H.eq(s.hearthReadyAt, c.world.clock + 600)
    H.eq(s.mount.mounted, true)
    H.eq(errors(c), "")
  end)

  H.test("state: a ready hearthstone is 0", function()
    local c = login(H)
    c.world.travel.hearthCD = { c.world.clock - 4000, 3600 }
    c.fire("PLAYER_LOGOUT")
    H.eq(stateOf(c).hearthReadyAt, 0)
    c.world.travel.hearthCD = { 0, 0 }
    c.fire("PLAYER_LOGOUT")
    H.eq(stateOf(c).hearthReadyAt, 0)
  end)

  H.test("state: setting the hearth records the spot; a new bind zone at login drops it", function()
    local c = login(H)
    c.world.travel.bind = "Brill"
    c.advance(5)
    c.fire("HEARTHSTONE_BOUND")
    local b = stateOf(c).bind
    H.eq(b.zone, "Brill")
    H.eq(b.spot.mapID, 1420)
    H.eq(b.spot.x, 0.6071)
    H.eq(b.spot.y, 0.5426)
    H.eq(b.at, c.world.clock)
    -- the next login with the same bind keeps the spot
    local saved = c.env.ForeverLedgerDB
    local again = P.session(H, { api = "forever", travelAPI = true, questLog = questLog(), zone = BRILL,
                                 travel = (function() local t = travel(); t.bind = "Brill"; return t end)() },
                            H.copy(saved))
    H.eq(stateOf(again).bind.spot.mapID, 1420, "same bind: spot kept")
    local moved = P.session(H, { api = "forever", travelAPI = true, questLog = questLog(), zone = BRILL,
                                 travel = travel() }, H.copy(saved))
    H.eq(stateOf(moved).bind.zone, "Undercity")
    H.eq(stateOf(moved).bind.spot, nil, "bound elsewhere since: the old spot is gone")
  end)

  H.test("state: the flight map records its nodes and their state", function()
    local c = login(H)
    c.world.travel.taxiMapID = 1464
    c.world.travel.taxiNodes = orgrimmarNodes()
    c.fire("TAXIMAP_OPENED", 1)
    local t = stateOf(c).taxi[1464]
    H.ok(t, "taxi map 1464")
    H.eq(t.at, c.world.clock)
    H.eq(#t.nodes, 4)
    H.eq(t.nodes[2].id, 23)
    H.eq(t.nodes[2].name, "Orgrimmar, Durotar")
    H.eq(t.nodes[2].x, 0.628)
    H.eq(t.nodes[2].y, 0.4434)
    H.eq(t.nodes[2].state, 0, "current")
    H.eq(t.nodes[3].state, 2, "not learned")
    H.eq(t.nodes[4].state, 1, "learned")
  end)

  H.test("state: a level up records the new level's XP in the curve", function()
    local c = login(H)
    c.world.player.level, c.world.player.xp, c.world.player.xpMax = 11, 120, 8800
    c.fire("PLAYER_LEVEL_UP", 11)
    c.advance(2)
    H.eq(c.env.ForeverLedgerDB.xpCurve[B][10], 7600)
    H.eq(c.env.ForeverLedgerDB.xpCurve[B][11], 8800)
    local s = stateOf(c)
    H.eq(s.level, 11)
    H.eq(s.xp, 120)
    H.eq(s.xpMax, 8800)
  end)

  H.test("state: a client without these APIs records nothing of theirs and throws nothing", function()
    local c = P.session(H, { questLog = questLog(), zone = BRILL,
                             missing = { C_Map = true } })
    c.fire("QUEST_TURNED_IN", 365, 450, 0)
    c.fire("HEARTHSTONE_BOUND")
    c.fire("TAXIMAP_OPENED", 1)
    c.fire("PLAYER_LEVEL_UP", 11)
    c.advance(20)
    c.fire("PLAYER_LOGOUT")
    c.slash("FOREVERLEDGER", "state")
    local s = stateOf(c)
    H.eq(s.completed, nil)
    H.eq(s.bind, nil)
    H.eq(s.taxi, nil)
    H.eq(s.mount, nil)
    H.eq(s.hearthReadyAt, nil)
    H.eq(s.pos, nil)
    H.eq(s.level, 10, "UnitLevel is everywhere")
    H.eq(errors(c), "")
  end)

  H.test("state: caps hold (35 log quests, 5000 completed, 4 taxi maps of 80 nodes)", function()
    local t = travel()
    t.completed = {}
    for i = 1, 6000 do t.completed[i] = 7000 - i end
    local log = {}
    for i = 1, 40 do log[i] = { title = "Q" .. i, level = 5, questID = 1000 + i, objectives = { "0/1 Thing" } } end
    local c = login(H, { travel = t, questLog = log })
    c.fire("PLAYER_LOGOUT")
    local s = stateOf(c)
    H.eq(#s.completed, 5000)
    H.eq(s.completed[1], 1000, "the lowest ids are kept")
    H.eq(#s.log, 35)
    local nodes = {}
    for i = 1, 100 do nodes[i] = { nodeID = i, name = "N" .. i, x = 0.5, y = 0.5, state = 1, slotIndex = i } end
    c.world.travel.taxiNodes = nodes
    for _, id in ipairs({ 1464, 1465, 1466, 1467, 1468 }) do
      c.world.travel.taxiMapID = id
      c.advance(1)
      c.fire("TAXIMAP_OPENED", 1)
    end
    H.eq(H.count(s.taxi), 4)
    H.eq(s.taxi[1464], nil, "the oldest map goes")
    H.eq(#s.taxi[1468].nodes, 80)
  end)

  H.test("state: the character key moves with a surname that arrives after login", function()
    local c = login(H)
    H.ok(stateOf(c), "first written under the short key")
    c.world.player.surname = "Willikers"
    c.fire("PLAYER_LOGOUT")
    local d = c.env.ForeverLedgerDB
    H.eq(d.charState[ME], nil)
    H.eq(d.charState["Thibodeaux Willikers-Bayou"].bind.zone, "Undercity", "login data kept")
  end)

  H.test("state: /fl state prints what is recorded for this character", function()
    local c = login(H)
    c.world.travel.taxiMapID = 1464
    c.world.travel.taxiNodes = orgrimmarNodes()
    c.fire("TAXIMAP_OPENED", 1)
    c.world.travel.hearthCD = { c.world.clock - 1200, 3600 }
    c.fire("PLAYER_LOGOUT")
    c.world.printed = {}
    c.slash("FOREVERLEDGER", "state")
    H.ok(printed(c, "level 10 (0/7600 XP), 4 quests completed, 2 in the log, bound to Undercity, hearth ready in "
      .. "40 min, 3 flight paths, 2 mounts (not mounted)"), table.concat(c.world.printed, "\n"))
  end)

  H.test("state: /fl reset confirm wipes state, curve and trips", function()
    local c = login(H)
    c.slash("FOREVERLEDGER", "reset confirm")
    local d = c.env.ForeverLedgerDB
    H.eq(next(d.charState), nil)
    H.eq(next(d.xpCurve), nil)
    H.eq(next(d.trips), nil)
  end)
end
