-- Shared world for the professions tests and the schema 4 fixture: items, skill lines, a tailoring window,
-- crafting, gathering, trainer and vendor helpers. The stubs follow the retail field names.
local harness = require("harness")
local S = require("scenario")

local ADDON = "../ForeverLedger/ForeverLedger.lua"
local B = 61582
local ME = "Thibodeaux-Bayou"
local TAILORING, FIRST_AID = 197, 129
local RED_ROBE, LINEN_BOLT, LINEN_SHIRT, BANDAGE = 2389, 2963, 2393, 3275 -- recipe (spell) IDs
local TRAINER = "Creature-0-1-0-1-1103-0000T01" -- Eldrin, tailoring trainer (npc 1103)

local function items()
  local it = S.items()
  local function add(id, name, classID, subclassID, extra)
    local t = { name = name, quality = 1, ilvl = 5, reqLevel = 0, type = "Trade Goods", subtype = "Cloth",
                equipLoc = "", sellPrice = 10, stats = {}, tooltip = { { name } }, classID = classID,
                subclassID = subclassID }
    for k, v in pairs(extra or {}) do t[k] = v end
    it[id] = t
  end
  add(2996, "Bolt of Linen Cloth", 7, 5)
  add(2320, "Coarse Thread", 7, 5)
  add(2568, "Brown Linen Vest", 4, 1, { type = "Armor", subtype = "Cloth", equipLoc = "INVTYPE_CHEST" })
  add(2572, "Red Linen Robe", 4, 1, { type = "Armor", subtype = "Cloth", equipLoc = "INVTYPE_ROBE" })
  add(2598, "Pattern: Red Linen Robe", 9, 2, { type = "Recipe", subtype = "Tailoring", useSpell = 483,
                                               tooltip = { { "Pattern: Red Linen Robe" },
                                                           { "Teaches you how to sew a Red Linen Robe." } } })
  add(1251, "Linen Bandage", 0, 7)
  add(2770, "Copper Ore", 7, 7)
  add(2447, "Peacebloom", 7, 9)
  add(6303, "Raw Slitherskin Mackerel", 7, 8)
  add(4470, "Simple Wood", 7, 11)
  it[2589].classID, it[2589].subclassID = 7, 5 -- Linen Cloth
  return it
end

-- A full retail SkillLineAttributes table.
local function line(id, name, rank, maxRank, category, extra)
  local l = { skillID = id, name = name, isHeader = false, isCollapsed = false, rank = rank, tempPoints = 0,
              modifier = 0, maxRank = maxRank, isAbandonable = true, stepCost = 0, rankCost = 0, minLevel = 5,
              costType = 0, parentSkillLineID = 0, skillLineCategoryID = category, description = "" }
  for k, v in pairs(extra or {}) do l[k] = v end
  return l
end
local function header(name, category) return { name = name, isHeader = true, skillLineCategoryID = category } end

local function skillLines(tailoring)
  return {
    header("Professions", 11), line(TAILORING, "Tailoring", tailoring or 50, 75, 11),
    header("Secondary Skills", 9), line(FIRST_AID, "First Aid", 1, 75, 9),
    header("Weapon Skills", 6), line(45, "Bows", 50, 50, 6),
    header("Languages", 10), line(98, "Language: Common", 300, 300, 10),
  }
end

local function profInfo(id, name, rank)
  return { professionID = id, professionName = name, expansionName = "Classic", skillLevel = rank,
           maxSkillLevel = 75, skillModifier = 0, isPrimaryProfession = true, parentProfessionID = 0 }
end

