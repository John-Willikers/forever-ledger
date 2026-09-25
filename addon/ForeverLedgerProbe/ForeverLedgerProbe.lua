-- Forever Ledger Probe v0.3.0
-- Read-only: records what this client supports so Forever Ledger can be built against the real API.
-- Nothing is automated. Output lands in WTF/Account/<ACCOUNT>/SavedVariables/ForeverLedgerProbe.lua on /reload.
--
--   /flprobe             dump build info, API docs (same data as /api), globals and event support
--   /flprobe specs       spec catalog per class and, for every bag/equipped item, which specs the client says want it
--   /flprobe sniff on    record the first few payloads of every event while you play (off after /reload unless on)
--   /flprobe sniff off
--   /flprobe io          record chat/combat logging state (plus the SavedVariables load check)
--   /flprobe io on       turn chat and combat logging on and print marker lines to find in the log files
--   /flprobe io toggle   logging off then on again (does that flush the files?)
--   /flprobe io off      turn chat and combat logging off
--   /flprobe io reloadbtn        show two buttons that /reload only when you click them
--   /flprobe io reloadbtn hide
--   /flprobe status
--   /flprobe reset confirm

local VERSION = "0.3.0"
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
  "LoggingChat", "LoggingCombat", "C_ChatInfo.IsLoggingChat", "C_ChatInfo.IsLoggingCombat",
  "C_CombatLog.IsCombatLogRestricted", "GetCVar", "ReloadUI", "C_UI.Reload", "InCombatLockdown",
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

---------------------------------------------------------------- io: logging channels, reload, load bug
-- Everything here runs only when the player types a command or clicks a probe button. Every client call is pcall'd
-- and its outcome recorded in db.io[build] (append-only, newest last).
local IO_CAP = 200       -- io entries kept per build
local HISTORY_CAP = 50   -- load checks kept
local TOGGLE_GAP = 10    -- seconds between /flprobe io toggle runs
local COMBAT_BUDGET = 5  -- the client allows 5 LoggingCombat calls per 10 s; a 6th returns nil
local LOG_DIR = "<WoW>\\_classic_beta_\\Logs\\"
local STATE_ORDER = { "LoggingChat", "LoggingCombat", "C_ChatInfo.IsLoggingChat", "C_ChatInfo.IsLoggingCombat",
                      "GetCVar(advancedCombatLogging)", "C_CombatLog.IsCombatLogRestricted" }

local lastToggleAt
local combatCalls = {}   -- times of our own LoggingCombat calls this session
local reloadButtons

local function packResult(ok, ...)
  if not ok then return { ok = false, err = clip(tostring((...))) } end
  local values = {}
  for i = 1, select("#", ...) do values[i] = clip((select(i, ...))) end
  return { ok = true, values = values }
end

-- Calls fn in pcall: { ok = true, values = {...} }, { ok = false, err } or { ok = false, missing = true }.
local function try(fn, ...)
  if type(fn) ~= "function" then return { ok = false, missing = true, err = "missing" } end
  return packResult(pcall(fn, ...))
end

local function show(r)
  if not r then return "?" end
  if r.missing then return "missing" end
  if not r.ok then return "error: " .. tostring(r.err) end
  local parts = {}
  for i, v in ipairs(r.values or {}) do parts[i] = tostring(v) end
  return #parts > 0 and table.concat(parts, ", ") or "(no value)"
end

local function inCombat()
  local ok, locked = pcall(InCombatLockdown)
  return ok and locked and true or false
end

