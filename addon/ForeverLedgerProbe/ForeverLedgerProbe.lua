-- Forever Ledger Probe v0.6.0
-- Read-only: records what this client supports so Forever Ledger can be built against the real API.
-- Nothing is automated. Output lands in WTF/Account/<ACCOUNT>/SavedVariables/ForeverLedgerProbe.lua on /reload.
--
--   /flprobe             dump build info, API docs (same data as /api), globals and event support
--   /flprobe specs       spec catalog per class and, for every bag/equipped item, which specs the client says want it
--   /flprobe names       every way the client names you (and your target / party): looking for the surname
--   /flprobe tracker     the quest tracker on the right: frames, templates, watched quests, waypoints, facing
--   /flprobe tracker watch   watch + super-track one quest, read it back, then put both back (UI state only)
--   /flprobe arrow       sample facing and position 20 times, 1 s apart (turn around and walk): for a waypoint arrow
--   /flprobe travel      taxi nodes, bind location, hearthstone cooldown, mount + speed, every map's size and corners
--   /flprobe trip on     record a flight or boat ride: taxi window, takeoff, zone changes, position every 2 s
--   /flprobe trip off    (off after /reload)
--   /flprobe fish on     record each fishing cast: events, lure, tooltip, loot sources, zone, skill (off after /reload)
--   /flprobe fish off
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

local VERSION = "0.6.0"
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

---------------------------------------------------------------- names (where is the surname?)
local MAX_FISH = 300
-- Lua patterns have no alternation: a name matches when any of these is in it (lowercased).
local NAME_PATTERNS = { "surname", "lastname", "familyname", "fullname", "charactername", "playername" }
local NAME_UNITS = { "player", "target", "party1", "mouseover" }

-- A table's first-level entries, clipped (enough to see what a getter returns).
local function shallow(t)
  if type(t) ~= "table" then return clip(t) end
  local out, n = {}, 0
  for k, v in pairs(t) do
    n = n + 1
    if n > MAX_LIST then break end
    out[tostring(k)] = clip(v)
  end
  return out
end

-- Like try, but every return value that is a table is kept one level deep.
local function tryDeep(fn, ...)
  if type(fn) ~= "function" then return { ok = false, missing = true, err = "missing" } end
  local function pack(ok, ...)
    if not ok then return { ok = false, err = clip(tostring((...))) } end
    local values = {}
    -- select("#") rather than #: a nil in the middle (GetMountInfoByID's faction) must not cut the list short.
    for i = 1, select("#", ...) do values[i] = shallow((select(i, ...))) end
    return { ok = true, values = values }
  end
  return pack(pcall(fn, ...))
end

local function nameLike(name)
  local lower = name:lower()
  for _, p in ipairs(NAME_PATTERNS) do
    if lower:find(p, 1, true) then return true end
  end
  return false
end

