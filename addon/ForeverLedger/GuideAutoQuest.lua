-- Forever Ledger guide: accepts and turns in the current step's quests when you talk to the NPC (quality of life,
-- like Leatrix Plus or Zygor). Only the step's quests: an accept step accepts the ones not in your log or done yet, a
-- turn-in step turns its quests in. Nothing else is selected, accepted or completed. A reward choice is always yours:
-- when the quest offers one (even a single item) it only says so and waits.
-- Off with /fl guide auto off (kept per character); Shift held as any of the NPC's windows opens skips the whole
-- conversation.

local G = ForeverLedgerGuide
if not G then return end

local told -- the quest whose "pick your reward" line was printed in this window
local NEW_TALK = 1 -- seconds with no NPC window open: the next window is a new conversation

local function shift() return IsShiftKeyDown ~= nil and IsShiftKeyDown() == true end
local function clock() return GetTime and GetTime() or time() end

-- Shift skips the conversation: gossip → quest windows → gossip again, until no window has been open for a moment.
-- GOSSIP_CLOSED fires as gossip hands over to the quest frame, so a close alone doesn't end it.
local skipping, closedAt = false, nil
local function opened()
  if skipping and closedAt and clock() - closedAt >= NEW_TALK then skipping = false end
  closedAt = nil
  if shift() then skipping = true end
end
local function closed() closedAt = clock() end

local function enabled() return G.shown == true and G.state().autoQuest ~= false and not skipping and not shift() end

-- The step's quests this window may act on, by questID, for `action` ("accept" or "turn_in").
local function wanted(action)
  local g = G.current()
  local step = g and g.steps[G.stepIndex()]
  if not step or step.action ~= action then return {} end
  local set = {}
  for _, q in ipairs(step.quests or {}) do
    local id = q.questId
    if action == "turn_in" or not (G.onQuest(id) or G.completed(id)) then set[id] = q end
  end
  return set
end
local function want(action, id) return id ~= nil and enabled() and wanted(action)[id] ~= nil end

-- Runs act a beat later (the ledger's own QUEST_COMPLETE capture runs first and the frame shows), and only if
-- `still` says the same window is open and the quest is still the step's. Errors are swallowed: it just doesn't act.
local function later(still, act)
  local function run()
    pcall(function() if still() then act() end end)
  end
  if C_Timer and C_Timer.After then C_Timer.After(0.1, run) else run() end
end

local function questID() return GetQuestID and GetQuestID() or nil end

local handlers = {}

function handlers.GOSSIP_SHOW()
  local gossip = C_GossipInfo
  if not gossip then return end
  local function find(list, action, complete)
    for _, q in ipairs(list or {}) do
      if type(q) == "table" and (not complete or q.isComplete) and want(action, q.questID) then return q.questID end
    end
  end
  local id = find(gossip.GetAvailableQuests(), "accept")
  if id then
    return later(function() return find(gossip.GetAvailableQuests(), "accept") == id end,
                 function() gossip.SelectAvailableQuest(id) end)
  end
  id = find(gossip.GetActiveQuests(), "turn_in", true)
  if id then
    later(function() return find(gossip.GetActiveQuests(), "turn_in", true) == id end,
          function() gossip.SelectActiveQuest(id) end)
  end
end

function handlers.QUEST_GREETING()
  local function available(i) return select(5, GetAvailableQuestInfo(i)) end
  local function active(i)
    local _, complete = GetActiveTitle(i)
    return complete and GetActiveQuestID(i) or nil
  end
  local function find(count, idAt, action)
    for i = 1, count() or 0 do
      local id = idAt(i)
      if want(action, id) then return i, id end
    end
  end
  local i, id = find(GetNumAvailableQuests, available, "accept")
  if i then
    return later(function() return available(i) == id and want("accept", id) end,
                 function() SelectAvailableQuest(i) end)
  end
  i, id = find(GetNumActiveQuests, active, "turn_in")
  if i then
    later(function() return active(i) == id and want("turn_in", id) end, function() SelectActiveQuest(i) end)
  end
end

function handlers.QUEST_DETAIL()
  local id = questID()
  if not want("accept", id) then return end
  later(function() return questID() == id and want("accept", id) end, function()
    if QuestGetAutoAccept and QuestGetAutoAccept() then AcknowledgeAutoAcceptQuest() else AcceptQuest() end
  end)
end

function handlers.QUEST_PROGRESS()
  local id = questID()
  if not want("turn_in", id) then return end
  later(function() return questID() == id and want("turn_in", id) and IsQuestCompletable() end, CompleteQuest)
end

function handlers.QUEST_COMPLETE()
  local id = questID()
  if not want("turn_in", id) then return end
  later(function() return questID() == id and want("turn_in", id) end, function()
    -- The reward choice is always the player's: only exactly 0 choices turns it in (nil or an error means a choice).
    local ok, n = pcall(GetNumQuestChoices)
    if not ok or n ~= 0 then
      if told ~= id then
        told = id
        local title = GetTitleText and GetTitleText() or wanted("turn_in")[id].title
        print("|cff33ff99Forever Ledger:|r pick your reward for " .. G.esc(title) .. ".")
      end
      return
    end
    GetQuestReward(0)
  end)
end

function handlers.QUEST_FINISHED() told = nil; closed() end
handlers.GOSSIP_CLOSED = closed

local OPENS = { GOSSIP_SHOW = true, QUEST_GREETING = true, QUEST_DETAIL = true, QUEST_PROGRESS = true,
                QUEST_COMPLETE = true }
local events = CreateFrame("Frame")
for event in pairs(handlers) do pcall(events.RegisterEvent, events, event) end
events:SetScript("OnEvent", function(_, event, ...)
  if OPENS[event] then pcall(opened) end
  pcall(handlers[event], ...)
end)