local function addIo(entry)
  entry.at = entry.at or time()
  db.io[build] = db.io[build] or {}
  local list = db.io[build]
  list[#list + 1] = entry
  local extra = #list - IO_CAP
  if extra > 0 then
    for i = 1, #list do list[i] = list[i + extra] end
  end
  return entry
end

-- Refuses (and says why) when `n` more LoggingCombat calls would pass the client's 5-per-10-s limit.
local function combatBudget(n)
  local now, recent = time(), {}
  for _, t in ipairs(combatCalls) do
    if now - t < 10 then recent[#recent + 1] = t end
  end
  combatCalls = recent
  if #recent + n <= COMBAT_BUDGET then return true end
  say(format("refused: %d combat-log calls in the last 10 s; the client allows %d per 10 s. Wait %d s.",
    #recent, COMBAT_BUDGET, 10 - (now - recent[1])))
  return false
end

local function callLogging(name, arg)
  if name == "LoggingCombat" then combatCalls[#combatCalls + 1] = time() end
  local r = try(_G[name], arg)
  r.call = name .. "(" .. tostring(arg) .. ")"
  return r
end

-- withSetters: also ask LoggingChat()/LoggingCombat() (no argument = query). Without it only the pure getters run,
-- so on/off/toggle don't spend the combat-log call budget on a read-back.
local function loggingState(withSetters)
  local chat, cl = C_ChatInfo or {}, C_CombatLog or {}
  local s = {
    ["C_ChatInfo.IsLoggingChat"] = try(chat.IsLoggingChat),
    ["C_ChatInfo.IsLoggingCombat"] = try(chat.IsLoggingCombat),
    ["GetCVar(advancedCombatLogging)"] = try(GetCVar, "advancedCombatLogging"),
    ["C_CombatLog.IsCombatLogRestricted"] = try(cl.IsCombatLogRestricted),
  }
  if withSetters then
    s.LoggingChat = callLogging("LoggingChat")
    s.LoggingCombat = callLogging("LoggingCombat")
    s.LoggingChat.call, s.LoggingCombat.call = nil, nil
  end
  return s
end

local function sayCalls(calls)
  local parts = {}
  for i, r in ipairs(calls) do parts[i] = r.call .. " -> " .. show(r) end
  say(table.concat(parts, ", "))
end

local function ioStatus()
  if not combatBudget(1) then return end
  local e = addIo({ action = "state", state = loggingState(true) })
  for _, k in ipairs(STATE_ORDER) do say(k .. ": " .. show(e.state[k])) end
  local lc = db.loadCheck or {}
  say(format("load check: loadCount %d, ForeverLedgerProbeDB arrived %s with %d key(s).", lc.loadCount or 0,
    lc.arrivedNil and "nil" or "as a table", lc.arrivedKeys or 0))
  if (lc.loadCount or 0) <= 1 then
    say("loadCount 1 after a /reload means Forever did not load SavedVariables back: copy ForeverLedgerProbe.lua "
      .. "after every /reload, the next write replaces it.")
  end
  local l = db.ledgerCheck
  if l then
    say(format("ForeverLedgerDB at login: %s, %s data record(s).", l.type, tostring(l.records or 0)))
  end
  say("/flprobe io on | toggle | off | reloadbtn [hide]  -  /reload to save the results.")
end

local function ioOn()
  if not combatBudget(1) then return end
  local marker = time()
  local e = addIo({ action = "on", marker = marker,
                    calls = { callLogging("LoggingChat", true), callLogging("LoggingCombat", true) } })
  e.after = loggingState(false)
  print("FLPROBE-PRINT-" .. marker)
  e.addMessage = try(function() DEFAULT_CHAT_FRAME:AddMessage("FLPROBE-ADDMSG-" .. marker) end)
  sayCalls(e.calls)
  say("Now loot something, kill a mob and turn in a quest. Then open " .. LOG_DIR .. " and search WoWChatLog.txt "
    .. "and WoWCombatLog*.txt for FLPROBE (marker " .. marker .. "); note how long lines take to show up.")
  say("/flprobe io toggle tests whether off/on flushes the files; /flprobe io off when done; /reload to save.")
end

local function ioToggle()
  local now = time()
  if lastToggleAt and now - lastToggleAt < TOGGLE_GAP then
    say(format("toggle refused: the last one was %d s ago and the client allows only %d logging calls per 10 s. "
      .. "Try again in %d s.", now - lastToggleAt, COMBAT_BUDGET, TOGGLE_GAP - (now - lastToggleAt)))
    return
  end
  if not combatBudget(2) then return end
  lastToggleAt = now
  print("FLPROBE-TOGGLE-" .. now)
  local e = addIo({ action = "toggle", marker = now, calls = {
    callLogging("LoggingCombat", false), callLogging("LoggingCombat", true),
    callLogging("LoggingChat", false), callLogging("LoggingChat", true),
  } })
  e.after = loggingState(false)
  sayCalls(e.calls)
  say("Printed FLPROBE-TOGGLE-" .. now .. " first: if it and earlier lines now appear in the files, toggling "
    .. "flushes them. Did a new WoWCombatLog file start?")
end

local function ioOff()
  if not combatBudget(1) then return end
  local e = addIo({ action = "off",
                    calls = { callLogging("LoggingChat", false), callLogging("LoggingCombat", false) } })
  e.after = loggingState(false)
  sayCalls(e.calls)
  say("logging off. /reload to save the results.")
end

---------------------------------------------------------------- reload buttons (user clicks only)
local function makeButton(name, template, label, y)
  local b = CreateFrame("Button", name, UIParent, template)
  b:SetSize(170, 26)
  b:SetPoint("CENTER", UIParent, "CENTER", 0, y)
  b:SetText(label)
  b:SetMovable(true)
  b:SetClampedToScreen(true)
  b:EnableMouse(true)
  b:RegisterForDrag("RightButton")
  b:SetScript("OnDragStart", b.StartMoving)
  b:SetScript("OnDragStop", b.StopMovingOrSizing)
  return b
end

local function makeSecureButton()
  local b = makeButton("ForeverLedgerProbeReloadSecure", "SecureActionButtonTemplate,UIPanelButtonTemplate",
    "Reload (probe)", 40)
  -- Newer clients act on down or up depending on ActionButtonUseKeyDown; registering both is the usual fix.
  b:RegisterForClicks("LeftButtonUp", "LeftButtonDown")
  b:SetAttribute("type", "macro")
  b:SetAttribute("macrotext", "/reload")
  -- Recorded before the secure macro runs, so it lands in the file the reload writes.
  b:SetScript("PreClick", function() addIo({ action = "secure-click" }) end)
  return b
end

local function makePlainButton()
  local b = makeButton("ForeverLedgerProbeReloadUI", "UIPanelButtonTemplate", "ReloadUI() (probe)", 0)
  b:RegisterForClicks("LeftButtonUp")
  b:SetScript("OnClick", function()
    local fn = ReloadUI or (C_UI and C_UI.Reload)
    -- Recorded first: if the call works the UI reloads and nothing after it runs.
    addIo({ action = "reloadui-click", fn = ReloadUI and "ReloadUI" or (fn and "C_UI.Reload") or "missing" })
    local r = try(fn)
    addIo({ action = "reloadui-result", result = r })
    say("ReloadUI() returned without reloading: " .. show(r) .. " (recorded; /reload to save).")
  end)
  return b
end

local function ioReloadButtons(hide)
  if inCombat() then
    say("reload buttons can't be created, shown or hidden in combat. Try again after the fight.")
    return
  end
  if hide then
    if reloadButtons then
      for _, b in pairs(reloadButtons) do pcall(b.Hide, b) end
    end
    say("reload buttons hidden.")
    return
  end
  if not reloadButtons then
    local okS, secure = pcall(makeSecureButton)
    local okP, plain = pcall(makePlainButton)
    reloadButtons = {}
    if okS then reloadButtons.secure = secure end
    if okP then reloadButtons.plain = plain end
    addIo({ action = "reloadbtn", secure = packResult(okS, okS and "created" or secure),
            plain = packResult(okP, okP and "created" or plain) })
    if not okS then say("secure button failed: " .. tostring(secure)) end
    if not okP then say("plain button failed: " .. tostring(plain)) end
  end
  for _, b in pairs(reloadButtons) do pcall(b.Show, b) end
  say("'Reload (probe)' runs /reload as a secure macro; 'ReloadUI() (probe)' calls ReloadUI() from addon code. "
    .. "Right-drag to move. Nothing happens unless you click one. After the reload, /flprobe io shows the load check.")
end

---------------------------------------------------------------- load checks
local function countKeys(t)
  local n = 0
  if type(t) == "table" then
    for _ in pairs(t) do n = n + 1 end
  end
  return n
end

-- Forever bug #34: the client may start addons with an empty table even though the file on disk has data. Record
-- what arrived before touching it, and a counter that only grows if the table is loaded back.
local function loadCheck(arrived)
  db.loadCount = (tonumber(db.loadCount) or 0) + 1
  local prev = db.loadCheck
  local keys = countKeys(arrived)
  db.loadCheck = { at = time(), build = build, probeVersion = VERSION, arrivedType = type(arrived),
                   arrivedNil = arrived == nil, arrivedKeys = keys, arrivedEmpty = keys == 0,
                   loadCount = db.loadCount, previousLoadAt = type(prev) == "table" and prev.at or nil }
  db.loadHistory = type(db.loadHistory) == "table" and db.loadHistory or {}
  local h = db.loadHistory
  h[#h + 1] = { at = db.loadCheck.at, build = build, arrivedKeys = keys, loadCount = db.loadCount }
  local extra = #h - HISTORY_CAP
  if extra > 0 then
    for i = 1, #h do h[i] = h[i + extra] end
  end
end

-- Read-only look at the ledger's table at PLAYER_LOGIN. The ledger has already created its empty sub-tables by then,
-- so "empty" means no data records (quests, items, drops, runs, turn-ins), not no keys.
local function ledgerCheck()
  local isLoaded = (C_AddOns and C_AddOns.IsAddOnLoaded) or IsAddOnLoaded
  local okL, loaded = pcall(isLoaded, "ForeverLedger")
  local l = ForeverLedgerDB
  local c = { at = time(), addonLoaded = okL and loaded and true or false, type = type(l) }
  if c.addonLoaded and type(l) == "table" then
    c.keys = countKeys(l)
    c.counts = {}
    local records = 0
    for _, k in ipairs({ "quests", "items", "drops", "runs", "turnIns", "chars" }) do
      c.counts[k] = countKeys(l[k])
      if k ~= "chars" then records = records + c.counts[k] end
    end
    c.records, c.empty = records, records == 0
  end
  db.ledgerCheck = c
end

---------------------------------------------------------------- /flprobe specs
-- Does this client say which specs an item is for? Retail's GetItemSpecInfo answers for the player's class only;
-- DoesItemContainSpec takes any class, so both are asked for every bag and equipped item, over the spec catalog.
local SPEC_API = {
  "C_Item.GetItemSpecInfo", "C_Item.DoesItemContainSpec", "C_Item.IsEquippableItem",
  "C_Item.IsItemSpecificToPlayerClass", "C_SpecializationInfo",
  "C_SpecializationInfo.GetNumSpecializationsForClassID", "C_SpecializationInfo.GetSpecializationInfo",
  "C_SpecializationInfo.GetSpecialization", "C_SpecializationInfo.GetSpecIDs",
  "C_SpecializationInfo.GetAllClassIDs", "C_SpecializationInfo.GetClassIDFromSpecID", "GetSpecializationInfoForClassID",
  "GetNumSpecializations", "GetClassInfo", "GetInventoryItemLink", "C_Container.GetContainerNumSlots",
  "C_Container.GetContainerItemLink",
}
local MAX_CLASS_ID = 13       -- Classic has 9 classes; retail ids go to 13 (Evoker)
local SPECS_WHEN_UNKNOWN = 3  -- indexes to try per class when the count call is missing
local MAX_SPECS_PER_CLASS = 8
local MAX_SPEC_ITEMS = 200
local MAX_LIST = 64

-- Like try, but a table first return is kept as a list (try clips tables to "<table>").
local function tryList(fn, ...)
  if type(fn) ~= "function" then return { ok = false, missing = true, err = "missing" } end
  local ok, first = pcall(fn, ...)
  if not ok then return { ok = false, err = clip(tostring(first)) } end
  if type(first) ~= "table" then return { ok = true, values = { clip(first) } } end
  local list = {}
  for i, v in ipairs(first) do
    if i > MAX_LIST then break end
    list[i] = clip(v)
  end
  return { ok = true, values = { list } }
end

local function specId(entry)
  local id = entry.ok and tonumber(entry.values[1])
  return id and id > 0 and id or nil
end

-- Class ids 1..MAX_CLASS_ID plus whatever GetAllClassIDs adds (a client may number classes differently).
local function classIDs()
  local ids, seen = {}, {}
  for classID = 1, MAX_CLASS_ID do ids[#ids + 1] = classID; seen[classID] = true end
  local all = tryList(resolve("C_SpecializationInfo.GetAllClassIDs"))
  for _, id in ipairs(all.ok and all.values[1] or {}) do
    if type(id) == "number" and not seen[id] then ids[#ids + 1] = id; seen[id] = true end
  end
  return ids
end

-- catalog[classID] = { info, count, specs = { { forClass, info }, ... } }; list = { { classID, specID }, ... };
-- classes = how many classes resolved at least one spec id.
local function specCatalog()
  local numFor = resolve("C_SpecializationInfo.GetNumSpecializationsForClassID")
  local infoFor = resolve("C_SpecializationInfo.GetSpecializationInfo")
  local forClass = resolve("GetSpecializationInfoForClassID")
  local classInfo = resolve("GetClassInfo")
  local catalog, list, classes = {}, {}, 0
  for _, classID in ipairs(classIDs()) do
    local c = { info = try(classInfo, classID), count = try(numFor, classID), specs = {} }
    local before = #list
    local n = c.count.ok and tonumber(c.count.values[1]) or SPECS_WHEN_UNKNOWN
    for i = 1, math.min(n, MAX_SPECS_PER_CLASS) do
      local s = { forClass = try(forClass, classID, i),
                  info = try(infoFor, i, false, false, nil, nil, nil, classID) }
      c.specs[i] = s
      local id = specId(s.forClass) or specId(s.info)
      if id then list[#list + 1] = { classID = classID, specID = id } end
    end
    if #list > before then classes = classes + 1 end
    catalog[classID] = c
  end
  return catalog, list, classes
end

local function playerSpecs()
  local infoFor = resolve("C_SpecializationInfo.GetSpecializationInfo")
  local _, token, classID = UnitClass("player")
  local p = { class = token, classID = classID, level = UnitLevel("player"),
              specIndex = try(resolve("C_SpecializationInfo.GetSpecialization")), specs = {} }
  local count = try(resolve("GetNumSpecializations"))
  local n = count.ok and tonumber(count.values[1]) or (type(infoFor) == "function" and SPECS_WHEN_UNKNOWN or 0)
  for i = 1, math.min(n, MAX_SPECS_PER_CLASS) do p.specs[i] = try(infoFor, i, false, false) end
  return p
end

-- fn(where, link) for every bag slot (0..4) and equipped slot (1..19) that holds an item, up to MAX_SPEC_ITEMS.
local function eachOwnedItem(fn)
  local numSlots = resolve("C_Container.GetContainerNumSlots")
  local slotLink = resolve("C_Container.GetContainerItemLink")
  local invLink = resolve("GetInventoryItemLink")
  local seen = 0
  local function visit(where, link)
    if seen >= MAX_SPEC_ITEMS then return end
    seen = seen + 1
    fn(where, link)
  end
  if numSlots and slotLink then
    for bag = 0, 4 do
      local okN, n = pcall(numSlots, bag)
      for slot = 1, (okN and tonumber(n)) or 0 do
        local okL, link = pcall(slotLink, bag, slot)
        if okL and type(link) == "string" then visit("bag:" .. bag .. ":" .. slot, link) end
      end
    end
  end
  if invLink then
    for slot = 1, 19 do
      local ok, link = pcall(invLink, "player", slot)
      if ok and type(link) == "string" then visit("slot:" .. slot, link) end
    end
  end
end

local function dumpSpecs()
  local getSpecInfo = resolve("C_Item.GetItemSpecInfo")
  local contains = resolve("C_Item.DoesItemContainSpec")
  local isEquippable = resolve("C_Item.IsEquippableItem")
  local classSpecific = resolve("C_Item.IsItemSpecificToPlayerClass")
  local getStats = resolve("C_Item.GetItemStats") or resolve("GetItemStats")

  local api = {}
  for _, name in ipairs(SPEC_API) do api[name] = type(resolve(name)) end
  local catalog, specList, classes = specCatalog()
  local counts = { items = 0, equippable = 0, withSpecInfo = 0, emptySpecInfo = 0, specInfoErrors = 0,
                   specInfoOther = 0, containsAny = 0 }
  local items = {}

  eachOwnedItem(function(where, link)
    local it = { id = tonumber(link:match("item:(%d+)")), link = clip(link), where = where }
    it.specInfo = tryList(getSpecInfo, link)
    it.equippable = try(isEquippable, link)
    it.classSpecific = try(classSpecific, link)
    if getStats then
      local ok, stats = pcall(getStats, link)
      if ok and type(stats) == "table" then it.statKeys = sortedKeys(stats) end
    end
    counts.items = counts.items + 1
    local equippable = it.equippable.ok and it.equippable.values[1] == true
    if equippable then counts.equippable = counts.equippable + 1 end
    -- A table answer is the expected shape; nil/false/number answers are counted apart (specInfoOther) so the
    -- summary can tell "always empty" from "not a table".
    local answer = it.specInfo.ok and it.specInfo.values[1]
    if type(answer) == "table" then
      local key = #answer > 0 and "withSpecInfo" or "emptySpecInfo"
      counts[key] = counts[key] + 1
    elseif it.specInfo.ok then
      counts.specInfoOther = counts.specInfoOther + 1
    elseif not it.specInfo.missing then
      counts.specInfoErrors = counts.specInfoErrors + 1
    end
    -- Only hits are stored (a miss for every catalog spec would bloat the file); askedSpecs says how many were asked.
    if contains and equippable and #specList > 0 then
      it.contains, it.askedSpecs = {}, #specList
      local any = false
      for _, s in ipairs(specList) do
        local ok, r = pcall(contains, link, s.classID, s.specID)
        if not ok then
          it.containsErr = clip(tostring(r))
          break
        end
        if r == true then it.contains[s.specID] = true; any = true end
      end
      if any then counts.containsAny = counts.containsAny + 1 end
    end
    items[#items + 1] = it
  end)

  db.specs[build] = { at = time(), probeVersion = VERSION, api = api, player = playerSpecs(), catalog = catalog,
                      items = items, counts = counts }
  say(format("%d item(s): %d equippable, %d with spec info (%d empty, %d errors, %d non-table), %d matched by " ..
    "DoesItemContainSpec; catalog %d class(es) / %d spec(s).", counts.items, counts.equippable, counts.withSpecInfo,
    counts.emptySpecInfo, counts.specInfoErrors, counts.specInfoOther, counts.containsAny, classes, #specList))
  say("Type /reload to write ForeverLedgerProbe.lua.")
end

---------------------------------------------------------------- lifecycle
local lifecycle = CreateFrame("Frame")
lifecycle:RegisterEvent("ADDON_LOADED")
lifecycle:RegisterEvent("PLAYER_LOGIN")
pcall(lifecycle.RegisterEvent, lifecycle, "ADDON_ACTION_BLOCKED")
pcall(lifecycle.RegisterEvent, lifecycle, "ADDON_ACTION_FORBIDDEN")
lifecycle:SetScript("OnEvent", function(_, event, name, func)
  if event == "ADDON_LOADED" then
    if name ~= "ForeverLedgerProbe" then return end
    local arrived = ForeverLedgerProbeDB
    ForeverLedgerProbeDB = type(arrived) == "table" and arrived or {}
    db = ForeverLedgerProbeDB
    db.dumps, db.sniff, db.io, db.specs = db.dumps or {}, db.sniff or {}, db.io or {}, db.specs or {}
    db.probeVersion = VERSION
    local _, buildStr = GetBuildInfo()
    build = tonumber(buildStr) or 0
    loadCheck(arrived)
    if db.sniffing then setSniff(true) end
  elseif not db then
    return
  elseif event == "PLAYER_LOGIN" then
    ledgerCheck()
  elseif name == "ForeverLedgerProbe" then -- ADDON_ACTION_BLOCKED / _FORBIDDEN naming us
    addIo({ action = "blocked", event = event, func = clip(func) })
  end
end)

SLASH_FOREVERLEDGERPROBE1 = "/flprobe"
SlashCmdList.FOREVERLEDGERPROBE = function(msg)
  msg = ((msg or ""):lower():gsub("^%s+", ""):gsub("%s+$", ""))
  if msg == "" or msg == "dump" then
    dump()
  elseif msg == "sniff on" then
    setSniff(true)
    say("sniffing all events (first " .. SAMPLE_LIMIT .. " payloads each). /flprobe sniff off to stop.")
  elseif msg == "sniff off" then
    setSniff(false)
    say("sniffer off.")
  elseif msg == "io" or msg == "io status" then
    ioStatus()
  elseif msg == "io on" then
    ioOn()
  elseif msg == "io toggle" then
    ioToggle()
  elseif msg == "io off" then
    ioOff()
  elseif msg == "io reloadbtn" or msg == "io reloadbtn hide" then
    ioReloadButtons(msg == "io reloadbtn hide")
  elseif msg == "specs" then
    dumpSpecs()
  elseif msg == "reset confirm" then
    wipe(db.dumps); wipe(db.sniff); wipe(db.io); wipe(db.specs); db.sniffEventCount = 0
    say("probe data wiped.")
  else
    local ndumps = 0
    for _ in pairs(db.dumps) do ndumps = ndumps + 1 end
    local nev = 0
    for _ in pairs(db.sniff[build] or {}) do nev = nev + 1 end
    say(format("build %d: %d dump(s), specs %s, sniffer %s, %d events seen this build, %d io entries, load #%d.",
      build, ndumps, db.specs[build] and "recorded" or "not run", db.sniffing and "ON" or "off", nev,
      #(db.io[build] or {}), db.loadCount or 0))
    say("/flprobe  |  /flprobe specs  |  /flprobe sniff on|off  |  /flprobe io [on|toggle|off|reloadbtn]  |  " ..
      "/flprobe reset confirm")
  end
end
