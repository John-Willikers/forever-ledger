-- Forever Ledger guide arrow: a TomTom-style arrow to the guide step's spot, with yards left. It only reads the
-- player's map position and facing (probe 0.5.0: GetPlayerFacing and C_Map.GetMapWorldSize work in the open world);
-- it is our own frame, so it keeps working in combat. Drag it to move it.
local G = ForeverLedgerGuide
if not G then return end
local A = {}
G.arrow = A

local ARRIVED = 10   -- yards
local EVERY = 0.05   -- seconds between updates
local TWO_PI = math.pi * 2
local ARROW_TEXTURE = "Interface\\Minimap\\MiniMap-QuestArrow"
local DONE_TEXTURE = "Interface\\RaidFrame\\ReadyCheck-Ready"

local function call(fn, ...)
  if type(fn) ~= "function" then return nil end
  local ok, a, b = pcall(fn, ...)
  if ok then return a, b end
end

-- Where the arrow points and how far. Map x/y are 0..1 and grow east and south; target x/y are the guide's 0..100.
-- Facing is radians counter-clockwise from north (GetPlayerFacing), and so is the returned rotation.
function A.compute(target, me)
  if not target or not target.mapId or not tonumber(target.x) or not tonumber(target.y) then
    return { state = "none" }
  end
  if not me or not me.mapId or not me.x then return { state = "none" } end
  if me.mapId ~= target.mapId then return { state = "elsewhere" } end
  if not me.width or not me.height or not me.facing then return { state = "none" } end
  local dx = (target.x / 100 - me.x) * me.width
  local dy = (target.y / 100 - me.y) * me.height
  local yards = math.sqrt(dx * dx + dy * dy)
  if yards <= ARRIVED then return { state = "arrived", yards = yards } end
  return { state = "point", yards = yards, rotation = (math.atan2(-dx, -dy) - me.facing) % TWO_PI }
end

-- The player's map, position, the map's size in yards and facing (nil in an instance, where it is restricted).
function A.player()
  local map = C_Map
  if not map then return nil end
  local mapId = call(map.GetBestMapForUnit, "player")
  if not mapId then return nil end
  local pos = call(map.GetPlayerMapPosition, mapId, "player")
  if type(pos) ~= "table" or type(pos.GetXY) ~= "function" then return nil end
  local x, y = pos:GetXY()
  if not x or not y then return nil end
  local w, h = call(map.GetMapWorldSize, mapId)
  local inInstance = IsInInstance and IsInInstance()
  return { mapId = mapId, x = x, y = y, width = tonumber(w), height = tonumber(h),
           facing = not inInstance and tonumber(call(GetPlayerFacing)) or nil }
end

local function label(step)
  local q = step.quests and step.quests[1]
  return G.esc(step.npc or (q and q.title) or "")
end

function A.frame()
  if A.win then return A.win end
  local f = CreateFrame("Frame", "ForeverLedgerGuideArrow", UIParent)
  f:SetSize(56, 76)
  local p = G.state().arrowPoint
  if type(p) == "table" and p[1] then
    f:SetPoint(p[1], UIParent, p[2] or p[1], p[3] or 0, p[4] or 0)
  else
    f:SetPoint("TOP", UIParent, "TOP", 0, -120)
  end
  f:SetClampedToScreen(true)
  f:SetMovable(true)
  f:EnableMouse(true)
  f:RegisterForDrag("LeftButton")
  f:SetScript("OnDragStart", function(self) self:StartMoving() end)
  f:SetScript("OnDragStop", function(self)
    self:StopMovingOrSizing()
    local point, _, relPoint, x, y = self:GetPoint(1)
    G.state().arrowPoint = { point, relPoint, x, y }
  end)
  f.icon = f:CreateTexture(nil, "ARTWORK")
  f.icon:SetSize(42, 42)
  f.icon:SetPoint("TOP")
  f.dist = f:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  f.dist:SetPoint("TOP", f.icon, "BOTTOM", 0, -2)
  f.label = f:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
  f.label:SetPoint("TOP", f.dist, "BOTTOM", 0, -1)
  f.label:SetWidth(200)
  local since = 0
  f:SetScript("OnUpdate", function(_, elapsed)
    since = since + (elapsed or 0)
    if since >= EVERY then
      since = 0
      A.tick()
    end
  end)
  A.win = f
  return f
end

-- Shows the arrow for a step with a spot; hides it for none.
function A.setTarget(step)
  A.target = step and step.mapId and tonumber(step.x) and tonumber(step.y) and step or nil
  if not A.target then
    if A.win then A.win:Hide() end
    return
  end
  A.frame():Show()
  A.tick()
end

function A.tick()
  local f, t = A.win, A.target
  if not f or not t then return end
  local r = A.compute(t, A.player())
  A.last = r
  f.label:SetText(label(t))
  if r.state == "point" then
    f.icon:SetTexture(ARROW_TEXTURE)
    f.icon:SetRotation(r.rotation)
    f.icon:Show()
    f.dist:SetText(string.format("%d yd", math.floor(r.yards + 0.5)))
  elseif r.state == "arrived" then
    f.icon:SetTexture(DONE_TEXTURE)
    f.icon:SetRotation(0)
    f.icon:Show()
    f.dist:SetText("Arrived")
  elseif r.state == "elsewhere" then
    f.icon:Hide()
    f.dist:SetText("Go to " .. G.esc(t.zone or "the step's zone"))
  else
    f.icon:Hide()
    f.dist:SetText("")
    f.label:SetText("")
  end
end
