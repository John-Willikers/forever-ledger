-- Forever Ledger test harness (Lua 5.1).
-- Builds a fake WoW global environment driven by a mutable `world` table, loads addon files into it,
-- and lets tests fire events. Nothing here talks to a real client.

local H = {}

local function copy(t)
  if type(t) ~= "table" then return t end
  local c = {}
  for k, v in pairs(t) do c[k] = copy(v) end
  return c
end
H.copy = copy

local function default_world()
  return {
    clock = 1790000000,
    buildInfo = { "1.15.7", "61582", "Sep 18 2026", 11507 },
    player = { name = "Thibodeaux", realm = "Bayou", class = "HUNTER", race = "Human", faction = "Alliance",
               level = 10, xp = 0, xpMax = 7600, guid = "Player-1-0000AAAA" },
    zone = { zone = "Elwynn Forest", subzone = "Goldshire", mapID = 1429, x = 0.421, y = 0.659 },
    instance = nil,        -- { name=, type="party", difficulty=1, maxPlayers=5, instanceID= }
    party = {},            -- { { class=, level=, name= }, ... } party1..4
    raid = nil,            -- { { class=, name= }, ... } raid1..40 when set
    npc = nil,             -- { name=, guid= }
    questFrame = nil,      -- { questID=, title=, xp=, money=, choices={ {id=, count=} }, rewards={...} }
    questLog = {},         -- { { title=, level=, suggestedGroup=, isHeader=, questID=, objectives={...},
                           --     choices={ id, ... }, money= } }
    items = {},            -- [itemID] = { name=, quality=, ilvl=, reqLevel=, type=, subtype=, equipLoc=,
                           --              sellPrice=, stats={}, tooltip={ {l, r}, ... }, cached=true|false }
    loot = {},             -- { { itemID=, sourceGUID=, quantity=, money=<copper>, sources={ guid, qty, ... } } }
    money = 0,             -- GetMoney()
    lootMethod = nil,      -- C_PartyInfo.GetLootMethod() (an Enum.LootMethod value)
    lootHistory = {},      -- [encounterID] = { EncounterLootDropInfo, ... } for C_LootHistory
    globalStrings = nil,   -- [name] = template overriding the enUS loot GlobalStrings below
    rng = 0,               -- math.random calls so far (deterministic)
    api = "classic",       -- "forever": swap Classic globals for the namespaces the Forever 1.60 client has
    missing = {},          -- [globalName] = true to simulate an API the client lacks
    rejectEvents = {},     -- [event] = true to make RegisterEvent throw for it
    addons = {},           -- [name] = function(env) run when LoadAddOn(name) is called
    loadedAddons = {},     -- [name] = true for C_AddOns.IsAddOnLoaded
    printed = {},
    chatFrame = {},        -- lines sent to DEFAULT_CHAT_FRAME:AddMessage
    inCombat = false,      -- InCombatLockdown() / UnitAffectingCombat("player")
    logging = { chat = false, combat = false },
    loggingCalls = {},     -- { { name=, arg= } } every LoggingChat/LoggingCombat call
    loggingErrors = {},    -- [name] = message to make LoggingChat/LoggingCombat throw
    cvars = { advancedCombatLogging = "0" },
    combatLogRestricted = true,
    reloads = 0,           -- ReloadUI() calls
    reloadBlocked = nil,   -- message: ReloadUI() throws it instead of "reloading"
    secureMacros = {},     -- macrotext run by clicked SecureActionButtonTemplate buttons
    rejectTemplates = {},  -- [template] = true to make CreateFrame throw for it
    questRewardCalls = {}, -- index passed to every GetQuestReward call
    questLoadRequests = {}, -- questID of every C_QuestLog.RequestLoadQuestByID call
  }
end

local function itemLink(id, it)
  local colors = { [0] = "ff9d9d9d", "ffffffff", "ff1eff00", "ff0070dd", "ffa335ee", "ffff8000" }
  return "|c" .. (colors[it.quality or 1] or "ffffffff") .. "|Hitem:" .. id .. "::::::::" .. "|h[" ..
    it.name .. "]|h|r"
end
H.itemLink = itemLink