-- Retail TradeSkillRecipeInfo / CraftingRecipeSchematic shapes.
local function recipe(id, name, learned, difficulty, output, reagents, extra)
  local slots = {}
  for i, r in ipairs(reagents) do
    slots[i] = { reagents = { { itemID = r[1] } }, quantityRequired = r[2], reagentType = r[3] or 1,
                 required = r[3] == nil or r[3] == 1, slotIndex = i, dataSlotIndex = i }
  end
  local rec = {
    info = { recipeID = id, categoryID = 1001, name = name, learned = learned, relativeDifficulty = difficulty,
             numSkillUps = 1, maxTrivialLevel = 90, craftable = true, disabled = false, icon = 132149,
             hyperlink = "|Henchant:" .. id .. "|h[" .. name .. "]|h", supportsQualities = false,
             favorite = false, alternateVerb = nil },
    schematic = { recipeID = id, outputItemID = output, quantityMin = 1, quantityMax = 1, name = name,
                  reagentSlotSchematics = slots, isRecraft = false, recipeType = 1, productQuality = nil },
    profession = profInfo(TAILORING, "Tailoring", 50),
  }
  for k, v in pairs(extra or {}) do rec[k] = v end
  return rec
end

local function tailoringWindow(rank)
  return {
    base = profInfo(TAILORING, "Tailoring", rank or 50),
    ids = { LINEN_BOLT, LINEN_SHIRT, RED_ROBE },
    recipes = {
      [LINEN_BOLT] = recipe(LINEN_BOLT, "Bolt of Linen Cloth", true, 3, 2996, { { 2589, 2 } }),
      [LINEN_SHIRT] = recipe(LINEN_SHIRT, "Brown Linen Vest", true, 0, 2568,
        { { 2996, 1 }, { 2320, 1 }, { 4470, 1, 0 } }), -- the third slot is an optional (modifying) reagent
      [RED_ROBE] = recipe(RED_ROBE, "Red Linen Robe", false, 0, 2572, { { 2996, 3 }, { 2320, 2 } },
        { sourceText = "|cffffd100Vendor: |rMisensi" }),
    },
  }
end

local function session(H, overrides, savedDB)
  local world = { items = items(), questLog = S.questLog(), professionAPI = true, skillLines = skillLines() }
  for k, v in pairs(overrides or {}) do world[k] = v end
  local ctl = H.new(world)
  ctl.env.ForeverLedgerDB = savedDB
  ctl.load(ADDON)
  ctl.login("ForeverLedger")
  return ctl
end

local function openTrade(c, window)
  c.world.tradeSkill = window or tailoringWindow()
  c.fire("TRADE_SKILL_SHOW")
end

---------------------------------------------------------------- crafts
local function cast(c, guid, spellID, tradeskill)
  c.world.casting = { "Craft", "", 132149, 0, 1000, tradeskill and true or false, guid, false, spellID, 0, 0 }
  c.fire("UNIT_SPELLCAST_START", "player", guid, spellID)
  c.world.casting = nil
  c.fire("UNIT_SPELLCAST_SUCCEEDED", "player", guid, spellID)
end
local function result(c, itemID, qty, multicraft)
  c.fire("TRADE_SKILL_ITEM_CRAFTED_RESULT", { itemID = itemID, quantity = qty, multicraft = multicraft or 0,
    isCrit = false, operationID = 1, hasIngenuityProc = false, craftingQuality = nil,
    hyperlink = harness.itemLink(itemID, c.world.items[itemID]) })
end
local function created(c, itemID, qty)
  local link = harness.itemLink(itemID, c.world.items[itemID])
  if qty and qty > 1 then
    c.lootLine("LOOT_ITEM_CREATED_SELF_MULTIPLE", c.world.player.name, link, qty)
  else
    c.lootLine("LOOT_ITEM_CREATED_SELF", c.world.player.name, link)
  end
end

