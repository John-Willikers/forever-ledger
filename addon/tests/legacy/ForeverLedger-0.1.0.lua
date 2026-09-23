-- Forever Ledger v0.1.0
-- Passive data collector. Reads what the game already shows you; automates nothing.
-- Data is written to WTF/Account/<ACCOUNT>/SavedVariables/ForeverLedger.lua on /reload or logout.

local VERSION = "0.1.0"
local f = CreateFrame("Frame")

-- API compatibility (Classic-era vs newer namespaces)
local GetItemInfo  = (C_Item and C_Item.GetItemInfo) or GetItemInfo
local GetItemStats = (C_Item and C_Item.GetItemStats) or GetItemStats
local NumLogEntries = GetNumQuestLogEntries or (C_QuestLog and C_QuestLog.GetNumQuestLogEntries)

local db
local pendingItems = {}
local seenLoot = {}
local run
local lastXP, lastMax, lastLevel
local RESUME_WINDOW = 900 -- seconds: re-entering the same instance within 15 min continues the run

local function now() return time() end
local function say(msg) print("|cff33ff99Forever Ledger:|r " .. msg) end
local function idFromLink(link) return link and tonumber(link:match("item:(%d+)")) end

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

---------------------------------------------------------------- items
local tip = CreateFrame("GameTooltip", "ForeverLedgerScanTip", nil, "GameTooltipTemplate")

