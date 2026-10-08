-- Forever Ledger guide watches: while a guide runs, Blizzard's quest tracker watches only the current step's quests
-- (probe 0.5.0: C_QuestLog.Add/RemoveQuestWatch and C_SuperTrack.SetSuperTrackedQuestID work from an addon, out of
-- combat). Your own watch list is saved once and given back when the guide is hidden or finished. GuideViewer's
-- G.sync calls this, never in combat.
local G = ForeverLedgerGuide
if not G then return end
local W = {}
G.watches = W

local function ql() return C_QuestLog or {} end

local function call(fn, ...)
  if type(fn) ~= "function" then return nil end
  local ok, v = pcall(fn, ...)
  if ok then return v end
end

-- The watched quest IDs, in the tracker's order.
function W.current()
  local ids = {}
  for i = 1, tonumber(call(ql().GetNumQuestWatches)) or 0 do
    local id = call(ql().GetQuestIDForQuestWatchIndex, i)
    if id then ids[#ids + 1] = id end
  end
  return ids
end

local function watched(id) return call(ql().GetQuestWatchType, id) ~= nil end

local function manual() return Enum and Enum.QuestWatchType and Enum.QuestWatchType.Manual or 1 end

-- Makes the watch list `ids`: exactly, or with `keepManual` keeping the watches you added by hand. Added watches get
-- `watchType` (AddQuestWatch(questID[, watchType])).
local function setWatches(ids, watchType, keepManual)
  local want = {}
  for _, id in ipairs(ids) do want[id] = true end
  for _, id in ipairs(W.current()) do
    if not want[id] and not (keepManual and call(ql().GetQuestWatchType, id) == manual()) then
      call(ql().RemoveQuestWatch, id)
    end
  end
  for _, id in ipairs(ids) do
    if not watched(id) then call(ql().AddQuestWatch, id, watchType) end
  end
end

-- Saves your watch list and super-tracked quest, once: a reload while the guide runs must not save the guide's own
-- over them. A saved list that isn't a table (an old or hand-edited file) is replaced.
function W.take()
  local s = G.state()
  if type(s.savedWatches) ~= "table" then
    s.savedWatches = W.current()
    s.savedSuperTrack = C_SuperTrack and call(C_SuperTrack.GetSuperTrackedQuestID) or nil
  end
end

-- The step's quests only, the first super-tracked. `key` names the step and its quests: a new key sets the list
-- exactly; the same key is not applied again unless `rewatch` (after an accept or quest progress, which the game
-- auto-watches), and then only the game's watches go: a watch you add by hand (Manual) stays until the step changes.
function W.apply(ids, key, rewatch)
  local same = key == W.lastKey
  if same and not rewatch then return end
  W.lastKey = key
  setWatches(ids, nil, same)
  if ids[1] and C_SuperTrack then call(C_SuperTrack.SetSuperTrackedQuestID, ids[1]) end
end

-- Gives your watch list back as manual watches, minus quests no longer in the log, and your super-tracked quest if
-- you still have it.
function W.restore()
  W.lastKey = nil
  local s = G.state()
  local saved = s.savedWatches
  if type(saved) ~= "table" then
    s.savedWatches = nil
    return
  end
  local superID = tonumber(s.savedSuperTrack)
  if not (superID and G.onQuest(superID)) then superID = 0 end
  s.savedWatches, s.savedSuperTrack = nil, nil
  local keep = {}
  for _, id in ipairs(saved) do
    if G.onQuest(id) then keep[#keep + 1] = id end
  end
  setWatches(keep, Enum and Enum.QuestWatchType and Enum.QuestWatchType.Manual)
  if C_SuperTrack then call(C_SuperTrack.SetSuperTrackedQuestID, superID) end
end
