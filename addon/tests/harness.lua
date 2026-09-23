-- Forever Ledger test harness (Lua 5.1).
-- Builds a fake WoW global environment driven by a mutable `world` table, loads addon files into it,
-- and lets tests fire events. Nothing here talks to a real client.

local H = {}

local function copy(t)
  if type(t) ~= "table" then return t end
  local c = {}
  for k, v in pairs(t) do c[k] = copy(v) end
  return c
end
H.copy = copy

local function default_world()
  return {
    clock = 1790000000,
    buildInfo = { "1.15.7", "61582", "Sep 18 2026", 11507 },
    player = { name = "Thibodeaux", realm = "Bayou", class = "HUNTER", race = "Human", faction = "Alliance",
               level = 10, xp = 0, xpMax = 7600, guid = "Player-1-0000AAAA" },
    zone = { zone = "Elwynn Forest", subzone = "Goldshire", mapID = 1429, x = 0.421, y = 0.659 },
    instance = nil,        -- { name=, type="party", difficulty=1, maxPlayers=5, instanceID= }
    party = {},            -- { { class=, level= }, ... }
    npc = nil,             -- { name=, guid= }
    questFrame = nil,      -- { questID=, title=, xp=, money=, choices={ {id=, count=} }, rewards={...} }
    questLog = {},         -- { { title=, level=, suggestedGroup=, isHeader=, questID=, objectives={...},
                           --     choices={ id, ... }, money= } }
    items = {},            -- [itemID] = { name=, quality=, ilvl=, reqLevel=, type=, subtype=, equipLoc=,
                           --              sellPrice=, stats={}, tooltip={ {l, r}, ... }, cached=true|false }
    loot = {},             -- { { itemID=, sourceGUID= } }
    api = "classic",       -- "forever": swap Classic globals for the namespaces the Forever 1.60 client has
    missing = {},          -- [globalName] = true to simulate an API the client lacks
    rejectEvents = {},     -- [event] = true to make RegisterEvent throw for it
    addons = {},           -- [name] = function(env) run when LoadAddOn(name) is called
    printed = {},
  }
end

local function itemLink(id, it)
  local colors = { [0] = "ff9d9d9d", "ffffffff", "ff1eff00", "ff0070dd", "ffa335ee", "ffff8000" }
  return "|c" .. (colors[it.quality or 1] or "ffffffff") .. "|Hitem:" .. id .. "::::::::" .. "|h[" ..
    it.name .. "]|h|r"
end
H.itemLink = itemLink