-- Returns a new environment table with all WoW stubs plus a controller.
function H.new(worldOverrides)
  local world = default_world()
  for k, v in pairs(worldOverrides or {}) do world[k] = v end

  local env = {}
  setmetatable(env, { __index = _G })
  env._G = env
  local frames = {}

  local function linkID(link) return link and tonumber(link:match("item:(%d+)")) end

  -- Lua helpers WoW adds
  env.wipe = function(t) for k in pairs(t) do t[k] = nil end return t end
  env.floor = math.floor
  env.format = string.format
  env.strsplit = function(sep, s)
    local out, i = {}, 1
    for part in (s .. sep):gmatch("(.-)" .. sep:gsub("%p", "%%%0")) do out[i] = part; i = i + 1 end
    return unpack(out)
  end
  env.time = function() return math.floor(world.clock) end -- whole seconds, like the client
  env.date = os.date
  env.print = function(...)
    local parts = {}
    for i = 1, select("#", ...) do parts[#parts + 1] = tostring((select(i, ...))) end
    world.printed[#world.printed + 1] = table.concat(parts, " ")
  end
  env.SlashCmdList = {}
  -- deterministic math.random so fixtures are stable
  env.math = setmetatable({
    random = function(a, b)
      world.rng = world.rng + 1
      if not a then return (world.rng % 1000) / 1000 end
      if not b then a, b = 1, a end
      return a + (world.rng * 40503) % (b - a + 1)
    end,
  }, { __index = math })
  -- hooksecurefunc([table,] name, hook): the hook runs after the original with the same arguments.
  env.hooksecurefunc = function(a, b, c)
    local tbl, name, hook = a, b, c
    if type(a) == "string" then tbl, name, hook = env, a, b end
    local orig = assert(tbl[name], "hooksecurefunc: no function " .. tostring(name))
    tbl[name] = function(...)
      local r = { orig(...) }
      hook(...)
      return unpack(r)
    end
  end

  -- frames
  env.WorldFrame, env.UIParent = {}, {}
  env.CreateFrame = function(kind, name, _, template)
    for t in pairs(world.rejectTemplates) do
      if template and template:find(t, 1, true) then error("Couldn't find inherited node \"" .. t .. "\"") end
    end
    local f = { kind = kind, template = template, events = {}, scripts = {}, lines = {} }
    function f:RegisterEvent(ev)
      if world.rejectEvents[ev] then error("Attempt to register unknown event \"" .. ev .. "\"") end
      self.events[ev] = true
    end
    function f:UnregisterEvent(ev) self.events[ev] = nil end
    function f:RegisterAllEvents() self.allEvents = true end
    function f:UnregisterAllEvents() self.allEvents = nil; self.events = {} end
    function f:SetScript(what, fn) self.scripts[what] = fn end
    if kind == "GameTooltip" then
      function f:SetOwner() end
      function f:ClearLines() self.lines = {} end
      function f:SetHyperlink(link)
        local it = world.items[linkID(link)]
        self.lines = it and it.tooltip or {}
        for i = 1, 30 do
          local l, r = self.lines[i] and self.lines[i][1], self.lines[i] and self.lines[i][2]
          env[name .. "TextLeft" .. i] = { GetText = function() return l end }
          env[name .. "TextRight" .. i] = { GetText = function() return r end }
        end
      end
      function f:NumLines() return #self.lines end
    end
    if kind == "Button" then
      f.attributes, f.shown = {}, true
      function f:SetAttribute(k, v) self.attributes[k] = v end
      function f:GetAttribute(k) return self.attributes[k] end
      function f:SetText(t) self.text = t end
      function f:SetSize(w, h) self.size = { w, h } end
      function f:SetPoint() end
      function f:SetMovable(v) self.movable = v end
      function f:SetClampedToScreen() end
      function f:EnableMouse() end
      function f:RegisterForDrag(...) self.dragButtons = { ... } end
      function f:RegisterForClicks(...) self.clickButtons = { ... } end
      function f:StartMoving() end
      function f:StopMovingOrSizing() end
      function f:Show() self.shown = true end
      function f:Hide() self.shown = false end
      function f:IsShown() return self.shown end
      -- A user click: PreClick, then the secure action for secure macro buttons, then OnClick.
      function f:Click(button)
        button = button or "LeftButton"
        if self.scripts.PreClick then self.scripts.PreClick(self, button, false) end
        if (self.template or ""):find("SecureActionButtonTemplate", 1, true) and self.attributes.type == "macro" then
          world.secureMacros[#world.secureMacros + 1] = self.attributes.macrotext
        end
        if self.scripts.OnClick then self.scripts.OnClick(self, button, false) end
      end
    end
    if name then env[name] = f end
    frames[#frames + 1] = f
    return f
  end

  -- client
  env.GetBuildInfo = function() return unpack(world.buildInfo) end
  env.GetRealmName = function() return world.player.realm end
  env.GetCVar = function(name) return world.cvars[name] end
  env.InCombatLockdown = function() return world.inCombat end
  env.UnitAffectingCombat = function(u) return u == "player" and world.inCombat or false end
  env.DEFAULT_CHAT_FRAME = { AddMessage = function(_, text) world.chatFrame[#world.chatFrame + 1] = text end }
  env.ReloadUI = function()
    world.reloads = world.reloads + 1
    if world.reloadBlocked then error(world.reloadBlocked) end
  end

  -- chat / combat log files: LoggingX(nil) queries, LoggingX(bool) sets; both return the current state
  local function loggingFn(name, key)
    return function(newState)
      world.loggingCalls[#world.loggingCalls + 1] = { name = name, arg = newState }
      if world.loggingErrors[name] then error(world.loggingErrors[name]) end
      if newState ~= nil then world.logging[key] = newState and true or false end
      return world.logging[key]
    end
  end
  env.LoggingChat = loggingFn("LoggingChat", "chat")
  env.LoggingCombat = loggingFn("LoggingCombat", "combat")
  env.C_ChatInfo = {
    IsLoggingChat = function() return world.logging.chat end,
    IsLoggingCombat = function() return world.logging.combat end,
  }
  env.C_CombatLog = { IsCombatLogRestricted = function() return world.combatLogRestricted end }

  -- units
  local function groupUnit(u)
    local i = tonumber((u or ""):match("^party(%d)$"))
    if i then return world.party[i] end
    i = tonumber((u or ""):match("^raid(%d+)$"))
    if i and world.raid then return world.raid[i] end
  end
  env.UnitName = function(u)
    if u == "player" then return world.player.name end
    if u == "npc" and world.npc then return world.npc.name end
    local m = groupUnit(u)
    if m and m.name then return m.name, m.realm end
  end
  env.UnitGUID = function(u)
    if u == "player" then return world.player.guid end
    if u == "npc" and world.npc then return world.npc.guid end
  end
  env.UnitLevel = function(u)
    if u == "player" then return world.player.level end
    local i = tonumber((u or ""):match("party(%d)"))
    return i and world.party[i] and world.party[i].level or 0
  end
  env.UnitClass = function(u)
    if u == "player" then return "Hunter", world.player.class end
    local m = groupUnit(u)
    if m then return m.class, m.class end
  end
  env.UnitRace = function() return world.player.race, world.player.race end
  env.UnitFactionGroup = function() return world.player.faction end
  env.UnitExists = function(u)
    local i = tonumber((u or ""):match("party(%d)"))
    return i ~= nil and world.party[i] ~= nil
  end
  env.IsInGroup = function() return #world.party > 0 or (world.raid ~= nil and #world.raid > 0) end
  env.GetNumGroupMembers = function()
    if world.raid then return #world.raid end
    return #world.party > 0 and #world.party + 1 or 0
  end
  env.UnitXP = function() return world.player.xp end
  env.UnitXPMax = function() return world.player.xpMax end

  -- zone / instance
  env.GetRealZoneText = function() return world.instance and world.instance.name or world.zone.zone end
  env.GetSubZoneText = function() return world.zone.subzone end
  env.C_Map = {
    GetBestMapForUnit = function() return world.zone.mapID end,
    GetPlayerMapPosition = function()
      return { GetXY = function() return world.zone.x, world.zone.y end }
    end,
  }
  env.IsInInstance = function()
    if world.instance then return true, world.instance.type end
    return false, "none"
  end
  env.GetInstanceInfo = function()
    local i = world.instance
    if not i then return world.zone.zone, "none", 0, "", 0, 0, false, 0 end
    return i.name, i.type, i.difficulty, "Normal", i.maxPlayers, 0, false, i.instanceID
  end

  -- quest frame
  local function qf() return world.questFrame or {} end
  env.GetQuestID = function() return qf().questID or 0 end
  env.GetTitleText = function() return qf().title end
  env.GetRewardXP = function() return qf().xp or 0 end
  env.GetRewardMoney = function() return qf().money or 0 end
  env.GetNumQuestChoices = function() return #(qf().choices or {}) end
  env.GetNumQuestRewards = function() return #(qf().rewards or {}) end
  env.GetQuestItemLink = function(kind, i)
    local list = kind == "choice" and qf().choices or qf().rewards
    local r = list and list[i]
    return r and world.items[r.id] and itemLink(r.id, world.items[r.id]) or (r and ("|Hitem:" .. r.id .. "|h[?]|h"))
  end
  -- Clicking Complete in the reward window; the Blizzard quest frame passes the selected choice (0 if none).
  env.GetQuestReward = function(index) world.questRewardCalls[#world.questRewardCalls + 1] = index end
  env.GetQuestItemInfo = function(kind, i)
    local list = kind == "choice" and qf().choices or qf().rewards
    local r = list and list[i]
    if r then return (world.items[r.id] or {}).name, nil, r.count or 1 end
  end

  -- quest log
  local selected = 0
  env.GetNumQuestLogEntries = function() return #world.questLog end
  env.GetQuestLogTitle = function(i)
    local e = world.questLog[i]
    if not e then return nil end
    return e.title, e.level, e.suggestedGroup or 0, e.isHeader or false, false, false, false, e.questID
  end
  env.GetNumQuestLeaderBoards = function(i) return #((world.questLog[i] or {}).objectives or {}) end
  env.GetQuestLogLeaderBoard = function(j, i) return world.questLog[i].objectives[j], "monster", false end
  env.GetQuestLogSelection = function() return selected end
  env.SelectQuestLogEntry = function(i) selected = i end
  env.GetNumQuestLogChoices = function() return #((world.questLog[selected] or {}).choices or {}) end
  env.GetQuestLogItemLink = function(_, c)
    local id = world.questLog[selected].choices[c]
    return world.items[id] and itemLink(id, world.items[id]) or ("|Hitem:" .. id .. "|h[?]|h")
  end
  env.GetQuestLogRewardMoney = function() return (world.questLog[selected] or {}).money or 0 end

  -- items
  env.GetItemInfo = function(x)
    local id = type(x) == "number" and x or linkID(x)
    local it = world.items[id]
    if not it or it.cached == false then return nil end
    return it.name, itemLink(id, it), it.quality, it.ilvl, it.reqLevel, it.type, it.subtype, 1, it.equipLoc,
      nil, it.sellPrice, it.classID, it.subclassID
  end
  env.GetItemStats = function(link)
    local it = world.items[linkID(link)]
    return it and copy(it.stats) or {}
  end

  -- loot
  env.GetNumLootItems = function() return #world.loot end
  env.GetLootSlotLink = function(i)
    local l = world.loot[i]
    return l and world.items[l.itemID] and itemLink(l.itemID, world.items[l.itemID])
  end
  -- guid1, qty1, guid2, qty2, ...: qty is the stack from that source, or copper for a money slot
  env.GetLootSourceInfo = function(i)
    local l = world.loot[i]
    if not l then return nil end
    if l.sources then return unpack(l.sources) end
    return l.sourceGUID, l.money or l.quantity or 1
  end
  env.GetLootSlotType = function(i)
    local l = world.loot[i]
    if not l then return 0 end
    return l.money and 2 or 1
  end
  env.GetLootSlotInfo = function(i)
    local l = world.loot[i]
    if not l then return nil end
    if l.money then return 133784, l.money .. " Copper", 0, nil, 0, false, false, nil, true end
    local it = world.items[l.itemID] or {}
    return 134939, it.name, l.quantity or 1, nil, it.quality or 1, false, false, nil, true
  end
  env.GetMoney = function() return world.money end
  env.Enum = {
    LootSlotType = { None = 0, Item = 1, Money = 2, Currency = 3 },
    LootMethod = { Freeforall = 0, Roundrobin = 1, Masterlooter = 2, Group = 3, Needbeforegreed = 4, Personal = 5 },
    EncounterLootDropRollState = { NeedMainSpec = 0, NeedOffSpec = 1, Transmog = 2, Greed = 3, NoRoll = 4, Pass = 5 },
  }
  env.C_PartyInfo = { GetLootMethod = function() return world.lootMethod end }
  env.C_LootHistory = {
    GetSortedDropsForEncounter = function(encounterID)
      local drops = world.lootHistory[encounterID]
      return drops and copy(drops) or nil
    end,
    GetSortedInfoForDrop = function(encounterID, lootListKey)
      for _, d in ipairs(world.lootHistory[encounterID] or {}) do
        if d.lootListKey == lootListKey then return copy(d) end
      end
    end,
  }
  -- enUS loot GlobalStrings (FrameXML GlobalStrings.lua)
  local strings = {
    LOOT_ITEM = "%s receives loot: %s.", LOOT_ITEM_MULTIPLE = "%s receives loot: %sx%d.",
    LOOT_ITEM_SELF = "You receive loot: %s.", LOOT_ITEM_SELF_MULTIPLE = "You receive loot: %sx%d.",
    LOOT_ROLL_WON = "%s won: %s", LOOT_ROLL_YOU_WON = "You won: %s",
  }
  for k, v in pairs(world.globalStrings or {}) do strings[k] = v end
  for k, v in pairs(strings) do env[k] = v end

  -- professions
  local function installProfessionAPI()
    -- World fields (retail-style API of Forever 1.60; field names as the retail docs have them). The stubs only
    -- exist with world.professionAPI = true, so the probe's global census (probe-dump fixture) stays as it was.
    local defaults = {
      skillLines = {},       -- C_SkillInfo lines: { skillID=, name=, isHeader=, rank=, maxRank=, modifier=,
                             --   parentSkillLineID=, skillLineCategoryID= }
      -- professions = nil:  GetProfessions() indices -> { name=, rank=, maxRank=, skillLine=, modifier= }
      -- tradeSkill = nil:   the profession window's data: { base=ProfessionInfo, child=ProfessionInfo,
      --                     ids={ recipeID, ... }, recipes={ [id]={ info=, schematic=, sourceText=, profession= } },
      --                     linked=, guild=, npcCrafting=, changing= }
      calls = {},            -- [api] = number of calls of the profession/trainer/vendor stubs
      timers = {},           -- pending C_Timer.After callbacks { at=, fn= }; ctl.advance runs the due ones
      -- bags = nil:         [bag][slot] = itemID; when set, C_Container exists
      -- casting = nil:      UnitCastingInfo("player") returns, as a list
      spells = {},           -- [spellID] = { name= } for C_Spell.GetSpellInfo
      fishing = false,       -- IsFishingLoot()
      tooltip = { shown = false }, -- GameTooltip: { shown=, owner="UIParent"|<other>, text=, unit=, item=, spell= }
      -- trainer = nil:      { tradeskill=true, filters={ available=, unavailable=, used= }, services={ { name=,
      --                     sub=, type=, cost=, skill=, skillRank=, level=, itemID=, skillLine=, expanded= } } }
      -- merchant = nil:     { items={ { itemID=, info=MerchantItemInfo } } }
    }
    for k, v in pairs(defaults) do
      if world[k] == nil then world[k] = v end
    end
    env.Enum.TradeskillRelativeDifficulty = { Optimal = 0, Medium = 1, Easy = 2, Trivial = 3 }
    env.Enum.CraftingReagentType = { Modifying = 0, Basic = 1, Finishing = 2, Automatic = 3 }
    env.Enum.ItemClass = { Consumable = 0, Container = 1, Weapon = 2, Armor = 4, Reagent = 5, Tradegoods = 7,
                           Recipe = 9 }
    env.LOOT_ITEM_CREATED_SELF = (world.globalStrings or {}).LOOT_ITEM_CREATED_SELF or "You create: %s."
    env.LOOT_ITEM_CREATED_SELF_MULTIPLE = (world.globalStrings or {}).LOOT_ITEM_CREATED_SELF_MULTIPLE
      or "You create: %sx%d."
    local function called(api) world.calls[api] = (world.calls[api] or 0) + 1 end
    env.C_Timer = {
      After = function(secs, fn) world.timers[#world.timers + 1] = { at = world.clock + secs, fn = fn } end,
    }
    env.GetTime = function() return world.clock end -- fractional seconds
    env.C_SkillInfo = {
      GetNumSkillLines = function() return #world.skillLines end,
      GetSkillLineInfo = function(i) return copy(world.skillLines[i]) end,
    }
    if world.professions then
      env.GetProfessions = function()
        local idx = {}
        for i = 1, #world.professions do idx[i] = i end
        return unpack(idx)
      end
      env.GetProfessionInfo = function(i)
        local p = world.professions[i]
        return p.name, 136240, p.rank, p.maxRank, 10, 0, p.skillLine, p.modifier or 0, 0, 0
      end
    end
    local function trade() return world.tradeSkill or {} end
    local function recipe(id) return (trade().recipes or {})[id] end
    env.C_TradeSkillUI = {
      GetAllRecipeIDs = function() called("GetAllRecipeIDs"); return copy(trade().ids or {}) end,
      GetRecipeInfo = function(id)
        called("GetRecipeInfo")
        return recipe(id) and copy(recipe(id).info)
      end,
      GetRecipeSchematic = function(id, isRecraft)
        called("GetRecipeSchematic")
        assert(isRecraft == false, "GetRecipeSchematic(recipeID, false)")
        return recipe(id) and copy(recipe(id).schematic)
      end,
      GetRecipeSourceText = function(id) return recipe(id) and recipe(id).sourceText end,
      GetBaseProfessionInfo = function()
        called("GetBaseProfessionInfo")
        return copy(trade().base)
      end,
      GetChildProfessionInfo = function() return copy(trade().child) end,
      GetProfessionInfoByRecipeID = function(id)
        called("GetProfessionInfoByRecipeID")
        return copy(recipe(id) and recipe(id).profession or trade().base)
      end,
      IsTradeSkillLinked = function() return trade().linked or false end,
      IsTradeSkillGuild = function() return trade().guild or false end,
      IsNPCCrafting = function() return trade().npcCrafting or false end,
      IsDataSourceChanging = function() return trade().changing or false end,
    }
    if world.bags then
      env.C_Container = {
        GetContainerItemID = function(bag, slot) return (world.bags[bag] or {})[slot] end,
        UseContainerItem = function(bag, slot) world.usedItem = { bag, slot } end,
      }
    end
    env.UnitCastingInfo = function(u) if u == "player" and world.casting then return unpack(world.casting) end end
    env.C_Spell = { GetSpellInfo = function(id) return copy(world.spells[id]) end }
    -- GetItemSpell(item): the item's use spell (world.items[id].useSpell = spellID), as spellName, spellID
    env.GetItemSpell = function(x)
      local id = type(x) == "number" and x or linkID(x)
      local it = world.items[id]
      if it and it.useSpell then return (world.spells[it.useSpell] or {}).name or "Learning", it.useSpell end
    end
    env.IsFishingLoot = function() return world.fishing end
    env.GameTooltip = {
      IsShown = function() return world.tooltip.shown end,
      GetOwner = function() return world.tooltip.owner == "UIParent" and env.UIParent or world.tooltip.owner end,
      GetUnit = function() return world.tooltip.unit end,
      GetItem = function() return world.tooltip.item end,
      GetSpell = function() return world.tooltip.spell end,
    }
    env.GameTooltipTextLeft1 = { GetText = function() return world.tooltip.text end }
    -- trainer window (GetTrainerServiceInfo: name, subText, serviceType, isExpanded)
    local function service(i) return ((world.trainer or {}).services or {})[i] end
    env.IsTradeskillTrainer = function() return world.trainer and world.trainer.tradeskill or false end
    env.GetNumTrainerServices = function()
      called("GetNumTrainerServices")
      return #((world.trainer or {}).services or {})
    end
    env.GetTrainerServiceInfo = function(i)
      local s = service(i)
      if s then return s.name, s.sub or "", s.type or "available", s.type == "header" and s.expanded ~= false end
    end
    -- world.trainer.filters = { available=, unavailable=, used= }: false hides that type (default: all shown)
    env.GetTrainerServiceTypeFilter = function(kind)
      called("GetTrainerServiceTypeFilter")
      return ((world.trainer or {}).filters or {})[kind] ~= false
    end
    env.GetTrainerServiceCost = function(i) local s = service(i); return s and s.cost or 0, false end
    env.GetTrainerServiceSkillReq = function(i)
      local s = service(i)
      if s and s.skill then return s.skill, s.skillRank, true end
    end
    env.GetTrainerServiceLevelReq = function(i) local s = service(i); return s and s.level or 0 end
    env.GetTrainerServiceSkillLine = function(i) local s = service(i); return s and s.skillLine end
    env.GetTrainerServiceItemLink = function(i)
      local s = service(i)
      return s and s.itemID and world.items[s.itemID] and itemLink(s.itemID, world.items[s.itemID]) or nil
    end
    -- merchant window
    local function stock(i) return ((world.merchant or {}).items or {})[i] end
    env.GetMerchantNumItems = function()
      called("GetMerchantNumItems")
      return #((world.merchant or {}).items or {})
    end
    env.GetMerchantItemID = function(i) local m = stock(i); return m and m.itemID end
    env.GetMerchantItemLink = function(i)
      local m = stock(i)
      return m and world.items[m.itemID] and itemLink(m.itemID, world.items[m.itemID]) or nil
    end
    env.C_MerchantFrame = { GetItemInfo = function(i) local m = stock(i); return m and copy(m.info) end }
  end
  if world.professionAPI then installProfessionAPI() end

  -- addons
  env.LoadAddOn = function(name)
    local fn = world.addons[name]
    if not fn then return false, "MISSING" end
    fn(env)
    return true
  end
  env.C_AddOns = { LoadAddOn = env.LoadAddOn,
                   IsAddOnLoaded = function(name) return world.loadedAddons[name] or false end }

  -- World of Warcraft: Forever 1.60 (probe dump of build 69913) has no Classic quest-log globals and no
  -- global GetItemInfo/GetItemStats; it has the C_QuestLog / C_Item namespaces instead.
  if world.api == "forever" then
    env.C_QuestLog = {
      GetNumQuestLogEntries = env.GetNumQuestLogEntries,
      GetInfo = function(i)
        local e = world.questLog[i]
        if not e then return nil end
        return { title = e.title, level = e.level or 0, suggestedGroup = e.suggestedGroup or 0,
                 isHeader = e.isHeader or false, questID = e.questID or 0, questLogIndex = i }
      end,
      GetSelectedQuest = function() return (world.questLog[selected] or {}).questID or 0 end,
      SetSelectedQuest = function(questID)
        for i, e in ipairs(world.questLog) do
          if e.questID == questID then selected = i end
        end
      end,
      GetQuestObjectives = function(questID)
        for _, e in ipairs(world.questLog) do
          if e.questID == questID and not e.isHeader then
            local out = {}
            for j, text in ipairs(e.objectives or {}) do
              local have, need = text:match("(%d+)/(%d+)")
              out[j] = { text = text, type = "item", finished = false, numFulfilled = tonumber(have) or 0,
                         numRequired = tonumber(need) or 1 }
            end
            return out
          end
        end
        return {}
      end,
      RequestLoadQuestByID = function(questID)
        world.questLoadRequests[#world.questLoadRequests + 1] = questID
      end,
    }
    env.C_Item = { GetItemInfo = env.GetItemInfo, GetItemStats = env.GetItemStats }
    if world.professionAPI then
      env.C_Item.GetItemSpell = env.GetItemSpell
      env.C_Item.GetItemInfoInstant = function(x)
        local id = type(x) == "number" and x or linkID(x)
        local it = world.items[id]
        if it then return id, it.type, it.subtype, it.equipLoc, 134939, it.classID, it.subclassID end
      end
    end
    for _, name in ipairs({ "GetNumQuestLogEntries", "GetQuestLogTitle", "GetQuestLogSelection",
                            "SelectQuestLogEntry", "GetItemInfo", "GetItemStats", "LoadAddOn" }) do
      world.missing[name] = true
    end
  end

  -- frame:RegisterUnitEvent(ev, unit, ...): the event only reaches the frame for those units (its first argument).
  -- world.noUnitEvents: a client without it. (Added here, not in CreateFrame above, so harness line numbers that the
  -- probe fixture records stay put.)
  if not world.noUnitEvents then
    local create = env.CreateFrame
    env.CreateFrame = function(...)
      local frame = create(...)
      frame.unitEvents = {}
      function frame:RegisterUnitEvent(ev, ...)
        self:RegisterEvent(ev)
        self.unitEvents[ev] = { ... }
      end
      return frame
    end
  end

  -- Simulate an API the client lacks. The real Lua _G behind __index has no WoW names, so nil is enough.
  for name in pairs(world.missing) do env[name] = nil end

  local ctl = { env = env, world = world, frames = frames }

  function ctl.load(path)
    local chunk = assert(loadfile(path))
    setfenv(chunk, env)
    chunk()
  end

  local function unitMatches(units, unit)
    if not units then return true end
    for _, u in ipairs(units) do
      if u == unit then return true end
    end
    return false
  end

  function ctl.fire(event, ...)
    for _, f in ipairs(frames) do
      local units = f.unitEvents and f.unitEvents[event]
      if (f.events[event] or f.allEvents) and f.scripts.OnEvent and unitMatches(units, (...)) then
        f.scripts.OnEvent(f, event, ...)
      end
    end
  end

  function ctl.slash(cmdKey, msg) env.SlashCmdList[cmdKey](msg or "") end
  -- Moves the clock and runs the C_Timer callbacks that are due, oldest first.
  function ctl.advance(secs)
    world.clock = world.clock + secs
    while true do
      local due
      for i, t in ipairs(world.timers or {}) do
        if t.at <= world.clock and (not due or t.at < world.timers[due].at) then due = i end
      end
      if not due then break end
      local t = table.remove(world.timers, due)
      t.fn()
    end
  end

  -- A CHAT_MSG_LOOT line built from the environment's GlobalStrings, as the client formats it.
  function ctl.lootLine(global, playerName, ...)
    ctl.fire("CHAT_MSG_LOOT", string.format(env[global], ...), playerName or "", "", "", playerName or "")
  end

  function ctl.gainXP(amount)
    local p = world.player
    p.xp = p.xp + amount
    while p.xp >= p.xpMax do
      p.xp = p.xp - p.xpMax
      p.level = p.level + 1
      p.xpMax = math.floor(p.xpMax * 1.15)
    end
    ctl.fire("PLAYER_XP_UPDATE", "player")
  end

  function ctl.login(addonName)
    ctl.fire("ADDON_LOADED", addonName)
    ctl.fire("PLAYER_LOGIN")
    ctl.fire("PLAYER_ENTERING_WORLD", true, false)
  end

  return ctl
end

---------------------------------------------------------------- WoW-style serializer
-- Mimics the client's SavedVariables writer closely enough for the parser fixtures:
-- tabs, ["key"] = value, trailing commas, `-- [n]` after array entries, numeric keys as [n].

local function sortedKeys(t)
  local keys = {}
  for k in pairs(t) do keys[#keys + 1] = k end
  table.sort(keys, function(a, b)
    local ta, tb = type(a), type(b)
    if ta ~= tb then return ta < tb end
    return a < b
  end)
  return keys
end

local function isArray(t)
  local n = #t
  if n == 0 then return false end
  local count = 0
  for _ in pairs(t) do count = count + 1 end
  return count == n
end

local function serializeValue(v, indent, out)
  local tv = type(v)
  if tv == "string" then
    out[#out + 1] = string.format("%q", v):gsub("\\\n", "\\n")
  elseif tv == "number" then
    if v == math.floor(v) and math.abs(v) < 2 ^ 53 then out[#out + 1] = string.format("%d", v)
    else out[#out + 1] = string.format("%.14g", v) end
  elseif tv == "boolean" then
    out[#out + 1] = tostring(v)
  elseif tv == "table" then
    out[#out + 1] = "{\n"
    local pad = string.rep("\t", indent + 1)
    if isArray(v) then
      for i = 1, #v do
        out[#out + 1] = pad
        serializeValue(v[i], indent + 1, out)
        out[#out + 1] = ", -- [" .. i .. "]\n"
      end
    else
      for _, k in ipairs(sortedKeys(v)) do
        out[#out + 1] = pad .. "["
        if type(k) == "string" then out[#out + 1] = string.format("%q", k) else out[#out + 1] = tostring(k) end
        out[#out + 1] = "] = "
        serializeValue(v[k], indent + 1, out)
        out[#out + 1] = ",\n"
      end
    end
    out[#out + 1] = string.rep("\t", indent) .. "}"
  else
    error("cannot serialize " .. tv)
  end
end

function H.serialize(name, value)
  local out = { "\n", name, " = " }
  serializeValue(value, 0, out)
  out[#out + 1] = "\n"
  return table.concat(out)
end

function H.writeFile(path, text)
  local f = assert(io.open(path, "wb"))
  f:write(text)
  f:close()
end

---------------------------------------------------------------- tiny test framework
local results = { passed = 0, failed = 0, failures = {} }
H.results = results

function H.test(name, fn)
  local ok, err = xpcall(fn, debug.traceback)
  if ok then
    results.passed = results.passed + 1
  else
    results.failed = results.failed + 1
    results.failures[#results.failures + 1] = name .. "\n    " .. tostring(err)
  end
end

local function fmt(v)
  if type(v) == "string" then return string.format("%q", v) end
  return tostring(v)
end

function H.eq(actual, expected, msg)
  if actual ~= expected then
    error((msg or "values differ") .. ": expected " .. fmt(expected) .. ", got " .. fmt(actual), 2)
  end
end

function H.ok(cond, msg)
  if not cond then error(msg or "assertion failed", 2) end
end

function H.count(t)
  local n = 0
  for _ in pairs(t or {}) do n = n + 1 end
  return n
end

return H