local function scanItem(itemID, link)
  if not itemID then return end
  local name, ilink, quality, ilvl, reqLevel, itype, isub, _, equipLoc, _, sellPrice =
    GetItemInfo(link or itemID)
  if not name then pendingItems[itemID] = link or true; return end -- server hasn't sent it yet
  pendingItems[itemID] = nil

  local rec = db.items[itemID] or {}
  db.items[itemID] = rec
  rec.name, rec.link, rec.quality, rec.ilvl, rec.reqLevel = name, ilink, quality, ilvl, reqLevel
  rec.type, rec.subtype, rec.equipLoc, rec.sellPrice = itype, isub, equipLoc, sellPrice

  local ok, stats = pcall(GetItemStats, ilink)
  if ok and stats then rec.stats = stats end

  -- Full tooltip text catches set bonuses, "Equip:" effects and anything GetItemStats misses
  tip:SetOwner(WorldFrame, "ANCHOR_NONE")
  tip:ClearLines()
  tip:SetHyperlink(ilink)
  local lines = {}
  for i = 1, tip:NumLines() do
    local l = _G["ForeverLedgerScanTipTextLeft" .. i]
    local r = _G["ForeverLedgerScanTipTextRight" .. i]
    local lt, rt = l and l:GetText(), r and r:GetText()
    if lt or rt then
      lines[#lines + 1] = (lt or "") .. ((rt and rt ~= "") and (" || " .. rt) or "")
    end
  end
  if #lines > 0 then rec.tooltip = lines end
  rec.lastSeen = now()
end

---------------------------------------------------------------- quests
local function questRec(questID)
  local q = db.quests[questID] or { id = questID }
  db.quests[questID] = q
  return q
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
  local q = questRec(questID)
  q.title = GetTitleText() or q.title
  if GetRewardXP then q.xpOffered = GetRewardXP() end
  if GetRewardMoney then q.moneyOffered = GetRewardMoney() end

  local nChoice, nReward = GetNumQuestChoices() or 0, GetNumQuestRewards() or 0
  if nChoice > 0 then q.choices = readItemList("choice", nChoice) end
  if nReward > 0 then q.rewards = readItemList("reward", nReward) end

  local npc = { name = UnitName("npc"), id = npcIDFromGUID(UnitGUID("npc")), loc = where() }
  if stage == "detail" then q.giver = npc else q.ender = npc end
  q.seenAtLevel = UnitLevel("player")
end

-- Pulls level, group size, category (zone/dungeon header) and objectives from the quest log
local function captureFromLog(questID)
  if not NumLogEntries then return end
  local header
  for i = 1, NumLogEntries() do
    local title, level, suggestedGroup, isHeader, _, _, _, qid = GetQuestLogTitle(i)
    if isHeader then
      header = title
    elseif qid == questID or (not questID and qid) then
      local q = questRec(qid)
      q.title, q.level, q.category = title, level, header
      q.suggestedGroup = (suggestedGroup and suggestedGroup > 0) and suggestedGroup or nil
      local objs = {}
      for j = 1, (GetNumQuestLeaderBoards(i) or 0) do
        objs[#objs + 1] = GetQuestLogLeaderBoard(j, i)
      end
      if #objs > 0 then q.objectives = objs end
      if questID then return end
    end
  end
end

-- Walks the whole log and reads rewards for quests you already hold
local function scanWholeLog()
  if not NumLogEntries then return end
  captureFromLog(nil)
  local prev = GetQuestLogSelection and GetQuestLogSelection()
  local n = 0
  for i = 1, NumLogEntries() do
    local _, _, _, isHeader, _, _, _, qid = GetQuestLogTitle(i)
    if not isHeader and qid then
      SelectQuestLogEntry(i)
      local q = questRec(qid)
      local choices = {}
      for c = 1, (GetNumQuestLogChoices() or 0) do
        local link = GetQuestLogItemLink("choice", c)
        choices[#choices + 1] = { itemID = idFromLink(link) }
        scanItem(idFromLink(link), link)
      end
      if #choices > 0 then q.choices = q.choices or choices end
      if GetQuestLogRewardMoney then q.moneyOffered = q.moneyOffered or GetQuestLogRewardMoney() end
      n = n + 1
    end
  end
  if prev and prev > 0 then SelectQuestLogEntry(prev) end
  say("scanned " .. n .. " quests in your log.")
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
end

local function checkInstance()
  local inInst, iType = IsInInstance()
  if inInst and (iType == "party" or iType == "raid") then
    local name, _, diffID, _, maxPlayers, _, _, instID = GetInstanceInfo()
    if run and run.instanceID == instID then return end
    if run then closeRun("switched") end

    local last = db.runs[#db.runs]
    if last and last.instanceID == instID and last.endReason == "left"
       and now() - last.finish < RESUME_WINDOW then
      last.awaySecs = (last.awaySecs or 0) + (now() - last.finish)
      last.finish, last.endReason = nil, nil
      run = last
      say("resumed " .. name .. " run.")
      return
    end

    run = { instance = name, instanceID = instID, difficulty = diffID, maxPlayers = maxPlayers,
            start = now(), awaySecs = 0, xpTotal = 0, questXP = 0, deaths = 0,
            bosses = {}, loot = {}, char = whoAmI(), party = partyInfo() }
    db.runs[#db.runs + 1] = run
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
local function onLootOpened()
  for i = 1, (GetNumLootItems() or 0) do
    local link = GetLootSlotLink(i)
    local id = idFromLink(link)
    if id then
      local guid = GetLootSourceInfo and GetLootSourceInfo(i)
      local key = (guid or "?") .. ":" .. id
      if not seenLoot[key] then
        seenLoot[key] = true
        local src = npcIDFromGUID(guid) or 0
        db.drops[id] = db.drops[id] or {}
        db.drops[id][src] = (db.drops[id][src] or 0) + 1
        scanItem(id, link)
        if run then run.loot[#run.loot + 1] = { itemID = id, npcID = src } end
      end
    end
  end
end

---------------------------------------------------------------- events
local handlers = {}

function handlers.ADDON_LOADED(name)
  if name ~= "ForeverLedger" then return end
  ForeverLedgerDB = ForeverLedgerDB or {}
  db = ForeverLedgerDB
  db.quests, db.items, db.runs, db.drops = db.quests or {}, db.items or {}, db.runs or {}, db.drops or {}
  db.meta = db.meta or {}
  db.meta.addonVersion = VERSION
  db.meta.build = { GetBuildInfo() }
end

function handlers.PLAYER_LOGIN()
  db.meta.lastChar = whoAmI()
  lastXP, lastMax, lastLevel = UnitXP("player"), UnitXPMax("player"), UnitLevel("player")
  say("v" .. VERSION .. " recording. /fl for commands.")
end

function handlers.PLAYER_ENTERING_WORLD() checkInstance() end
function handlers.ZONE_CHANGED_NEW_AREA() checkInstance() end
function handlers.QUEST_DETAIL() captureQuestFrame("detail") end
function handlers.QUEST_COMPLETE() captureQuestFrame("complete") end
function handlers.PLAYER_XP_UPDATE() onXP() end
function handlers.LOOT_OPENED() onLootOpened() end

function handlers.QUEST_ACCEPTED(a, b)
  local questID = b or a -- Classic sends (logIndex, questID); newer clients send (questID)
  captureFromLog(questID)
  local q = questRec(questID)
  q.acceptedAt = { level = UnitLevel("player"), time = now(), loc = where() }
end

function handlers.QUEST_TURNED_IN(questID, xp, money)
  local q = questRec(questID)
  q.turnIns = q.turnIns or {}
  q.turnIns[#q.turnIns + 1] = { xp = xp, money = money, level = UnitLevel("player"),
                                time = now(), char = UnitName("player") }
  if run then run.questXP = run.questXP + (xp or 0) end
end

function handlers.ENCOUNTER_END(encounterID, name, _, _, success)
  if run then
    run.bosses[#run.bosses + 1] = { id = encounterID, name = name, killed = success == 1,
                                    atSecs = now() - run.start - (run.awaySecs or 0) }
  end
end

function handlers.PLAYER_DEAD() if run then run.deaths = run.deaths + 1 end end

function handlers.GET_ITEM_INFO_RECEIVED(itemID)
  local link = pendingItems[itemID]
  if link then scanItem(itemID, type(link) == "string" and link or nil) end
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
  elseif msg == "reset confirm" then
    wipe(db.quests); wipe(db.items); wipe(db.runs); wipe(db.drops)
    say("all data wiped.")
  else
    local nq, ni, nd = 0, 0, 0
    for _ in pairs(db.quests) do nq = nq + 1 end
    for _ in pairs(db.items) do ni = ni + 1 end
    for _ in pairs(db.drops) do nd = nd + 1 end
    say(format("%d quests, %d items, %d looted item types, %d runs.", nq, ni, nd, #db.runs))
    say("/fl scanlog  -  read rewards for quests already in your log")
    say("/fl done  -  close the current dungeon timer by hand")
    say("/fl reset confirm  -  wipe everything")
    say("Type /reload after each dungeon so the data hits disk.")
  end
end