-- Returns a new environment table with all WoW stubs plus a controller.
function H.new(worldOverrides)
  local world = default_world()
  for k, v in pairs(worldOverrides or {}) do world[k] = v end

  local env = {}
  setmetatable(env, { __index = _G })
  env._G = env
  local frames = {}

  local function linkID(link) return link and tonumber(link:match("item:(%d+)")) end

  -- Lua helpers WoW adds
  env.wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
  env.floor = math.floor
  env.format = string.format
  env.strsplit = function(sep, s)
    local out, i = {}, 1
    for part in (s .. sep):gmatch("(.-)" .. sep:gsub("%p", "%%%0")) do out[i] = part; i = i + 1 end
    return unpack(out)
  end
  env.time = function() return world.clock end
  env.date = os.date
  env.print = function(...)
    local parts = {}
    for i = 1, select("#", ...) do parts[#parts + 1] = tostring((select(i, ...))) end
    world.printed[#world.printed + 1] = table.concat(parts, " ")
  end
  env.SlashCmdList = {}

  -- frames
  env.WorldFrame, env.UIParent = {}, {}
  env.CreateFrame = function(kind, name)
    local f = { kind = kind, events = {}, scripts = {}, lines = {} }
    function f:RegisterEvent(ev)
      if world.rejectEvents[ev] then error("Attempt to register unknown event \"" .. ev .. "\"") end
      self.events[ev] = true
    end
    function f:UnregisterEvent(ev) self.events[ev] = nil end
    function f:RegisterAllEvents() self.allEvents = true end
    function f:UnregisterAllEvents() self.allEvents = nil; self.events = {} end
    function f:SetScript(what, fn) self.scripts[what] = fn end
    if kind == "GameTooltip" then
      function f:SetOwner() end
      function f:ClearLines() self.lines = {} end
      function f:SetHyperlink(link)
        local it = world.items[linkID(link)]
        self.lines = it and it.tooltip or {}
        for i = 1, 30 do
          local l, r = self.lines[i] and self.lines[i][1], self.lines[i] and self.lines[i][2]
          env[name .. "TextLeft" .. i] = { GetText = function() return l end }
          env[name .. "TextRight" .. i] = { GetText = function() return r end }
        end
      end
      function f:NumLines() return #self.lines end
    end
    if name then env[name] = f end
    frames[#frames + 1] = f
    return f
  end

  -- client
  env.GetBuildInfo = function() return unpack(world.buildInfo) end
  env.GetRealmName = function() return world.player.realm end

  -- units
  env.UnitName = function(u)
    if u == "player" then return world.player.name end
    if u == "npc" and world.npc then return world.npc.name end
  end
  env.UnitGUID = function(u)
    if u == "player" then return world.player.guid end
    if u == "npc" and world.npc then return world.npc.guid end
  end
  env.UnitLevel = function(u)
    if u == "player" then return world.player.level end
    local i = tonumber((u or ""):match("party(%d)"))
    return i and world.party[i] and world.party[i].level or 0
  end
  env.UnitClass = function(u)
    if u == "player" then return "Hunter", world.player.class end
    local i = tonumber((u or ""):match("party(%d)"))
    if i and world.party[i] then return world.party[i].class, world.party[i].class end
  end
  env.UnitRace = function() return world.player.race, world.player.race end
  env.UnitFactionGroup = function() return world.player.faction end
  env.UnitExists = function(u)
    local i = tonumber((u or ""):match("party(%d)"))
    return i ~= nil and world.party[i] ~= nil
  end
  env.UnitXP = function() return world.player.xp end
  env.UnitXPMax = function() return world.player.xpMax end

  -- zone / instance
  env.GetRealZoneText = function() return world.instance and world.instance.name or world.zone.zone end
  env.GetSubZoneText = function() return world.zone.subzone end
  env.C_Map = {
    GetBestMapForUnit = function() return world.zone.mapID end,
    GetPlayerMapPosition = function()
      return { GetXY = function() return world.zone.x, world.zone.y end }
    end,
  }
  env.IsInInstance = function()
    if world.instance then return true, world.instance.type end
    return false, "none"
  end
  env.GetInstanceInfo = function()
    local i = world.instance
    if not i then return world.zone.zone, "none", 0, "", 0, 0, false, 0 end
    return i.name, i.type, i.difficulty, "Normal", i.maxPlayers, 0, false, i.instanceID
  end

  -- quest frame
  local function qf() return world.questFrame or {} end
  env.GetQuestID = function() return qf().questID or 0 end
  env.GetTitleText = function() return qf().title end
  env.GetRewardXP = function() return qf().xp or 0 end
  env.GetRewardMoney = function() return qf().money or 0 end
  env.GetNumQuestChoices = function() return #(qf().choices or {}) end
  env.GetNumQuestRewards = function() return #(qf().rewards or {}) end
  env.GetQuestItemLink = function(kind, i)
    local list = kind == "choice" and qf().choices or qf().rewards
    local r = list and list[i]
    return r and world.items[r.id] and itemLink(r.id, world.items[r.id]) or (r and ("|Hitem:" .. r.id .. "|h[?]|h"))
  end
  env.GetQuestItemInfo = function(kind, i)
    local list = kind == "choice" and qf().choices or qf().rewards
    local r = list and list[i]
    if r then return (world.items[r.id] or {}).name, nil, r.count or 1 end
  end

  -- quest log
  local selected = 0
  env.GetNumQuestLogEntries = function() return #world.questLog end
  env.GetQuestLogTitle = function(i)
    local e = world.questLog[i]
    if not e then return nil end
    return e.title, e.level, e.suggestedGroup or 0, e.isHeader or false, false, false, false, e.questID
  end
  env.GetNumQuestLeaderBoards = function(i) return #((world.questLog[i] or {}).objectives or {}) end
  env.GetQuestLogLeaderBoard = function(j, i) return world.questLog[i].objectives[j], "monster", false end
  env.GetQuestLogSelection = function() return selected end
  env.SelectQuestLogEntry = function(i) selected = i end
  env.GetNumQuestLogChoices = function() return #((world.questLog[selected] or {}).choices or {}) end
  env.GetQuestLogItemLink = function(_, c)
    local id = world.questLog[selected].choices[c]
    return world.items[id] and itemLink(id, world.items[id]) or ("|Hitem:" .. id .. "|h[?]|h")
  end
  env.GetQuestLogRewardMoney = function() return (world.questLog[selected] or {}).money or 0 end

  -- items
  env.GetItemInfo = function(x)
    local id = type(x) == "number" and x or linkID(x)
    local it = world.items[id]
    if not it or it.cached == false then return nil end
    return it.name, itemLink(id, it), it.quality, it.ilvl, it.reqLevel, it.type, it.subtype, 1, it.equipLoc,
      nil, it.sellPrice
  end
  env.GetItemStats = function(link)
    local it = world.items[linkID(link)]
    return it and copy(it.stats) or {}
  end

  -- loot
  env.GetNumLootItems = function() return #world.loot end
  env.GetLootSlotLink = function(i)
    local l = world.loot[i]
    return l and world.items[l.itemID] and itemLink(l.itemID, world.items[l.itemID])
  end
  env.GetLootSourceInfo = function(i) return world.loot[i] and world.loot[i].sourceGUID, 1 end

  -- addons
  env.LoadAddOn = function(name)
    local fn = world.addons[name]
    if not fn then return false, "MISSING" end
    fn(env)
    return true
  end
  env.C_AddOns = { LoadAddOn = env.LoadAddOn }

  -- World of Warcraft: Forever 1.60 (probe dump of build 69913) has no Classic quest-log globals and no
  -- global GetItemInfo/GetItemStats; it has the C_QuestLog / C_Item namespaces instead.
  if world.api == "forever" then
    env.C_QuestLog = {
      GetNumQuestLogEntries = env.GetNumQuestLogEntries,
      GetInfo = function(i)
        local e = world.questLog[i]
        if not e then return nil end
        return { title = e.title, level = e.level or 0, suggestedGroup = e.suggestedGroup or 0,
                 isHeader = e.isHeader or false, questID = e.questID or 0, questLogIndex = i }
      end,
      GetSelectedQuest = function() return (world.questLog[selected] or {}).questID or 0 end,
      SetSelectedQuest = function(questID)
        for i, e in ipairs(world.questLog) do
          if e.questID == questID then selected = i end
        end
      end,
    }
    env.C_Item = { GetItemInfo = env.GetItemInfo, GetItemStats = env.GetItemStats }
    for _, name in ipairs({ "GetNumQuestLogEntries", "GetQuestLogTitle", "GetQuestLogSelection",
                            "SelectQuestLogEntry", "GetItemInfo", "GetItemStats", "LoadAddOn" }) do
      world.missing[name] = true
    end
  end

  -- Simulate an API the client lacks. The real Lua _G behind __index has no WoW names, so nil is enough.
  for name in pairs(world.missing) do env[name] = nil end

  local ctl = { env = env, world = world, frames = frames }

  function ctl.load(path)
    local chunk = assert(loadfile(path))
    setfenv(chunk, env)
    chunk()
  end

  function ctl.fire(event, ...)
    for _, f in ipairs(frames) do
      if (f.events[event] or f.allEvents) and f.scripts.OnEvent then f.scripts.OnEvent(f, event, ...) end
    end
  end

  function ctl.slash(cmdKey, msg) env.SlashCmdList[cmdKey](msg or "") end
  function ctl.advance(secs) world.clock = world.clock + secs end

  function ctl.gainXP(amount)
    local p = world.player
    p.xp = p.xp + amount
    while p.xp >= p.xpMax do
      p.xp = p.xp - p.xpMax
      p.level = p.level + 1
      p.xpMax = math.floor(p.xpMax * 1.15)
    end
    ctl.fire("PLAYER_XP_UPDATE", "player")
  end

  function ctl.login(addonName)
    ctl.fire("ADDON_LOADED", addonName)
    ctl.fire("PLAYER_LOGIN")
    ctl.fire("PLAYER_ENTERING_WORLD", true, false)
  end

  return ctl
end

---------------------------------------------------------------- WoW-style serializer
-- Mimics the client's SavedVariables writer closely enough for the parser fixtures:
-- tabs, ["key"] = value, trailing commas, `-- [n]` after array entries, numeric keys as [n].

local function sortedKeys(t)
  local keys = {}
  for k in pairs(t) do keys[#keys + 1] = k end
  table.sort(keys, function(a, b)
    local ta, tb = type(a), type(b)
    if ta ~= tb then return ta < tb end
    return a < b
  end)
  return keys
end

local function isArray(t)
  local n = #t
  if n == 0 then return false end
  local count = 0
  for _ in pairs(t) do count = count + 1 end
  return count == n
end

local function serializeValue(v, indent, out)
  local tv = type(v)
  if tv == "string" then
    out[#out + 1] = string.format("%q", v):gsub("\\\n", "\\n")
  elseif tv == "number" then
    if v == math.floor(v) and math.abs(v) < 2 ^ 53 then out[#out + 1] = string.format("%d", v)
    else out[#out + 1] = string.format("%.14g", v) end
  elseif tv == "boolean" then
    out[#out + 1] = tostring(v)
  elseif tv == "table" then
    out[#out + 1] = "{\n"
    local pad = string.rep("\t", indent + 1)
    if isArray(v) then
      for i = 1, #v do
        out[#out + 1] = pad
        serializeValue(v[i], indent + 1, out)
        out[#out + 1] = ", -- [" .. i .. "]\n"
      end
    else
      for _, k in ipairs(sortedKeys(v)) do
        out[#out + 1] = pad .. "["
        if type(k) == "string" then out[#out + 1] = string.format("%q", k) else out[#out + 1] = tostring(k) end
        out[#out + 1] = "] = "
        serializeValue(v[k], indent + 1, out)
        out[#out + 1] = ",\n"
      end
    end
    out[#out + 1] = string.rep("\t", indent) .. "}"
  else
    error("cannot serialize " .. tv)
  end
end

function H.serialize(name, value)
  local out = { "\n", name, " = " }
  serializeValue(value, 0, out)
  out[#out + 1] = "\n"
  return table.concat(out)
end

function H.writeFile(path, text)
  local f = assert(io.open(path, "wb"))
  f:write(text)
  f:close()
end

---------------------------------------------------------------- tiny test framework
local results = { passed = 0, failed = 0, failures = {} }
H.results = results

function H.test(name, fn)
  local ok, err = xpcall(fn, debug.traceback)
  if ok then
    results.passed = results.passed + 1
  else
    results.failed = results.failed + 1
    results.failures[#results.failures + 1] = name .. "\n    " .. tostring(err)
  end
end

local function fmt(v)
  if type(v) == "string" then return string.format("%q", v) end
  return tostring(v)
end

function H.eq(actual, expected, msg)
  if actual ~= expected then
    error((msg or "values differ") .. ": expected " .. fmt(expected) .. ", got " .. fmt(actual), 2)
  end
end

function H.ok(cond, msg)
  if not cond then error(msg or "assertion failed", 2) end
end

function H.count(t)
  local n = 0
  for _ in pairs(t or {}) do n = n + 1 end
  return n
end

return H
