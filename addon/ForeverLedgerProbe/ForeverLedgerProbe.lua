-- Forever Ledger Probe v0.1.0
-- Read-only: records what this client supports so Forever Ledger can be built against the real API.
-- Nothing is automated. Output lands in WTF/Account/<ACCOUNT>/SavedVariables/ForeverLedgerProbe.lua on /reload.
--
--   /flprobe             dump build info, API docs (same data as /api), globals and event support
--   /flprobe sniff on    record the first few payloads of every event while you play (off after /reload unless on)
--   /flprobe sniff off
--   /flprobe status
--   /flprobe reset confirm

local VERSION = "0.1.0"
local SAMPLE_LIMIT = 5     -- payloads kept per event
local MAX_EVENTS = 1500    -- distinct events tracked per build while sniffing
local MAX_STRING = 200

local CANDIDATE_EVENTS = {
  "ADDON_LOADED", "PLAYER_LOGIN", "PLAYER_ENTERING_WORLD", "ZONE_CHANGED_NEW_AREA", "UPDATE_INSTANCE_INFO",
  "QUEST_DETAIL", "QUEST_PROGRESS", "QUEST_COMPLETE", "QUEST_ACCEPTED", "QUEST_TURNED_IN", "QUEST_REMOVED",
  "QUEST_LOG_UPDATE", "QUEST_WATCH_UPDATE", "UNIT_QUEST_LOG_CHANGED",
  "PLAYER_XP_UPDATE", "PLAYER_LEVEL_UP", "CHAT_MSG_COMBAT_XP_GAIN", "PLAYER_DEAD", "PLAYER_ALIVE",
  "PLAYER_UNGHOST",
  "ENCOUNTER_START", "ENCOUNTER_END", "BOSS_KILL", "INSTANCE_ENCOUNTER_ENGAGE_UNIT", "SCENARIO_COMPLETED",
  "LFG_COMPLETION_REWARD",
  "LOOT_READY", "LOOT_OPENED", "LOOT_SLOT_CLEARED", "LOOT_CLOSED", "CHAT_MSG_LOOT", "CHAT_MSG_MONEY",
  "GET_ITEM_INFO_RECEIVED", "ITEM_DATA_LOAD_RESULT",
  "GROUP_ROSTER_UPDATE", "PLAYER_REGEN_DISABLED", "PLAYER_REGEN_ENABLED",
}

local CANDIDATE_GLOBALS = {
  "GetBuildInfo", "GetLocale", "GetRealmName", "GetServerTime",
  "GetQuestID", "GetTitleText", "GetRewardXP", "GetRewardMoney", "GetNumQuestChoices", "GetNumQuestRewards",
  "GetQuestItemLink", "GetQuestItemInfo", "GetQuestLogRewardXP", "GetQuestLogRewardMoney",
  "GetNumQuestLogEntries", "GetQuestLogTitle", "GetQuestLogSelection", "SelectQuestLogEntry",
  "GetNumQuestLogChoices", "GetQuestLogItemLink", "GetNumQuestLeaderBoards", "GetQuestLogLeaderBoard",
  "GetQuestTagInfo", "GetQuestDifficultyColor",
  "C_QuestLog", "C_QuestLog.GetNumQuestLogEntries", "C_QuestLog.GetInfo", "C_QuestLog.GetQuestIDForLogIndex",
  "C_QuestLog.GetQuestTagInfo", "C_QuestLog.GetTitleForQuestID",
  "GetItemInfo", "GetItemStats", "C_Item", "C_Item.GetItemInfo", "C_Item.GetItemStats",
  "C_Item.RequestLoadItemDataByID", "C_TooltipInfo", "C_TooltipInfo.GetHyperlink",
  "GetNumLootItems", "GetLootSlotLink", "GetLootSlotInfo", "GetLootSourceInfo",
  "IsInInstance", "GetInstanceInfo", "GetDifficultyInfo", "C_EncounterJournal", "EJ_GetEncounterInfo",
  "UnitXP", "UnitXPMax", "UnitLevel", "UnitGUID", "UnitClass", "UnitRace", "UnitFactionGroup",
  "C_Map", "C_Map.GetBestMapForUnit", "C_Map.GetPlayerMapPosition",
  "C_AddOns", "C_AddOns.LoadAddOn", "LoadAddOn", "CombatLogGetCurrentEventInfo", "C_Container",
}

