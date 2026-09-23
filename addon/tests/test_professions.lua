-- ForeverLedger professions (schema 4): skills, recipes, learned recipes, API samples, crafts, gathering, trainers
-- and vendors. The stubs follow the retail field names; the addon reads them defensively.
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
  add(2598, "Pattern: Red Linen Robe", 9, 2, { type = "Recipe", subtype = "Tailoring",
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

local function printed(c, text)
  for _, l in ipairs(c.world.printed) do
    if l:find(text, 1, true) then return true end
  end
  return false
end

local function statusCount(c)
  c.world.printed = {}
  c.slash("FOREVERLEDGER", "")
  for _, l in ipairs(c.world.printed) do
    local n = l:match("|r (%d+) new records? since your last /reload %(saved")
    if n then return tonumber(n) end
  end
end

return function(H)
  ---------------------------------------------------------------- skills
  H.test("professions: skills keep profession and secondary lines only", function()
    local c = session(H)
    local sk = c.env.ForeverLedgerDB.skills[ME]
    H.eq(H.count(sk), 2)
    H.eq(sk[TAILORING].name, "Tailoring")
    H.eq(sk[TAILORING].rank, 50)
    H.eq(sk[TAILORING].maxRank, 75)
    H.eq(sk[TAILORING].modifier, 0)
    H.eq(sk[TAILORING].parentID, nil)
    H.eq(sk[TAILORING].lastSeen, c.world.clock)
    H.eq(sk[FIRST_AID].rank, 1)
    H.eq(sk[45], nil)
    H.eq(sk[98], nil)
  end)

  H.test("professions: without a skill line category the header decides (maxRank > 1)", function()
    local lines = skillLines()
    for _, l in ipairs(lines) do l.skillLineCategoryID = nil end
    lines[#lines + 1] = header("Armor Proficiencies")
    lines[#lines + 1] = line(415, "Cloth", 1, 1)
    lines[#lines + 1] = header("Class Skills")
    lines[#lines + 1] = line(51, "Marksmanship", 10, 50)
    local c = session(H, { skillLines = lines })
    local sk = c.env.ForeverLedgerDB.skills[ME]
    H.ok(sk[TAILORING] and sk[FIRST_AID], "professions kept")
    H.eq(H.count(sk), 2)
  end)

  H.test("professions: GetProfessions adds lines C_SkillInfo did not list", function()
    local c = session(H, { skillLines = {}, professions = {
      { name = "Tailoring", rank = 50, maxRank = 75, skillLine = TAILORING },
      { name = "Fishing", rank = 20, maxRank = 75, skillLine = 356, modifier = 5 } } })
    local sk = c.env.ForeverLedgerDB.skills[ME]
    H.eq(sk[356].name, "Fishing")
    H.eq(sk[356].rank, 20)
    H.eq(sk[356].modifier, 5)
    H.eq(sk[TAILORING].maxRank, 75)
    local s = c.env.ForeverLedgerDB.apiSamples.GetProfessionInfo
    H.eq(s.sample[1], "Tailoring")
    H.eq(s.sample[7], TAILORING)
  end)

  H.test("professions: a rank rise is a skill-up; the first sighting this load is not", function()
    local saved = session(H).env.ForeverLedgerDB
    saved.skills[ME][TAILORING].rank = 20 -- an older table: its ranks are not this load's
    local c = session(H, { clock = 1790000500 }, saved)
    local d = c.env.ForeverLedgerDB
    H.eq(#d.skillUps, 0)
    c.advance(10)
    c.world.skillLines = skillLines(52)
    c.fire("SKILL_LINES_CHANGED")
    c.fire("SKILL_LINES_CHANGED") -- nothing new
    H.eq(#d.skillUps, 1)
    local e = d.skillUps[1]
    H.eq(e.char, ME)
    H.eq(e.skillLineID, TAILORING)
    H.eq(e.from, 50)
    H.eq(e.to, 52)
    H.eq(e.build, B)
    H.eq(e.time, c.world.clock)
    H.eq(e.recipeID, nil)
    H.eq(d.skills[ME][TAILORING].rank, 52)
  end)

  H.test("professions: skill-ups are capped at 2000", function()
    local c = session(H)
    for i = 1, 2005 do
      c.world.skillLines[2].rank = 50 + i
      c.fire("SKILL_LINES_CHANGED")
    end
    local d = c.env.ForeverLedgerDB
    H.eq(#d.skillUps, 2000)
    H.eq(d.skillUps[1].to, 56)
    H.eq(d.skillUps[2000].to, 2055)
  end)

  ---------------------------------------------------------------- recipes
  H.test("professions: the profession window records recipes, snapshots per build and reagent items", function()
    local c = session(H)
    openTrade(c)
    local d = c.env.ForeverLedgerDB
    H.eq(H.count(d.recipes), 3)
    local vest = d.recipes[LINEN_SHIRT]
    H.eq(vest.id, LINEN_SHIRT)
    H.eq(vest.name, "Brown Linen Vest")
    H.eq(vest.skillLineID, TAILORING)
    H.eq(vest.categoryID, 1001)
    local snap = vest.byBuild[B]
    H.eq(snap.outputItemID, 2568)
    H.eq(snap.qtyMin, 1)
    H.eq(snap.qtyMax, 1)
    H.eq(snap.maxTrivial, 90)
    H.eq(snap.firstSeen, c.world.clock)
    H.eq(#snap.reagents, 2, "the optional reagent slot is left out")
    H.eq(snap.reagents[1].itemID, 2996)
    H.eq(snap.reagents[1].qty, 1)
    H.eq(snap.reagents[2].itemID, 2320)
    H.eq(snap.sourceText, nil, "learned recipes have no source text")
    H.eq(d.recipes[RED_ROBE].byBuild[B].sourceText, "|cffffd100Vendor: |rMisensi")
    H.eq(d.recipes[RED_ROBE].byBuild[B].reagents[1].qty, 3)
    H.ok(d.items[2996] and d.items[2996].byBuild[B], "reagents are scanned")
    H.ok(d.items[2568] and d.items[2568].byBuild[B], "outputs are scanned")
    H.eq(d.items[2568].classID, 4)
    H.eq(d.items[2568].subclassID, 1)
  end)

  H.test("professions: recipeSeen keeps learned, difficulty, rank and the rank range per difficulty", function()
    local c = session(H)
    openTrade(c)
    local d = c.env.ForeverLedgerDB
    local seen = d.recipeSeen[B][ME]
    H.eq(seen[LINEN_BOLT].learned, true)
    H.eq(seen[LINEN_BOLT].difficulty, "trivial")
    H.eq(seen[LINEN_BOLT].rank, 50)
    H.eq(seen[LINEN_BOLT].seenAt, c.world.clock)
    H.eq(seen[LINEN_BOLT].byDifficulty.trivial.minRank, 50)
    H.eq(seen[RED_ROBE].learned, false)
    H.eq(seen[RED_ROBE].difficulty, "optimal")
    H.eq(next(seen[RED_ROBE].byDifficulty), nil, "unlearned recipes give no thresholds")

    c.advance(60)
    c.world.skillLines = skillLines(57)
    c.fire("SKILL_LINES_CHANGED")
    c.world.tradeSkill.recipes[LINEN_SHIRT].info.relativeDifficulty = 1
    c.fire("TRADE_SKILL_LIST_UPDATE")
    local vest = seen[LINEN_SHIRT]
    H.eq(vest.difficulty, "medium")
    H.eq(vest.rank, 57, "the rank comes from the skill line")
    H.eq(vest.byDifficulty.optimal.minRank, 50)
    H.eq(vest.byDifficulty.optimal.maxRank, 50)
    H.eq(vest.byDifficulty.medium.minRank, 57)
    c.advance(60)
    c.world.skillLines = skillLines(60)
    c.fire("SKILL_LINES_CHANGED")
    c.fire("TRADE_SKILL_LIST_UPDATE")
    H.eq(vest.byDifficulty.medium.minRank, 57)
    H.eq(vest.byDifficulty.medium.maxRank, 60)
  end)

  H.test("professions: without the skill line the window's profession rank is used", function()
    local c = session(H, { skillLines = {} })
    openTrade(c, tailoringWindow(44))
    H.eq(c.env.ForeverLedgerDB.recipeSeen[B][ME][LINEN_BOLT].rank, 44)
  end)

  H.test("professions: a schematic is read once per recipe per build", function()
    local c = session(H)
    openTrade(c)
    H.eq(c.world.calls.GetRecipeSchematic, 3)
    H.eq(c.world.calls.GetProfessionInfoByRecipeID, 3)
    c.advance(5)
    c.fire("TRADE_SKILL_LIST_UPDATE")
    H.eq(c.world.calls.GetRecipeInfo, 6, "recipe info is re-read")
    H.eq(c.world.calls.GetRecipeSchematic, 3, "schematics are not")
    local saved = c.env.ForeverLedgerDB
    local c2 = session(H, { buildInfo = { "1.15.8", "61600", "Oct 01 2026", 11508 } }, saved)
    openTrade(c2)
    H.eq(c2.world.calls.GetRecipeSchematic, 3, "a new build reads them again")
    H.ok(saved.recipes[LINEN_BOLT].byBuild[B] and saved.recipes[LINEN_BOLT].byBuild[61600], "both builds kept")
  end)

  H.test("professions: linked, guild, NPC-crafter and switching windows are not read", function()
    for _, flag in ipairs({ "linked", "guild", "npcCrafting", "changing" }) do
      local c = session(H)
      local w = tailoringWindow()
      w[flag] = true
      openTrade(c, w)
      H.eq(next(c.env.ForeverLedgerDB.recipes), nil, flag)
      H.eq(c.world.calls.GetAllRecipeIDs, nil, flag)
    end
  end)

  H.test("professions: a guard that errors also skips the scan", function()
    local c = session(H)
    c.env.C_TradeSkillUI.IsTradeSkillLinked = function() error("no") end
    openTrade(c)
    H.eq(next(c.env.ForeverLedgerDB.recipes), nil)
  end)

  H.test("professions: window scans are throttled to one per 2 s with one trailing scan", function()
    local c = session(H)
    openTrade(c)
    H.eq(c.world.calls.GetAllRecipeIDs, 1)
    c.fire("TRADE_SKILL_LIST_UPDATE")
    c.fire("TRADE_SKILL_LIST_UPDATE")
    c.fire("TRADE_SKILL_DATA_SOURCE_CHANGED")
    H.eq(c.world.calls.GetAllRecipeIDs, 1, "inside the gap")
    H.eq(#c.world.timers, 1, "one trailing scan queued")
    c.advance(1)
    H.eq(c.world.calls.GetAllRecipeIDs, 1)
    c.advance(1)
    H.eq(c.world.calls.GetAllRecipeIDs, 2, "the trailing scan ran")
    c.fire("TRADE_SKILL_CLOSE")
    c.advance(5)
    c.fire("TRADE_SKILL_LIST_UPDATE")
    H.eq(c.world.calls.GetAllRecipeIDs, 2, "closed windows are not read")
  end)

  H.test("professions: at most 60 new schematics per scan, the rest on the next passes", function()
    local c = session(H)
    local w = tailoringWindow()
    w.ids = {}
    for i = 1, 130 do
      local id = 90000 + i
      w.ids[i] = id
      w.recipes[id] = recipe(id, "Recipe " .. i, true, 0, 2996, { { 2589, 1 } })
    end
    openTrade(c, w)
    H.eq(c.world.calls.GetRecipeSchematic, 60)
    local d = c.env.ForeverLedgerDB
    H.eq(H.count(d.recipes), 130, "every recipe is listed")
    H.eq(d.recipes[90100].byBuild[B], nil)
    c.advance(2)
    H.eq(c.world.calls.GetRecipeSchematic, 120)
    c.advance(2)
    H.eq(c.world.calls.GetRecipeSchematic, 130)
    H.ok(d.recipes[90130].byBuild[B], "the last one is read")
    c.advance(10)
    H.eq(#c.world.timers, 0, "nothing left queued")
  end)

  H.test("professions: without C_Timer a scan inside the gap is skipped", function()
    local c = session(H, { missing = { C_Timer = true } })
    openTrade(c)
    c.fire("TRADE_SKILL_LIST_UPDATE")
    H.eq(c.world.calls.GetAllRecipeIDs, 1)
    c.advance(2)
    c.fire("TRADE_SKILL_LIST_UPDATE")
    H.eq(c.world.calls.GetAllRecipeIDs, 2)
  end)

  ---------------------------------------------------------------- learned
  local function learnSession(_, overrides)
    local o = { bags = { [0] = { [1] = 2598, [2] = 2589 } } }
    for k, v in pairs(overrides or {}) do o[k] = v end
    return session(H, o)
  end

  H.test("professions: a recipe learned at a trainer says trainer:<npcID>", function()
    local c = learnSession(H)
    c.world.npc = { name = "Eldrin", guid = TRAINER }
    c.fire("TRAINER_SHOW")
    c.fire("NEW_RECIPE_LEARNED", LINEN_SHIRT, 1, nil)
    c.fire("TRAINER_CLOSED")
    c.advance(1)
    c.fire("NEW_RECIPE_LEARNED", BANDAGE)
    local l = c.env.ForeverLedgerDB.learned
    H.eq(#l, 2)
    H.eq(l[1].char, ME)
    H.eq(l[1].recipeID, LINEN_SHIRT)
    H.eq(l[1].build, B)
    H.eq(l[1].time, c.world.clock - 1)
    H.eq(l[1].via, "trainer:1103")
    H.eq(l[2].via, "unknown")
    local s = c.env.ForeverLedgerDB.apiSamples.NEW_RECIPE_LEARNED
    H.eq(s.sample[1], LINEN_SHIRT)
    H.eq(s.sample[2], 1)
  end)

  H.test("professions: a recipe item used from the bags in the last 5 s says item:<itemID>", function()
    local c = learnSession(H)
    c.env.C_Container.UseContainerItem(0, 1) -- Pattern: Red Linen Robe
    H.eq(c.world.usedItem[2], 1, "the original still runs")
    c.advance(3)
    c.fire("NEW_RECIPE_LEARNED", RED_ROBE)
    c.env.C_Container.UseContainerItem(0, 2) -- Linen Cloth is not a recipe
    c.fire("NEW_RECIPE_LEARNED", BANDAGE)
    local l = c.env.ForeverLedgerDB.learned
    H.eq(l[1].via, "item:2598")
    H.eq(l[2].via, "unknown")
  end)

  H.test("professions: an old item use is unknown unless a player spell finished since", function()
    local c = learnSession(H)
    c.env.C_Container.UseContainerItem(0, 1)
    c.advance(6)
    c.fire("NEW_RECIPE_LEARNED", RED_ROBE)
    c.env.C_Container.UseContainerItem(0, 1)
    c.advance(8)
    c.fire("UNIT_SPELLCAST_SUCCEEDED", "target", "Cast-1", 483) -- not the player
    c.fire("NEW_RECIPE_LEARNED", LINEN_SHIRT)
    c.env.C_Container.UseContainerItem(0, 1)
    c.advance(8)
    c.fire("UNIT_SPELLCAST_SUCCEEDED", "player", "Cast-2", 483) -- the learning cast finished
    c.advance(1)
    c.fire("NEW_RECIPE_LEARNED", BANDAGE)
    local l = c.env.ForeverLedgerDB.learned
    H.eq(l[1].via, "unknown")
    H.eq(l[2].via, "unknown")
    H.eq(l[3].via, "item:2598")
  end)

  H.test("professions: the item class comes from GetItemInfoInstant when the item was never scanned", function()
    local c = learnSession(H, { api = "forever" })
    H.eq(c.env.ForeverLedgerDB.items[2598], nil)
    c.env.C_Container.UseContainerItem(0, 1)
    c.fire("NEW_RECIPE_LEARNED", RED_ROBE)
    H.eq(c.env.ForeverLedgerDB.learned[1].via, "item:2598")
  end)

  H.test("professions: learned recipes are capped at 2000", function()
    local c = session(H)
    for i = 1, 2003 do c.fire("NEW_RECIPE_LEARNED", 70000 + i) end
    local l = c.env.ForeverLedgerDB.learned
    H.eq(#l, 2000)
    H.eq(l[1].recipeID, 70004)
  end)

  ---------------------------------------------------------------- API samples
  H.test("professions: one API sample per API per build, trimmed", function()
    local c = session(H)
    local w = tailoringWindow()
    local info = w.recipes[LINEN_BOLT].info
    info.longText = string.rep("x", 300)
    info.fn = function() end
    info.nested = { deeper = { deepest = 1 }, flat = 2 }
    for i = 1, 80 do info["extra" .. i] = i end
    openTrade(c, w)
    local d = c.env.ForeverLedgerDB
    local s = d.apiSamples["C_TradeSkillUI.GetRecipeInfo"]
    H.eq(s.build, B)
    H.eq(s.time, c.world.clock)
    H.eq(H.count(s.sample), 60, "60 keys at most")
    local ok = pcall(function()
      -- the first recipe's sample: every kept value is trimmed
      for k, v in pairs(s.sample) do
        H.ok(type(v) ~= "function", k)
        if type(v) == "string" then H.ok(#v <= 200, k) end
        if k == "nested" then H.eq(v.deeper, "<table>"); H.eq(v.flat, 2) end
      end
    end)
    H.ok(ok, "sample values trimmed")
    local sch = d.apiSamples["C_TradeSkillUI.GetRecipeSchematic"].sample
    H.eq(sch.outputItemID, 2996)
    H.eq(sch.reagentSlotSchematics[1], "<table>", "depth 2: slots are summarised")
    H.eq(d.apiSamples["C_TradeSkillUI.GetRecipeSchematic:reagentSlot"].sample.quantityRequired, 2)
    H.eq(d.apiSamples["C_TradeSkillUI.GetRecipeSchematic:reagent"].sample.itemID, 2589)
    H.eq(d.apiSamples["C_TradeSkillUI.GetBaseProfessionInfo"].sample.professionID, TAILORING)
    H.eq(d.apiSamples["C_TradeSkillUI.GetProfessionInfoByRecipeID"].sample.skillLevel, 50)
    H.eq(d.apiSamples["C_TradeSkillUI.GetRecipeSourceText"].sample[1], "|cffffd100Vendor: |rMisensi")
    H.eq(d.apiSamples["C_TradeSkillUI.GetAllRecipeIDs"].sample[3], RED_ROBE)
    H.eq(d.apiSamples["C_SkillInfo.GetSkillLineInfo"].sample.skillLineCategoryID, 11)
    H.eq(d.apiSamples["C_SkillInfo.GetSkillLineInfo"].sample.name, "Tailoring", "headers are not sampled")
    H.eq(d.apiSamples["ForeverLedger.fieldMisses"], nil, "no misses with the retail names")

    -- a later, different table on the same build does not replace it; a new build does
    c.advance(10)
    c.world.tradeSkill.recipes[LINEN_BOLT].info.name = "Changed"
    c.fire("TRADE_SKILL_LIST_UPDATE")
    H.eq(d.apiSamples["C_TradeSkillUI.GetRecipeInfo"].sample.name, "Bolt of Linen Cloth")
    local c2 = session(H, { buildInfo = { "1.15.8", "61600", "Oct 01 2026", 11508 } }, d)
    openTrade(c2)
    H.eq(d.apiSamples["C_TradeSkillUI.GetRecipeInfo"].build, 61600)
  end)

  H.test("professions: unknown field names are read by their alternatives and misses are noted", function()
    local w = tailoringWindow()
    for _, r in pairs(w.recipes) do
      r.info.recipeName, r.info.name = r.info.name, nil
      r.schematic.minQuantity, r.schematic.quantityMin = 1, nil
      r.schematic.quantityMax = nil
    end
    local lines = skillLines()
    lines[2].skillLineID, lines[2].skillID = TAILORING, nil
    local c = session(H, { skillLines = lines })
    openTrade(c, w)
    local d = c.env.ForeverLedgerDB
    H.eq(d.skills[ME][TAILORING].rank, 50)
    H.eq(d.recipes[LINEN_BOLT].name, "Bolt of Linen Cloth")
    H.eq(d.recipes[LINEN_BOLT].byBuild[B].qtyMin, 1)
    H.eq(d.recipes[LINEN_BOLT].byBuild[B].qtyMax, nil)
    local misses = d.apiSamples["ForeverLedger.fieldMisses"].sample
    H.eq(misses["C_TradeSkillUI.GetRecipeSchematic:quantityMax"], "quantityMax|maxQuantity")
    H.eq(H.count(misses), 1, "names found under an alternative are not misses")
  end)

  H.test("professions: missing profession APIs do not break loading or play", function()
    local c = session(H, { missing = { C_SkillInfo = true, C_TradeSkillUI = true, C_Timer = true, Enum = true } })
    openTrade(c)
    c.fire("SKILL_LINES_CHANGED")
    c.fire("NEW_RECIPE_LEARNED", LINEN_SHIRT)
    local d = c.env.ForeverLedgerDB
    H.eq(next(d.skills), nil)
    H.eq(next(d.recipes), nil)
    H.eq(#d.learned, 1)
  end)

  ---------------------------------------------------------------- status, reset, nudge
  H.test("professions: /fl shows profession counts and reset wipes the new tables", function()
    local c = session(H)
    openTrade(c)
    c.fire("NEW_RECIPE_LEARNED", LINEN_SHIRT)
    c.slash("FOREVERLEDGER", "")
    H.ok(printed(c, "professions: 2 skills, 3 recipes, 0 crafts, 0 nodes gathered, 0 trainers, 0 vendors."),
      table.concat(c.world.printed, "\n"))
    c.slash("FOREVERLEDGER", "reset confirm")
    local d = c.env.ForeverLedgerDB
    for _, k in ipairs({ "skills", "skillUps", "recipes", "recipeSeen", "learned", "crafts", "nodes", "nodeLoot",
                         "trainers", "vendors", "apiSamples" }) do
      H.eq(next(d[k]), nil, k)
    end
  end)

  H.test("professions: new skills, recipe snapshots, skill-ups and learned recipes count toward the nudge", function()
    local c = session(H)
    H.eq(statusCount(c), 2, "two skill lines")
    openTrade(c)
    -- 3 recipes + items 2996, 2589, 2568, 2320, 2572 (4470 is an optional reagent: not read)
    H.eq(statusCount(c), 2 + 3 + 5)
    c.world.skillLines = skillLines(51)
    c.fire("SKILL_LINES_CHANGED")
    c.fire("NEW_RECIPE_LEARNED", BANDAGE)
    H.eq(statusCount(c), 12)
  end)
end
