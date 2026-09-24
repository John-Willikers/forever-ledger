-- Forever Ledger v0.3.2 (SavedVariables schema 4)
-- Passive data collector. Reads what the game already shows you; automates nothing.
-- Data is written to WTF/Account/<ACCOUNT>/SavedVariables/ForeverLedger.lua on /reload or logout.

local VERSION = "0.3.2"
-- 2 adds turnIns[].choice; 3 adds meta.session, dropQty, corpses and run lootMethod / bossLoot / groupLoot;
-- 4 adds professions (skills, skillUps, recipes, recipeSeen, learned, crafts, nodes, nodeLoot, trainers, vendors),
-- items[].classID/subclassID and apiSamples. Each is additive: older data is valid as it is.
local SCHEMA_VERSION = 4
local HISTORY_CAP = 2000 -- runs and turn-ins kept on disk; the uploader already has older rows
local LIST_CAP = 500     -- bossLoot and groupLoot entries kept per run
local f = CreateFrame("Frame")

-- API compatibility (Classic-era globals vs newer namespaces; Forever 1.60 has only the namespaces)
local GetItemInfo  = (C_Item and C_Item.GetItemInfo) or GetItemInfo
local GetItemStats = (C_Item and C_Item.GetItemStats) or GetItemStats
local GetItemSpell = (C_Item and C_Item.GetItemSpell) or GetItemSpell
local QuestLog = C_QuestLog or {}
local NumLogEntries = GetNumQuestLogEntries or QuestLog.GetNumQuestLogEntries

-- title, level, suggestedGroup, isHeader, questID for quest log line i
local function logEntry(i)
  if GetQuestLogTitle then
    local title, level, suggestedGroup, isHeader, _, _, _, qid = GetQuestLogTitle(i)
    return title, level, suggestedGroup, isHeader, qid
  end
  local info = QuestLog.GetInfo and QuestLog.GetInfo(i)
  if info then return info.title, info.level, info.suggestedGroup, info.isHeader, info.questID end
end

-- Classic selects by log index, newer clients by questID. Returns what selectLogEntry needs to restore it.
local function logSelection()
  if GetQuestLogSelection then return GetQuestLogSelection() end
  return QuestLog.GetSelectedQuest and QuestLog.GetSelectedQuest()
end

local function selectLogEntry(i, questID)
  if SelectQuestLogEntry then SelectQuestLogEntry(i)
  elseif QuestLog.SetSelectedQuest then QuestLog.SetSelectedQuest(questID) end
end

local db
local build = 0
local pendingItems = {}
local seenLoot = {}
local run
local lastXP, lastMax, lastLevel
local RESUME_WINDOW = 900 -- seconds: re-entering the same instance within 15 min continues the run

local function now() return time() end
local function say(msg) print("|cff33ff99Forever Ledger:|r " .. msg) end

---------------------------------------------------------------- checkpoint nudges
-- Only SavedVariables reach disk, and only on /reload or logout. At natural checkpoints (boss kill, run closed,
-- quest turned in, dungeon finder reward) remind the player once, out of combat, that there is unsaved data.
-- It only prints. Bookkeeping stays in locals so the SavedVariables shape is unchanged (/fl nudge off lasts until
-- the next /reload or logout).
local NUDGE_GAP = 300    -- seconds: at most one nudge per 5 minutes
local newRecords = 0     -- records added since this load (every load is a save point)
local nudgeOn = true
local nudgeDeferred = false
local lastNudgeAt

local function added() newRecords = newRecords + 1 end

local function inCombat()
  local ok, locked = pcall(InCombatLockdown)
  if ok and locked then return true end
  local ok2, busy = pcall(UnitAffectingCombat, "player")
  return ok2 and busy and true or false
end

local function checkpoint()
  if not nudgeOn or newRecords < 1 then return end
  if inCombat() then nudgeDeferred = true; return end
  nudgeDeferred = false
  if lastNudgeAt and now() - lastNudgeAt < NUDGE_GAP then return end
  lastNudgeAt = now()
  say(format("%d new record%s since your last /reload — type /reload to save them (the tray app uploads within "
    .. "seconds).", newRecords, newRecords == 1 and "" or "s"))
end

---------------------------------------------------------------- helpers
local function idFromLink(link) return link and tonumber(link:match("item:(%d+)")) end
local function charKey() return (UnitName("player") or "?") .. "-" .. (GetRealmName() or "?") end

-- What a GUID is, for loot and NPC windows: "npc" for Creature/Vehicle-0-server-instance-zoneUID-npcID-spawnUID,
-- "object" for GameObject-0-server-instance-zoneUID-objectID-spawnUID (the id is the 6th field in both).
local function guidSource(guid)
  if type(guid) ~= "string" then return nil end
  local unitType, _, _, _, _, id = strsplit("-", guid)
  if unitType == "Creature" or unitType == "Vehicle" then return "npc", tonumber(id) end
  if unitType == "GameObject" then return "object", tonumber(id) end
end

local function npcIDFromGUID(guid)
  local kind, id = guidSource(guid)
  if kind == "npc" then return id end
end

local function where()
  local w = { zone = GetRealZoneText(), subzone = GetSubZoneText() }
  if C_Map and C_Map.GetBestMapForUnit then
    local mapID = C_Map.GetBestMapForUnit("player")
    if mapID then
      w.mapID = mapID
      local ok, pos = pcall(C_Map.GetPlayerMapPosition, mapID, "player")
      if ok and pos then
        local x, y = pos:GetXY()
        w.x, w.y = floor(x * 1000) / 10, floor(y * 1000) / 10
      end
    end
  end
  return w
end

local function whoAmI()
  local _, class = UnitClass("player")
  local _, race = UnitRace("player")
  return { name = UnitName("player"), realm = GetRealmName(), class = class,
           race = race, faction = UnitFactionGroup("player"), level = UnitLevel("player") }
end

local function packed(...) return select("#", ...), { ... } end

-- Enum values are stored as their lower-cased key ("group", "needmainspec"); the raw value when the client has no
-- Enum for it; strings (the Classic GetLootMethod) lower-cased as they are.
local function enumName(enum, v)
  if type(v) == "string" then return v:lower() end
  if type(v) ~= "number" then return nil end
  if type(enum) == "table" then
    for k, ev in pairs(enum) do
      if ev == v and type(k) == "string" then return k:lower() end
    end
  end
  return tostring(v)
end

-- Drops the oldest entries so the file stays bounded.
local function trim(list, cap)
  local extra = #list - cap
  if extra <= 0 then return end
  for i = 1, #list do list[i] = list[i + extra] end
end

---------------------------------------------------------------- items
local tip = CreateFrame("GameTooltip", "ForeverLedgerScanTip", nil, "GameTooltipTemplate")