---------------------------------------------------------------- gathering
local MINING, HERBALISM = 186, 182
local VEIN = "GameObject-0-1-0-1-1731-0000N01"   -- Copper Vein (object 1731)
local VEIN2 = "GameObject-0-1-0-1-1731-0000N02"
local BOBBER = "GameObject-0-1-0-1-35591-0000F01"
local function gatherLines()
  local lines = skillLines()
  lines[#lines + 1] = header("Professions", 11)
  lines[#lines + 1] = line(MINING, "Mining", 70, 75, 11)
  lines[#lines + 1] = line(HERBALISM, "Herbalism", 40, 75, 11)
  lines[#lines + 1] = line(356, "Fishing", 25, 75, 9)
  return lines
end
local function gatherer(H_, overrides)
  local o = { skillLines = gatherLines(), tooltip = { shown = true, owner = "UIParent", text = "Copper Vein" } }
  for k, v in pairs(overrides or {}) do o[k] = v end
  return session(H_, o)
end
local function lootNode(c, slots)
  c.world.loot = slots
  c.fire("LOOT_OPENED")
  c.fire("LOOT_CLOSED")
  c.world.loot = {}
end
-- One gather cast (a new castGUID each time) on `guid`, then its loot window. `target` is the name
-- UNIT_SPELLCAST_SENT gives the cast's target (not sent when nil).
local casts = 0
local function mine(c, guid, spell, target)
  casts = casts + 1
  local castGUID = "Cast-" .. guid .. "-" .. casts
  if target then c.fire("UNIT_SPELLCAST_SENT", "player", target, castGUID, spell or 2575) end
  c.fire("UNIT_SPELLCAST_SUCCEEDED", "player", castGUID, spell or 2575)
  lootNode(c, { { itemID = 2770, sourceGUID = guid, quantity = 2 } })
end

---------------------------------------------------------------- trainers and vendors
local VENDOR = "Creature-0-1-0-1-1347-0000V01" -- Alexandra Bolero, cloth vendor (npc 1347)
local function tailorServices()
  return {
    { name = "Tailoring", type = "header" },
    { name = "Brown Linen Vest", sub = "Apprentice", type = "available", cost = 100, skill = "Tailoring",
      skillRank = 10, level = 5, itemID = 2568, skillLine = "Tailoring" },
    { name = "Red Linen Robe", type = "unavailable", cost = 250, skill = "Tailoring", skillRank = 40, level = 8,
      itemID = 2572, skillLine = "Tailoring" },
    { name = "Journeyman Tailoring", type = "used", cost = 500, level = 10, skillLine = "Tailoring" },
  }
end
local function atTrainer(c, services, tradeskill)
  c.world.npc = { name = "Eldrin", guid = TRAINER }
  c.world.trainer = { tradeskill = tradeskill ~= false, services = services or tailorServices() }
  c.fire("TRAINER_SHOW")
end
local function merchantItem(itemID, price, extra)
  local info = { name = "?", texture = 134939, price = price, stackCount = 1, numAvailable = -1,
                 isPurchasable = true, isUsable = true, hasExtendedCost = false, currencyID = nil, spellID = nil,
                 isQuestStartItem = false }
  for k, v in pairs(extra or {}) do info[k] = v end
  return { itemID = itemID, info = info }
end
local function atVendor(c, stock, guid)
  c.world.npc = { name = "Alexandra Bolero", guid = guid or VENDOR }
  c.world.merchant = { items = stock or { merchantItem(2320, 10, { stackCount = 5 }),
                                          merchantItem(2598, 1200, { numAvailable = 1 }),
                                          merchantItem(2996, 0, { hasExtendedCost = true, currencyID = 1901 }) } }
  c.fire("MERCHANT_SHOW")
end

return {
  ADDON = ADDON, B = B, ME = ME, TAILORING = TAILORING, FIRST_AID = FIRST_AID, RED_ROBE = RED_ROBE,
  LINEN_BOLT = LINEN_BOLT, LINEN_SHIRT = LINEN_SHIRT, BANDAGE = BANDAGE, TRAINER = TRAINER, items = items,
  line = line, header = header, skillLines = skillLines, profInfo = profInfo, recipe = recipe,
  tailoringWindow = tailoringWindow, session = session, openTrade = openTrade, cast = cast, result = result,
  created = created, MINING = MINING, HERBALISM = HERBALISM, VEIN = VEIN, VEIN2 = VEIN2, BOBBER = BOBBER,
  gatherLines = gatherLines, gatherer = gatherer, lootNode = lootNode, mine = mine, VENDOR = VENDOR,
  tailorServices = tailorServices, atTrainer = atTrainer, merchantItem = merchantItem, atVendor = atVendor,
}
