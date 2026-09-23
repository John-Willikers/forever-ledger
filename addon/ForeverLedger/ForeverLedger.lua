-- Forever Ledger v0.2.2 (SavedVariables schema 1)
-- Passive data collector. Reads what the game already shows you; automates nothing.
-- Data is written to WTF/Account/<ACCOUNT>/SavedVariables/ForeverLedger.lua on /reload or logout.

local VERSION = "0.2.2"
local SCHEMA_VERSION = 1
local HISTORY_CAP = 2000 -- runs and turn-ins kept on disk; the uploader already has older rows
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
            bosses = {}, loot = {}, party = partyInfo() }
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
        local byBuild = db.drops[id] or {}
        db.drops[id] = byBuild
        byBuild[build] = byBuild[build] or {}
        byBuild[build][src] = (byBuild[build][src] or 0) + 1
        added()
        scanItem(id, link)
        if run then run.loot[#run.loot + 1] = { itemID = id, npcID = src } end
      end
    end
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

local function initDB()
  ForeverLedgerDB = ForeverLedgerDB or {}
  db = ForeverLedgerDB
  db.quests, db.items, db.runs, db.drops = db.quests or {}, db.items or {}, db.runs or {}, db.drops or {}
  db.turnIns = db.turnIns or {}
  db.meta = db.meta or {}
  if not db.meta.schemaVersion then
    if next(db.quests) or next(db.items) or next(db.runs) or next(db.drops) then migrateV0() end
    db.meta.schemaVersion = SCHEMA_VERSION
  end

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
function handlers.QUEST_COMPLETE() captureQuestFrame("complete") end
function handlers.PLAYER_XP_UPDATE() onXP() end
function handlers.LOOT_OPENED() onLootOpened() end

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
                  runID = run and run.id or nil }
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
    say("all data wiped.")
  else
    local nq, ni, nd = 0, 0, 0
    for _ in pairs(db.quests) do nq = nq + 1 end
    for _ in pairs(db.items) do ni = ni + 1 end
    for _ in pairs(db.drops) do nd = nd + 1 end
    say(format("schema %d, build %d.", db.meta.schemaVersion or 0, build))
    say(format("%d quests, %d turn-ins, %d items, %d looted item types, %d runs.",
      nq, #db.turnIns, ni, nd, #db.runs))
    say(format("%d new record%s since your last /reload (saved on the next /reload); reminders %s.",
      newRecords, newRecords == 1 and "" or "s", nudgeOn and "on" or "off"))
    say("/fl scanlog  -  read rewards for quests already in your log")
    say("/fl done  -  close the current dungeon timer by hand")
    say("/fl nudge off|on  -  reminders to /reload after bosses, runs and turn-ins")
    say("/fl reset confirm  -  wipe everything")
    say("Type /reload after each dungeon so the data hits disk.")
  end
end