local function scanItem(itemID, link)
  if not itemID then return end
  local name, ilink, quality, ilvl, reqLevel, itype, isub, _, equipLoc, _, sellPrice, classID, subclassID =
    GetItemInfo(link or itemID)
  if not name then pendingItems[itemID] = link or true; return end -- server hasn't sent it yet
  pendingItems[itemID] = nil

  local rec = db.items[itemID] or { id = itemID, byBuild = {} }
  db.items[itemID] = rec
  rec.name, rec.quality, rec.type, rec.subtype, rec.equipLoc = name, quality, itype, isub, equipLoc
  -- classID 9 is Recipe: lets the server find recipe drops and vendor recipes
  rec.classID, rec.subclassID = tonumber(classID) or rec.classID, tonumber(subclassID) or rec.subclassID

  -- Per-build snapshot: beta stat changes are data, never overwrite another build's values.
  local snap = rec.byBuild[build]
  if not snap then
    snap = { firstSeen = now() }
    rec.byBuild[build] = snap
    added()
  end
  snap.link, snap.ilvl, snap.reqLevel, snap.sellPrice = ilink, ilvl, reqLevel, sellPrice

  local ok, stats = pcall(GetItemStats, ilink)
  if ok and stats then snap.stats = stats end

  -- Full tooltip text catches set bonuses, "Equip:" effects and anything GetItemStats misses.
  -- Left and right columns are joined with a tab.
  tip:SetOwner(WorldFrame, "ANCHOR_NONE")
  tip:ClearLines()
  tip:SetHyperlink(ilink)
  local lines = {}
  for i = 1, tip:NumLines() do
    local l = _G["ForeverLedgerScanTipTextLeft" .. i]
    local r = _G["ForeverLedgerScanTipTextRight" .. i]
    local lt, rt = l and l:GetText(), r and r:GetText()
    if lt or rt then
      lines[#lines + 1] = (lt or "") .. ((rt and rt ~= "") and ("\t" .. rt) or "")
    end
  end
  if #lines > 0 then snap.tooltip = lines end
end

-- Items read in bulk (recipe reagents, vendor stock) are scanned once per build, not on every window refresh.
local function scanItemOnce(itemID, link)
  local rec = itemID and db.items[itemID]
  if rec and rec.byBuild and rec.byBuild[build] then return end
  scanItem(itemID, link)
end

---------------------------------------------------------------- professions: API samples and readers
-- Forever runs the retail profession API, but the dump names its structs without their fields. `field` returns the
-- first candidate name that is present; `need` does the same and notes a miss. The first table each API returns on a
-- build is kept in db.apiSamples (trimmed), so the real field names can be checked on the server.
local ATTRIBUTE_WINDOW = 5 -- seconds: a skill-up or learned recipe belongs to a craft or item use this recent
local field, sample, sampleReturns, need, throttled, noteError, safely
do
  local SCAN_GAP = 2         -- seconds between two scans of the same window (profession, trainer, vendor)
  local SAMPLE_KEYS, SAMPLE_DEPTH, SAMPLE_STR = 60, 2, 200
  -- sample = { ["api:firstName"] = "firstName|otherName" } for required reads where no candidate name was present
  local MISSES_API = "ForeverLedger.fieldMisses"

  function field(t, ...)
    if type(t) ~= "table" then return nil end
    for i = 1, select("#", ...) do
      local v = t[(select(i, ...))]
      if v ~= nil then return v end
    end
    return nil -- one value, always: callers pass this straight to tonumber()
  end

  -- Keeps one sample per API per build: depth <= 2, <= 60 keys per table, strings <= 200 chars, functions and
  -- userdata dropped; a deeper table becomes the string "<table>".
  local function trimSample(v, depth)
    local tv = type(v)
    if tv == "string" then return #v > SAMPLE_STR and v:sub(1, SAMPLE_STR) or v end
    if tv == "boolean" then return v end
    if tv == "number" then
      if v ~= v or v == math.huge or v == -math.huge then return tostring(v) end
      return v
    end
    if tv ~= "table" then return nil end
    if depth > SAMPLE_DEPTH then return "<table>" end
    local out, n = {}, 0
    for k, x in pairs(v) do
      if n >= SAMPLE_KEYS then break end
      local tk = type(k)
      if tk == "string" or (tk == "number" and k == floor(k)) then
        local y = trimSample(x, depth + 1)
        if y ~= nil then out[k] = y; n = n + 1 end
      end
    end
    return out
  end

  local function sampled(api)
    local s = db and db.apiSamples[api]
    return s ~= nil and s.build == build
  end

  function sample(api, value)
    if not db or sampled(api) then return end
    if type(value) ~= "table" then
      if value == nil then return end
      value = { value }
    end
    if next(value) == nil then return end -- an empty table says nothing about field names
    db.apiSamples[api] = { build = build, time = now(), sample = trimSample(value, 1) }
  end

  -- Several return values, kept by position.
  function sampleReturns(api, ...)
    if not db or sampled(api) or select("#", ...) == 0 then return end
    sample(api, { ... })
  end

  function need(api, t, ...)
    local v = field(t, ...)
    if v == nil and type(t) == "table" and db then
      local m = db.apiSamples[MISSES_API]
      if not m or m.build ~= build then
        m = { build = build, time = now(), sample = {} }
        db.apiSamples[MISSES_API] = m
      end
      local n = 0
      for _ in pairs(m.sample) do n = n + 1 end
      local key = api .. ":" .. tostring((...))
      if not m.sample[key] and n < SAMPLE_KEYS then m.sample[key] = table.concat({ ... }, "|") end
    end
    return v
  end

  -- db.apiSamples["ForeverLedger.errors"].sample = { [where] = { msg =, count =, last = } } for this build: the first
  -- message of each failing function or handler (<= 200 chars), how often it failed and when last; at most 40 places.
  -- Blocked/forbidden actions blamed on this addon and Lua warnings naming it are kept the same way.
  local ERRORS_API, ERRORS_CAP, ERROR_LEN = "ForeverLedger.errors", 40, 200

  function noteError(place, msg)
    if not db or type(db.apiSamples) ~= "table" then return end
    local m = db.apiSamples[ERRORS_API]
    if type(m) ~= "table" or m.build ~= build or type(m.sample) ~= "table" then
      m = { build = build, time = now(), sample = {} }
      db.apiSamples[ERRORS_API] = m
    end
    place = tostring(place):sub(1, 80)
    local e = m.sample[place]
    if not e then
      local n = 0
      for _ in pairs(m.sample) do n = n + 1 end
      if n >= ERRORS_CAP then return end
      e = { msg = tostring(msg):sub(1, ERROR_LEN), count = 0 }
      m.sample[place] = e
    end
    e.count, e.last = e.count + 1, now()
  end

  local function captured(place, ok, ...)
    if not ok then pcall(noteError, place, (...)) end
    return ok, ...
  end

  -- pcall that notes a failure under `place`.
  function safely(place, fn, ...) return captured(place, pcall(fn, ...)) end

  -- A window scan at most every SCAN_GAP seconds (GetTime, else time()). A request inside the gap runs once when it
  -- ends (C_Timer), so the last state of the window is still read. `fn(continued)` returning true has work left over
  -- (a pass does a bounded amount): the next pass runs CONTINUE_GAP later, and `fn` itself stops once its window is
  -- closed. Without C_Timer the next throttled scan picks the work up.
  local CONTINUE_GAP = 0.2
  local lastScan, scanQueued, continuing = {}, {}, {}
  local function clock() return GetTime and GetTime() or time() end

  function throttled(key, fn, continued)
    local t = clock()
    local wait = SCAN_GAP - (t - (lastScan[key] or t - SCAN_GAP))
    if wait > 0 then
      if not scanQueued[key] and C_Timer and C_Timer.After then
        scanQueued[key] = true
        C_Timer.After(wait, function() scanQueued[key] = nil; throttled(key, fn) end)
      end
      return
    end
    lastScan[key] = t
    local ok, more = safely("scan:" .. key, fn, continued)
    if ok and more and not continuing[key] and C_Timer and C_Timer.After then
      continuing[key] = true
      C_Timer.After(CONTINUE_GAP, function()
        continuing[key], lastScan[key] = nil, nil
        throttled(key, fn, true)
      end)
    end
  end
end

---------------------------------------------------------------- professions: skills
-- C_SkillInfo lines in the SkillLine categories 9 (secondary skills) and 11 (professions). Without a category the
-- line counts when maxRank > 1 and its header is not weapons, armor, languages or class skills (enUS header words).
-- Collapsed headers hide their lines; the addon never expands them. GetProfessions/GetProfessionInfo add lines
-- C_SkillInfo did not list.
local PROFESSION_CATEGORIES = { [9] = true, [11] = true }
local NOT_PROFESSION_HEADERS = { "weapon", "armor", "language", "class" }
local sessionRank = {} -- ["char:skillLineID"] = rank seen this load; skill-ups only count against these
local lineParent = {}  -- [child skillLineID] = parent line, from ProfessionInfo tables (db.skills has parentID too)
local onSkillUp        -- set by the crafts section: function(entry), attributes the skill-up to a recent craft

local function charSkills()
  local byChar = db.skills[charKey()] or {}
  db.skills[charKey()] = byChar
  return byChar
end

local function skillRank(skillLineID)
  local s = skillLineID and db.skills[charKey()] and db.skills[charKey()][skillLineID]
  return s and s.rank
end

-- The same profession: equal lines, or one is the other's parent (base Tailoring and its Classic Tailoring child).
local function relatedLines(a, b)
  if not a or not b then return false end
  if a == b then return true end
  local skills = db.skills[charKey()] or {}
  local pa = (skills[a] and skills[a].parentID) or lineParent[a]
  local pb = (skills[b] and skills[b].parentID) or lineParent[b]
  return pa == b or pb == a
end

local function isProfessionLine(category, maxRank, header)
  if category then return PROFESSION_CATEGORIES[category] == true end
  if not maxRank or maxRank <= 1 then return false end
  for _, word in ipairs(NOT_PROFESSION_HEADERS) do
    if header and header:find(word, 1, true) then return false end
  end
  return true
end

local function noteSkill(id, name, rank, maxRank, modifier, parentID)
  local byChar = charSkills()
  local s = byChar[id]
  if not s then
    s = {}
    byChar[id] = s
    added()
  end
  s.name = type(name) == "string" and name or s.name
  s.rank, s.maxRank, s.modifier = rank or s.rank, maxRank or s.maxRank, modifier or s.modifier
  s.parentID = (parentID and parentID > 0) and parentID or s.parentID
  s.lastSeen = now()

  local key = charKey() .. ":" .. id
  local before = sessionRank[key]
  if rank then sessionRank[key] = rank end
  if before and rank and rank > before then
    local e = { char = charKey(), skillLineID = id, from = before, to = rank, build = build, time = now() }
    if onSkillUp then onSkillUp(e) end
    db.skillUps[#db.skillUps + 1] = e
    trim(db.skillUps, HISTORY_CAP)
    added()
  end
end

local function scanSkills()
  local SI = C_SkillInfo
  local listed = {}
  if SI and SI.GetNumSkillLines and SI.GetSkillLineInfo then
    local api = "C_SkillInfo.GetSkillLineInfo"
    local header
    for i = 1, (SI.GetNumSkillLines() or 0) do
      local info = SI.GetSkillLineInfo(i)
      if type(info) == "table" then
        local name = field(info, "name", "skillName")
        if field(info, "isHeader", "header") then
          header = type(name) == "string" and name:lower() or nil
        else
          sample(api, info)
          local id = tonumber(need(api, info, "skillID", "skillLineID", "id"))
          local maxRank = tonumber(need(api, info, "maxRank", "skillMaxRank", "max"))
          local category = tonumber(field(info, "skillLineCategoryID", "categoryID", "category"))
          if id and isProfessionLine(category, maxRank, header) then
            listed[id] = true
            noteSkill(id, name, tonumber(need(api, info, "rank", "skillRank", "skillLevel")), maxRank,
              tonumber(field(info, "modifier", "skillModifier")),
              tonumber(field(info, "parentSkillLineID", "parentID")))
          end
        end
      end
    end
  end
  if GetProfessions and GetProfessionInfo then
    local n, idx = packed(GetProfessions())
    for i = 1, n do
      if idx[i] then
        local _, r = packed(GetProfessionInfo(idx[i]))
        sampleReturns("GetProfessionInfo", unpack(r, 1, 10))
        -- name, icon, skillLevel, maxSkillLevel, numAbilities, spellOffset, skillLine, skillModifier
        local line = tonumber(r[7])
        if line and not listed[line] then noteSkill(line, r[1], tonumber(r[3]), tonumber(r[4]), tonumber(r[8])) end
      end
    end
  end
end

---------------------------------------------------------------- professions: recipes
-- Read only from your own profession window (never a linked, guild or NPC crafter window, nor while the data source
-- is switching). The schematic is read once per recipe per build, at most SCHEMATIC_BUDGET new ones per pass; the
-- next pass follows 0.2 s later while the window is open. The window counts as closed after TRADE_SKILL_CLOSE,
-- TRADE_SKILL_DATA_SOURCE_CHANGING (until the matching _CHANGED, or a _CHANGED within 5 s of TRADE_SKILL_SHOW) or a
-- failed GetBaseProfessionInfo, so a missed close event does not keep it being read.
local SCHEMATIC_BUDGET = 20
local tradeOpen, tradeSwitching, tradeShownAt = false, false, nil

local function tradeGuardsOK(T)
  for _, guard in ipairs({ "IsTradeSkillLinked", "IsTradeSkillGuild", "IsNPCCrafting", "IsDataSourceChanging" }) do
    if T[guard] then
      local ok, v = pcall(T[guard])
      if not ok or v then return false end
    end
  end
  return true
end

local function professionInfo(T, fn, ...)
  if not T[fn] then return nil end
  local ok, info = pcall(T[fn], ...)
  if not ok or type(info) ~= "table" then return nil end
  sample("C_TradeSkillUI." .. fn, info)
  local id = tonumber(field(info, "professionID", "skillLineID"))
  local parent = tonumber(field(info, "parentProfessionID", "parentSkillLineID"))
  if id and parent and parent > 0 and parent ~= id then lineParent[id] = parent end
  return info
end

-- The window's own profession: the child (expansion) line when the client has one, else the base line.
local function windowProfession(T)
  local child = professionInfo(T, "GetChildProfessionInfo")
  local base = professionInfo(T, "GetBaseProfessionInfo")
  for i = 1, 2 do
    local p = i == 1 and child or base
    local id = tonumber(field(p, "professionID", "skillLineID"))
    if id and id > 0 then return id, tonumber(field(p, "skillLevel", "rank")) end
  end
end

local function isRequiredSlot(slot)
  local req = field(slot, "required")
  if req ~= nil then return req and true or false end
  local basic = Enum and Enum.CraftingReagentType and Enum.CraftingReagentType.Basic
  local rt = field(slot, "reagentType")
  if rt ~= nil and basic ~= nil then return rt == basic end
  return true
end

local function readReagents(slots)
  local out = {}
  if type(slots) ~= "table" then return out end
  local api = "C_TradeSkillUI.GetRecipeSchematic"
  for _, slot in ipairs(slots) do
    if type(slot) == "table" then
      sample(api .. ":reagentSlot", slot)
      local list = field(slot, "reagents")
      local first = type(list) == "table" and list[1] or nil
      if type(first) == "table" then sample(api .. ":reagent", first) end
      local itemID = tonumber(field(first, "itemID")) or tonumber(field(slot, "itemID"))
      if itemID and isRequiredSlot(slot) then
        out[#out + 1] = { itemID = itemID, qty = tonumber(need(api .. ":reagentSlot", slot, "quantityRequired",
          "quantity", "count")) or 1 }
        scanItemOnce(itemID)
      end
    end
  end
  return out
end

local function readSnapshot(T, recipeID, info, rec, windowLine)
  local api = "C_TradeSkillUI.GetRecipeSchematic"
  local snap = { firstSeen = now(), reagents = {},
                 maxTrivial = tonumber(field(info, "maxTrivialLevel", "trivialLevel", "maxTrivial")) }
  if T.GetRecipeSchematic then
    local ok, s = pcall(T.GetRecipeSchematic, recipeID, false)
    if ok and type(s) == "table" then
      sample(api, s)
      snap.outputItemID = tonumber(field(s, "outputItemID", "itemID"))
      snap.qtyMin = tonumber(need(api, s, "quantityMin", "minQuantity"))
      snap.qtyMax = tonumber(need(api, s, "quantityMax", "maxQuantity"))
      snap.reagents = readReagents(need(api, s, "reagentSlotSchematics", "reagentSlots", "reagents"))
      if snap.outputItemID then scanItemOnce(snap.outputItemID) end
    end
  end
  if T.GetRecipeSourceText and not field(info, "learned", "isLearned") then
    local ok, text = pcall(T.GetRecipeSourceText, recipeID)
    if ok and type(text) == "string" and text ~= "" then
      sample("C_TradeSkillUI.GetRecipeSourceText", text)
      snap.sourceText = text:sub(1, 500)
    end
  end
  if not rec.skillLineID then
    local p = professionInfo(T, "GetProfessionInfoByRecipeID", recipeID)
    rec.skillLineID = tonumber(field(p, "professionID", "skillLineID")) or windowLine
  end
  return snap
