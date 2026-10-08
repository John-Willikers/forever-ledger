-- Forever Ledger guide section in Blizzard's quest tracker: a "Guide" module above Quests with the current step
-- (Forever has the retail 11.x module tracker, probe 0.5.0). It only lays out its own block and lines; the tracker is
-- only asked to redraw out of combat (GuideViewer's G.sync). If the module can't be made, or the game blocks an
-- action and names us (taint), the guide uses its own window instead. A block is remembered for the client build
-- (ForeverLedgerGuideState.trackerBlocked), and `/fl guide tracker off` keeps the window for good (trackerOff).
local G = ForeverLedgerGuide
if not G then return end
local T = {}
G.tracker = T

local GREY = "|cff9d9d9d"

local function say(msg) print("|cff33ff99Forever Ledger:|r " .. msg) end

local function build()
  local ok, _, b = pcall(GetBuildInfo)
  return ok and b ~= nil and tostring(b) or "?"
end

-- Out of the tracker: blocked this session, or turned off with /fl guide tracker off.
local function outOfTracker() return T.blocked or G.state().trackerOff == true end

function T.active() return T.module ~= nil and not T.removed and not outOfTracker() end

local function lines(text)
  local out = {}
  for line in ((text or "") .. "\n"):gmatch("(.-)\n") do
    if line ~= "" then out[#out + 1] = line end
  end
  return out
end

-- Called by Blizzard's tracker update (ObjectiveTrackerModuleMixin:Update): one block, the guide's view as lines.
function T.layout(module)
  if not G.shown then return end
  local v = G.view()
  local block = module:GetBlock("guide")
  block:SetHeader(v.title)
  -- useFullHeight: Blizzard cuts an objective at two lines otherwise.
  for i, line in ipairs(lines(v.body)) do block:AddObjective("line" .. i, line, nil, true) end
  if v.counter ~= "" then
    block:AddObjective("counter", GREY .. v.counter .. "|r", nil, true, OBJECTIVE_DASH_STYLE_HIDE)
  end
  module:LayoutBlock(block)
end

function T.layoutSafe(module)
  local ok, err = pcall(T.layout, module)
  if not ok and not T.errored then
    T.errored = true
    say("guide tracker error: " .. tostring(err))
  end
end

-- Header click: a menu (Next, Back, Pick guide, Hide); without MenuUtil, left is Next and right is Back.
function T.click(button)
  local menu = MenuUtil
  if type(menu) == "table" and type(menu.CreateContextMenu) == "function" then
    local ok = pcall(menu.CreateContextMenu, T.module, function(_, root)
      root:CreateTitle("Forever Ledger guide")
      root:CreateButton("Next step", function() G.go(1); G.sync() end)
      root:CreateButton("Back", function() G.go(-1); G.sync() end)
      local mine = G.myGuides()
      if #mine > 1 then
        local pick = root:CreateButton("Pick guide")
        for i, g in ipairs(mine) do pick:CreateButton(G.esc(g.title), function() G.slash("use " .. i) end) end
      end
      root:CreateButton("Hide guide", function() G.hide() end)
    end)
    if ok then return end
  end
  G.go(button == "RightButton" and -1 or 1)
  G.sync()
end

-- Makes the module and puts it in ObjectiveTrackerFrame; false (and the window is used) when it can't. Before the
-- manager's Init (PLAYER_ENTERING_WORLD) SetModuleContainer does nothing: that waits for the next sync.
function T.attach()
  if T.module then return T.active() end
  local s = G.state()
  if T.failed or s.trackerOff or s.trackerBlocked == build() then return false end
  local manager, container, base = ObjectiveTrackerManager, ObjectiveTrackerFrame, ObjectiveTrackerModuleMixin
  if type(manager) ~= "table" or type(container) ~= "table" or type(manager.SetModuleContainer) ~= "function" then
    T.failed = true
    return false
  end
  if type(manager.containers) == "table" and not manager.containers[container] then return false end
  local m = T.frame
  if not m then
    local ok, f = pcall(CreateFrame, "Frame", "ForeverLedgerGuideTracker", UIParent, "ObjectiveTrackerModuleTemplate")
    if not ok or type(f) ~= "table" then
      T.failed = true
      return false
    end
    m, T.frame = f, f
  end
  -- The template mixes ObjectiveTrackerModuleMixin in and its OnLoad sets usedBlocks. This is mainly for a client
  -- whose template lacks the mixin: copy it in and do what OnLoad would have.
  if rawget(m, "GetBlock") == nil and type(base) == "table" then
    for k, v in pairs(base) do
      if rawget(m, k) == nil then m[k] = v end
    end
    if rawget(m, "usedBlocks") == nil then m.usedBlocks = {} end
  end
  -- Blizzard's run 1 (Scenario), 2 (UI widgets), 3 (Campaign), 4 (Quests) ... 11: dungeon objectives stay on top.
  m.uiOrder = 2.5
  m.headerText = "Guide"
  pcall(m.SetHeader, m, "Guide")
  m.LayoutContents = T.layoutSafe
  m.OnBlockHeaderClick = function(_, _, button) T.click(button) end
  local ok = pcall(manager.SetModuleContainer, manager, m, container)
  local getContainer = manager.GetContainerForModule
  if ok and type(getContainer) == "function" then
    local got, placed = pcall(getContainer, manager, m)
    ok = got and placed == container
  end
  if not ok then
    T.failed = true
    return false
  end
  T.module = m
  return true
end

-- Out of combat only (G.sync): redraw, or take the module out once it was blocked or turned off. Once out it stays
-- out until a /reload.
function T.refresh()
  local m = T.module
  if not m or T.removed then return end
  if outOfTracker() then
    T.removed = true
    pcall(function()
      ObjectiveTrackerFrame:RemoveModule(m)
      m:Hide()
    end)
    return
  end
  pcall(m.MarkDirty, m)
end

-- ADDON_ACTION_BLOCKED naming us: the window takes over at once (it is our own frame); the module leaves the
-- tracker on the next out-of-combat sync. Our AddModule left the tracker's tables tainted, so quest items can stay
-- blocked until a /reload; the block is remembered for this build so the next session doesn't try again.
function T.onBlocked(func)
  if not T.module or T.blocked then return end
  T.blocked = true
  G.state().trackerBlocked = build()
  local later = InCombatLockdown and InCombatLockdown() and " (it leaves the quest tracker after combat)" or ""
  say("the game blocked an action (" .. tostring(func) .. ") while the guide was in the quest tracker: the guide "
    .. "moves to its own window" .. later .. ". Quest items may stay blocked until you /reload. "
    .. "/fl guide tracker on tries the tracker again after a /reload.")
end