-- Every function whose name looks like it gives a name, in _G and the C_ namespaces.
local function nameFunctions()
  local found = {}
  for k, v in pairs(_G) do
    if type(k) == "string" then
      if type(v) == "function" and nameLike(k) then
        found[#found + 1] = k
      elseif type(v) == "table" and k:sub(1, 2) == "C_" then
        for fk, fv in pairs(v) do
          if type(fk) == "string" and type(fv) == "function" and nameLike(fk) then
            found[#found + 1] = k .. "." .. fk
          end
        end
      end
    end
  end
  table.sort(found)
  return found
end

local function unitNames(unit)
  local exists = UnitExists and UnitExists(unit)
  if not exists then return nil end
  local guid = UnitGUID and UnitGUID(unit)
  local loc = PlayerLocation and PlayerLocation.CreateFromUnit and PlayerLocation:CreateFromUnit(unit)
  local r = {
    UnitName = try(UnitName, unit),
    UnitFullName = try(UnitFullName, unit),
    GetUnitNameShort = try(GetUnitName, unit, false),
    GetUnitNameServer = try(GetUnitName, unit, true),
    UnitPVPName = try(UnitPVPName, unit),
    guid = clip(guid),
    GetPlayerInfoByGUID = guid and try(GetPlayerInfoByGUID, guid) or nil,
    GetNameAndServerNameFromGUID = guid and try(C_PlayerInfo and C_PlayerInfo.GetNameAndServerNameFromGUID, guid)
      or nil,
    calls = {},
  }
  -- C_PlayerInfo getters that take a PlayerLocation: only Get*/Is*/Should*/Can*/Has* names (read-only by convention).
  if C_PlayerInfo and loc then
    for fk, fv in pairs(C_PlayerInfo) do
      if type(fv) == "function" and (fk:find("^Get") or fk:find("^Is") or fk:find("^Should") or fk:find("^Has")) then
        local res = tryDeep(fv, loc)
        if res.ok then r.calls[fk] = res end
      end
    end
  end
  return r
end

local function frameText(path)
  local f = resolve(path)
  if type(f) ~= "table" or type(f.GetText) ~= "function" then return nil end
  local ok, text = pcall(f.GetText, f)
  return ok and clip(text) or nil
end

local function dumpNames()
  db.names = db.names or {}
  local out = { at = time(), probeVersion = VERSION, functions = nameFunctions(), units = {},
                ShouldDisplaySurname = try(C_PlayerInfo and C_PlayerInfo.ShouldDisplaySurname),
                frames = { PlayerName = frameText("PlayerName"), PlayerFrameName = frameText("PlayerFrame.name"),
                           TargetFrameName = frameText("TargetFrame.name"),
                           CharacterTitle = frameText("CharacterFrameTitleText") } }
  for _, unit in ipairs(NAME_UNITS) do out.units[unit] = unitNames(unit) end
  -- Name-like globals and C_ functions called with no argument and with "player".
  out.direct = {}
  for _, name in ipairs(out.functions) do
    -- Read-only: only getters are called (Get*, Is*, Should*, Has*, Unit*); the rest are just listed.
    local short = name:match("[^%.]+$")
    local getter = short:find("^Get") or short:find("^Is") or short:find("^Should") or short:find("^Has")
    if getter or short:find("^Unit") then
      local fn = resolve(name)
      out.direct[name] = { none = tryDeep(fn), player = tryDeep(fn, "player") }
    end
  end
  db.names[build] = out
  local p = out.units.player
  say(format("UnitName %s | UnitFullName %s | player frame %s | surname shown: %s | %d name function(s)",
    p and show(p.UnitName) or "?", p and show(p.UnitFullName) or "?", tostring(out.frames.PlayerName),
    show(out.ShouldDisplaySurname), #out.functions))
  say("Target another player (or open the character frame) and run it again for more. /reload to write the file.")
end

---------------------------------------------------------------- fishing casts
local fishFrame = CreateFrame("Frame")
local fishCast   -- the cast being recorded

local function isFishingSpell(spellID, name)
  if spellID == 7620 or spellID == 7731 or spellID == 7732 or spellID == 18248 then return true end
  return type(name) == "string" and name:lower():find("fishing") ~= nil
end

local function spellName(spellID)
  local info = C_Spell and C_Spell.GetSpellInfo and C_Spell.GetSpellInfo(spellID)
  if type(info) == "table" then return info.name end
  return GetSpellInfo and (GetSpellInfo(spellID)) or nil
end

local function fishingSkill()
  local out = {}
  local ok, a, b, c, fish = pcall(GetProfessions)
  out.GetProfessions = ok and { clip(a), clip(b), clip(c), clip(fish) } or clip(a)
  if ok and fish then out.fishing = try(GetProfessionInfo, fish) end
  return out
end

local function tooltipLines()
  if not GameTooltip or not GameTooltip.IsShown or not GameTooltip:IsShown() then return nil end
  local lines = {}
  for i = 1, math.min(GameTooltip:NumLines() or 0, 4) do
    local fs = _G["GameTooltipTextLeft" .. i]
    lines[i] = fs and clip(fs:GetText()) or nil
  end
  return lines
end

local function where()
  local mapID = C_Map and C_Map.GetBestMapForUnit and C_Map.GetBestMapForUnit("player")
  local pos = mapID and C_Map.GetPlayerMapPosition and C_Map.GetPlayerMapPosition(mapID, "player")
  local x, y
  if pos and pos.GetXY then x, y = pos:GetXY() end
  return { mapID = mapID, zone = clip(GetRealZoneText and GetRealZoneText()),
           subzone = clip(GetSubZoneText and GetSubZoneText()),
           x = x and math.floor(x * 1000 + 0.5) / 10, y = y and math.floor(y * 1000 + 0.5) / 10,
           swimming = IsSwimming and IsSwimming() or nil }
end

local function startCast()
  db.fish[build] = db.fish[build] or {}
  local list = db.fish[build]
  if #list >= MAX_FISH then return end
  fishCast = { at = time(), events = {}, lure = try(GetWeaponEnchantInfo), tooltip = tooltipLines(),
               mouseover = UnitExists and UnitExists("mouseover") and clip(UnitName("mouseover")) or nil,
               where = where(), skill = fishingSkill() }
  list[#list + 1] = fishCast
end

local function addEvent(event, ...)
  if not fishCast then return end
  local args = {}
  for i = 1, select("#", ...) do args[i] = clip((select(i, ...))) end
  fishCast.events[#fishCast.events + 1] = { event = event, t = GetTime and GetTime() or 0, args = args }
end

local function recordLoot()
  local loot = { fishingLoot = try(IsFishingLoot), slots = {} }
  local ok, n = pcall(GetNumLootItems)
  for i = 1, ok and n or 0 do
    loot.slots[i] = { info = try(GetLootSlotInfo, i), link = try(GetLootSlotLink, i),
                      sources = try(GetLootSourceInfo, i) }
  end
  return loot
end

fishFrame:SetScript("OnEvent", function(_, event, ...)
  if event == "UNIT_SPELLCAST_SENT" then
    local unit, _, _, spellID = ...
    if unit ~= "player" then return end
    if isFishingSpell(spellID, spellName(spellID)) then startCast() end
    addEvent(event, ...)
  elseif event == "LOOT_OPENED" then
    if fishCast and not fishCast.loot then
      addEvent(event, ...)
      fishCast.loot = recordLoot()
      local n = #fishCast.loot.slots
      local first = n > 0 and fishCast.loot.slots[1].info.ok and fishCast.loot.slots[1].info.values[2] or "-"
      say(format("cast %d: %s %s, lure %s, %d slot(s), first %s", #db.fish[build], tostring(fishCast.where.zone),
        tostring(fishCast.where.subzone), show(fishCast.lure), n, tostring(first)))
    end
  elseif event == "LOOT_CLOSED" then
    addEvent(event, ...)
    fishCast = nil
  else
    local unit = ...
    if unit == "player" then addEvent(event, ...) end
  end
end)

local FISH_EVENTS = { "UNIT_SPELLCAST_SENT", "UNIT_SPELLCAST_START", "UNIT_SPELLCAST_CHANNEL_START",
  "UNIT_SPELLCAST_CHANNEL_STOP", "UNIT_SPELLCAST_SUCCEEDED", "UNIT_SPELLCAST_INTERRUPTED", "UNIT_SPELLCAST_FAILED",
  "UNIT_SPELLCAST_STOP", "LOOT_READY", "LOOT_OPENED", "LOOT_CLOSED" }

local function setFish(on)
  db.fishing = on and true or nil
  for _, e in ipairs(FISH_EVENTS) do
    if on then pcall(fishFrame.RegisterEvent, fishFrame, e) else pcall(fishFrame.UnregisterEvent, fishFrame, e) end
  end
  if not on then fishCast = nil end
end

---------------------------------------------------------------- tracker (guide in Blizzard's quest tracker) + arrow
local MAX_TRACKER_GLOBALS = 400
local MAX_METHODS = 120
local ARROW_SAMPLES, ARROW_EVERY = 20, 1
-- Lua patterns have no alternation: a global matches when any of these is in its name.
local TRACKER_PATTERNS = { "ObjectiveTracker", "QuestWatch", "WatchFrame", "SuperTrack", "Navigation", "Waypoint",
  "QUEST_TRACKER", "TRACKER_MODULE", "QuestPOI" }
-- Retail 11.x (ObjectiveTrackerManager, modules), retail 10.x (ObjectiveTracker_*), Classic (QuestWatchFrame).
local TRACKER_OBJECTS = { "ObjectiveTrackerFrame", "ObjectiveTrackerManager", "ObjectiveTrackerModuleMixin",
  "ObjectiveTrackerContainerMixin", "ObjectiveTrackerBlockMixin", "QuestObjectiveTracker",
  "CampaignQuestObjectiveTracker", "ScenarioObjectiveTracker", "ObjectiveTrackerBlocksFrame", "QuestWatchFrame",
  "WatchFrame", "SuperTrackedFrame", "EditModeManagerFrame", "QuestPOI_Initialize" }
local TRACKER_TEMPLATES = { "ObjectiveTrackerModuleTemplate", "ObjectiveTrackerContainerHeaderTemplate",
  "ObjectiveTrackerModuleHeaderTemplate", "ObjectiveTrackerBlockTemplate", "ObjectiveTrackerLineTemplate",
  "ObjectiveTrackerHeaderTemplate" }
local TRACKER_ADDONS = { "Blizzard_ObjectiveTracker", "Blizzard_ObjectiveTrackerShared", "Blizzard_QuestNavigation",
  "Blizzard_EditMode" }
local TRACKER_CVARS = { "autoQuestWatch", "autoQuestProgress", "showInGameNavigation", "trackQuestSorting",
  "showQuestTrackingTooltips" }
local WATCH_APIS = { "C_QuestLog.AddQuestWatch", "C_QuestLog.RemoveQuestWatch", "C_QuestLog.GetNumQuestWatches",
  "C_QuestLog.GetQuestIDForQuestWatchIndex", "C_QuestLog.GetQuestWatchType", "C_QuestLog.SortQuestWatches",
  "C_QuestLog.GetNextWaypoint", "C_QuestLog.GetNextWaypointText", "C_QuestLog.GetQuestsOnMap",
  "C_QuestLog.GetMaxNumQuestsCanAccept", "AddQuestWatch", "RemoveQuestWatch", "IsQuestWatched",
  "GetNumQuestWatches", "GetQuestIndexForWatch", "QuestUtils_IsQuestWatched",
  "C_SuperTrack.GetSuperTrackedQuestID", "C_SuperTrack.SetSuperTrackedQuestID",
  "C_SuperTrack.IsSuperTrackingUserWaypoint", "C_SuperTrack.SetSuperTrackedUserWaypoint",
  "C_Map.SetUserWaypoint", "C_Map.HasUserWaypoint", "C_Map.GetUserWaypoint", "C_Map.ClearUserWaypoint",
  "C_Map.CanSetUserWaypointOnMap", "C_Map.GetWorldPosFromMapPos", "C_Map.GetMapWorldSize", "C_Map.GetMapInfo",
  "C_Navigation.GetFrame", "C_Navigation.GetDistance", "C_Navigation.GetTargetState",
  "C_Navigation.HasValidScreenPosition", "C_Navigation.WasClampedToScreen", "GetPlayerFacing", "UnitPosition",
  "UiMapPoint.CreateFromCoordinates" }

local function call(path, ...) return tryDeep(resolve(path), ...) end

local function round(v, places)
  if type(v) ~= "number" then return v end
  local m = 10 ^ (places or 4)
  return math.floor(v * m + 0.5) / m
end

-- Every global whose name has one of the patterns, with its type.
local function trackerGlobals()
  local found, n = {}, 0
  for k, v in pairs(_G) do
    if type(k) == "string" then
      for _, p in ipairs(TRACKER_PATTERNS) do
        if k:find(p, 1, true) then
          n = n + 1
          if n <= MAX_TRACKER_GLOBALS then found[k] = type(v) end
          break
        end
      end
    end
  end
  return found, n
end

-- What a frame or mixin is: object type, shown, anchor, child modules, and its method names.
local function describe(path)
  local o = resolve(path)
  if o == nil then return nil end
  if type(o) ~= "table" then return { type = type(o) } end
  local d = { type = "table", methods = {}, fields = {} }
  local keys = sortedKeys(o)
  for _, k in ipairs(keys) do
    local v = o[k]
    if type(v) == "function" then
      if #d.methods < MAX_METHODS then d.methods[#d.methods + 1] = tostring(k) end
    elseif type(k) == "string" and #d.fields < MAX_METHODS then
      d.fields[#d.fields + 1] = k .. ":" .. type(v)
    end
  end
  if type(o.GetObjectType) == "function" then
    d.objectType = try(o.GetObjectType, o)
    d.shown = try(o.IsShown, o)
    d.point = try(o.GetPoint, o)
    d.size = try(o.GetSize, o)
    d.children = try(o.GetNumChildren, o)
  end
  -- Its tracker modules, whichever field the client keeps them in.
  for _, field in ipairs({ "modules", "MODULES", "MODULES_UI_ORDER" }) do
    if type(o[field]) == "table" then
      local list = {}
      for i, m in ipairs(o[field]) do
        if i > MAX_LIST then break end
        local header = type(m) == "table" and (m.headerText or (m.Header and m.Header.Text)) or nil
        if type(header) == "table" and type(header.GetText) == "function" then header = header:GetText() end
        list[i] = { name = type(m) == "table" and type(m.GetName) == "function" and clip(m:GetName()) or nil,
                    header = clip(header), uiOrder = type(m) == "table" and clip(m.uiOrder) or nil }
      end
      d[field] = list
    end
  end
  return d
end

-- Can an addon build from the tracker's templates? (A hidden, unparented frame; dropped right after.)
local function templateCheck(template)
  local ok, f = pcall(CreateFrame, "Frame", nil, nil, template)
  if not ok then return { ok = false, err = clip(tostring(f)) } end
  if f and f.Hide then pcall(f.Hide, f) end
  local methods = {}
  for _, k in ipairs(sortedKeys(f or {})) do
    if type(f[k]) == "function" and #methods < MAX_METHODS then methods[#methods + 1] = tostring(k) end
  end
  return { ok = true, methods = methods }
end

local function questLog()
  local out = {}
  local nr = call("C_QuestLog.GetNumQuestLogEntries")
  local n = nr.ok and tonumber(nr.values[1]) or 0
  for i = 1, math.min(n, MAX_LIST) do
    local info = call("C_QuestLog.GetInfo", i)
    local q = info.ok and type(info.values[1]) == "table" and info.values[1] or nil
    local id = q and tonumber(q.questID)
    if id and id > 0 and q.isHeader ~= true then
      out[#out + 1] = { questID = id, title = q.title, isHidden = q.isHidden, isOnMap = q.isOnMap,
                        hasLocalPOI = q.hasLocalPOI, watchType = call("C_QuestLog.GetQuestWatchType", id),
                        isWatched = call("QuestUtils_IsQuestWatched", id),
                        waypoint = call("C_QuestLog.GetNextWaypoint", id),
                        waypointText = call("C_QuestLog.GetNextWaypointText", id) }
    end
  end
  return out
end

local function watchList()
  local nr = call("C_QuestLog.GetNumQuestWatches")
  local n = nr.ok and tonumber(nr.values[1]) or 0
  local ids = {}
  for i = 1, math.min(n, MAX_LIST) do
    local r = call("C_QuestLog.GetQuestIDForQuestWatchIndex", i)
    ids[i] = r.ok and r.values[1] or "?"
  end
  return { count = nr, ids = ids }
end

-- Where the player is and which way they face: what a TomTom-style arrow needs.
local function navSample()
  local mr = call("C_Map.GetBestMapForUnit", "player")
  local mapID = mr.ok and tonumber(mr.values[1]) or nil
  local pos = mapID and resolve("C_Map.GetPlayerMapPosition") and C_Map.GetPlayerMapPosition(mapID, "player")
  local x, y
  if type(pos) == "table" and type(pos.GetXY) == "function" then x, y = pos:GetXY() end
  local facing = call("GetPlayerFacing")
  local s = { t = GetTime and round(GetTime(), 2) or 0, mapID = mapID, x = round(x), y = round(y),
              facing = facing.ok and round(facing.values[1]) or facing, unitPosition = call("UnitPosition", "player"),
              navDistance = call("C_Navigation.GetDistance"), navState = call("C_Navigation.GetTargetState"),
              navOnScreen = call("C_Navigation.HasValidScreenPosition"),
              instance = try(IsInInstance) }
  if mapID and pos then s.world = call("C_Map.GetWorldPosFromMapPos", mapID, pos) end
  return s
end

local function dumpTracker()
  db.tracker = db.tracker or {}
  local globals, nGlobals = trackerGlobals()
  local out = { at = time(), probeVersion = VERSION, globals = globals, globalCount = nGlobals, objects = {},
                templates = {}, addons = {}, cvars = {}, apis = {}, inCombat = inCombat() }
  for _, path in ipairs(TRACKER_OBJECTS) do out.objects[path] = describe(path) end
  if not out.inCombat then
    for _, t in ipairs(TRACKER_TEMPLATES) do out.templates[t] = templateCheck(t) end
  end
  for _, a in ipairs(TRACKER_ADDONS) do out.addons[a] = call("C_AddOns.IsAddOnLoaded", a) end
  for _, cv in ipairs(TRACKER_CVARS) do out.cvars[cv] = try(GetCVar, cv) end
  for _, api in ipairs(WATCH_APIS) do out.apis[api] = type(resolve(api)) end
  out.watchTypes = shallow(Enum and Enum.QuestWatchType)
  out.maxWatchable = clip(rawget(_G, "MAX_WATCHABLE_QUESTS"))
  out.watches = watchList()
  out.quests = questLog()
  out.superTrackedQuest = call("C_SuperTrack.GetSuperTrackedQuestID")
  out.userWaypoint = { has = call("C_Map.HasUserWaypoint"), get = call("C_Map.GetUserWaypoint"),
                       superTracked = call("C_SuperTrack.IsSuperTrackingUserWaypoint") }
  out.nav = navSample()
  local mapID = out.nav.mapID
  if mapID then
    out.map = { info = call("C_Map.GetMapInfo", mapID), worldSize = call("C_Map.GetMapWorldSize", mapID),
                questsOnMap = call("C_QuestLog.GetQuestsOnMap", mapID),
                canPin = call("C_Map.CanSetUserWaypointOnMap", mapID) }
  end
  db.tracker[build] = out
  local tf = out.objects.ObjectiveTrackerFrame
  local nTemplates = 0
  for _, r in pairs(out.templates) do nTemplates = nTemplates + (r.ok and 1 or 0) end
  say(format("tracker %s, manager %s, QuestWatchFrame %s | %d/%d templates | %d tracker globals | %d watched, " ..
    "%d in log | facing %s, nav %s", tf and (tf.objectType and show(tf.objectType) or tf.type) or "missing",
    out.objects.ObjectiveTrackerManager and "yes" or "no", out.objects.QuestWatchFrame and "yes" or "no",
    nTemplates, #TRACKER_TEMPLATES, nGlobals, #out.watches.ids, #out.quests,
    tostring(type(out.nav.facing) == "number" and out.nav.facing or show(out.nav.facing)), show(out.nav.navDistance)))
  say("/flprobe tracker watch tries watching a quest (then puts it back); /flprobe arrow samples facing. /reload.")
end

-- Watch one quest and super-track it, read both back, then put everything back as it was. UI state only.
local function watchTest()
  if inCombat() then return say("out of combat only.") end
  db.tracker = db.tracker or {}
  local quests = questLog()
  if #quests == 0 then return say("no quests in your log: pick one up first.") end
  local pick
  for _, q in ipairs(quests) do
    local wt = q.watchType
    if not pick and not (wt.ok and wt.values[1] ~= nil and wt.values[1] ~= "<nil>") then pick = q end
  end
  pick = pick or quests[1]
  local id = pick.questID
  local t = { at = time(), probeVersion = VERSION, questID = id, title = pick.title, steps = {} }
  local function step(name, r)
    t.steps[#t.steps + 1] = { name = name, result = r, watchType = call("C_QuestLog.GetQuestWatchType", id),
                              watches = watchList().count, superTracked = call("C_SuperTrack.GetSuperTrackedQuestID") }
  end
  local before = call("C_QuestLog.GetQuestWatchType", id)
  local wasWatched = before.ok and before.values[1] ~= nil and before.values[1] ~= "<nil>"
  local superBefore = call("C_SuperTrack.GetSuperTrackedQuestID")
  step("before", before)
  if wasWatched then step("RemoveQuestWatch", call("C_QuestLog.RemoveQuestWatch", id)) end
  step("AddQuestWatch", call("C_QuestLog.AddQuestWatch", id))
  step("SetSuperTrackedQuestID", call("C_SuperTrack.SetSuperTrackedQuestID", id))
  -- Put it back.
  if not wasWatched then step("RemoveQuestWatch (restore)", call("C_QuestLog.RemoveQuestWatch", id)) end
  local prev = superBefore.ok and tonumber(superBefore.values[1]) or 0
  step("SetSuperTrackedQuestID (restore)", call("C_SuperTrack.SetSuperTrackedQuestID", prev))
  db.tracker.watchTest = db.tracker.watchTest or {}
  db.tracker.watchTest[build] = t
  local byName = {}
  for _, s in ipairs(t.steps) do byName[s.name] = s end
  say(format("%q (%d): watch type after Add %s, super-tracked after Set %s; restored. /reload to write the file.",
    tostring(pick.title), id, show(byName.AddQuestWatch.watchType), show(byName.SetSuperTrackedQuestID.superTracked)))
end

-- A TomTom-style arrow needs facing + position every frame: sample them while the player turns and walks.
local arrowRun
local function arrowTick()
  if not arrowRun then return end
  local list = db.tracker.arrow[build]
  list[#list + 1] = navSample()
  arrowRun.left = arrowRun.left - 1
  if arrowRun.left <= 0 then
    arrowRun = nil
    local first, last = list[1], list[#list]
    say(format("arrow: %d sample(s); facing %s -> %s, x/y %s,%s -> %s,%s. /reload to write the file.", #list,
      tostring(first.facing), tostring(last.facing), tostring(first.x), tostring(first.y), tostring(last.x),
      tostring(last.y)))
    return
  end
  C_Timer.After(ARROW_EVERY, arrowTick)
end

local function arrowSample()
  if not (C_Timer and C_Timer.After) then return say("C_Timer.After is missing: can't sample.") end
  db.tracker = db.tracker or {}
  db.tracker.arrow = db.tracker.arrow or {}
  db.tracker.arrow[build] = {}
  arrowRun = { left = ARROW_SAMPLES }
  say(format("sampling facing and position %d times, every %d s: turn in a full circle, then walk a bit.",
    ARROW_SAMPLES, ARROW_EVERY))
  arrowTick()
end

---------------------------------------------------------------- travel (quest-atlas planner) + trip recorder
-- What the route planner needs from the client: flight nodes, bind location, hearthstone cooldown, mount and speed, and
-- every map's size and world corners. Read-only: nothing here takes a flight, moves or casts.
local TRAVEL_APIS = { "C_TaxiMap.GetAllTaxiNodes", "C_TaxiMap.GetTaxiNodesForMap", "GetTaxiMapID", "NumTaxiNodes",
  "TaxiNodeName", "TaxiNodeGetType", "TaxiNodePosition", "UnitOnTaxi", "TakeTaxiNode", "GetBindLocation",
  "C_Container.GetItemCooldown", "GetItemCooldown", "C_Item.GetItemCooldown", "C_Spell.GetSpellCooldown",
  "GetSpellCooldown", "C_Item.GetItemCount", "GetItemCount", "IsMounted", "IsIndoors", "GetUnitSpeed",
  "C_MountJournal", "C_MountJournal.GetMountIDs", "C_MountJournal.GetMountInfoByID", "C_MountJournal.GetNumMounts",
  "IsFlying", "IsSwimming", "UnitInVehicle", "C_Map.GetMapInfo", "C_Map.GetMapWorldSize",
  "C_Map.GetWorldPosFromMapPos", "CreateVector2D" }
local TRAVEL_MAPS = { 1414, 1415 }  -- Kalimdor, Eastern Kingdoms (plus the map you stand on)
local HEARTHSTONE_ITEM, HEARTHSTONE_SPELL = 6948, 8690
local MAX_TAXI_NODES = 200
local MAX_MOUNTS = 20
local MAP_SCAN = 3000               -- uiMapIDs 1..MAP_SCAN are asked
local MAP_FIELDS = { "id", "name", "mapType", "parentMapID", "width", "height", "c0", "x0", "y0", "c1", "x1", "y1" }
local TRIP_EVERY = 2                -- seconds between trip samples
local MAX_TRIP_SAMPLES = 900        -- 30 min
local MAX_TRIP_EVENTS = 300
local MAX_TRIPS = 20                -- per build
local TRIP_EVENTS = { "TAXIMAP_OPENED", "TAXIMAP_CLOSED", "PLAYER_CONTROL_LOST", "PLAYER_CONTROL_GAINED",
  "ZONE_CHANGED", "ZONE_CHANGED_NEW_AREA", "PLAYER_ENTERING_WORLD", "LOADING_SCREEN_ENABLED",
  "LOADING_SCREEN_DISABLED" }

-- The first return of a getter, or nil (missing, error, or a table/function).
local function first(path, ...)
  local fn = resolve(path)
  if type(fn) ~= "function" then return nil end
  local ok, v = pcall(fn, ...)
  if not ok or v == nil then return nil end
  local tv = type(v)
  if tv == "string" or tv == "number" or tv == "boolean" then return clip(v) end
  return nil
end

-- { x, y } of a Vector2D (fields or :GetXY()), or nil.
local function vecXY(v, places)
  if type(v) ~= "table" then return nil end
  local x, y = v.x, v.y
  if (type(x) ~= "number" or type(y) ~= "number") and type(v.GetXY) == "function" then
    local ok, a, b = pcall(v.GetXY, v)
    if ok then x, y = a, b end
  end
  if type(x) ~= "number" or type(y) ~= "number" then return nil end
  return { round(x, places), round(y, places) }
end

-- A C_TaxiMap list: each node one level deep, its position vector read as { x, y }.
local function taxiNodes(path, mapID)
  local fn = resolve(path)
  if type(fn) ~= "function" then return { ok = false, missing = true, err = "missing" } end
  local ok, list = pcall(fn, mapID)
  if not ok then return { ok = false, err = clip(tostring(list)) } end
  if type(list) ~= "table" then return { ok = true, value = clip(list) } end
  local nodes = {}
  for i, node in ipairs(list) do
    if i > MAX_TAXI_NODES then break end
    local s = shallow(node)
    if type(node) == "table" and type(s) == "table" then s.position = vecXY(node.position) or s.position end
    nodes[i] = s
  end
  return { ok = true, count = #list, nodes = nodes }
end

-- Where the player is right now: one trip sample.
local function travelSample()
  local mapID = first("C_Map.GetBestMapForUnit", "player")
  local x, y
  local getPos = resolve("C_Map.GetPlayerMapPosition")
  if type(mapID) == "number" and type(getPos) == "function" then
    local ok, pos = pcall(getPos, mapID, "player")
    local xy = ok and vecXY(pos)
    if xy then x, y = xy[1], xy[2] end
  end
  return { t = round(first("GetTime") or time(), 2), mapID = mapID, x = x, y = y, zone = first("GetRealZoneText"),
           subzone = first("GetSubZoneText"), onTaxi = first("UnitOnTaxi", "player"), mounted = first("IsMounted"),
           speed = round(first("GetUnitSpeed", "player"), 2), indoors = first("IsIndoors") }
end

local function mountInfo()
  local m = { num = call("C_MountJournal.GetNumMounts"), list = {} }
  local fn = resolve("C_MountJournal.GetMountIDs")
  local ok, ids = false, "missing"
  if type(fn) == "function" then ok, ids = pcall(fn) end
  if ok and type(ids) == "table" then
    m.ids = #ids
    for i = 1, math.min(#ids, MAX_MOUNTS) do m.list[i] = call("C_MountJournal.GetMountInfoByID", ids[i]) end
  else
    m.ids = clip(type(ids) == "string" and ids or tostring(ids))
  end
  return m
end

-- uiMapID 1..MAP_SCAN: one row of numbers per map that exists (see MAP_FIELDS); false where the client had no answer.
local function mapCatalog()
  local getInfo = resolve("C_Map.GetMapInfo")
  if type(getInfo) ~= "function" then return { missing = true, count = 0 } end
  local getSize, getWorld = resolve("C_Map.GetMapWorldSize"), resolve("C_Map.GetWorldPosFromMapPos")
  local makeVec = resolve("CreateVector2D")
  local function vec(x, y)
    if type(makeVec) == "function" then
      local ok, v = pcall(makeVec, x, y)
      if ok and v then return v end
    end
    return { x = x, y = y }
  end
  local function corner(id, x, y)
    if type(getWorld) ~= "function" then return false, false, false end
    local ok, continent, pos = pcall(getWorld, id, vec(x, y))
    local xy = ok and vecXY(pos, 1)
    if not xy then return false, false, false end
    return tonumber(continent) or false, xy[1], xy[2]
  end
  local rows, errors = {}, 0
  for id = 1, MAP_SCAN do
    local ok, info = pcall(getInfo, id)
    if not ok then
      errors = errors + 1
    elseif type(info) == "table" then
      local w, h = false, false
      if type(getSize) == "function" then
        local okS, a, b = pcall(getSize, id)
        if okS then w, h = round(tonumber(a), 1) or false, round(tonumber(b), 1) or false end
      end
      local c0, x0, y0 = corner(id, 0, 0)
      local c1, x1, y1 = corner(id, 1, 1)
      rows[#rows + 1] = { id, clip(info.name), tonumber(info.mapType) or false, tonumber(info.parentMapID) or false,
                          w, h, c0, x0, y0, c1, x1, y1 }
    end
  end
  return { fields = MAP_FIELDS, rows = rows, count = #rows, scanned = MAP_SCAN, errors = errors,
           vector = type(makeVec) == "function" and "CreateVector2D" or "table" }
end

local function dumpTravel()
  db.travel = db.travel or {}
  local out = { at = time(), probeVersion = VERSION, apis = {}, taxi = {}, here = travelSample() }
  for _, api in ipairs(TRAVEL_APIS) do out.apis[api] = type(resolve(api)) end
  local mapIDs, seen = {}, {}
  for _, id in ipairs({ out.here.mapID, TRAVEL_MAPS[1], TRAVEL_MAPS[2] }) do
    if type(id) == "number" and not seen[id] then mapIDs[#mapIDs + 1] = id; seen[id] = true end
  end
  for _, id in ipairs(mapIDs) do
    out.taxi[id] = { all = taxiNodes("C_TaxiMap.GetAllTaxiNodes", id),
                     forMap = taxiNodes("C_TaxiMap.GetTaxiNodesForMap", id) }
  end
  out.bind = call("GetBindLocation")
  out.hearth = {
    item = HEARTHSTONE_ITEM, spell = HEARTHSTONE_SPELL, now = call("GetTime"),
    count = { ["C_Item.GetItemCount"] = call("C_Item.GetItemCount", HEARTHSTONE_ITEM),
              GetItemCount = call("GetItemCount", HEARTHSTONE_ITEM) },
    cooldown = { ["C_Container.GetItemCooldown"] = call("C_Container.GetItemCooldown", HEARTHSTONE_ITEM),
                 GetItemCooldown = call("GetItemCooldown", HEARTHSTONE_ITEM),
                 ["C_Item.GetItemCooldown"] = call("C_Item.GetItemCooldown", HEARTHSTONE_ITEM),
                 ["C_Spell.GetSpellCooldown"] = call("C_Spell.GetSpellCooldown", HEARTHSTONE_SPELL),
                 GetSpellCooldown = call("GetSpellCooldown", HEARTHSTONE_SPELL) },
  }
  out.state = { IsMounted = call("IsMounted"), IsFlying = call("IsFlying"), IsSwimming = call("IsSwimming"),
                IsIndoors = call("IsIndoors"), UnitOnTaxi = call("UnitOnTaxi", "player"),
                UnitInVehicle = call("UnitInVehicle", "player"), GetUnitSpeed = call("GetUnitSpeed", "player"),
                NumTaxiNodes = call("NumTaxiNodes"), GetTaxiMapID = call("GetTaxiMapID") }
  out.mounts = mountInfo()
  out.maps = mapCatalog()
  db.travel[build] = out
  local function nodeCount(id)
    local t = out.taxi[id]
    if not t then return "-" end
    local a, m = t.all, t.forMap
    return (a.ok and tostring(a.count or a.value) or (a.missing and "missing" or "error")) .. "/" ..
      (m.ok and tostring(m.count or m.value) or (m.missing and "missing" or "error"))
  end
  local cd = out.hearth.cooldown["C_Container.GetItemCooldown"]
  if not cd.ok then cd = out.hearth.cooldown.GetItemCooldown end
  say(format("taxi nodes (all/forMap) Kalimdor %s, Eastern Kingdoms %s, here (%s) %s | bind %s | hearth count %s, " ..
    "cooldown %s | mounted %s, speed %s | %s mount(s) | map catalog %d", nodeCount(1414), nodeCount(1415),
    tostring(out.here.mapID), nodeCount(out.here.mapID), show(out.bind),
    show(out.hearth.count["C_Item.GetItemCount"]), show(cd), show(out.state.IsMounted), show(out.state.GetUnitSpeed),
    tostring(out.mounts.ids), out.maps.count))
  say("Open a flight master's map and run /flprobe trip on before flying or taking a boat. /reload to write the file.")
end

-- The flight master window: every node's name, type and position, plus C_TaxiMap's view of the same map.
local function taxiWindow()
  local w = { numNodes = first("NumTaxiNodes"), mapID = first("GetTaxiMapID"), nodes = {} }
  for i = 1, math.min(tonumber(w.numNodes) or 0, MAX_TAXI_NODES) do
    local px, py
    local posFn = resolve("TaxiNodePosition")
    if type(posFn) == "function" then
      local ok, a, b = pcall(posFn, i)
      if ok then px, py = round(tonumber(a)), round(tonumber(b)) end
    end
    w.nodes[i] = { name = first("TaxiNodeName", i), type = first("TaxiNodeGetType", i), x = px, y = py }
  end
  if type(w.mapID) == "number" then w.all = taxiNodes("C_TaxiMap.GetAllTaxiNodes", w.mapID) end
  return w
end

local tripFrame = CreateFrame("Frame")
local tripRun          -- the trip being recorded (a table inside db.travel.trips[build])
local tripGen = 0      -- bumped on every on/off so a stale C_Timer chain stops
local tripHooked       -- "TakeTaxiNode" once the post-hook is in (it can't be removed; it checks tripRun)

local function tripEvent(event, extra)
  if not tripRun or #tripRun.events >= MAX_TRIP_EVENTS then return end
  local e = extra or {}
  e.event, e.at, e.t = event, time(), round(first("GetTime") or time(), 2)
  tripRun.events[#tripRun.events + 1] = e
  return e
end

local function tripTick()
  if not tripRun or #tripRun.samples >= MAX_TRIP_SAMPLES then return end
  tripRun.samples[#tripRun.samples + 1] = travelSample()
end

local function scheduleTick(gen)
  C_Timer.After(TRIP_EVERY, function()
    if gen ~= tripGen or not tripRun then return end
    tripTick()
    scheduleTick(gen)
  end)
end

-- Post-hook on the client's TakeTaxiNode: it only reads which node the player picked.
local function onTakeTaxiNode(slot)
  if not tripRun then return end
  pcall(function()
    local from
    for i = 1, math.min(tonumber(first("NumTaxiNodes")) or 0, MAX_TAXI_NODES) do
      if first("TaxiNodeGetType", i) == "CURRENT" then from = first("TaxiNodeName", i) end
    end
    local e = { node = clip(slot), destination = first("TaxiNodeName", slot), type = first("TaxiNodeGetType", slot),
                from = from, here = travelSample() }
    local posFn = resolve("TaxiNodePosition")
    if type(posFn) == "function" then
      local ok, a, b = pcall(posFn, slot)
      if ok then e.x, e.y = round(tonumber(a)), round(tonumber(b)) end
    end
    tripEvent("TakeTaxiNode", e)
  end)
end

tripFrame:SetScript("OnEvent", function(_, event, ...)
  if not tripRun then return end
  local args = {}
  for i = 1, select("#", ...) do args[i] = clip((select(i, ...))) end
  local e = { args = args, here = travelSample() }
  if event == "TAXIMAP_OPENED" then e.taxi = taxiWindow() end
  tripEvent(event, e)
end)

local function startTrip()
  if tripRun then return say("already recording a trip. /flprobe trip off to stop.") end
  db.travel = db.travel or {}
  db.travel.trips = db.travel.trips or {}
  db.travel.trips[build] = db.travel.trips[build] or {}
  local list = db.travel.trips[build]
  if #list >= MAX_TRIPS then table.remove(list, 1) end
  local trip = { startedAt = time(), probeVersion = VERSION, registered = {}, events = {}, samples = {} }
  list[#list + 1] = trip
  for _, ev in ipairs(TRIP_EVENTS) do trip.registered[ev] = pcall(tripFrame.RegisterEvent, tripFrame, ev) end
  if not tripHooked then
    if type(resolve("TakeTaxiNode")) ~= "function" then
      trip.hook = "missing"
    else
      local ok, err = pcall(hooksecurefunc, "TakeTaxiNode", onTakeTaxiNode)
      if ok then tripHooked = "TakeTaxiNode" end
      trip.hook = ok and "TakeTaxiNode" or clip(tostring(err))
    end
  else
    trip.hook = tripHooked
  end
  tripRun = trip
  tripGen = tripGen + 1
  tripTick()
  if C_Timer and C_Timer.After then
    trip.timer = "C_Timer"
    scheduleTick(tripGen)
  else
    trip.timer = "OnUpdate"
    local acc = 0
    tripFrame:SetScript("OnUpdate", function(_, elapsed)
      acc = acc + (tonumber(elapsed) or 0)
      if acc >= TRIP_EVERY then
        acc = 0
        tripTick()
      end
    end)
  end
  say(format("recording the trip: a sample every %d s (up to %d), taxi windows, takeoffs, zone changes, loading " ..
    "screens. Fly or take the boat, then /flprobe trip off and /reload. Stops on /reload.", TRIP_EVERY,
    MAX_TRIP_SAMPLES))
end

local function stopTrip(quiet)
  local trip = tripRun
  tripRun = nil
  tripGen = tripGen + 1
  for _, ev in ipairs(TRIP_EVENTS) do pcall(tripFrame.UnregisterEvent, tripFrame, ev) end
  pcall(tripFrame.SetScript, tripFrame, "OnUpdate", nil)
  if not trip then
    if not quiet then say("no trip is being recorded.") end
    return
  end
  trip.stoppedAt = time()
  if quiet then return end
  local taxi, takeoffs, onTaxi = 0, 0, 0
  for _, e in ipairs(trip.events) do
    if e.event == "TAXIMAP_OPENED" then taxi = taxi + 1 end
    if e.event == "TakeTaxiNode" then takeoffs = takeoffs + 1 end
  end
  for _, s in ipairs(trip.samples) do
    if s.onTaxi then onTaxi = onTaxi + 1 end
  end
  say(format("trip: %d sample(s) over %d s, %d event(s): %d taxi window(s), %d takeoff(s), on a taxi in %d " ..
    "sample(s). /reload to write the file.", #trip.samples, trip.stoppedAt - trip.startedAt, #trip.events, taxi,
    takeoffs, onTaxi))
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
    db.names, db.fish, db.tracker = db.names or {}, db.fish or {}, db.tracker or {}
    db.travel = db.travel or {}
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
  elseif msg == "names" then
    dumpNames()
  elseif msg == "tracker" then
    dumpTracker()
  elseif msg == "tracker watch" then
    watchTest()
  elseif msg == "arrow" then
    arrowSample()
  elseif msg == "travel" then
    dumpTravel()
  elseif msg == "trip on" then
    startTrip()
  elseif msg == "trip off" then
    stopTrip(false)
  elseif msg == "fish on" then
    setFish(true)
    say("recording fishing casts (up to " .. MAX_FISH .. " this build). Fish a bit, then /flprobe fish off, /reload.")
  elseif msg == "fish off" then
    setFish(false)
    say(format("fishing recorder off; %d cast(s) recorded this build.", #(db.fish[build] or {})))
  elseif msg == "reset confirm" then
    stopTrip(true)
    wipe(db.travel)
    wipe(db.dumps); wipe(db.sniff); wipe(db.io); wipe(db.specs); wipe(db.names); wipe(db.fish); wipe(db.tracker)
    db.sniffEventCount = 0
    say("probe data wiped.")
  else
    local ndumps = 0
    for _ in pairs(db.dumps) do ndumps = ndumps + 1 end
    local nev = 0
    for _ in pairs(db.sniff[build] or {}) do nev = nev + 1 end
    say(format("build %d: %d dump(s), specs %s, sniffer %s, %d events seen this build, %d io entries, load #%d.",
      build, ndumps, db.specs[build] and "recorded" or "not run", db.sniffing and "ON" or "off", nev,
      #(db.io[build] or {}), db.loadCount or 0))
    say("/flprobe  |  /flprobe specs  |  /flprobe names  |  /flprobe tracker [watch]  |  /flprobe arrow  |  " ..
      "/flprobe travel  |  /flprobe trip on|off  |  " ..
      "/flprobe fish on|off  |  /flprobe sniff on|off  |  " ..
      "/flprobe io [on|toggle|off|reloadbtn]  |  /flprobe reset confirm")
  end
end