end

-- relativeDifficulty as the lower-cased Enum.TradeskillRelativeDifficulty key ("optimal", "medium", "easy",
-- "trivial"), or the number as a string.
local function difficultyName(v)
  return enumName(Enum and Enum.TradeskillRelativeDifficulty, v)
end

local function noteRecipeSeen(byRecipe, recipeID, info, rank)
  local e = byRecipe[recipeID]
  if not e then
    e = { byDifficulty = {} }
    byRecipe[recipeID] = e
  end
  e.learned = field(info, "learned", "isLearned") and true or false
  e.difficulty = difficultyName(field(info, "relativeDifficulty", "difficulty"))
  e.rank, e.seenAt = rank, now()
  if e.learned and e.difficulty and rank then
    local d = e.byDifficulty[e.difficulty]
    if not d then
      e.byDifficulty[e.difficulty] = { minRank = rank, maxRank = rank }
    else
      if rank < d.minRank then d.minRank = rank end
      if rank > d.maxRank then d.maxRank = rank end
    end
  end
end

-- continued: a follow-up pass, which only reads recipes still missing this build's schematic.
local function scanTrade(continued)
  local T = C_TradeSkillUI
  if not tradeOpen or not T or not T.GetAllRecipeIDs or not T.GetRecipeInfo then return end
  if T.GetBaseProfessionInfo then
    local ok, base = pcall(T.GetBaseProfessionInfo)
    if not ok or type(base) ~= "table" then tradeOpen = false; return end
  end
  if not tradeGuardsOK(T) then return end
  local ids = T.GetAllRecipeIDs()
  if type(ids) ~= "table" then return end
  sample("C_TradeSkillUI.GetAllRecipeIDs", ids)
  local windowLine, windowRank = windowProfession(T)
  local byChar = db.recipeSeen[build] or {}
  db.recipeSeen[build] = byChar
  local byRecipe = byChar[charKey()] or {}
  byChar[charKey()] = byRecipe
  local budget, more = SCHEMATIC_BUDGET, false
  for _, rid in ipairs(ids) do
    local recipeID = tonumber(rid)
    local known = recipeID and db.recipes[recipeID]
    local skip = continued and known and known.byBuild and known.byBuild[build]
    if continued and budget == 0 and not skip then return true end
    local ok, info = false, nil
    if not skip then ok, info = pcall(T.GetRecipeInfo, recipeID) end
    if recipeID and ok and type(info) == "table" then
      sample("C_TradeSkillUI.GetRecipeInfo", info)
      local rec = db.recipes[recipeID] or { id = recipeID, byBuild = {} }
      db.recipes[recipeID] = rec
      local name = need("C_TradeSkillUI.GetRecipeInfo", info, "name", "recipeName")
      rec.name = type(name) == "string" and name or rec.name
      rec.categoryID = tonumber(field(info, "categoryID", "category")) or rec.categoryID
      if not rec.byBuild[build] then
        if budget > 0 then
          budget = budget - 1
          rec.byBuild[build] = readSnapshot(T, recipeID, info, rec, windowLine)
          added()
        else
          more = true
        end
      end
      -- The window's rank only stands in for its own line: another line's thresholds would be wrong for good.
      local rank = skillRank(rec.skillLineID)
      if rank == nil and (rec.skillLineID == nil or rec.skillLineID == windowLine) then rank = windowRank end
      noteRecipeSeen(byRecipe, recipeID, info, rank)
    end
  end
  return more
end

---------------------------------------------------------------- professions: learned recipes
-- NEW_RECIPE_LEARNED says how when a trainer window is open ("trainer:<npcID>") or a Recipe-class item was used from
-- the bags in the last 5 s ("item:<itemID>"). For recipes with a cast bar, the item's use spell (GetItemSpell)
-- finishing within 30 s of the use restarts the 5 s, and so does any player spell finishing within 3 s of it (the use
-- spell unknown). A post-hook on C_Container.UseContainerItem reads which item that was; items used from action bars
-- are not seen.
local RECIPE_CLASS = (Enum and Enum.ItemClass and Enum.ItemClass.Recipe) or 9
local trainerNpc      -- npcID while a trainer window is open
local recipeItemUse   -- { itemID =, spellID =, at =, usedAt = }

local function itemClass(itemID)
  local rec = db.items[itemID]
  if rec and rec.classID then return rec.classID end
  if C_Item and C_Item.GetItemInfoInstant then
    local ok, _, _, _, _, _, classID = pcall(C_Item.GetItemInfoInstant, itemID)
    if ok and classID then return tonumber(classID) end
  end
  local n, r = packed(pcall(GetItemInfo, itemID)) -- r[1] is pcall's ok, so return 12 (classID) is r[13]
  if r[1] and n >= 13 then return tonumber(r[13]) end
end

local function onUseContainerItem(bag, slot)
  if not db or not C_Container.GetContainerItemID then return end
  local itemID = C_Container.GetContainerItemID(bag, slot)
  itemID = tonumber(itemID)
  if itemID and itemClass(itemID) == RECIPE_CLASS then
    local spellID
    if GetItemSpell then
      local ok, _, id = pcall(GetItemSpell, itemID)
      if ok then spellID = tonumber(id) end
    end
    recipeItemUse = { itemID = itemID, spellID = spellID, at = now(), usedAt = now() }
  end
end

if hooksecurefunc and C_Container and C_Container.UseContainerItem then
  hooksecurefunc(C_Container, "UseContainerItem", function(bag, slot)
    safely("onUseContainerItem", onUseContainerItem, bag, slot)
  end)
end

local function learnedVia()
  if trainerNpc then return "trainer:" .. trainerNpc end
  local u = recipeItemUse
  if u and now() - u.at <= ATTRIBUTE_WINDOW then
    recipeItemUse = nil
    return "item:" .. u.itemID
  end
  return "unknown"
end

local function onRecipeLearned(recipeID, recipeLevel, baseRecipeID)
  sampleReturns("NEW_RECIPE_LEARNED", recipeID, recipeLevel, baseRecipeID)
  recipeID = tonumber(recipeID)
  if not recipeID then return end
  db.learned[#db.learned + 1] = { char = charKey(), recipeID = recipeID, build = build, time = now(),
                                  via = learnedVia() }
  trim(db.learned, HISTORY_CAP)
  added()
end

-- The recipe item's own use spell finishing (or any player spell right after the use) is its learning cast.
local function onPlayerSpellForRecipeItem(spellID)
  local u = recipeItemUse
  if not u then return end
  local since = now() - u.usedAt
  if (u.spellID and u.spellID == tonumber(spellID) and since <= 30) or since <= 3 then u.at = now() end
end

---------------------------------------------------------------- professions: trainers and vendors
-- Profession trainers (IsTradeskillTrainer) and every vendor with an NPC GUID, scanned like the profession window
-- (throttled). The lists are what the window shows. A trainer scan is `complete` when the available/unavailable/used
-- filters are all on (GetTrainerServiceTypeFilter, only read) and no header is collapsed: it replaces the list for
-- that NPC and build; any other scan merges its services into the list by name. A vendor scan replaces the list (its
-- item filter can narrow it). At most LIST_CAP entries.
local merchantNpc -- npcID while a merchant window is open

local function skillLineByName(name)
  if type(name) ~= "string" or name == "" then return nil end
  for id, sk in pairs(charSkills()) do
    if sk.name == name then return id end
  end
end

-- The service at index i, or nil and whether it is a collapsed header.
local function trainerService(i)
  local n, r = packed(GetTrainerServiceInfo(i))
  sampleReturns("GetTrainerServiceInfo", unpack(r, 1, n))
  -- Retail returns name, subText, serviceType, isExpanded; Forever 1.60 returns name, serviceType, icon,
  -- isExpanded (0/1), subText, category. Find the type by value so either order works.
  -- isExpanded is 4th in both.
  local name, serviceType = r[1], nil
  for j = 2, n do
    local v = r[j]
    if v == "available" or v == "unavailable" or v == "used" or v == "header" then
      serviceType = v
      break
    end
  end
  if serviceType == "header" then return nil, not (r[4] == true or r[4] == 1) end
  if type(name) ~= "string" then return nil end
  local s = { name = name, type = serviceType ~= nil and tostring(serviceType) or nil }
  if GetTrainerServiceCost then s.cost = tonumber((GetTrainerServiceCost(i))) end
  if GetTrainerServiceSkillReq then
    local skill, rank = GetTrainerServiceSkillReq(i)
    s.skill, s.skillRank = type(skill) == "string" and skill or nil, tonumber(rank)
  end
  if GetTrainerServiceLevelReq then s.level = tonumber((GetTrainerServiceLevelReq(i))) end
  if GetTrainerServiceItemLink then
    local link = GetTrainerServiceItemLink(i)
    s.itemID = idFromLink(link)
    if s.itemID then scanItemOnce(s.itemID, link) end
  end
  return s
end

local function trainerFiltersOn()
  if not GetTrainerServiceTypeFilter then return true end -- no filters: the window shows everything
  for _, kind in ipairs({ "available", "unavailable", "used" }) do
    local ok, on = pcall(GetTrainerServiceTypeFilter, kind)
    if not ok or not on then return false end
  end
  return true
end

