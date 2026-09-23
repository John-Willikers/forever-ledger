-- Forever Ledger v0.2.4 (SavedVariables schema 3)
-- Passive data collector. Reads what the game already shows you; automates nothing.
-- Data is written to WTF/Account/<ACCOUNT>/SavedVariables/ForeverLedger.lua on /reload or logout.

local VERSION = "0.2.4"
-- 2 adds turnIns[].choice; 3 adds meta.session, dropQty, corpses and run lootMethod / bossLoot / groupLoot.
-- Each is additive: older data is valid as it is.
local SCHEMA_VERSION = 3
local HISTORY_CAP = 2000 -- runs and turn-ins kept on disk; the uploader already has older rows
local LIST_CAP = 500     -- bossLoot and groupLoot entries kept per run
local f = CreateFrame("Frame")

-- API compatibility (Classic-era globals vs newer namespaces; Forever 1.60 has only the namespaces)
local GetItemInfo  = (C_Item and C_Item.GetItemInfo) or GetItemInfo
local GetItemStats = (C_Item and C_Item.GetItemStats) or GetItemStats
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

local function npcIDFromGUID(guid)
  if not guid then return nil end
  local unitType, _, _, _, _, npcID = strsplit("-", guid)
  if unitType == "Creature" or unitType == "Vehicle" then return tonumber(npcID) end
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
  local name, ilink, quality, ilvl, reqLevel, itype, isub, _, equipLoc, _, sellPrice =
    GetItemInfo(link or itemID)
  if not name then pendingItems[itemID] = link or true; return end -- server hasn't sent it yet
  pendingItems[itemID] = nil

  local rec = db.items[itemID] or { id = itemID, byBuild = {} }
  db.items[itemID] = rec
  rec.name, rec.quality, rec.type, rec.subtype, rec.equipLoc = name, quality, itype, isub, equipLoc

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
  hooksecurefunc("GetQuestReward", function(index) pcall(onGetQuestReward, index) end)
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

---------------------------------------------------------------- loot
-- Every counter here is a total for this SavedVariables session (db.meta.session). A loot slot can come from several
-- sources (AoE loot): GetLootSourceInfo(slot) returns guid1, qty1, guid2, qty2, ... where qty is the stack size, or
-- the copper for a money slot. Each source GUID is counted once as a corpse, once per item and once for its money.
local MONEY_SLOT = (Enum and Enum.LootSlotType and Enum.LootSlotType.Money) or LOOT_SLOT_MONEY or 2
local seenCorpse = {} -- [guid] = true once counted in db.corpses
local seenMoney = {}  -- [guid] = true once its copper was added
local pendingMoney    -- { guid =, before =, untilAt = } for a money slot without a per-source amount
local MONEY_WAIT = 2  -- seconds after LOOT_CLOSED that PLAYER_MONEY may still settle a pending money slot

local function packed(...) return select("#", ...), { ... } end

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

local function lootItem(i, sources)
  local link = GetLootSlotLink(i)
  local id = idFromLink(link)
  if not id then return end
  if #sources == 0 then sources = { {} } end
  local slotQty = #sources == 1 and slotQuantity(i) or nil
  for _, src in ipairs(sources) do
    local key = (src.guid or "?") .. ":" .. id
    if not seenLoot[key] then
      seenLoot[key] = true
      local npc = npcIDFromGUID(src.guid) or 0
      -- One source: the slot's own stack size. Several (AoE): each source's share.
      local qty = slotQty or ((src.qty and src.qty > 0) and src.qty) or 1
      addTo(db.drops, id, build, npc, 1)
      addTo(db.dropQty, id, build, npc, qty)
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
  for i = 1, (GetNumLootItems() or 0) do
    local sources = lootSources(i)
    for _, src in ipairs(sources) do countCorpse(src.guid) end
    if slotType(i) == MONEY_SLOT then lootMoney(sources) else lootItem(i, sources) end
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
local function runList(field)
  local list = run[field]
  if type(list) ~= "table" then
    list = {}
    run[field] = list
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

local function initDB()
  ForeverLedgerDB = ForeverLedgerDB or {}
  db = ForeverLedgerDB
  db.quests, db.items, db.runs, db.drops = db.quests or {}, db.items or {}, db.runs or {}, db.drops or {}
  db.turnIns = db.turnIns or {}
  db.dropQty, db.corpses = db.dropQty or {}, db.corpses or {}
  db.meta = db.meta or {}
  local hadData = next(db.quests) or next(db.items) or next(db.runs) or next(db.drops)
  local existed = db.meta.schemaVersion ~= nil or hadData
  if not db.meta.schemaVersion and hadData then migrateV0() end
  -- 1 -> 2 -> 3 only add fields, so older data needs nothing but the new stamp.
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
function handlers.LOOT_OPENED() onLootOpened() end
function handlers.LOOT_CLOSED() if pendingMoney then pendingMoney.untilAt = now() + MONEY_WAIT end end
function handlers.PLAYER_MONEY() pcall(onPlayerMoney) end
-- pcall: loot bookkeeping reads client tables whose shape we only know from API docs; it must never error in play
function handlers.CHAT_MSG_LOOT(text, playerName) pcall(onChatLoot, text, playerName) end
function handlers.LOOT_HISTORY_UPDATE_ENCOUNTER(encounterID) pcall(readEncounterLoot, encounterID) end
function handlers.LOOT_HISTORY_UPDATE_DROP(encounterID, lootListKey) pcall(readDropLoot, encounterID, lootListKey) end
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
    pcall(readEncounterLoot, encounterID)
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

for event in pairs(handlers) do pcall(f.RegisterEvent, f, event) end -- pcall: skip events a client lacks
f:SetScript("OnEvent", function(_, event, ...) handlers[event](...) end)

---------------------------------------------------------------- slash commands
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
    say(format("%d new record%s since your last /reload (saved on the next /reload); reminders %s.",
      newRecords, newRecords == 1 and "" or "s", nudgeOn and "on" or "off"))
    say("/fl scanlog  -  read rewards for quests already in your log")
    say("/fl done  -  close the current dungeon timer by hand")
    say("/fl nudge off|on  -  reminders to /reload after bosses, runs and turn-ins")
    say("/fl reset confirm  -  wipe everything")
    say("Type /reload after each dungeon so the data hits disk.")
  end
end
