-- Forever Ledger guide viewer: shows the leveling guides the tray app wrote into the ForeverLedger_Guides addon
-- (ForeverLedgerGuidesData), one step at a time, like Zygor. It only reads the quest log and shows text; the map pin
-- is set when you click Pin. Your place in each guide is kept per character in ForeverLedgerGuideState.
-- /fl guide  show | hide | list | use N | next | back | pin | reset

local G = {}
ForeverLedgerGuide = G

local QuestLog = C_QuestLog or {}
local READ_GAP = 0.5 -- seconds between quest-log driven re-checks
local WIDTH = 330

local function say(msg) print("|cff33ff99Forever Ledger:|r " .. msg) end

---------------------------------------------------------------- data
-- This character's keys, as the ledger names characters: full name (first + Forever surname) and first name, -Realm.
function G.myKeys()
  local first, second = UnitName("player")
  local realm = GetRealmName and GetRealmName() or "?"
  local keys = {}
  if first and second and second ~= "" then keys[#keys + 1] = first .. " " .. second .. "-" .. realm end
  if first then keys[#keys + 1] = first .. "-" .. realm end
  return keys
end

-- Guides for this character, newest first (the tray writes them in that order).
function G.myGuides()
  local data = ForeverLedgerGuidesData
  if type(data) ~= "table" or type(data.guides) ~= "table" then return {} end
  local keys, out = {}, {}
  for _, k in ipairs(G.myKeys()) do keys[k] = true end
  for _, g in ipairs(data.guides) do
    if type(g) == "table" and keys[g.char] and type(g.steps) == "table" and #g.steps > 0 then out[#out + 1] = g end
  end
  return out
end

local function state()
  ForeverLedgerGuideState = ForeverLedgerGuideState or {}
  local s = ForeverLedgerGuideState
  s.steps = s.steps or {} -- [guideID] = step index
  return s
end

function G.current()
  local s, mine = state(), G.myGuides()
  for _, g in ipairs(mine) do
    if g.id == s.guide then return g end
  end
  return mine[1]
end

---------------------------------------------------------------- quest state
local function call(fn, ...)
  if not fn then return nil end
  local ok, v = pcall(fn, ...)
  if ok then return v end
end

local function completed(id) return call(QuestLog.IsQuestFlaggedCompleted, id) == true end
local function onQuest(id) return call(QuestLog.IsOnQuest, id) == true end
local function readyToTurnIn(id)
  return call(QuestLog.ReadyForTurnIn, id) == true or (onQuest(id) and call(QuestLog.IsComplete, id) == true)
end

-- Whether a step is behind the player: picked up (or done), objectives finished, or turned in.
function G.stepDone(step)
  for _, q in ipairs(step.quests or {}) do
    local id = q.questId
    if step.action == "accept" then
      if not (onQuest(id) or completed(id)) then return false end
    elseif step.action == "complete" then
      if not (completed(id) or readyToTurnIn(id)) then return false end
    elseif not completed(id) then
      return false
    end
  end
  return true
end

-- Moves past every finished step from the current one; returns whether the step changed. A step the player went back
-- to by hand is left alone until they press Next or real progress happens (a quest accepted or turned in).
function G.advance(force)
  local g = G.current()
  if not g then return false end
  local s = state()
  if s.hold and not force then return false end
  if force then s.hold = nil end
  local i = s.steps[g.id] or 1
  local start = i
  while i <= #g.steps and G.stepDone(g.steps[i]) do i = i + 1 end
  s.steps[g.id], s.guide = i, g.id
  return i ~= start
end

function G.stepIndex()
  local g = G.current()
  return g and (state().steps[g.id] or 1) or nil
end

function G.go(delta)
  local g = G.current()
  if not g then return end
  local s = state()
  local i = math.max(1, math.min(#g.steps + 1, (s.steps[g.id] or 1) + delta))
  s.steps[g.id], s.guide = i, g.id
  s.hold = delta < 0 or nil
end

---------------------------------------------------------------- text
local VERB = { accept = "Accept", complete = "Do", turn_in = "Turn in" }
local GOLD, GREY, GREEN, WHITE = "|cffffd100", "|cff9d9d9d", "|cff40c040", "|cffffffff"

local function place(step)
  local parts = {}
  if step.subzone and step.subzone ~= "" then parts[#parts + 1] = step.subzone end
  if step.zone and step.zone ~= step.subzone then parts[#parts + 1] = step.zone end
  local at = ""
  if step.x and step.y then at = string.format(" (%.1f, %.1f)", step.x, step.y) end
  return table.concat(parts, ", ") .. at
end

-- The objectives of a quest as the log has them now, else as the guide wrote them.
local function objectiveLines(q)
  local lines = {}
  local live = onQuest(q.questId) and call(QuestLog.GetQuestObjectives, q.questId)
  if type(live) == "table" and #live > 0 then
    for _, o in ipairs(live) do
      if type(o) == "table" and type(o.text) == "string" and o.text ~= "" then
        lines[#lines + 1] = (o.finished and GREEN or WHITE) .. o.text .. "|r"
      end
    end
  end
  if #lines == 0 then
    for _, t in ipairs(q.objectives or {}) do lines[#lines + 1] = WHITE .. t .. "|r" end
  end
  return lines
end

-- The step as text: what to do, where, and its quests (with live objective counts while on them).
function G.stepText(step)
  local lines = {}
  local verb = VERB[step.action] or step.action
  local who = step.npc and (step.action == "accept" and " from " or step.action == "turn_in" and " to " or " ") or ""
  lines[#lines + 1] = GOLD .. verb .. (step.npc and (who .. step.npc) or "") .. "|r"
  local where = place(step)
  if where ~= "" then lines[#lines + 1] = GREY .. where .. "|r" end
  for _, q in ipairs(step.quests or {}) do
    local mark = completed(q.questId) and (GREEN .. "done: ") or "- "
    lines[#lines + 1] = mark .. (q.title or ("Quest " .. q.questId)) .. "|r"
    if step.action == "complete" then
      for _, o in ipairs(objectiveLines(q)) do lines[#lines + 1] = "    " .. o end
    end
  end
  if step.levelAfter then lines[#lines + 1] = GREY .. "Level " .. step.levelAfter .. " after this|r" end
  return table.concat(lines, "\n")
end

---------------------------------------------------------------- map pin
function G.pin()
  local g = G.current()
  local step = g and g.steps[G.stepIndex()]
  if not step or not step.x or not step.y then return say("this step has no position.") end
  local map = C_Map
  local point = UiMapPoint and UiMapPoint.CreateFromCoordinates
  if step.mapId and map and map.SetUserWaypoint and point
     and (not map.CanSetUserWaypointOnMap or call(map.CanSetUserWaypointOnMap, step.mapId)) then
    local ok = pcall(function() map.SetUserWaypoint(point(step.mapId, step.x / 100, step.y / 100)) end)
    if ok then
      if C_SuperTrack and C_SuperTrack.SetSuperTrackedUserWaypoint then
        pcall(C_SuperTrack.SetSuperTrackedUserWaypoint, true)
      end
      return say(string.format("map pin set at %.1f, %.1f.", step.x, step.y))
    end
  end
  say(string.format("go to %s.", place(step)))
end

---------------------------------------------------------------- window
local function button(parent, label, width, onClick)
  local ok, b = pcall(CreateFrame, "Button", nil, parent, "UIPanelButtonTemplate")
  if not ok or not b then
    b = CreateFrame("Button", nil, parent)
    local fs = b:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
    fs:SetPoint("CENTER")
    b:SetFontString(fs)
  end
  b:SetSize(width, 20)
  b:SetText(label)
  b:SetScript("OnClick", onClick)
  return b
end

function G.frame()
  if G.win then return G.win end
  local ok, f = pcall(CreateFrame, "Frame", "ForeverLedgerGuideFrame", UIParent, "BackdropTemplate")
  if not ok or not f then f = CreateFrame("Frame", "ForeverLedgerGuideFrame", UIParent) end
  f:SetSize(WIDTH, 200)
  local p = state().point
  if type(p) == "table" and p[1] then
    f:SetPoint(p[1], UIParent, p[2] or p[1], p[3] or 0, p[4] or 0)
  else
    f:SetPoint("RIGHT", UIParent, "RIGHT", -60, 120)
  end
  f:SetFrameStrata("MEDIUM")
  f:SetClampedToScreen(true)
  f:SetMovable(true)
  f:EnableMouse(true)
  f:RegisterForDrag("LeftButton")
  f:SetScript("OnDragStart", function(self) self:StartMoving() end)
  f:SetScript("OnDragStop", function(self)
    self:StopMovingOrSizing()
    local point, _, relPoint, x, y = self:GetPoint(1)
    state().point = { point, relPoint, x, y }
  end)
  if f.SetBackdrop then
    f:SetBackdrop({ bgFile = "Interface\\Tooltips\\UI-Tooltip-Background",
                    edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border", tile = true, tileSize = 16, edgeSize = 16,
                    insets = { left = 4, right = 4, top = 4, bottom = 4 } })
    f:SetBackdropColor(0, 0, 0, 0.8)
  else
    local bg = f:CreateTexture(nil, "BACKGROUND")
    bg:SetAllPoints()
    bg:SetColorTexture(0, 0, 0, 0.75)
  end
  f.title = f:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  f.title:SetPoint("TOPLEFT", 10, -9)
  f.title:SetPoint("TOPRIGHT", -10, -9)
  f.title:SetJustifyH("LEFT")
  f.counter = f:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  f.counter:SetPoint("TOPLEFT", f.title, "BOTTOMLEFT", 0, -2)
  f.body = f:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  f.body:SetPoint("TOPLEFT", f.counter, "BOTTOMLEFT", 0, -6)
  f.body:SetWidth(WIDTH - 20)
  f.body:SetJustifyH("LEFT")
  f.body:SetJustifyV("TOP")
  f.back = button(f, "Back", 56, function() G.go(-1); G.render() end)
  f.back:SetPoint("BOTTOMLEFT", 8, 8)
  f.nextB = button(f, "Next", 56, function() G.go(1); G.render() end)
  f.nextB:SetPoint("LEFT", f.back, "RIGHT", 4, 0)
  f.pinB = button(f, "Pin", 46, function() G.pin() end)
  f.pinB:SetPoint("LEFT", f.nextB, "RIGHT", 4, 0)
  f.close = button(f, "Hide", 50, function() G.hide() end)
  f.close:SetPoint("BOTTOMRIGHT", -8, 8)
  G.win = f
  return f
end

-- What the window shows now (also what /fl guide prints without a window): title, "Step i of n", and the step.
function G.view()
  local g = G.current()
  if not g then
    return { title = "Forever Ledger guide", counter = "",
             body = "No guide for this character yet. Ask for one in Discord or on the ledger's Guides page; the "
                    .. "tray writes it, then /reload." }
  end
  local i = G.stepIndex()
  if i > #g.steps then
    return { title = g.title, counter = string.format("Done: all %d steps", #g.steps),
             body = GREEN .. "Guide finished. " .. (g.toLevel and ("You should be level " .. g.toLevel .. ".") or "")
                    .. "|r" }
  end
  return { title = g.title, counter = string.format("Step %d of %d  ·  %s's run", i, #g.steps, g.basedOn or "?"),
           body = G.stepText(g.steps[i]) }
end

function G.render()
  if not G.win or not G.shown then return end
  local v = G.view()
  local f = G.win
  f.title:SetText(v.title)
  f.counter:SetText(v.counter)
  f.body:SetText(v.body)
  local h = tonumber(f.body.GetStringHeight and f.body:GetStringHeight()) or 80
  f:SetHeight(math.max(120, math.min(400, h + 72)))
end

function G.show()
  G.shown = true
  state().hidden = nil
  G.advance(false)
  G.frame():Show()
  G.render()
end

function G.hide()
  G.shown = false
  state().hidden = true
  if G.win then G.win:Hide() end
end

---------------------------------------------------------------- slash (/fl guide ...)
function G.slash(rest)
  local cmd, arg = (rest or ""):match("^%s*(%S*)%s*(.-)%s*$")
  if cmd == "" or cmd == "show" then return G.show() end
  if cmd == "hide" then return G.hide() end
  if cmd == "next" then G.go(1); return G.show() end
  if cmd == "back" then G.go(-1); return G.show() end
  if cmd == "pin" then return G.pin() end
  local mine = G.myGuides()
  if cmd == "list" then
    if #mine == 0 then return say("no guides for this character yet.") end
    local cur = G.current()
    for i, g in ipairs(mine) do
      say(string.format("%d. %s (%d steps)%s", i, g.title, #g.steps, g == cur and "  <- current" or ""))
    end
    return say("/fl guide use N switches.")
  end
  if cmd == "use" then
    local g = mine[tonumber(arg) or 0]
    if not g then return say("no guide " .. tostring(arg) .. "; /fl guide list shows them.") end
    state().guide = g.id
    G.advance(true)
    return G.show()
  end
  if cmd == "reset" then
    local g = G.current()
    if g then state().steps[g.id] = 1 end
    G.advance(true)
    return G.show()
  end
  say("/fl guide  show | hide | list | use N | next | back | pin | reset")
end

---------------------------------------------------------------- events
local events = CreateFrame("Frame")
local lastRead, pending = -math.huge, false
local function refresh(force)
  G.advance(force)
  G.render()
end
local handlers = {}
function handlers.PLAYER_LOGIN()
  -- The quest log is ready a moment after login.
  local function start()
    if #G.myGuides() == 0 then return end
    G.advance(true)
    if not state().hidden then G.show() end
    say("guide loaded: " .. G.current().title .. ". /fl guide to show or hide it.")
  end
  if C_Timer then C_Timer.After(3, start) else start() end
end
function handlers.QUEST_ACCEPTED() refresh(true) end
function handlers.QUEST_TURNED_IN() refresh(true) end
function handlers.QUEST_REMOVED() refresh(false) end
function handlers.QUEST_LOG_UPDATE()
  if not G.shown then return end
  local now = GetTime and GetTime() or time()
  if now - lastRead >= READ_GAP then
    lastRead = now
    refresh(false)
  elseif not pending and C_Timer then
    pending = true
    C_Timer.After(READ_GAP, function() pending = false; refresh(false) end)
  end
end
for event in pairs(handlers) do pcall(events.RegisterEvent, events, event) end
events:SetScript("OnEvent", function(_, event, ...)
  local ok, err = pcall(handlers[event], ...)
  if not ok then print("|cff33ff99Forever Ledger:|r guide viewer error: " .. tostring(err)) end
end)
