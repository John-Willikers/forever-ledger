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

  H.test("state: an empty completed list never replaces a recorded one; it is read again 5 s later", function()
    local c = login(H)
    local saved = c.env.ForeverLedgerDB
    local t = travel()
    t.completed = {} -- quest data not loaded yet right after login
    local again = P.session(H, { api = "forever", travelAPI = true, travel = t, questLog = questLog(), zone = BRILL },
                            H.copy(saved))
    H.eq(table.concat(stateOf(again).completed, ","), "364,790,805,4641", "the old list is kept")
    H.eq(again.world.calls.GetAllCompletedQuestIDs, 1)
    again.world.travel.completed = { 790, 4641, 364, 805, 9000 }
    again.advance(4)
    H.eq(again.world.calls.GetAllCompletedQuestIDs, 1, "not before 5 s")
    again.advance(1)
    H.eq(again.world.calls.GetAllCompletedQuestIDs, 2, "one retry")
    H.eq(table.concat(stateOf(again).completed, ","), "364,790,805,4641,9000")
    -- empty again (the read and its one retry): kept, and the retry doesn't try again
    again.world.travel.completed = {}
    again.fire("PLAYER_LOGOUT")
    H.eq(#stateOf(again).completed, 5)
    for _ = 1, 15 do again.advance(2) end
    H.eq(again.world.calls.GetAllCompletedQuestIDs, 4, "one retry, no more")
    H.eq(#stateOf(again).completed, 5)
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

  ---------------------------------------------------------------- trips
  -- The harness's advance moves the clock first and then runs the timers that are due, so the 2 s sampler gets one
  -- sample per advance: waits go in 2 s steps.
  local function wait(c, secs)
    for _ = 1, secs / 2 do c.advance(2) end
  end
  -- Moves the player by (dx, dy) on the map every 2 s for `ticks` ticks (the addon samples every 2 s).
  local function move(c, ticks, dx, dy)
    for _ = 1, ticks do
      c.world.zone.x, c.world.zone.y = c.world.zone.x + dx, c.world.zone.y + dy
      c.advance(2)
    end
  end
  local function at(zone, subzone, mapID, x, y)
    return { zone = zone, subzone = subzone, mapID = mapID, x = x, y = y }
  end
  local function tripsOf(c) return c.env.ForeverLedgerDB.trips end

  local function orgrimmar()
    local c = login(H, { zone = at("Orgrimmar", "Valley of Strength", 1454, 0.4525, 0.6393) })
    c.world.travel.taxiMapID = 1464
    c.world.travel.taxiNodes = orgrimmarNodes()
    c.fire("TAXIMAP_OPENED", 1)
    return c
  end

  H.test("trips: a flight is timed from losing control to getting it back, with both nodes", function()
    local c = orgrimmar()
    c.advance(1.5)
    c.env.TakeTaxiNode(14)
    H.eq(c.world.calls.TakeTaxiNode, 1, "the client's TakeTaxiNode still runs")
    c.advance(0.15)
    c.fire("PLAYER_CONTROL_LOST")
    local started = c.world.clock
    c.world.travel.onTaxi, c.world.travel.speed, c.world.travel.mounted = true, 30.52, true
    c.world.zone = at("Durotar", "Southfury River", 1411, 0.3637, 0.0335)
    wait(c, 30)
    c.world.zone = at("Ashenvale", "Splintertree Post", 1440, 0.7327, 0.6155)
    c.advance(59.6)
    -- Probe 0.6.0: on landing PLAYER_CONTROL_GAINED comes while UnitOnTaxi is still true.
    c.world.travel.speed = 0
    c.fire("PLAYER_CONTROL_GAINED")
    local t = tripsOf(c)
    H.eq(#t, 1)
    local f = t[1]
    H.eq(f.kind, "flight")
    H.eq(f.char, ME)
    H.eq(f.build, B)
    H.eq(f.startedAt, math.floor(started))
    H.eq(f.seconds, 89.6)
    H.eq(f.from.mapID, 1454)
    H.eq(f.from.x, 0.4525)
    H.eq(f.to.mapID, 1440)
    H.eq(f.to.subzone, "Splintertree Post")
    H.eq(f.fromNode.id, 23)
    H.eq(f.fromNode.name, "Orgrimmar, Durotar")
    H.eq(f.toNode.id, 61)
    H.eq(f.toNode.name, "Splintertree Post, Ashenvale")
    c.world.travel.onTaxi, c.world.travel.mounted = false, false
    wait(c, 30)
    H.eq(#tripsOf(c), 1, "nothing else on landing")
    H.eq(errors(c), "")
  end)

  H.test("trips: a taxi pick that never takes off is no flight", function()
    local c = orgrimmar()
    c.env.TakeTaxiNode(14) -- e.g. not enough money
    wait(c, 60)
    c.fire("PLAYER_CONTROL_LOST") -- a stun, much later
    c.advance(5)
    c.fire("PLAYER_CONTROL_GAINED")
    H.eq(#tripsOf(c), 0)
  end)

  H.test("trips: a hearth through a loading screen goes from the cast to where the player arrives", function()
    local c = login(H)
    c.advance(3)
    c.fire("UNIT_SPELLCAST_SUCCEEDED", "player", "Cast-3-1-1-1-8690-0001", 8690)
    local started = c.world.clock
    c.fire("LOADING_SCREEN_ENABLED")
    c.advance(1)
    c.world.zone = at("Orgrimmar", "Valley of Strength", 1454, 0.5413, 0.6865)
    wait(c, 6)
    c.fire("PLAYER_ENTERING_WORLD", false, false)
    c.fire("LOADING_SCREEN_DISABLED")
    c.advance(3)
    local t = tripsOf(c)
    H.eq(#t, 1)
    H.eq(t[1].kind, "hearth")
    H.eq(t[1].startedAt, started)
    H.eq(t[1].seconds, 7)
    H.eq(t[1].from.mapID, 1420)
    H.eq(t[1].from.subzone, "Brill")
    H.eq(t[1].to.mapID, 1454, "read once the client has the new zone")
    H.eq(t[1].fromNode, nil)
  end)

  H.test("trips: a hearth without a loading screen ends once the player is far away", function()
    local c = login(H)
    c.advance(1)
    c.fire("UNIT_SPELLCAST_SUCCEEDED", "player", "Cast-3-1-1-1-8690-0002", 8690)
    c.advance(1)
    H.eq(#tripsOf(c), 0, "still at the cast")
    c.world.zone = at("Tirisfal Glades", "Deathknell", 1420, 0.3082, 0.6612) -- 1400 yd west on the same map
    c.advance(2)
    local t = tripsOf(c)
    H.eq(#t, 1)
    H.eq(t[1].kind, "hearth")
    H.eq(t[1].to.subzone, "Deathknell")
    H.ok(t[1].seconds > 0 and t[1].seconds <= 4, "seconds " .. tostring(t[1].seconds))
  end)

  H.test("trips: a lost loading-screen end or a taxi pick that never flew doesn't stop the sampler", function()
    local c = orgrimmar()
    c.env.TakeTaxiNode(14)
    c.fire("LOADING_SCREEN_ENABLED") -- and no LOADING_SCREEN_DISABLED
    wait(c, 70)
    c.fire("UNIT_SPELLCAST_SUCCEEDED", "player", "Cast-3-1-1-1-8690-0004", 8690)
    c.world.zone = at("Orgrimmar", "Valley of Honor", 1454, 0.7, 0.3) -- 500 yd away on the same map
    wait(c, 2)
    H.eq(#tripsOf(c), 1)
    H.eq(tripsOf(c)[1].kind, "hearth")
  end)

  H.test("trips: another spell, or another unit's hearth, is no trip", function()
    local c = login(H)
    c.fire("UNIT_SPELLCAST_SUCCEEDED", "player", "Cast-3-1-1-1-133-0001", 133)
    c.fire("UNIT_SPELLCAST_SUCCEEDED", "party1", "Cast-3-1-1-1-8690-0003", 8690)
    c.world.zone = at("Orgrimmar", "Valley of Strength", 1454, 0.5413, 0.6865)
    wait(c, 10)
    c.fire("PLAYER_ENTERING_WORLD", false, false)
    wait(c, 10)
    H.eq(#tripsOf(c), 0)
  end)

  H.test("trips: a zeppelin ride (moving at speed 0, a loading screen, docking) is one transport trip", function()
    local c = login(H, { zone = at("Tirisfal Glades", "The North Coast", 1420, 0.6232, 0.3207) })
    wait(c, 4) -- standing on the deck, waiting
    local before = c.world.clock
    move(c, 10, -0.002, -0.006) -- 20 s north-west, about 19 yd per tick
    c.fire("LOADING_SCREEN_ENABLED")
    c.advance(6) -- the client is loading: nothing moves
    c.world.zone = at("Durotar", "Bladefist Bay", 1411, 0.645, 0.1291)
    c.fire("PLAYER_ENTERING_WORLD", false, false)
    c.fire("LOADING_SCREEN_DISABLED")
    move(c, 4, -0.006, 0.002)
    local docked = c.world.clock
    wait(c, 10) -- docked
    local t = tripsOf(c)
    H.eq(#t, 1)
    local r = t[1]
    H.eq(r.kind, "transport")
    H.eq(r.from.mapID, 1420)
    H.eq(r.to.mapID, 1411)
    H.eq(r.to.subzone, "Bladefist Bay")
    H.ok(r.startedAt >= before and r.startedAt <= before + 2, "starts with the first move")
    H.ok(math.abs(r.seconds - (docked - before)) <= 2, "seconds " .. tostring(r.seconds))
    c.world.travel.speed = 7 -- walks off
    move(c, 5, 0.003, 0)
    c.world.travel.speed = 0
    wait(c, 10)
    H.eq(#tripsOf(c), 1, "walking off is not another ride")
  end)

  H.test("trips: walking, running or riding a mount is never a transport", function()
    local c = login(H)
    c.world.travel.speed = 7
    move(c, 20, 0.002, 0.001)
    c.world.travel.speed = 11.2
    c.world.travel.mounted = true
    move(c, 20, -0.003, 0)
    c.world.travel.speed = 0
    wait(c, 20)
    H.eq(#tripsOf(c), 0)
  end)

  H.test("trips: a short push at speed 0 (a knock-back) is no trip", function()
    local c = login(H)
    move(c, 2, 0.003, 0)
    wait(c, 20)
    H.eq(#tripsOf(c), 0)
  end)

  H.test("trips: at most 300 are kept, oldest dropped; each one is a new record", function()
    local c = orgrimmar()
    local d = c.env.ForeverLedgerDB
    local function newRecords()
      c.world.printed = {}
      c.slash("FOREVERLEDGER", "")
      for _, line in ipairs(c.world.printed) do
        local n = line:match("(%d+) new records? since")
        if n then return tonumber(n) end
      end
    end
    local before = newRecords()
    for i = 1, 300 do d.trips[i] = { kind = "hearth", char = ME, build = B, startedAt = i, seconds = 20 } end
    c.env.TakeTaxiNode(14)
    c.fire("PLAYER_CONTROL_LOST")
    wait(c, 30)
    c.fire("PLAYER_CONTROL_GAINED")
    H.eq(#d.trips, 300)
    H.eq(d.trips[1].startedAt, 2)
    H.eq(d.trips[300].kind, "flight")
    H.eq(newRecords(), before + 1)
  end)

  H.test("trips: a client without these APIs records none and throws nothing", function()
    local c = P.session(H, { questLog = questLog(), zone = BRILL })
    c.fire("UNIT_SPELLCAST_SUCCEEDED", "player", "Cast-3-1-1-1-8690-0001", 8690)
    c.fire("PLAYER_CONTROL_LOST")
    c.fire("LOADING_SCREEN_ENABLED")
    c.world.zone = at("Orgrimmar", "Valley of Strength", 1454, 0.5413, 0.6865)
    c.fire("PLAYER_ENTERING_WORLD", false, false)
    c.fire("LOADING_SCREEN_DISABLED")
    c.fire("PLAYER_CONTROL_GAINED")
    wait(c, 30)
    H.eq(errors(c), "")
    H.eq(#tripsOf(c), 1, "the hearth, timed by the loading screen (no flight without the hook)")
    H.eq(tripsOf(c)[1].kind, "hearth")
  end)
end