-- `services` merged into `old` by name: known names updated in place, new ones appended.
local function mergeServices(old, services)
  local out, at = {}, {}
  for i, s in ipairs(old) do
    out[i] = s
    if type(s) == "table" and s.name then at[s.name] = i end
  end
  for _, s in ipairs(services) do
    if at[s.name] then
      out[at[s.name]] = s
    elseif #out < LIST_CAP then
      out[#out + 1] = s
      at[s.name] = #out
    end
  end
  return out
end

local function scanTrainer()
  if not trainerNpc or not IsTradeskillTrainer or not GetNumTrainerServices or not GetTrainerServiceInfo then
    return
  end
  local ok, isTradeskill = pcall(IsTradeskillTrainer)
  if not ok or not isTradeskill then return end
  local services, skillLineID = {}, nil
  local total = GetNumTrainerServices() or 0
  local complete = total <= LIST_CAP and trainerFiltersOn()
  for i = 1, math.min(total, LIST_CAP) do
    local s, collapsed = trainerService(i)
    if collapsed then complete = false end
    if s then
      services[#services + 1] = s
      skillLineID = skillLineID or skillLineByName(GetTrainerServiceSkillLine and GetTrainerServiceSkillLine(i))
        or skillLineByName(s.skill)
    end
  end
  local byNpc = db.trainers[build] or {}
  db.trainers[build] = byNpc
  local prev = byNpc[trainerNpc]
  if not prev then added() end
  if not complete and prev and type(prev.services) == "table" then
    services = mergeServices(prev.services, services)
    skillLineID = skillLineID or prev.skillLineID
  end
  byNpc[trainerNpc] = { name = UnitName("npc"), loc = where(), skillLineID = skillLineID, seenAt = now(),
                        complete = complete, services = services }
end

-- The whole list every pass, but at most VENDOR_SCAN_BUDGET items new to this build are scanned per pass (big stocks);
-- the next pass follows 0.2 s later while the window is open. Items the client has not sent yet wait for
-- GET_ITEM_INFO_RECEIVED instead.
local VENDOR_SCAN_BUDGET = 20
local function scanVendor()
  if not merchantNpc or not GetMerchantNumItems then return end
  local MF = C_MerchantFrame
  local api = "C_MerchantFrame.GetItemInfo"
  local list, budget, more = {}, VENDOR_SCAN_BUDGET, false
  for i = 1, math.min(GetMerchantNumItems() or 0, LIST_CAP) do
    local info = MF and MF.GetItemInfo and MF.GetItemInfo(i)
    sample(api, info)
    local link = GetMerchantItemLink and GetMerchantItemLink(i)
    local itemID = tonumber((GetMerchantItemID and GetMerchantItemID(i))) or idFromLink(link)
    if itemID then
      local e = { itemID = itemID, price = tonumber(need(api, info, "price", "cost")),
                  stack = tonumber(need(api, info, "stackCount", "stack", "quantity")),
                  numAvailable = tonumber(field(info, "numAvailable")),
                  currencyID = tonumber(field(info, "currencyID")) }
      local ext = field(info, "hasExtendedCost", "extendedCost")
      if ext ~= nil then e.extendedCost = ext and true or false end
      list[#list + 1] = e
      local rec = db.items[itemID]
      if not (rec and rec.byBuild and rec.byBuild[build]) and not pendingItems[itemID] then
        if budget > 0 then
          budget = budget - 1
          scanItem(itemID, link)
        else
          more = true
        end
      end
    end
  end
  local byNpc = db.vendors[build] or {}
  db.vendors[build] = byNpc
  if not byNpc[merchantNpc] then added() end
  byNpc[merchantNpc] = { name = UnitName("npc"), loc = where(), seenAt = now(), items = list }
  return more
end

---------------------------------------------------------------- quests
local function questRec(questID)
  local q = db.quests[questID] or { id = questID, obs = {} }
  db.quests[questID] = q
  return q
end

-- One observation per build + stage + character; later sightings refresh it.
local function questObs(questID, stage)
  local q = questRec(questID)
  local key = build .. ":" .. stage .. ":" .. charKey()
  local o = q.obs[key]
  if not o then
    o = { build = build, stage = stage, char = charKey() }
    q.obs[key] = o
    added()
  end
  o.level, o.time = UnitLevel("player"), now()
  return o, q
end

local function readItemList(kind, count)
  local list = {}
  for i = 1, count do
    local link = GetQuestItemLink(kind, i)
    local _, _, num = GetQuestItemInfo(kind, i)
    local id = idFromLink(link)
    list[#list + 1] = { itemID = id, count = num }
    scanItem(id, link)
  end
  return list
end

-- Fires when the quest giver window shows rewards (accept screen and turn-in screen)
local function captureQuestFrame(stage)
  local questID = GetQuestID and GetQuestID()
  if not questID or questID == 0 then return end
  local o, q = questObs(questID, stage)
  q.title = GetTitleText() or q.title
  if GetRewardXP then o.xp = GetRewardXP() end
  if GetRewardMoney then o.money = GetRewardMoney() end

  local nChoice, nReward = GetNumQuestChoices() or 0, GetNumQuestRewards() or 0
  o.choices = nChoice > 0 and readItemList("choice", nChoice) or nil
  o.rewards = nReward > 0 and readItemList("reward", nReward) or nil
  o.npc = { name = UnitName("npc"), id = npcIDFromGUID(UnitGUID("npc")), loc = where() }
  return questID, o
end

---------------------------------------------------------------- chosen reward
-- The reward window only lists the choices; which one you took is only visible as the argument the quest frame
-- passes to GetQuestReward when you click Complete. A post-hook reads that argument (it never calls anything) and
-- the next QUEST_TURNED_IN for the same quest gets it.
local CHOICE_TTL = 60   -- seconds: a remembered pick older than this is dropped
local completeWindow    -- { questID =, choices = } from the last QUEST_COMPLETE
local pendingChoice     -- { questID =, index =, itemID =, at = }

local function onGetQuestReward(index)
  if type(index) ~= "number" or index < 1 then return end
  local questID = GetQuestID and GetQuestID()
  if not questID or questID == 0 then questID = completeWindow and completeWindow.questID end
  if not questID then return end
  local choices = completeWindow and completeWindow.questID == questID and completeWindow.choices
  local n = choices and #choices or (GetNumQuestChoices and GetNumQuestChoices() or 0)
  if n < 1 or index > n then return end
  local itemID = choices and choices[index] and choices[index].itemID
  if not itemID and GetQuestItemLink then itemID = idFromLink(GetQuestItemLink("choice", index)) end
  if not itemID then return end
  pendingChoice = { questID = questID, index = index, itemID = itemID, at = now() }
end

if hooksecurefunc and GetQuestReward then
  -- pcall: an error here must never surface in the middle of turning a quest in
  hooksecurefunc("GetQuestReward", function(index) safely("onGetQuestReward", onGetQuestReward, index) end)
end

-- The pick for questID, if one is waiting and fresh. Consumes it.
local function takeChoice(questID)
  local p = pendingChoice
  if not p then return end
  if now() - p.at > CHOICE_TTL then pendingChoice = nil; return end
  if p.questID ~= questID then return end
  pendingChoice = nil
  return { index = p.index, itemID = p.itemID }
end

---------------------------------------------------------------- objectives
-- Item objectives read before the item is cached come back as "0/10  " (count, no name). Such quests are asked
-- to load and re-read on QUEST_DATA_LOAD_RESULT / QUEST_WATCH_UPDATE / (throttled) QUEST_LOG_UPDATE until the
-- names are there or the quest leaves the log.
local OBJ_REFRESH_GAP = 2 -- seconds between QUEST_LOG_UPDATE re-reads
local blankObjectives = {} -- [questID] = true while some objective has no text
local loadRequested = {}   -- [questID] = true once RequestLoadQuestByID was called this session
local lastObjRefresh = 0

local function isBlankObjective(text)
  return type(text) ~= "string" or text:match("^%s*$") ~= nil or text:match("^%s*%d+/%d+%s*$") ~= nil
    or text:match("^%s*:%s*%d+/%d+%s*$") ~= nil
end

local function readObjectives(logIndex, questID)
  local objs = {}
  if QuestLog.GetQuestObjectives and questID then
    local ok, list = pcall(QuestLog.GetQuestObjectives, questID)
    if ok and type(list) == "table" then
      for _, o in ipairs(list) do
        objs[#objs + 1] = type(o) == "table" and type(o.text) == "string" and o.text or ""
      end
    end
  end
  if #objs == 0 and GetNumQuestLeaderBoards and GetQuestLogLeaderBoard then
    for j = 1, (GetNumQuestLeaderBoards(logIndex) or 0) do
      objs[#objs + 1] = GetQuestLogLeaderBoard(j, logIndex)
    end
  end
  return objs
end

-- Stores what was read, never replacing a named objective with a blank one, and tracks blanks.
local function applyObjectives(q, questID, objs)
  if #objs == 0 then return end
  local old, anyBlank = q.objectives or {}, false
  for j, text in ipairs(objs) do
    if isBlankObjective(text) and old[j] and not isBlankObjective(old[j]) then objs[j] = old[j] end
    if isBlankObjective(objs[j]) then anyBlank = true end
  end
  q.objectives = objs
  if not anyBlank then blankObjectives[questID] = nil; return end
  blankObjectives[questID] = true
  if not loadRequested[questID] and QuestLog.RequestLoadQuestByID then
    loadRequested[questID] = true
    pcall(QuestLog.RequestLoadQuestByID, questID)
  end
end

-- Re-reads objectives of the tracked quests (or just onlyID); drops quests no longer in the log.
local function refreshBlankObjectives(onlyID)
  if not next(blankObjectives) or not NumLogEntries then return end
  if onlyID and not blankObjectives[onlyID] then return end
  lastObjRefresh = now()
  local inLog = {}
  for i = 1, NumLogEntries() do
    local _, _, _, isHeader, qid = logEntry(i)
    if not isHeader and qid and blankObjectives[qid] and (not onlyID or qid == onlyID) then
      inLog[qid] = true
      applyObjectives(questRec(qid), qid, readObjectives(i, qid))
    end
  end
  for qid in pairs(blankObjectives) do
    if not inLog[qid] and (not onlyID or qid == onlyID) then blankObjectives[qid] = nil end
  end
end

-- Pulls level, group size, category (zone/dungeon header) and objectives from the quest log
local function captureFromLog(questID)
  if not NumLogEntries then return end
  local header
  for i = 1, NumLogEntries() do
    local title, level, suggestedGroup, isHeader, qid = logEntry(i)
    if isHeader then
      header = title
    elseif qid == questID or (not questID and qid) then
      local q = questRec(qid)
      q.title, q.level, q.category = title, level, header
      q.suggestedGroup = (suggestedGroup and suggestedGroup > 0) and suggestedGroup or nil
      applyObjectives(q, qid, readObjectives(i, qid))
      if questID then return end
    end
  end
end

-- Walks the whole log and reads rewards for quests you already hold
local function scanWholeLog()
  if not NumLogEntries then return end
  captureFromLog(nil)
  local prev = logSelection()
  local n = 0
  for i = 1, NumLogEntries() do
    local _, _, _, isHeader, qid = logEntry(i)
    if not isHeader and qid and qid > 0 then
      selectLogEntry(i, qid)
      local o = questObs(qid, "log")
      local choices = {}
      -- questID is ignored by Classic (uses the selection) and required by newer clients
      for c = 1, (GetNumQuestLogChoices(qid) or 0) do
        local link = GetQuestLogItemLink("choice", c)
        choices[#choices + 1] = { itemID = idFromLink(link) }
        scanItem(idFromLink(link), link)
      end
      o.choices = #choices > 0 and choices or nil
      if GetQuestLogRewardMoney then o.money = GetQuestLogRewardMoney(qid) end
      n = n + 1
    end
  end
  if prev and prev > 0 then selectLogEntry(prev, prev) end
  say("scanned " .. n .. " quests in your log.")
end

---------------------------------------------------------------- groups
local function inGroup()
  if IsInGroup then
    local ok, g = pcall(IsInGroup)
    if ok then return g and true or false end
  end
  if GetNumGroupMembers then
    local ok, n = pcall(GetNumGroupMembers)
    if ok and type(n) == "number" then return n > 0 end
  end
  return UnitExists("party1") and true or false
end

local function lootMethod()
  local get = (C_PartyInfo and C_PartyInfo.GetLootMethod) or GetLootMethod
  if not get then return nil end
  local ok, m = pcall(get)
  if not ok then return nil end
  return enumName(Enum and Enum.LootMethod, m)
end

-- The class of the group member called `name` ("Name" or "Name-Realm"), or nil. Names are only compared, never kept.
local function groupMemberClass(name)
  if type(name) ~= "string" or name == "" then return nil end
  local short = name:match("^([^%-]+)") or name
  local function check(unit)
    local n, realm = UnitName(unit)
    if not n then return nil end
    if n == name or n == short or (realm and realm ~= "" and n .. "-" .. realm == name) then
      local _, class = UnitClass(unit)
      return class or false
    end
  end
  for i = 1, 4 do
    local c = check("party" .. i)
    if c ~= nil then return c or nil end
  end
  for i = 1, 40 do
    local c = check("raid" .. i)
    if c ~= nil then return c or nil end
  end
end

---------------------------------------------------------------- dungeon runs
local function partyInfo()
  local members = {}
  for i = 1, 4 do
    local u = "party" .. i
    if UnitExists(u) then
      local _, class = UnitClass(u)
      members[#members + 1] = { class = class, level = UnitLevel(u) }
    end
  end
  return members
end

local function closeRun(reason)
  if not run then return end
  run.finish = now()
  run.endReason = reason
  run.activeSecs = run.finish - run.start - (run.awaySecs or 0)
  run.mobXP = (run.xpTotal or 0) - (run.questXP or 0)
  say(format("%s run logged: %d min active, %d XP (%d from mobs).",
    run.instance or "?", floor(run.activeSecs / 60), run.xpTotal or 0, run.mobXP))
  run = nil
  checkpoint()
end

local function checkInstance()
  local inInst, iType = IsInInstance()
  if inInst and (iType == "party" or iType == "raid") then
    local name, _, diffID, _, maxPlayers, _, _, instID = GetInstanceInfo()
    if run and run.instanceID == instID then return end
    if run then closeRun("switched") end

    local last = db.runs[#db.runs]
    if last and last.instanceID == instID and last.endReason == "left" and last.char == charKey()
       and now() - last.finish < RESUME_WINDOW then
      last.awaySecs = (last.awaySecs or 0) + (now() - last.finish)
      last.finish, last.endReason, last.activeSecs, last.mobXP = nil, nil, nil, nil
      run = last
      say("resumed " .. name .. " run.")
      return
    end

    local start = now()
    run = { id = charKey() .. "-" .. instID .. "-" .. start, build = build, char = charKey(),
            charLevel = UnitLevel("player"), instance = name, instanceID = instID, difficulty = diffID,
            maxPlayers = maxPlayers, start = start, awaySecs = 0, xpTotal = 0, questXP = 0, deaths = 0,
            bosses = {}, loot = {}, party = partyInfo(), lootMethod = lootMethod(), bossLoot = {}, groupLoot = {} }
    db.runs[#db.runs + 1] = run
    trim(db.runs, HISTORY_CAP)
    added()
    say("started timing " .. name .. ".")
  elseif run then
    closeRun("left")
  end
end

---------------------------------------------------------------- xp
local function onXP()
  local cur, max, lvl = UnitXP("player"), UnitXPMax("player"), UnitLevel("player")
  if lastXP then
    local gain = (lvl > lastLevel) and ((lastMax - lastXP) + cur) or (cur - lastXP)
    if gain > 0 and run then run.xpTotal = run.xpTotal + gain end
  end
  lastXP, lastMax, lastLevel = cur, max, lvl
end

---------------------------------------------------------------- professions: gathering
-- Loot from a GameObject (ore, herbs, chests, ...) or a fishing loot window (IsFishingLoot: pseudo object 0) goes to
-- db.nodes / db.nodeLoot, no longer to drops of npc 0. Creatures, skinned ones included, stay drops of their npc.
-- A node counts once per harvest: a vein or herb can be gathered 2-3 times, each time with a new gather cast and new
-- loot, so a GUID opened after a gather cast that no other node used yet is a new harvest. Objects opened without a
-- gather cast (chests, ...) count once per GUID per session. Its skill line is the one of a gather spell that finished
-- in the last 5 s (fishing: always Fishing), and rankMin the lowest rank of that skill seen when opening it.
-- The node's name is the target UNIT_SPELLCAST_SENT gave its gather cast, else the world tooltip's first line.
-- seq: bumped on every gather cast; last = { skillLineID =, at =, seq =, name = }; sent = { castGUID =, spellID =,
-- name =, at = } from the last player gather UNIT_SPELLCAST_SENT.
local gather = { fishingOpens = 0, seq = 0 }
local gatherSkill, isFishingLoot, nodeObject, openNode, addNodeLoot, onGatherSent, noteGatherCast
do
  local FISHING_LINE = 356
  local SPOT_CAP = 50 -- spots kept per node per map
  -- The gather spells GatherMate-style addons use (Mining, Herb Gathering, Skinning, Fishing); other spells match by
  -- the client's (localized) name of these or the enUS name.
  local GATHER_SPELLS = { [2575] = 186, [2366] = 182, [8613] = 393, [7620] = FISHING_LINE }
  local GATHER_NAMES_ENUS = { mining = 186, ["herb gathering"] = 182, herbalism = 182, skinning = 393, fishing = 356 }
  local gatherCache = {} -- [spellID] = skillLineID or false
  local gatherNames      -- [lower-cased spell name] = skillLineID
  local seenNode = {}    -- [guid or fishing-window key] = gather seq of its last counted harvest (0: no gather cast)
  local seqNode = {}     -- [gather seq] = the key that harvest opened

  local function spellName(spellID)
    if C_Spell and C_Spell.GetSpellInfo then
      local ok, info = pcall(C_Spell.GetSpellInfo, spellID)
      if ok and type(info) == "table" then return field(info, "name") end
    end
    if GetSpellInfo then
      local ok, name = pcall(GetSpellInfo, spellID)
      if ok then return name end
    end
  end

  -- The skill line a finished player spell gathers with, or nil.
  function gatherSkill(spellID)
    spellID = tonumber(spellID)
    if not spellID then return nil end
    if gatherCache[spellID] == nil then
      if not gatherNames then
        gatherNames = {}
        for name, line in pairs(GATHER_NAMES_ENUS) do gatherNames[name] = line end
        for id, line in pairs(GATHER_SPELLS) do
          local name = spellName(id)
          if type(name) == "string" then gatherNames[name:lower()] = line end
        end
      end
      local name = GATHER_SPELLS[spellID] == nil and spellName(spellID) or nil
      gatherCache[spellID] = GATHER_SPELLS[spellID] or (type(name) == "string" and gatherNames[name:lower()]) or false
    end
    return gatherCache[spellID] or nil
  end

  function isFishingLoot()
    if not IsFishingLoot then return false end
    local ok, yes = pcall(IsFishingLoot)
    return ok and yes and true or false
  end

  -- The object a loot source counts for: 0 in a fishing window, the GameObject id otherwise, nil for anything else.
  function nodeObject(guid, fishing)
    if fishing then return 0 end
    local kind, id = guidSource(guid)
    if kind == "object" then return id end
  end

  -- The world tooltip's first line, when it shows a world object (owned by UIParent, not a unit, item or spell).
  local function tooltipObjectName()
    local tt = GameTooltip
    if not tt or not tt:IsShown() or tt:GetOwner() ~= UIParent then return nil end
    if (tt.GetUnit and tt:GetUnit()) or (tt.GetItem and tt:GetItem()) or (tt.GetSpell and tt:GetSpell()) then
      return nil
    end
    local text = GameTooltipTextLeft1 and GameTooltipTextLeft1:GetText()
    if type(text) == "string" and text ~= "" then return text:sub(1, 100) end
  end

  local function addSpot(n, loc)
    if not loc.mapID or not loc.x or not loc.y then return end
    local list = n.spots[loc.mapID] or {}
    n.spots[loc.mapID] = list
    if #list >= SPOT_CAP then return end
    for _, spot in ipairs(list) do
      local x, y = spot:match("^([%d.]+),([%d.]+)$")
      x, y = tonumber(x), tonumber(y)
      if x and y and (x - loc.x) ^ 2 + (y - loc.y) ^ 2 <= 1 then return end -- within 1 map unit: the same spot
    end
    list[#list + 1] = format("%.1f,%.1f", loc.x, loc.y)
  end

  local function recentGather()
    local g = gather.last
    if g and now() - g.at <= ATTRIBUTE_WINDOW then return g end
  end

  -- The harvest a loot window of `key` belongs to ("<key>#<gather seq>"), whether it is a new one, and the gather
  -- cast it came from (a recent cast no other node used yet).
  local function harvestOf(key)
    local g = recentGather()
    if g and seqNode[g.seq] ~= nil and seqNode[g.seq] ~= key then g = nil end
    local prev = seenNode[key]
    if prev ~= nil and (g == nil or g.seq == prev) then return key .. "#" .. prev, false end
    local seq = g and g.seq or 0
    seenNode[key] = seq
    if g then seqNode[seq] = key end
    return key .. "#" .. seq, true, g
  end

  -- UNIT_SPELLCAST_SENT(unit, target, castGUID, spellID) of a player gather spell: the target is the node's name.
  function onGatherSent(target, castGUID, spellID)
    local line = gatherSkill(spellID)
    if not line then return end
    -- The rank now, before this cast's own skill-up (SKILL_LINES_CHANGED arrives before the loot window opens).
    gather.sent = { castGUID = castGUID, spellID = tonumber(spellID), at = now(), rank = skillRank(line),
                    name = type(target) == "string" and target ~= "" and target:sub(1, 100) or nil }
  end

  -- A player gather cast finished: the next node opened is its harvest.
  function noteGatherCast(line, castGUID, spellID)
    local s = gather.sent
    local name, rank
    if s and now() - s.at <= ATTRIBUTE_WINDOW and s.spellID == spellID
       and (s.castGUID == castGUID or not s.castGUID or not castGUID) then
      name, rank = s.name, s.rank
    end
    gather.sent = nil
    gather.seq = gather.seq + 1
    gather.last = { skillLineID = line, at = now(), seq = gather.seq, name = name, rank = rank }
  end

  -- Counts the object's harvest if it is a new one; returns the harvest key its loot is deduplicated by.
  function openNode(key, objectID)
    if not key then return end
    local harvest, new, g = harvestOf(key)
    if not new then return harvest end
    local byObject = db.nodes[build] or {}
    db.nodes[build] = byObject
    local n = byObject[objectID]
    if not n then
      n = { opened = 0, spots = {} }
      byObject[objectID] = n
    end
    n.opened = n.opened + 1
    added()
    local line = objectID == 0 and FISHING_LINE or (g and g.skillLineID)
    if line then
      n.skillLineID = line
      local rank = (g and g.skillLineID == line and g.rank) or skillRank(line)
      if rank and (not n.rankMin or rank < n.rankMin) then n.rankMin = rank end
    end
    if objectID ~= 0 and g and g.name then
      n.name = g.name
    elseif objectID ~= 0 and not n.name then
      local ok, name = pcall(tooltipObjectName)
      if ok then n.name = name end
    end
    addSpot(n, where())
    return harvest
  end

  function addNodeLoot(itemID, objectID, qty)
    local byBuild = db.nodeLoot[itemID] or {}
    db.nodeLoot[itemID] = byBuild
    local byObject = byBuild[build] or {}
    byBuild[build] = byObject
    local e = byObject[objectID]
    if not e then
      e = { n = 0, qty = 0 }
      byObject[objectID] = e
    end
    e.n, e.qty = e.n + 1, e.qty + qty
  end
end

---------------------------------------------------------------- loot
-- Every counter here is a total for this SavedVariables session (db.meta.session). A loot slot can come from several
-- sources (AoE loot): GetLootSourceInfo(slot) returns guid1, qty1, guid2, qty2, ... where qty is the stack size, or
-- the copper for a money slot. Each source GUID is counted once as a corpse, once per item and once for its money.
local MONEY_SLOT = (Enum and Enum.LootSlotType and Enum.LootSlotType.Money) or LOOT_SLOT_MONEY or 2
local seenCorpse = {} -- [guid] = true once counted in db.corpses
local seenMoney = {}  -- [guid] = true once its copper was added
local pendingMoney    -- { guid =, before =, untilAt = } for a money slot without a per-source amount
local MONEY_WAIT = 2  -- seconds after LOOT_CLOSED that PLAYER_MONEY may still settle a pending money slot

-- { { guid =, qty = }, ... } for loot slot i; empty when the client cannot say.
local function lootSources(i)
  local out = {}
  if not GetLootSourceInfo then return out end
  local n, r = packed(pcall(GetLootSourceInfo, i))
  if not r[1] then return out end
  for j = 2, n, 2 do
    if type(r[j]) == "string" and r[j] ~= "" then out[#out + 1] = { guid = r[j], qty = tonumber(r[j + 1]) } end
  end
  return out
end

local function slotType(i)
  if not GetLootSlotType then return nil end
  local ok, t = pcall(GetLootSlotType, i)
  if ok then return t end
end

local function slotQuantity(i)
  if not GetLootSlotInfo then return nil end
  local ok, _, _, qty = pcall(GetLootSlotInfo, i)
  if ok and type(qty) == "number" and qty > 0 then return qty end
end

local function addTo(root, a, b, c, by)
  local t1 = root[a] or {}
  root[a] = t1
  local t2 = t1[b] or {}
  t1[b] = t2
  t2[c] = (t2[c] or 0) + by
end

local function corpseRec(npc)
  local byNpc = db.corpses[build] or {}
  db.corpses[build] = byNpc
  local c = byNpc[npc]
  if not c then
    c = { n = 0, copper = 0 }
    byNpc[npc] = c
  end
  return c
end

-- Only creatures count: chests, fishing and opened containers have no npc.
local function countCorpse(guid)
  local npc = npcIDFromGUID(guid)
  if not npc or seenCorpse[guid] then return end
  seenCorpse[guid] = true
  local c = corpseRec(npc)
  c.n = c.n + 1
  added()
end

local function addCopper(guid, copper)
  local npc = npcIDFromGUID(guid)
  if not npc or seenMoney[guid] or type(copper) ~= "number" or copper <= 0 then return end
  seenMoney[guid] = true
  local c = corpseRec(npc)
  c.copper = c.copper + floor(copper)
end

-- fishingKey stands in for the source GUID of a fishing window that has none; harvests maps an object's GUID to the
-- harvest this window belongs to (openNode).
local function lootItem(i, sources, fishing, fishingKey, harvests)
  local link = GetLootSlotLink(i)
  local id = idFromLink(link)
  if not id then return end
  if #sources == 0 then sources = { {} } end
  local slotQty = #sources == 1 and slotQuantity(i) or nil
  for _, src in ipairs(sources) do
    local object = nodeObject(src.guid, fishing)
    local harvest
    if object then harvest = src.guid and harvests[src.guid] or (not src.guid and openNode(fishingKey, object)) end
    local key = (harvest or src.guid or "?") .. ":" .. id
    if not seenLoot[key] then
      seenLoot[key] = true
      -- One source: the slot's own stack size. Several (AoE): each source's share.
      local qty = slotQty or ((src.qty and src.qty > 0) and src.qty) or 1
      local npc = 0
      if object then
        addNodeLoot(id, object, qty)
      else
        npc = npcIDFromGUID(src.guid) or 0
        addTo(db.drops, id, build, npc, 1)
        addTo(db.dropQty, id, build, npc, qty)
      end
      added()
      scanItem(id, link)
      if run then run.loot[#run.loot + 1] = { itemID = id, npcID = npc } end
    end
  end
end

local function lootMoney(sources)
  local split = false
  for _, src in ipairs(sources) do
    if src.qty and src.qty > 0 then
      addCopper(src.guid, src.qty)
      split = true
    end
  end
  -- No per-source amount: whatever GetMoney gains next goes to the first source (your share when grouped).
  local first = sources[1]
  if not split and first and GetMoney and not seenMoney[first.guid] and npcIDFromGUID(first.guid) then
    local ok, before = pcall(GetMoney)
    if ok and type(before) == "number" then pendingMoney = { guid = first.guid, before = before } end
  end
end

local function onLootOpened()
  pendingMoney = nil
  local fishing = isFishingLoot()
  local fishingKey, harvests = nil, {}
  if fishing then
    gather.fishingOpens = gather.fishingOpens + 1
    fishingKey = "fishing#" .. gather.fishingOpens
  end
  for i = 1, (GetNumLootItems() or 0) do
    local sources = lootSources(i)
    for _, src in ipairs(sources) do
      countCorpse(src.guid)
      local object = nodeObject(src.guid, fishing)
      if object and not harvests[src.guid] then harvests[src.guid] = openNode(src.guid, object) end
    end
    if slotType(i) == MONEY_SLOT then
      lootMoney(sources)
    else
      lootItem(i, sources, fishing, fishingKey, harvests)
    end
  end
end

local function onPlayerMoney()
  local p = pendingMoney
  if not p then return end
  pendingMoney = nil
  if p.untilAt and now() > p.untilAt then return end
  local ok, cur = pcall(GetMoney)
  if ok and type(cur) == "number" then addCopper(p.guid, cur - p.before) end
end

---------------------------------------------------------------- run loot
-- run.bossLoot: C_LootHistory drops of this run's encounters (winner and rolls by class, never names).
-- run.groupLoot: what group members received (CHAT_MSG_LOOT) while in a run and a group, by class.
local function runList(key)
  local list = run[key]
  if type(list) ~= "table" then
    list = {}
    run[key] = list
  end
  return list
end

local function rollInfo(r)
  return { class = r.playerClass, roll = tonumber(r.roll),
           state = enumName(Enum and Enum.EncounterLootDropRollState, r.state) }
end

local function recordBossDrop(encounterID, drop)
  if type(drop) ~= "table" then return end
  local itemID = idFromLink(drop.itemHyperlink)
  if not itemID then return end
  local key = tonumber(drop.lootListKey)
  local list = runList("bossLoot")
  local e
  for _, x in ipairs(list) do
    if x.encounterID == encounterID and x.lootListKey == key and (key or x.itemID == itemID) then e = x end
  end
  if not e then
    e = { encounterID = encounterID, lootListKey = key, itemID = itemID, rolls = {} }
    list[#list + 1] = e
    trim(list, LIST_CAP)
    added()
    scanItem(itemID, drop.itemHyperlink)
  end
  if type(drop.winner) == "table" then
    e.winnerClass = drop.winner.playerClass
    e.winnerIsSelf = drop.winner.isSelf and true or false
  end
  if drop.allPassed then e.allPassed = true end
  if type(drop.rollInfos) == "table" then
    local rolls = {}
    for _, r in ipairs(drop.rollInfos) do
      if type(r) == "table" and #rolls < 40 then rolls[#rolls + 1] = rollInfo(r) end
    end
    if #rolls > 0 then e.rolls = rolls end
  end
end

local function readEncounterLoot(encounterID)
  local LH = C_LootHistory
  if not run or not LH or not LH.GetSortedDropsForEncounter or type(encounterID) ~= "number" then return end
  local drops = LH.GetSortedDropsForEncounter(encounterID)
  if type(drops) ~= "table" then return end
  for _, d in ipairs(drops) do recordBossDrop(encounterID, d) end
end

local function readDropLoot(encounterID, lootListKey)
  local LH = C_LootHistory
  if not run or not LH or type(encounterID) ~= "number" then return end
  if LH.GetSortedInfoForDrop and lootListKey then
    local d = LH.GetSortedInfoForDrop(encounterID, lootListKey)
    if type(d) == "table" then return recordBossDrop(encounterID, d) end
  end
  readEncounterLoot(encounterID)
end

-- Loot chat lines come from client GlobalStrings; the enUS text is only a fallback when a global is missing.
-- `who` is whose line it is; `won` marks roll results.
local LOOT_LINES = {
  { "LOOT_ITEM_SELF_MULTIPLE", "You receive loot: %sx%d.", "self" },
  { "LOOT_ITEM_SELF", "You receive loot: %s.", "self" },
  { "LOOT_ROLL_YOU_WON", "You won: %s", "self", true },
  { "LOOT_ITEM_MULTIPLE", "%s receives loot: %sx%d.", "other" },
  { "LOOT_ITEM", "%s receives loot: %s.", "other" },
  { "LOOT_ROLL_WON", "%s won: %s", "other", true },
}

-- A format string as an anchored Lua pattern: %s -> (.+), %d -> (%d+), positional %2$s too; other text literal.
-- `order[k]` is the format argument the k-th capture fills.
local function formatPattern(template)
  if type(template) ~= "string" or template == "" then return nil end
  local parts, order, pos = { "^" }, {}, 1
  while true do
    local s, e, idx, conv = template:find("%%(%d*)%$?([sd])", pos)
    if not s then break end
    parts[#parts + 1] = (template:sub(pos, s - 1):gsub("%p", "%%%0"))
    order[#order + 1] = tonumber(idx) or (#order + 1)
    parts[#parts + 1] = conv == "d" and "(%d+)" or "(.+)"
    pos = e + 1
  end
  if #order == 0 then return nil end
  parts[#parts + 1] = (template:sub(pos):gsub("%p", "%%%0"))
  parts[#parts + 1] = "$"
  return { pat = table.concat(parts), order = order }
end

local lootLinePatterns
local function lootPatterns()
  if lootLinePatterns then return lootLinePatterns end
  lootLinePatterns = {}
  for _, l in ipairs(LOOT_LINES) do
    local g = _G[l[1]]
    local p = formatPattern(type(g) == "string" and g or l[2])
    if p then
      p.who, p.won = l[3], l[4] and true or false
      lootLinePatterns[#lootLinePatterns + 1] = p
    end
  end
  return lootLinePatterns
end

-- Format arguments of `text` by position, or nil when it is not this line.
local function matchLine(p, text)
  local caps = { text:match(p.pat) }
  if #caps < #p.order then return nil end
  local args = {}
  for k, argIndex in ipairs(p.order) do args[argIndex] = caps[k] end
  return args
end

-- "X won: [item]" and "X receives loot: [item]" describe one item, in either order: the second line updates the
-- entry the first one added. Kept in locals only.
local PAIR_WINDOW = 60
local recentGroupLoot = {} -- ["itemID:by:class"] = { entry =, at =, won =, list = }

local function addGroupLoot(itemID, link, qty, by, class, won)
  local list = runList("groupLoot")
  local k = itemID .. ":" .. by .. ":" .. (class or "?")
  local r = recentGroupLoot[k]
  if r and r.list == list and r.won ~= won and now() - r.at <= PAIR_WINDOW then
    recentGroupLoot[k] = nil
    if won then r.entry.won = true else r.entry.qty = qty end
    return
  end
  local e = { itemID = itemID, qty = qty, by = by, class = class, won = won or nil }
  list[#list + 1] = e
  trim(list, LIST_CAP)
  added()
  recentGroupLoot[k] = { entry = e, at = now(), won = won, list = list }
  scanItem(itemID, link)
end

local function onChatLoot(text, playerName)
  if not run or type(text) ~= "string" or not inGroup() then return end
  for _, p in ipairs(lootPatterns()) do
    local args = matchLine(p, text)
    if args then
      local name, link, qty
      if p.who == "self" then link, qty = args[1], args[2] else name, link, qty = args[1], args[2], args[3] end
      local itemID = idFromLink(link)
      if not itemID then return end
      local by, class = "self", nil
      if p.who == "other" then
        name = name:match("|h%[?([^%]|]+)%]?|h") or name -- a player hyperlink, if the client sends one
        local me = UnitName("player")
        if name ~= me and name:match("^([^%-]+)") ~= me then
          by = "party"
          class = groupMemberClass(name) or groupMemberClass(playerName)
        end
      end
      addGroupLoot(itemID, link, tonumber(qty) or 1, by, class, p.won)
      return
    end
  end
end

local function refreshLootMethod()
  if run then run.lootMethod = lootMethod() or run.lootMethod end
end

---------------------------------------------------------------- professions: crafts
-- One craft can show up as up to three signals: UNIT_SPELLCAST_SUCCEEDED (castGUID), TRADE_SKILL_ITEM_CRAFTED_RESULT
-- and a "You create" loot line (LOOT_ITEM_CREATED_SELF*, same template matching as the loot lines). Signals less than
-- CRAFT_WINDOW seconds apart are one craft: a cast joins a craft that has no cast yet, a quantity replaces one from
-- a less trusted source (result event over chat line). A cast counts as a craft when the spell is a known recipe or
-- TRADE_SKILL_CRAFT_BEGIN named it; a tradeskill cast alone (Disenchant, Prospecting, Milling) is not one. A result
-- event for another item than the recipe's output within the window is a bonus item of the same craft: a proc, not a
-- new craft, and not part of qty (the recipe's own output). Totals are per session.
local onPlayerCastStart, onPlayerCastSucceeded, onCraftBegin, onCraftedResult, onCreateLine
do
  local CRAFT_WINDOW = 3
  local BEGIN_TTL = 60   -- seconds a TRADE_SKILL_CRAFT_BEGIN recipe stays the current one
  local CAST_MEMORY = 200 -- castGUIDs remembered before the lists are cleared
  local craftBegin       -- { recipeID =, at = }
  local lastCraft        -- { recipeID =, at =, castGUID =, qty =, qtyRank =, proc =, chat =, bonus = { [itemID] } }
  local castSeen, castCount = {}, 0

  local function craftRec(recipeID)
    local byRecipe = db.crafts[build] or {}
    db.crafts[build] = byRecipe
    local c = byRecipe[recipeID]
    if not c then
      c = { casts = 0, qty = 0, procs = 0, skillUps = 0 }
      byRecipe[recipeID] = c
    end
    return c
  end

  local function newCraft(recipeID)
    local c = craftRec(recipeID)
    c.casts = c.casts + 1
    added()
    lastCraft = { recipeID = recipeID, at = now() }
    if craftBegin and craftBegin.recipeID == recipeID then craftBegin.at = now() end
    return lastCraft
  end

  local function recentCraft()
    local k = lastCraft
    if k and now() - k.at <= CRAFT_WINDOW then return k end
  end

  local function beganRecipe()
    local b = craftBegin
    if b and now() - b.at <= BEGIN_TTL then return b.recipeID end
  end

  local function recipeSnap(recipeID)
    local r = db.recipes[recipeID]
    return r and r.byBuild and r.byBuild[build]
  end

  local function recipeByOutput(itemID)
    for id, r in pairs(db.recipes) do
      local snap = r.byBuild and r.byBuild[build]
      if snap and snap.outputItemID == itemID then return id end
    end
  end

  -- rank: 2 crafted-result event, 1 chat line. A proc is multicraft, or more than the recipe's quantityMax.
  local function setCraftQty(k, qty, rank, proc)
    if (k.qtyRank or 0) >= rank then return end
    local c = craftRec(k.recipeID)
    c.qty = c.qty + qty - (k.qty or 0)
    k.qty, k.qtyRank = qty, rank
    local snap = recipeSnap(k.recipeID)
    proc = (proc or k.bonus or (snap and snap.qtyMax and qty > snap.qtyMax)) and true or false
    if proc ~= (k.proc or false) then
      c.procs = c.procs + (proc and 1 or -1)
      k.proc = proc
    end
  end

  -- A bonus item of craft k: a proc once per craft.
  local function addBonus(k, itemID)
    k.bonus = k.bonus or {}
    k.bonus[itemID] = true
    if not k.proc then
      local c = craftRec(k.recipeID)
      c.procs = c.procs + 1
      k.proc = true
    end
    scanItemOnce(itemID)
  end

  local function rememberCast(castGUID)
    castCount = castCount + 1
    if castCount > CAST_MEMORY then
      wipe(castSeen)
      castCount = 0
    end
    castSeen[castGUID] = true
  end

  -- Only sampled: name, displayName, texture, startTimeMs, endTimeMs, isTradeskill, castID, notInterruptible,
  -- castingSpellID.
  function onPlayerCastStart()
    if not UnitCastingInfo then return end
    local n, r = packed(UnitCastingInfo("player"))
    if n > 0 then sampleReturns("UnitCastingInfo", unpack(r, 1, n)) end
  end

  function onPlayerCastSucceeded(castGUID, spellID)
    spellID = tonumber(spellID)
    if not spellID then return end
    local line = gatherSkill(spellID)
    if line then return noteGatherCast(line, castGUID, spellID) end
    if castGUID and castSeen[castGUID] then return end
    if not (db.recipes[spellID] or beganRecipe() == spellID) then return end
    if castGUID then rememberCast(castGUID) end
    local k = recentCraft()
    if k and not k.castGUID and k.recipeID == spellID then
      k.castGUID = castGUID or true
      return
    end
    newCraft(spellID).castGUID = castGUID or true
  end

  function onCraftBegin(recipeSpellID)
    sampleReturns("TRADE_SKILL_CRAFT_BEGIN", recipeSpellID)
    local id = tonumber(recipeSpellID)
    if id then craftBegin = { recipeID = id, at = now() } end
  end

  function onCraftedResult(data)
    if type(data) ~= "table" then return end
    local api = "TRADE_SKILL_ITEM_CRAFTED_RESULT"
    sample(api, data)
    local k = recentCraft()
    local itemID = tonumber(field(data, "itemID"))
    local recipeID = tonumber(field(data, "recipeID", "recipeSpellID")) or (k and k.recipeID) or beganRecipe()
      or (itemID and recipeByOutput(itemID))
    if not recipeID then return end
    local snap = recipeSnap(recipeID)
    local bonus = itemID and snap and snap.outputItemID and itemID ~= snap.outputItemID
    if bonus and k and k.recipeID == recipeID then return addBonus(k, itemID) end
    if not k or k.recipeID ~= recipeID or (k.qtyRank or 0) >= 2 then k = newCraft(recipeID) end
    if bonus then return addBonus(k, itemID) end
    local extra = tonumber(field(data, "multicraft", "multicraftQuantity")) or 0
    setCraftQty(k, tonumber(need(api, data, "quantity", "count")) or 1, 2, extra > 0)
    if itemID then scanItemOnce(itemID) end
  end

  local CREATE_LINES = {
    { "LOOT_ITEM_CREATED_SELF_MULTIPLE", "You create: %sx%d." },
    { "LOOT_ITEM_CREATED_SELF", "You create: %s." },
  }
  local createPatterns

  function onCreateLine(text)
    if type(text) ~= "string" then return end
    if not createPatterns then
      createPatterns = {}
      for _, l in ipairs(CREATE_LINES) do
        local g = _G[l[1]]
        createPatterns[#createPatterns + 1] = formatPattern(type(g) == "string" and g or l[2])
      end
    end
    for _, p in ipairs(createPatterns) do
      local args = matchLine(p, text)
      if args then
        local itemID = idFromLink(args[1])
        if not itemID then return end
        local k = recentCraft()
        if k and k.bonus and k.bonus[itemID] then return end -- the bonus item's own line
        local snap = k and recipeSnap(k.recipeID)
        if snap and snap.outputItemID and snap.outputItemID ~= itemID then k = nil end
        if not k or k.chat then
          local recipeID = recipeByOutput(itemID)
          if not recipeID then return end -- not a known recipe's output (conjured food, ...)
          k = newCraft(recipeID)
        end
        k.chat = true
        setCraftQty(k, tonumber(args[2]) or 1, 1, false)
        return
      end
    end
  end

  -- The skill line of a crafted recipe: from the profession window's scan, else asked for by recipe.
  local function recipeLine(recipeID)
    local rec = db.recipes[recipeID]
    if rec and rec.skillLineID then return rec.skillLineID end
    local T = C_TradeSkillUI
    local p = T and professionInfo(T, "GetProfessionInfoByRecipeID", recipeID)
    return tonumber(field(p, "professionID", "skillLineID"))
  end

  -- A skill-up within 5 s of a craft (and not after a gather) belongs to that craft's recipe when it is the recipe's
  -- profession (its line or that line's parent/child). A craft is credited one skill-up: base and child lines rising
  -- together both name the recipe but count once, and the same line rising again is not this craft's.
  onSkillUp = function(e)
    local k = lastCraft
    if not k or now() - k.at > ATTRIBUTE_WINDOW then return end
    if gather.last and gather.last.at > k.at then return end
    k.lines = k.lines or {}
    if k.lines[e.skillLineID] or not relatedLines(recipeLine(k.recipeID), e.skillLineID) then return end
    k.lines[e.skillLineID] = true
    e.recipeID = k.recipeID
    if k.credited then return end
    k.credited = true
    local c = craftRec(k.recipeID)
    c.skillUps = c.skillUps + (e.to - e.from)
  end
end

---------------------------------------------------------------- schema
-- v0.1.0 files have no schemaVersion. Move their data into the v1 shape under the build they recorded.
local function migrateV0()
  local oldBuild = type(db.meta.build) == "table" and tonumber(db.meta.build[2]) or 0
  local who = db.meta.lastChar or {}
  local oldChar = (who.name or "?") .. "-" .. (who.realm or "?")

  for questID, q in pairs(db.quests) do
    q.id = q.id or questID
    q.obs = q.obs or {}
    local function move(stage, npc, extra)
      local key = oldBuild .. ":" .. stage .. ":" .. oldChar
      local o = { build = oldBuild, stage = stage, char = oldChar, level = q.seenAtLevel, npc = npc }
      for k, v in pairs(extra or {}) do o[k] = v end
      q.obs[key] = o
    end
    local offered = { xp = q.xpOffered, money = q.moneyOffered, choices = q.choices, rewards = q.rewards }
    if q.ender then move("complete", q.ender, offered)
    elseif q.giver or q.xpOffered or q.choices then move("detail", q.giver, offered) end
    if q.ender and q.giver then move("detail", q.giver) end
    if q.acceptedAt then
      move("accept", { loc = q.acceptedAt.loc }, { time = q.acceptedAt.time, level = q.acceptedAt.level })
    end
    for _, t in ipairs(q.turnIns or {}) do
      local char = (t.char or who.name or "?") .. "-" .. (who.realm or "?")
      db.turnIns[#db.turnIns + 1] = { id = char .. "-" .. questID .. "-" .. (t.time or 0), questID = questID,
                                       build = oldBuild, char = char, xp = t.xp, money = t.money,
                                       level = t.level, time = t.time }
    end
    q.xpOffered, q.moneyOffered, q.choices, q.rewards, q.giver, q.ender = nil, nil, nil, nil, nil, nil
    q.seenAtLevel, q.acceptedAt, q.turnIns = nil, nil, nil
  end
  table.sort(db.turnIns, function(a, b) return (a.time or 0) < (b.time or 0) end)

  for itemID, rec in pairs(db.items) do
    if not rec.byBuild then
      rec.byBuild = { [oldBuild] = { link = rec.link, ilvl = rec.ilvl, reqLevel = rec.reqLevel,
                                     sellPrice = rec.sellPrice, stats = rec.stats, tooltip = rec.tooltip,
                                     firstSeen = rec.lastSeen } }
      rec.id = itemID
      rec.link, rec.ilvl, rec.reqLevel, rec.sellPrice, rec.stats, rec.tooltip, rec.lastSeen =
        nil, nil, nil, nil, nil, nil, nil
    end
  end

  for itemID, bySrc in pairs(db.drops) do db.drops[itemID] = { [oldBuild] = bySrc } end

  for _, r in ipairs(db.runs) do
    local c = r.char or {}
    r.char = (c.name or "?") .. "-" .. (c.realm or "?")
    r.charLevel = c.level
    r.build = oldBuild
    r.id = r.char .. "-" .. (r.instanceID or 0) .. "-" .. (r.start or 0)
  end
end

local function newSessionID()
  local rnd = (math and math.random) or random
  return format("%d-%04x", now(), rnd(0, 65535))
end

-- Schema 4 tables; /fl reset confirm wipes them too.
local PROFESSION_TABLES = { "skills", "skillUps", "recipes", "recipeSeen", "learned", "crafts", "nodes", "nodeLoot",
                            "trainers", "vendors", "apiSamples" }

local function initDB()
  ForeverLedgerDB = ForeverLedgerDB or {}
  db = ForeverLedgerDB
  db.quests, db.items, db.runs, db.drops = db.quests or {}, db.items or {}, db.runs or {}, db.drops or {}
  db.turnIns = db.turnIns or {}
  db.dropQty, db.corpses = db.dropQty or {}, db.corpses or {}
  for _, k in ipairs(PROFESSION_TABLES) do db[k] = db[k] or {} end
  db.meta = db.meta or {}
  local hadData = next(db.quests) or next(db.items) or next(db.runs) or next(db.drops)
  local existed = db.meta.schemaVersion ~= nil or hadData
  if not db.meta.schemaVersion and hadData then migrateV0() end
  -- 1 -> 2 -> 3 -> 4 only add fields, so older data needs nothing but the new stamp.
  if (tonumber(db.meta.schemaVersion) or 0) < SCHEMA_VERSION then db.meta.schemaVersion = SCHEMA_VERSION end
  -- Per-session totals (drops, dropQty, corpses) belong to this session id for the life of the table. Forever
  -- starts every load with an empty table, so each load is a session. A table written by an older addon keeps
  -- session "": its drops are running totals the server already stores under "".
  if db.meta.session == nil then db.meta.session = existed and "" or newSessionID() end

  local version, buildStr, buildDate, interface = GetBuildInfo()
  build = tonumber(buildStr) or 0
  db.meta.addonVersion = VERSION
  db.meta.build, db.meta.version, db.meta.buildDate, db.meta.interface = build, version, buildDate, interface
end

---------------------------------------------------------------- events
local handlers = {}

function handlers.ADDON_LOADED(name)
  if name ~= "ForeverLedger" then return end
  initDB()
end

function handlers.PLAYER_LOGIN()
  local me = whoAmI()
  db.meta.lastChar = me
  db.chars = db.chars or {}
  me.lastSeen = now()
  db.chars[charKey()] = me
  lastXP, lastMax, lastLevel = UnitXP("player"), UnitXPMax("player"), UnitLevel("player")
  safely("scanSkills", scanSkills)
  say("v" .. VERSION .. " recording. /fl for commands.")
end

function handlers.PLAYER_LEVEL_UP(level)
  if db.chars and db.chars[charKey()] then db.chars[charKey()].level = level end
end

function handlers.PLAYER_ENTERING_WORLD() checkInstance() end
function handlers.ZONE_CHANGED_NEW_AREA() checkInstance() end
function handlers.QUEST_DETAIL() captureQuestFrame("detail") end
function handlers.QUEST_COMPLETE()
  local questID, o = captureQuestFrame("complete")
  completeWindow = questID and { questID = questID, choices = o.choices } or nil
end
function handlers.PLAYER_XP_UPDATE() onXP() end
function handlers.LOOT_OPENED() safely("onLootOpened", onLootOpened) end
function handlers.LOOT_CLOSED() if pendingMoney then pendingMoney.untilAt = now() + MONEY_WAIT end end
function handlers.PLAYER_MONEY() safely("onPlayerMoney", onPlayerMoney) end
-- safely (pcall): loot bookkeeping reads client tables whose shape we only know from API docs; it must never error in
-- play. Failures are noted in apiSamples["ForeverLedger.errors"].
function handlers.CHAT_MSG_LOOT(text, playerName)
  safely("onChatLoot", onChatLoot, text, playerName)
  safely("onCreateLine", onCreateLine, text)
end
function handlers.LOOT_HISTORY_UPDATE_ENCOUNTER(encounterID)
  safely("readEncounterLoot", readEncounterLoot, encounterID)
end
function handlers.LOOT_HISTORY_UPDATE_DROP(encounterID, lootListKey)
  safely("readDropLoot", readDropLoot, encounterID, lootListKey)
end
function handlers.PARTY_LOOT_METHOD_CHANGED() refreshLootMethod() end
function handlers.GROUP_ROSTER_UPDATE() refreshLootMethod() end

function handlers.QUEST_ACCEPTED(a, b)
  local questID = b or a -- Classic sends (logIndex, questID); newer clients send (questID)
  captureFromLog(questID)
  local o = questObs(questID, "accept")
  o.loc = where()
end

function handlers.QUEST_TURNED_IN(questID, xp, money)
  local t = now()
  local entry = { id = charKey() .. "-" .. questID .. "-" .. t, questID = questID, build = build,
                  char = charKey(), xp = xp, money = money, level = UnitLevel("player"), time = t,
                  runID = run and run.id or nil, choice = takeChoice(questID) }
  db.turnIns[#db.turnIns + 1] = entry
  trim(db.turnIns, HISTORY_CAP)
  added()
  if run then run.questXP = run.questXP + (xp or 0) end
  checkpoint()
end

function handlers.ENCOUNTER_END(encounterID, name, _, _, success)
  if run then
    run.bosses[#run.bosses + 1] = { id = encounterID, name = name, killed = success == 1,
                                    atSecs = now() - run.start - (run.awaySecs or 0) }
    refreshLootMethod()
    safely("readEncounterLoot", readEncounterLoot, encounterID)
  end
  if success == 1 or success == true then checkpoint() end
end

function handlers.LFG_COMPLETION_REWARD() checkpoint() end

-- A checkpoint that came during combat prints once the fight is over.
function handlers.PLAYER_REGEN_ENABLED()
  if nudgeDeferred then checkpoint() end
end

function handlers.PLAYER_DEAD() if run then run.deaths = run.deaths + 1 end end

function handlers.GET_ITEM_INFO_RECEIVED(itemID)
  local link = pendingItems[itemID]
  if link then scanItem(itemID, type(link) == "string" and link or nil) end
end

function handlers.QUEST_DATA_LOAD_RESULT(questID) refreshBlankObjectives(questID) end
function handlers.QUEST_WATCH_UPDATE(questID) refreshBlankObjectives(questID) end

function handlers.QUEST_LOG_UPDATE()
  if next(blankObjectives) and now() - lastObjRefresh >= OBJ_REFRESH_GAP then refreshBlankObjectives() end
end

-- professions: everything below reads client tables whose field names are unverified, so all of it runs `safely`
function handlers.SKILL_LINES_CHANGED() safely("scanSkills", scanSkills) end
function handlers.TRADE_SKILL_SHOW()
  tradeOpen, tradeShownAt = true, now()
  throttled("trade", scanTrade)
end
function handlers.TRADE_SKILL_LIST_UPDATE() if tradeOpen then throttled("trade", scanTrade) end end
-- CHANGING closes the window until the matching CHANGED (another profession in the open window); a closed window
-- stays closed.
function handlers.TRADE_SKILL_DATA_SOURCE_CHANGING()
  tradeSwitching = tradeOpen or tradeSwitching
  tradeOpen = false
end
function handlers.TRADE_SKILL_DATA_SOURCE_CHANGED()
  if tradeSwitching or (tradeShownAt and now() - tradeShownAt <= ATTRIBUTE_WINDOW) then tradeOpen = true end
  tradeSwitching = false
  if tradeOpen then throttled("trade", scanTrade) end
end
function handlers.TRADE_SKILL_CLOSE() tradeOpen, tradeSwitching, tradeShownAt = false, false, nil end
function handlers.NEW_RECIPE_LEARNED(...) safely("onRecipeLearned", onRecipeLearned, ...) end
function handlers.TRAINER_SHOW()
  trainerNpc = npcIDFromGUID(UnitGUID("npc"))
  if trainerNpc then throttled("trainer", scanTrainer) end
end
function handlers.TRAINER_UPDATE() if trainerNpc then throttled("trainer", scanTrainer) end end
function handlers.TRAINER_CLOSED() trainerNpc = nil end
function handlers.MERCHANT_SHOW()
  merchantNpc = npcIDFromGUID(UnitGUID("npc"))
  if merchantNpc then throttled("vendor", scanVendor) end
end
function handlers.MERCHANT_UPDATE() if merchantNpc then throttled("vendor", scanVendor) end end
function handlers.MERCHANT_CLOSED() merchantNpc = nil end
function handlers.UNIT_SPELLCAST_START(unit)
  if unit == "player" then safely("onPlayerCastStart", onPlayerCastStart) end
end
function handlers.UNIT_SPELLCAST_SENT(unit, target, castGUID, spellID)
  if unit == "player" then safely("onGatherSent", onGatherSent, target, castGUID, spellID) end
end
function handlers.UNIT_SPELLCAST_SUCCEEDED(unit, castGUID, spellID)
  if unit ~= "player" then return end
  safely("onPlayerSpellForRecipeItem", onPlayerSpellForRecipeItem, spellID)
  safely("onPlayerCastSucceeded", onPlayerCastSucceeded, castGUID, spellID)
end
function handlers.TRADE_SKILL_CRAFT_BEGIN(recipeSpellID) safely("onCraftBegin", onCraftBegin, recipeSpellID) end
function handlers.TRADE_SKILL_ITEM_CRAFTED_RESULT(data) safely("onCraftedResult", onCraftedResult, data) end

-- ADDON_ACTION_BLOCKED / _FORBIDDEN (addonName, functionName): a protected call blamed on this addon. It never makes
-- one, so any entry here is a bug (or taint from another addon) worth seeing on the server.
function handlers.ADDON_ACTION_BLOCKED(addonName, fn)
  if addonName == "ForeverLedger" then noteError("blocked:" .. tostring(fn), tostring(fn)) end
end
function handlers.ADDON_ACTION_FORBIDDEN(addonName, fn)
  if addonName == "ForeverLedger" then noteError("forbidden:" .. tostring(fn), tostring(fn)) end
end
-- LUA_WARNING(warningText) (some clients send a warning type first): kept when the text names this addon.
function handlers.LUA_WARNING(...)
  for i = 1, select("#", ...) do
    local text = select(i, ...)
    if type(text) == "string" and text:find("ForeverLedger", 1, true) then
      return noteError("warning:" .. text:sub(1, 60), text)
    end
  end
end

-- Unit events only for the player where the client can filter them (the handlers check the unit too).
local PLAYER_EVENTS = { UNIT_SPELLCAST_START = true, UNIT_SPELLCAST_SENT = true, UNIT_SPELLCAST_SUCCEEDED = true }
for event in pairs(handlers) do -- pcall: skip events a client lacks
  if not (PLAYER_EVENTS[event] and f.RegisterUnitEvent and pcall(f.RegisterUnitEvent, f, event, "player")) then
    pcall(f.RegisterEvent, f, event)
  end
end
-- A handler's error is noted, then raised as before.
f:SetScript("OnEvent", function(_, event, ...)
  local ok, err = pcall(handlers[event], ...)
  if not ok then
    pcall(noteError, "event:" .. event, err)
    error(err, 0)
  end
end)

---------------------------------------------------------------- slash commands
local function professionStatus()
  local nSkills, nCrafts, nNodes, nTrainers, nVendors = 0, 0, 0, 0, 0
  for _, byLine in pairs(db.skills) do
    for _ in pairs(byLine) do nSkills = nSkills + 1 end
  end
  local nRecipes = 0
  for _ in pairs(db.recipes) do nRecipes = nRecipes + 1 end
  for _, byRecipe in pairs(db.crafts) do
    for _, c in pairs(byRecipe) do nCrafts = nCrafts + (c.casts or 0) end
  end
  for _, byObj in pairs(db.nodes) do
    for _, n in pairs(byObj) do nNodes = nNodes + (n.opened or 0) end
  end
  for _, byNpc in pairs(db.trainers) do
    for _ in pairs(byNpc) do nTrainers = nTrainers + 1 end
  end
  for _, byNpc in pairs(db.vendors) do
    for _ in pairs(byNpc) do nVendors = nVendors + 1 end
  end
  return format("professions: %d skills, %d recipes, %d crafts, %d nodes gathered, %d trainers, %d vendors.",
    nSkills, nRecipes, nCrafts, nNodes, nTrainers, nVendors)
end

SLASH_FOREVERLEDGER1, SLASH_FOREVERLEDGER2 = "/fl", "/ledger"
SlashCmdList.FOREVERLEDGER = function(msg)
  msg = (msg or ""):lower()
  if msg == "scanlog" then
    scanWholeLog()
  elseif msg == "done" then
    closeRun("manual")
  elseif msg == "nudge off" or msg == "nudge on" then
    nudgeOn = msg == "nudge on"
    nudgeDeferred = false
    say(nudgeOn and "/reload reminders on." or "/reload reminders off until your next /reload or logout.")
  elseif msg == "reset confirm" then
    wipe(db.quests); wipe(db.items); wipe(db.runs); wipe(db.drops); wipe(db.turnIns)
    wipe(db.dropQty); wipe(db.corpses)
    for _, k in ipairs(PROFESSION_TABLES) do wipe(db[k]) end
    say("all data wiped.")
  else
    local nq, ni, nd, nc = 0, 0, 0, 0
    for _ in pairs(db.quests) do nq = nq + 1 end
    for _ in pairs(db.items) do ni = ni + 1 end
    for _ in pairs(db.drops) do nd = nd + 1 end
    for _, byNpc in pairs(db.corpses) do
      for _, c in pairs(byNpc) do nc = nc + (c.n or 0) end
    end
    say(format("schema %d, build %d, session %s.", db.meta.schemaVersion or 0, build, db.meta.session or "?"))
    say(format("%d quests, %d turn-ins, %d items, %d looted item types, %d corpses looted, %d runs.",
      nq, #db.turnIns, ni, nd, nc, #db.runs))
    say(professionStatus())
    say(format("%d new record%s since your last /reload (saved on the next /reload); reminders %s.",
      newRecords, newRecords == 1 and "" or "s", nudgeOn and "on" or "off"))
    say("/fl scanlog  -  read rewards for quests already in your log")
    say("/fl done  -  close the current dungeon timer by hand")
    say("/fl nudge off|on  -  reminders to /reload after bosses, runs and turn-ins")
    say("/fl reset confirm  -  wipe everything")
    say("Type /reload after each dungeon so the data hits disk.")
  end
end
