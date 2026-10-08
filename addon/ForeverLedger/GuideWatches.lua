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

-- Makes the watch list exactly `ids`.
local function setWatches(ids)
  local want = {}
  for _, id in ipairs(ids) do want[id] = true end
  for _, id in ipairs(W.current()) do
    if not want[id] then call(ql().RemoveQuestWatch, id) end
  end
  for _, id in ipairs(ids) do
    if not watched(id) then call(ql().AddQuestWatch, id) end
  end
end

-- Saves your watch list, once: a reload while the guide runs must not save the guide's own list over it.
function W.take()
  local s = G.state()
  if s.savedWatches == nil then s.savedWatches = W.current() end
end

-- The step's quests only, the first super-tracked. `key` names the step and its quests: the same key is not applied
-- again (so a watch you add by hand stays until the step changes) unless `rewatch`.
function W.apply(ids, key, rewatch)
  if key == W.lastKey and not rewatch then return end
  W.lastKey = key
  setWatches(ids)
  if ids[1] and C_SuperTrack then call(C_SuperTrack.SetSuperTrackedQuestID, ids[1]) end
end

-- Gives your watch list back, minus quests no longer in the log.
function W.restore()
  local s = G.state()
  local saved = s.savedWatches
  if saved == nil then return end
  s.savedWatches, W.lastKey = nil, nil
  local keep = {}
  for _, id in ipairs(saved) do
    if G.onQuest(id) then keep[#keep + 1] = id end
  end
  setWatches(keep)
end