local db, build = nil, 0
local sniffer = CreateFrame("Frame")
local probeFrame = CreateFrame("Frame")

local function say(msg) print("|cff33ff99Forever Ledger Probe:|r " .. msg) end

local function resolve(path)
  local v = _G
  for part in path:gmatch("[^%.]+") do
    if type(v) ~= "table" then return nil end
    v = v[part]
  end
  return v
end

local function sortedKeys(t)
  local keys = {}
  for k in pairs(t) do keys[#keys + 1] = k end
  table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
  return keys
end

local function clip(v)
  local tv = type(v)
  if tv == "string" then return #v > MAX_STRING and (v:sub(1, MAX_STRING) .. "...") or v end
  if tv == "number" or tv == "boolean" then return v end
  if v == nil then return "<nil>" end
  return "<" .. tv .. ">"
end

---------------------------------------------------------------- API documentation (/api)
local function fieldList(fields)
  local out = {}
  for _, fd in ipairs(fields or {}) do
    out[#out + 1] = { name = fd.Name, type = fd.Type, innerType = fd.InnerType, nilable = fd.Nilable or nil,
                      default = fd.Default ~= nil and clip(fd.Default) or nil }
  end
  return #out > 0 and out or nil
end

local function loadApiDocs()
  if APIDocumentation and APIDocumentation.systems then return true end
  local loader = (C_AddOns and C_AddOns.LoadAddOn) or LoadAddOn
  if not loader then return false end
  pcall(loader, "Blizzard_APIDocumentationGenerated")
  pcall(loader, "Blizzard_APIDocumentation")
  return APIDocumentation ~= nil and APIDocumentation.systems ~= nil
end

local function dumpApiDocs()
  if not loadApiDocs() then return { available = false } end
  local systems = {}
  for _, sys in ipairs(APIDocumentation.systems) do
    local s = { name = sys.Name, namespace = sys.Namespace, functions = {}, events = {}, tables = {} }
    for _, fn in ipairs(sys.Functions or {}) do
      s.functions[#s.functions + 1] = { name = fn.Name, args = fieldList(fn.Arguments),
                                        returns = fieldList(fn.Returns) }
    end
    for _, ev in ipairs(sys.Events or {}) do
      s.events[#s.events + 1] = { name = ev.Name, literal = ev.LiteralName, payload = fieldList(ev.Payload) }
    end
    for _, tb in ipairs(sys.Tables or {}) do
      s.tables[#s.tables + 1] = { name = tb.Name, type = tb.Type, fields = fieldList(tb.Fields) }
    end
    systems[#systems + 1] = s
  end
  return { available = true, systems = systems }
end

---------------------------------------------------------------- globals and events
local function dumpGlobals()
  local present = {}
  for _, name in ipairs(CANDIDATE_GLOBALS) do present[name] = type(resolve(name)) end

  local namespaces, functions = {}, {}
  for _, k in ipairs(sortedKeys(_G)) do
    local v = _G[k]
    if type(k) == "string" then
      if type(v) == "function" then
        functions[#functions + 1] = k
      elseif type(v) == "table" and k:match("^C_") then
        local fns = {}
        for _, fk in ipairs(sortedKeys(v)) do
          if type(v[fk]) == "function" then fns[#fns + 1] = fk end
        end
        namespaces[k] = fns
      end
    end
  end
  return present, namespaces, functions
end

local function probeEvents()
  local out = {}
  for _, ev in ipairs(CANDIDATE_EVENTS) do
    local ok = pcall(probeFrame.RegisterEvent, probeFrame, ev)
    out[ev] = ok
    if ok then probeFrame:UnregisterEvent(ev) end
  end
  return out
end

local function dump()
  local version, buildStr, buildDate, interface = GetBuildInfo()
  local present, namespaces, functions = dumpGlobals()
  local d = {
    at = time(),
    probeVersion = VERSION,
    buildInfo = { version = version, build = tonumber(buildStr) or buildStr, date = buildDate,
                  interface = interface },
    locale = GetLocale and GetLocale() or nil,
    globals = present,
    events = probeEvents(),
    namespaces = namespaces,
    globalFunctions = functions,
    api = dumpApiDocs(),
  }
  db.dumps[build] = d
  local nsys = d.api.systems and #d.api.systems or 0
  say(format("build %s (interface %s): %d global functions, %d C_ namespaces, API docs %s (%d systems).",
    tostring(buildStr), tostring(interface), #functions, #sortedKeys(namespaces),
    d.api.available and "loaded" or "missing", nsys))
  say("Type /reload to write ForeverLedgerProbe.lua.")
end

---------------------------------------------------------------- sniffer
local function record(event, ...)
  local byEvent = db.sniff[build]
  local e = byEvent[event]
  if not e then
    if db.sniffEventCount >= MAX_EVENTS then return end
    db.sniffEventCount = db.sniffEventCount + 1
    e = { count = 0, firstAt = time(), samples = {} }
    byEvent[event] = e
  end
  e.count = e.count + 1
  if #e.samples < SAMPLE_LIMIT then
    local n = select("#", ...)
    local args = { n = n }
    for i = 1, n do args[i] = clip((select(i, ...))) end
    e.samples[#e.samples + 1] = args
  end
end

local function setSniff(on)
  db.sniffing = on
  if on then
    db.sniff[build] = db.sniff[build] or {}
    db.sniffEventCount = db.sniffEventCount or 0
    if sniffer.RegisterAllEvents then
      sniffer:RegisterAllEvents()
    else
      for _, ev in ipairs(CANDIDATE_EVENTS) do pcall(sniffer.RegisterEvent, sniffer, ev) end
    end
    sniffer:SetScript("OnEvent", function(_, event, ...) record(event, ...) end)
  else
    if sniffer.UnregisterAllEvents then sniffer:UnregisterAllEvents() end
    sniffer:SetScript("OnEvent", nil)
  end
end

---------------------------------------------------------------- lifecycle
probeFrame:RegisterEvent("ADDON_LOADED")
probeFrame:SetScript("OnEvent", function(_, event, name)
  if event ~= "ADDON_LOADED" or name ~= "ForeverLedgerProbe" then return end
  ForeverLedgerProbeDB = ForeverLedgerProbeDB or {}
  db = ForeverLedgerProbeDB
  db.dumps, db.sniff = db.dumps or {}, db.sniff or {}
  db.probeVersion = VERSION
  local _, buildStr = GetBuildInfo()
  build = tonumber(buildStr) or 0
  if db.sniffing then setSniff(true) end
end)

SLASH_FOREVERLEDGERPROBE1 = "/flprobe"
SlashCmdList.FOREVERLEDGERPROBE = function(msg)
  msg = (msg or ""):lower()
  if msg == "" or msg == "dump" then
    dump()
  elseif msg == "sniff on" then
    setSniff(true)
    say("sniffing all events (first " .. SAMPLE_LIMIT .. " payloads each). /flprobe sniff off to stop.")
  elseif msg == "sniff off" then
    setSniff(false)
    say("sniffer off.")
  elseif msg == "reset confirm" then
    wipe(db.dumps); wipe(db.sniff); db.sniffEventCount = 0
    say("probe data wiped.")
  else
    local ndumps = 0
    for _ in pairs(db.dumps) do ndumps = ndumps + 1 end
    local nev = 0
    for _ in pairs(db.sniff[build] or {}) do nev = nev + 1 end
    say(format("build %d: %d dump(s) stored, sniffer %s, %d events seen this build.",
      build, ndumps, db.sniffing and "ON" or "off", nev))
    say("/flprobe  |  /flprobe sniff on|off  |  /flprobe reset confirm")
  end
end
