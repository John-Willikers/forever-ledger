-- ForeverLedger professions (schema 4): skills, recipes, learned recipes, API samples, crafts, gathering, trainers
-- and vendors. The stubs follow the retail field names; the addon reads them defensively.
local P = require("professions_world")
local S = require("scenario")

local ADDON, B, ME, TAILORING, FIRST_AID = P.ADDON, P.B, P.ME, P.TAILORING, P.FIRST_AID
local RED_ROBE, LINEN_BOLT, LINEN_SHIRT, BANDAGE = P.RED_ROBE, P.LINEN_BOLT, P.LINEN_SHIRT, P.BANDAGE
local TRAINER = P.TRAINER
local line, header, skillLines, recipe, tailoringWindow = P.line, P.header, P.skillLines, P.recipe, P.tailoringWindow
local session, openTrade, cast, result, created = P.session, P.openTrade, P.cast, P.result, P.created
local MINING, HERBALISM, VEIN, VEIN2, BOBBER = P.MINING, P.HERBALISM, P.VEIN, P.VEIN2, P.BOBBER
local gatherer, lootNode, mine = P.gatherer, P.lootNode, P.mine
local tailorServices, atTrainer, merchantItem, atVendor = P.tailorServices, P.atTrainer, P.merchantItem, P.atVendor

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

local FIXTURE = "../../fixtures/synthetic/session-v4.lua"

-- The schema 4 fixture: the shared play session (quests, loot, a dungeon run), then a profession session that
-- touches every appendix table: skills and a skill-up, a trainer (a recipe learned there), a vendor, the profession
-- window (one client field missing), crafts with a proc, a recipe learned from a pattern, a mined vein and fishing.
local function v4Session(H)
  local c = H.new({ items = P.items(), questLog = S.questLog(), professionAPI = true, skillLines = P.gatherLines(),
                    bags = { [0] = { [1] = 2598 } } })
  c.load(ADDON)
  S.play(c, "ForeverLedger")
  local w = c.world
  c.advance(60)

  atTrainer(c)
  c.fire("NEW_RECIPE_LEARNED", LINEN_SHIRT, nil, LINEN_SHIRT) -- (recipeID, recipeLevel, baseRecipeID): a nil gap
  c.fire("TRAINER_CLOSED")
  w.npc, w.trainer = nil, nil
  c.advance(30)
  atVendor(c)
  c.fire("MERCHANT_CLOSED")
  w.npc, w.merchant = nil, nil
  c.advance(30)

  local window = tailoringWindow()
  window.recipes[RED_ROBE].schematic.quantityMax = nil -- a field this client leaves out: noted as a miss
  openTrade(c, window)
  c.advance(10)
  cast(c, "Cast-V4-1", LINEN_BOLT, true)
  result(c, 2996, 3, 2) -- multicraft
  created(c, 2996, 3)
  c.advance(1)
  w.skillLines[2].rank = 51 -- Tailoring
  c.fire("SKILL_LINES_CHANGED")
  c.advance(10)
  cast(c, "Cast-V4-2", LINEN_SHIRT, true)
  result(c, 2568, 1)
  created(c, 2568, 1)
  c.advance(10)
  c.env.C_Container.UseContainerItem(0, 1) -- Pattern: Red Linen Robe
  c.advance(2)
  c.fire("NEW_RECIPE_LEARNED", RED_ROBE)
  window.recipes[RED_ROBE].info.learned = true
  window.recipes[LINEN_SHIRT].info.relativeDifficulty = 1
  c.fire("TRADE_SKILL_LIST_UPDATE")
  c.fire("TRADE_SKILL_CLOSE")
  w.tradeSkill = nil
  c.advance(60)

  w.tooltip = { shown = true, owner = "UIParent", text = "Copper Vein" }
  mine(c, VEIN)
  c.advance(40)
  w.zone.x, w.zone.y = 0.50, 0.70
  mine(c, VEIN2)
  w.tooltip = { shown = false }
  c.advance(120)
  w.fishing = true
  c.fire("UNIT_SPELLCAST_SUCCEEDED", "player", "Cast-F", 7620)
  lootNode(c, { { itemID = 6303, sourceGUID = BOBBER } })
  w.fishing = false
  c.advance(30)
  return c.env.ForeverLedgerDB
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

  ---------------------------------------------------------------- crafts
  -- A session whose recipes are known from the profession window.
  local function crafting(H_, overrides)
    local c = session(H_, overrides)
    openTrade(c)
    c.advance(10)
    return c
  end
  local function crafts(c, recipeID) return c.env.ForeverLedgerDB.crafts[B][recipeID] end

  H.test("crafts: cast, result event and chat line of one craft count once, in any order", function()
    local orders = {
      { "cast", "result", "chat" }, { "chat", "result", "cast" }, { "result", "cast", "chat" },
      { "chat", "cast", "result" },
    }
    for _, order in ipairs(orders) do
      local c = crafting(H)
      for _, sig in ipairs(order) do
        if sig == "cast" then cast(c, "Cast-A", LINEN_BOLT, true)
        elseif sig == "result" then result(c, 2996, 1)
        else created(c, 2996, 1) end
      end
      local k = crafts(c, LINEN_BOLT)
      local what = table.concat(order, ",")
      H.eq(k.casts, 1, what)
      H.eq(k.qty, 1, what)
      H.eq(k.procs, 0, what)
      H.eq(k.skillUps, 0, what)
    end
  end)

  H.test("crafts: repeated crafts are separate crafts", function()
    local c = crafting(H)
    for i = 1, 3 do
      cast(c, "Cast-" .. i, LINEN_BOLT, true)
      created(c, 2996, 1)
      result(c, 2996, 1)
      c.advance(2)
    end
    local k = crafts(c, LINEN_BOLT)
    H.eq(k.casts, 3)
    H.eq(k.qty, 3)
    c.fire("UNIT_SPELLCAST_SUCCEEDED", "player", "Cast-2", LINEN_BOLT) -- a repeated castGUID is ignored
    H.eq(k.casts, 3)
  end)

  H.test("crafts: result events without casts, one right after the other, are two crafts", function()
    local c = crafting(H)
    c.fire("TRADE_SKILL_CRAFT_BEGIN", LINEN_SHIRT)
    result(c, 2568, 1)
    result(c, 2568, 1)
    local k = crafts(c, LINEN_SHIRT)
    H.eq(k.casts, 2, "the recipe comes from TRADE_SKILL_CRAFT_BEGIN")
    H.eq(k.qty, 2)
    H.eq(c.env.ForeverLedgerDB.apiSamples.TRADE_SKILL_CRAFT_BEGIN.sample[1], LINEN_SHIRT)
    H.eq(c.env.ForeverLedgerDB.apiSamples.TRADE_SKILL_ITEM_CRAFTED_RESULT.sample.quantity, 1)
  end)

  H.test("crafts: multicraft and extra quantity are procs; the result event overrides the chat line", function()
    local c = crafting(H)
    cast(c, "Cast-1", LINEN_BOLT, true)
    result(c, 2996, 3, 2)
    c.advance(5)
    cast(c, "Cast-2", LINEN_BOLT, true)
    created(c, 2996, 2) -- more than quantityMax (1): a proc by the chat line alone
    c.advance(5)
    cast(c, "Cast-3", LINEN_BOLT, true)
    created(c, 2996, 2)
    result(c, 2996, 1, 0) -- the result says 1, no multicraft: not a proc after all
    local k = crafts(c, LINEN_BOLT)
    H.eq(k.casts, 3)
    H.eq(k.qty, 3 + 2 + 1)
    H.eq(k.procs, 2)
  end)

  H.test("crafts: without the result event, a tradeskill cast and the chat line are the fallback", function()
    local c = session(H) -- no profession window: no known recipes
    cast(c, "Cast-1", BANDAGE, true)
    created(c, 1251, 2)
    local k = crafts(c, BANDAGE)
    H.eq(k.casts, 1)
    H.eq(k.qty, 2)
    H.eq(c.env.ForeverLedgerDB.apiSamples.UnitCastingInfo.sample[6], true)
    H.eq(c.env.ForeverLedgerDB.apiSamples.UnitCastingInfo.sample[9], BANDAGE)
    cast(c, "Cast-2", 133, false) -- a Fireball is no craft
    H.eq(c.env.ForeverLedgerDB.crafts[B][133], nil)
  end)

  H.test("crafts: a known recipe cast counts without UnitCastingInfo; lone chat lines need a known output", function()
    local c = crafting(H, { missing = { UnitCastingInfo = true } })
    c.fire("UNIT_SPELLCAST_SUCCEEDED", "player", "Cast-1", LINEN_SHIRT)
    H.eq(crafts(c, LINEN_SHIRT).casts, 1)
    c.advance(10)
    created(c, 2572, 1) -- Red Linen Robe: the output of a known recipe
    H.eq(crafts(c, RED_ROBE).casts, 1)
    H.eq(crafts(c, RED_ROBE).qty, 1)
    c.advance(10)
    created(c, 5555, 1) -- not a known output (conjured, quest, ...)
    local n = 0
    for _, k in pairs(c.env.ForeverLedgerDB.crafts[B]) do n = n + k.casts end
    H.eq(n, 2)
  end)

  H.test("crafts: a chat line for another item is not the recent craft's", function()
    local c = crafting(H)
    cast(c, "Cast-1", LINEN_BOLT, true)
    created(c, 2572, 1) -- Red Linen Robe within the window of a Bolt of Linen Cloth craft
    H.eq(crafts(c, LINEN_BOLT).qty, 0)
    H.eq(crafts(c, RED_ROBE).casts, 1)
    H.eq(crafts(c, RED_ROBE).qty, 1)
  end)

  H.test("crafts: \"You create\" comes from the client's GlobalStrings", function()
    local c = crafting(H, { globalStrings = { LOOT_ITEM_CREATED_SELF = "Ihr stellt her: %s.",
                                              LOOT_ITEM_CREATED_SELF_MULTIPLE = "Ihr stellt her: %sx%d." } })
    local link = require("harness").itemLink(2996, c.world.items[2996])
    c.fire("CHAT_MSG_LOOT", "Ihr stellt her: " .. link .. "x2.", c.world.player.name)
    H.eq(crafts(c, LINEN_BOLT).qty, 2)
    c.advance(10)
    c.fire("CHAT_MSG_LOOT", "You create: " .. link .. ".", c.world.player.name) -- not this client's text
    H.eq(crafts(c, LINEN_BOLT).casts, 1)
  end)

  H.test("crafts: a skill-up within 5 s of a craft is that recipe's", function()
    local c = crafting(H)
    cast(c, "Cast-1", LINEN_BOLT, true)
    result(c, 2996, 1)
    c.advance(1)
    c.world.skillLines = skillLines(52)
    c.fire("SKILL_LINES_CHANGED")
    local d = c.env.ForeverLedgerDB
    H.eq(d.skillUps[1].recipeID, LINEN_BOLT)
    H.eq(crafts(c, LINEN_BOLT).skillUps, 2)
    c.advance(6)
    c.world.skillLines = skillLines(53)
    c.fire("SKILL_LINES_CHANGED")
    H.eq(d.skillUps[2].recipeID, nil, "too late")
    H.eq(crafts(c, LINEN_BOLT).skillUps, 2)
  end)

  ---------------------------------------------------------------- gathering

  H.test("gathering: a mined vein is a node with its skill, rank, name, spot and loot; not a drop", function()
    local c = gatherer(H)
    mine(c, VEIN)
    local d = c.env.ForeverLedgerDB
    local n = d.nodes[B][1731]
    H.eq(n.opened, 1)
    H.eq(n.skillLineID, MINING)
    H.eq(n.rankMin, 70)
    H.eq(n.name, "Copper Vein")
    H.eq(#n.spots[1429], 1)
    H.eq(n.spots[1429][1], "42.1,65.9")
    H.eq(d.nodeLoot[2770][B][1731].n, 1)
    H.eq(d.nodeLoot[2770][B][1731].qty, 2)
    H.eq(d.drops[2770], nil)
    H.eq(next(d.corpses), nil)
    H.ok(d.items[2770] and d.items[2770].byBuild[B], "node loot is scanned")
  end)

  H.test("gathering: a node counts once per harvest; spots within 1 map unit are one spot", function()
    local c = gatherer(H)
    mine(c, VEIN)
    mine(c, VEIN) -- a vein holds 2-3 harvests: a new gather cast on the same GUID is a new open
    lootNode(c, { { itemID = 2770, sourceGUID = VEIN, quantity = 2 } }) -- reopened without a new cast
    c.advance(10)
    lootNode(c, { { itemID = 2770, sourceGUID = VEIN, quantity = 2 } }) -- reopened later, still no cast
    local d = c.env.ForeverLedgerDB
    H.eq(d.nodes[B][1731].opened, 2)
    H.eq(d.nodeLoot[2770][B][1731].n, 2, "both harvests' loot counts")
    H.eq(d.nodeLoot[2770][B][1731].qty, 4)
    c.world.zone.x, c.world.zone.y = 0.426, 0.662 -- 0.5 units away
    c.world.skillLines[#c.world.skillLines - 2].rank = 65 -- a lower rank (another character's level of skill)
    c.fire("SKILL_LINES_CHANGED")
    mine(c, VEIN2)
    c.world.zone.x, c.world.zone.y = 0.50, 0.70
    mine(c, "GameObject-0-1-0-1-1731-0000N03")
    local n = d.nodes[B][1731]
    H.eq(n.opened, 4)
    H.eq(n.rankMin, 65)
    H.eq(#n.spots[1429], 2)
    H.eq(n.spots[1429][2], "50.0,70.0")
    H.eq(d.nodeLoot[2770][B][1731].n, 4)
    H.eq(d.nodeLoot[2770][B][1731].qty, 8)
  end)

  H.test("gathering: a gather cast on one node does not make another node's reopen a new harvest", function()
    local c = gatherer(H)
    mine(c, VEIN)
    mine(c, VEIN2)
    lootNode(c, { { itemID = 2770, sourceGUID = VEIN, quantity = 2 } }) -- VEIN again, VEIN2's cast is recent
    local d = c.env.ForeverLedgerDB
    H.eq(d.nodes[B][1731].opened, 2)
    H.eq(d.nodeLoot[2770][B][1731].n, 2)
  end)

  H.test("gathering: chests and other non-gather objects count once per GUID", function()
    local c = gatherer(H)
    local chest = "GameObject-0-1-0-1-2843-0000C01"
    lootNode(c, { { itemID = 2589, sourceGUID = chest } })
    c.advance(10)
    lootNode(c, { { itemID = 2589, sourceGUID = chest } })
    local d = c.env.ForeverLedgerDB
    H.eq(d.nodes[B][2843].opened, 1)
    H.eq(d.nodeLoot[2589][B][2843].n, 1)
  end)

  H.test("gathering: at most 50 spots per node and map", function()
    local c = gatherer(H)
    for i = 1, 60 do
      c.world.zone.x, c.world.zone.y = (i * 1.5) / 100, 0.5
      mine(c, "GameObject-0-1-0-1-1731-00" .. i)
    end
    local n = c.env.ForeverLedgerDB.nodes[B][1731]
    H.eq(n.opened, 60)
    H.eq(#n.spots[1429], 50)
  end)

  H.test("gathering: other gather spells match by name; no gather spell, no skill", function()
    local c = gatherer(H, { spells = { [2366] = { name = "Herb Gathering" }, [265819] = { name = "Herb Gathering" },
                                       [2575] = { name = "Mining" } } })
    c.fire("UNIT_SPELLCAST_SUCCEEDED", "player", "Cast-H", 265819)
    lootNode(c, { { itemID = 2447, sourceGUID = "GameObject-0-1-0-1-1618-0000H01" } })
    local d = c.env.ForeverLedgerDB
    H.eq(d.nodes[B][1618].skillLineID, HERBALISM)
    H.eq(d.nodes[B][1618].rankMin, 40)
    c.advance(10)
    lootNode(c, { { itemID = 2589, sourceGUID = "GameObject-0-1-0-1-2843-0000C01" } }) -- a chest, 10 s later
    H.eq(d.nodes[B][2843].opened, 1)
    H.eq(d.nodes[B][2843].skillLineID, nil)
    H.eq(d.nodes[B][2843].rankMin, nil)
  end)

  H.test("gathering: localized gather spell names come from the client", function()
    local c = gatherer(H, { spells = { [2575] = { name = "Bergbau" }, [999001] = { name = "Bergbau" } } })
    c.fire("UNIT_SPELLCAST_SUCCEEDED", "player", "Cast-1", 999001)
    lootNode(c, { { itemID = 2770, sourceGUID = VEIN } })
    H.eq(c.env.ForeverLedgerDB.nodes[B][1731].skillLineID, MINING)
  end)

  H.test("gathering: fishing loot is object 0 with the Fishing skill, once per window", function()
    local c = gatherer(H, { fishing = true })
    c.fire("UNIT_SPELLCAST_SUCCEEDED", "player", "Cast-F", 7620)
    lootNode(c, { { itemID = 6303, sourceGUID = BOBBER } })
    c.env.GetLootSourceInfo = function() return nil end -- a client that names no source
    lootNode(c, { { itemID = 6303 } })
    lootNode(c, { { itemID = 6303 } })
    local d = c.env.ForeverLedgerDB
    local n = d.nodes[B][0]
    H.eq(n.opened, 3)
    H.eq(n.skillLineID, 356)
    H.eq(n.rankMin, 25)
    H.eq(n.name, nil)
    H.eq(d.nodeLoot[6303][B][0].n, 3)
    H.eq(d.nodes[B][35591], nil, "the bobber is not a node")
    H.eq(d.drops[6303], nil)
  end)

  H.test("gathering: the tooltip names a node only when it shows a world object", function()
    for _, tt in ipairs({ { shown = false, owner = "UIParent", text = "X" },
                          { shown = true, owner = "SomeButton", text = "Backpack" },
                          { shown = true, owner = "UIParent", text = "Kobold", unit = "mouseover" } }) do
      local c = gatherer(H, { tooltip = tt })
      mine(c, VEIN)
      H.eq(c.env.ForeverLedgerDB.nodes[B][1731].name, nil, tt.text)
    end
    local c = gatherer(H, { missing = { GameTooltip = true } })
    mine(c, VEIN)
    H.eq(c.env.ForeverLedgerDB.nodes[B][1731].opened, 1)
  end)

  H.test("gathering: the gather cast's target name (UNIT_SPELLCAST_SENT) names the node before the tooltip", function()
    local c = gatherer(H) -- the tooltip says "Copper Vein"
    mine(c, VEIN, nil, "Tin Vein")
    local d = c.env.ForeverLedgerDB
    H.eq(d.nodes[B][1731].name, "Tin Vein")
    mine(c, VEIN2, nil, "") -- no target name: the tooltip, but a known name is kept
    H.eq(d.nodes[B][1731].name, "Tin Vein")
    c.fire("UNIT_SPELLCAST_SENT", "player", "Kobold Vermin", "Cast-X", 133) -- not a gather spell
    c.fire("UNIT_SPELLCAST_SENT", "target", "Mithril Deposit", "Cast-Y", 2575) -- not the player
    mine(c, "GameObject-0-1-0-1-1732-0000N01")
    H.eq(d.nodes[B][1732].name, "Copper Vein", "no matching SENT: the tooltip")
    c.fire("UNIT_SPELLCAST_SENT", "player", "Silverleaf", "Cast-Other", 2575) -- another cast's target
    mine(c, "GameObject-0-1-0-1-1733-0000N01")
    H.eq(d.nodes[B][1733].name, "Copper Vein", "a SENT for another castGUID is not this cast's")
  end)

  H.test("gathering: a chest opened right after mining is not that vein's harvest or skill", function()
    local c = gatherer(H)
    mine(c, VEIN, nil, "Copper Vein")
    lootNode(c, { { itemID = 2589, sourceGUID = "GameObject-0-1-0-1-2843-0000C01" } })
    local d = c.env.ForeverLedgerDB
    H.eq(d.nodes[B][2843].opened, 1)
    H.eq(d.nodes[B][2843].skillLineID, nil)
    H.eq(d.nodes[B][2843].name, "Copper Vein", "the tooltip")
  end)

  H.test("gathering: skinning a creature stays drops of that npc; its corpse is not counted twice", function()
    local c = gatherer(H)
    local mob = "Creature-0-1-0-1-1234-0000A01"
    lootNode(c, { { itemID = 2589, sourceGUID = mob }, { money = 12, sourceGUID = mob } })
    c.fire("UNIT_SPELLCAST_SUCCEEDED", "player", "Cast-S", 8613)
    lootNode(c, { { itemID = 2318, sourceGUID = mob } }) -- Light Leather: not in world.items, no link, skipped
    c.world.items[2318] = { name = "Light Leather", quality = 1, ilvl = 5, type = "Trade Goods", subtype = "Leather" }
    lootNode(c, { { itemID = 2318, sourceGUID = mob } })
    local d = c.env.ForeverLedgerDB
    H.eq(d.corpses[B][1234].n, 1)
    H.eq(d.corpses[B][1234].copper, 12)
    H.eq(d.drops[2318][B][1234], 1)
    H.eq(d.drops[2589][B][1234], 1)
    H.eq(next(d.nodes), nil)
    H.eq(next(d.nodeLoot), nil)
  end)

  H.test("gathering: an AoE window with a corpse and a chest splits into a drop and node loot", function()
    local c = gatherer(H)
    lootNode(c, { { itemID = 2589, quantity = 3,
                    sources = { "Creature-0-1-0-1-99-0000B01", 1, "GameObject-0-1-0-1-2843-0000C01", 2 } } })
    local d = c.env.ForeverLedgerDB
    H.eq(d.drops[2589][B][99], 1)
    H.eq(d.dropQty[2589][B][99], 1)
    H.eq(d.drops[2589][B][0], nil)
    H.eq(d.nodeLoot[2589][B][2843].qty, 2)
    H.eq(d.corpses[B][99].n, 1)
  end)

  H.test("gathering: creature drops, corpses and runs are exactly what 0.2.4 recorded", function()
    local function play(addon)
      local c = H.new({ items = S.items(), questLog = S.questLog(), professionAPI = true })
      c.load(addon)
      S.play(c, "ForeverLedger")
      local more = { { itemID = 2589, sourceGUID = "Creature-0-1-0-1-99-0000B01", quantity = 2 },
                     { money = 30, sourceGUID = "Creature-0-1-0-1-99-0000B01" } }
      c.world.loot = more
      c.fire("LOOT_OPENED")
      c.world.loot = {}
      return c.env.ForeverLedgerDB
    end
    local old, new = play("legacy/ForeverLedger-0.2.4.lua"), play(ADDON)
    local ser = require("harness").serialize
    for _, k in ipairs({ "drops", "dropQty", "corpses", "runs", "turnIns", "items", "quests" }) do
      H.eq(ser(k, new[k]), ser(k, old[k]), k)
    end
  end)

  ---------------------------------------------------------------- trainers

  H.test("trainers: a profession trainer's services, costs and requirements are recorded", function()
    local c = session(H)
    atTrainer(c)
    local d = c.env.ForeverLedgerDB
    local t = d.trainers[B][1103]
    H.eq(t.name, "Eldrin")
    H.eq(t.loc.zone, "Elwynn Forest")
    H.eq(t.loc.mapID, 1429)
    H.eq(t.loc.x, 42.1)
    H.eq(t.skillLineID, TAILORING)
    H.eq(t.seenAt, c.world.clock)
    H.eq(#t.services, 3, "headers are left out")
    local vest = t.services[1]
    H.eq(vest.name, "Brown Linen Vest")
    H.eq(vest.type, "available")
    H.eq(vest.cost, 100)
    H.eq(vest.skill, "Tailoring")
    H.eq(vest.skillRank, 10)
    H.eq(vest.level, 5)
    H.eq(vest.itemID, 2568)
    H.eq(t.services[2].type, "unavailable")
    H.eq(t.services[3].skill, nil)
    H.eq(t.services[3].itemID, nil)
    H.ok(d.items[2568].byBuild[B], "service items are scanned")
    local s = d.apiSamples.GetTrainerServiceInfo.sample
    H.eq(s[1], "Tailoring")
    H.eq(s[3], "header")
  end)

  H.test("trainers: class trainers are not recorded", function()
    local c = session(H)
    atTrainer(c, nil, false)
    H.eq(next(c.env.ForeverLedgerDB.trainers), nil)
  end)

  H.test("trainers: updates replace the list, throttled with one trailing scan", function()
    local c = session(H)
    atTrainer(c)
    H.eq(c.world.calls.GetNumTrainerServices, 1)
    local services = tailorServices()
    services[2].type = "used" -- bought
    table.remove(services, 4)
    c.world.trainer.services = services
    c.fire("TRAINER_UPDATE")
    c.fire("TRAINER_UPDATE")
    H.eq(c.world.calls.GetNumTrainerServices, 1)
    c.advance(2)
    H.eq(c.world.calls.GetNumTrainerServices, 2)
    local t = c.env.ForeverLedgerDB.trainers[B][1103]
    H.eq(#t.services, 2)
    H.eq(t.services[1].type, "used")
    c.fire("TRAINER_CLOSED")
    c.advance(5)
    c.fire("TRAINER_UPDATE")
    H.eq(c.world.calls.GetNumTrainerServices, 2, "closed windows are not read")
    H.eq(H.count(c.env.ForeverLedgerDB.trainers[B]), 1)
  end)

  H.test("trainers: the skill line comes from the skill requirement when the service has no skill line", function()
    local c = session(H)
    local services = tailorServices()
    for _, s in ipairs(services) do s.skillLine = nil end
    atTrainer(c, services)
    H.eq(c.env.ForeverLedgerDB.trainers[B][1103].skillLineID, TAILORING)
  end)

  ---------------------------------------------------------------- vendors

  H.test("vendors: every item with price, stack, stock and currency; items are scanned", function()
    local c = session(H)
    atVendor(c)
    local d = c.env.ForeverLedgerDB
    local v = d.vendors[B][1347]
    H.eq(v.name, "Alexandra Bolero")
    H.eq(v.loc.subzone, "Goldshire")
    H.eq(v.seenAt, c.world.clock)
    H.eq(#v.items, 3)
    H.eq(v.items[1].itemID, 2320)
    H.eq(v.items[1].price, 10)
    H.eq(v.items[1].stack, 5)
    H.eq(v.items[1].numAvailable, -1)
    H.eq(v.items[1].currencyID, nil)
    H.eq(v.items[1].extendedCost, false)
    H.eq(v.items[2].numAvailable, 1)
    H.eq(v.items[3].extendedCost, true)
    H.eq(v.items[3].currencyID, 1901)
    H.eq(d.items[2598].classID, 9, "a recipe for sale is findable by class")
    H.ok(d.items[2320].byBuild[B], "stock is scanned")
    H.eq(d.apiSamples["C_MerchantFrame.GetItemInfo"].sample.price, 10)
  end)

  H.test("vendors: updates replace the list; closed or non-NPC merchants are not read", function()
    local c = session(H)
    atVendor(c)
    c.world.merchant.items[2].info.numAvailable = 0
    table.remove(c.world.merchant.items, 3)
    c.advance(1)
    c.fire("MERCHANT_UPDATE")
    c.advance(1)
    local v = c.env.ForeverLedgerDB.vendors[B][1347]
    H.eq(#v.items, 2)
    H.eq(v.items[2].numAvailable, 0)
    c.fire("MERCHANT_CLOSED")
    c.advance(5)
    c.fire("MERCHANT_UPDATE")
    H.eq(c.world.calls.GetMerchantNumItems, 2)
    atVendor(c, nil, "GameObject-0-1-0-1-9999-0000X01")
    H.eq(c.world.calls.GetMerchantNumItems, 2)
    H.eq(H.count(c.env.ForeverLedgerDB.vendors[B]), 1)
  end)

  H.test("vendors: item info that has not loaded yet still lists the item", function()
    local c = session(H)
    local stock = { { itemID = 2320 } }
    atVendor(c, stock)
    local it = c.env.ForeverLedgerDB.vendors[B][1347].items[1]
    H.eq(it.itemID, 2320)
    H.eq(it.price, nil)
    H.eq(c.env.ForeverLedgerDB.apiSamples["ForeverLedger.fieldMisses"], nil, "no table, no miss")
  end)

  H.test("vendors and trainers: at most 500 entries per NPC", function()
    local c = session(H)
    local stock, services = {}, {}
    for i = 1, 510 do
      stock[i] = merchantItem(2320, i)
      services[i] = { name = "Service " .. i, cost = i }
    end
    atVendor(c, stock)
    atTrainer(c, services)
    H.eq(#c.env.ForeverLedgerDB.vendors[B][1347].items, 500)
    H.eq(#c.env.ForeverLedgerDB.trainers[B][1103].services, 500)
  end)

  H.test("vendors and trainers: each build keeps its own list", function()
    local c = session(H)
    atVendor(c)
    atTrainer(c)
    local d = c.env.ForeverLedgerDB
    local c2 = session(H, { buildInfo = { "1.15.8", "61600", "Oct 01 2026", 11508 } }, d)
    atVendor(c2, { merchantItem(2320, 12) })
    H.eq(d.vendors[B][1347].items[1].price, 10)
    H.eq(d.vendors[61600][1347].items[1].price, 12)
    H.eq(d.trainers[61600], nil)
  end)

  H.test("vendors and trainers: missing window APIs do not break anything", function()
    local c = session(H, { missing = { GetMerchantNumItems = true, C_MerchantFrame = true, IsTradeskillTrainer = true,
                                       GetNumTrainerServices = true, C_Timer = true } })
    atVendor(c)
    atTrainer(c)
    c.fire("NEW_RECIPE_LEARNED", LINEN_SHIRT)
    local d = c.env.ForeverLedgerDB
    H.eq(next(d.vendors), nil)
    H.eq(next(d.trainers), nil)
    H.eq(d.learned[1].via, "trainer:1103")
    local c2 = session(H, { missing = { C_MerchantFrame = true, GetMerchantItemID = true } })
    atVendor(c2)
    H.eq(c2.env.ForeverLedgerDB.vendors[B][1347].items[2].itemID, 2598, "the id from the item link")
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
    c.advance(10)
    cast(c, "Cast-N", LINEN_BOLT, true)
    result(c, 2996, 1)
    created(c, 2996, 1)
    H.eq(statusCount(c), 13, "one craft, however many signals")
    c.fire("UNIT_SPELLCAST_SUCCEEDED", "player", "Cast-M", 2575)
    lootNode(c, { { itemID = 2770, sourceGUID = VEIN, quantity = 2 } })
    lootNode(c, { { itemID = 2770, sourceGUID = VEIN, quantity = 2 } })
    H.eq(statusCount(c), 16, "node, node loot and the Copper Ore snapshot; the reopened vein adds nothing")
    atTrainer(c)
    atVendor(c)
    c.advance(5)
    c.fire("MERCHANT_UPDATE")
    H.eq(statusCount(c), 19, "a trainer, a vendor and the Pattern snapshot; a rescan adds nothing")
    c.slash("FOREVERLEDGER", "")
    H.ok(printed(c, "professions: 2 skills, 3 recipes, 1 crafts, 1 nodes gathered, 1 trainers, 1 vendors."),
      table.concat(c.world.printed, "\n"))
  end)
  ---------------------------------------------------------------- schema 4 fixture
  H.test("professions: session-v4 fixture fills every schema 4 table from one real session", function()
    local d = v4Session(H)
    H.writeFile(FIXTURE, H.serialize("ForeverLedgerDB", d))
    H.eq(d.meta.schemaVersion, 4)
    for _, k in ipairs({ "skills", "skillUps", "recipes", "recipeSeen", "learned", "crafts", "nodes", "nodeLoot",
                         "trainers", "vendors", "apiSamples", "quests", "turnIns", "runs", "drops", "corpses" }) do
      H.ok(next(d[k]) ~= nil, k)
    end
    H.eq(#d.skillUps, 1)
    H.eq(d.skillUps[1].recipeID, LINEN_BOLT)
    H.eq(d.learned[1].via, "trainer:1103")
    H.eq(d.learned[2].via, "item:2598")
    local seen = d.recipeSeen[B][ME]
    H.eq(seen[RED_ROBE].learned, true, "learned from the pattern, then rescanned")
    H.ok(seen[LINEN_SHIRT].byDifficulty.optimal and seen[LINEN_SHIRT].byDifficulty.medium, "two difficulties")
    local k = d.crafts[B][LINEN_BOLT]
    H.eq(k.casts, 1)
    H.eq(k.qty, 3)
    H.eq(k.procs, 1)
    H.eq(k.skillUps, 1)
    H.eq(d.crafts[B][LINEN_SHIRT].casts, 1)
    H.eq(d.nodes[B][1731].opened, 2)
    H.eq(d.nodes[B][0].opened, 1)
    H.eq(d.items[2598].classID, 9)
    H.ok(d.trainers[B][1103] and d.vendors[B][1347], "trainer and vendor")
    local misses = d.apiSamples["ForeverLedger.fieldMisses"].sample
    H.eq(misses["C_TradeSkillUI.GetRecipeSchematic:quantityMax"], "quantityMax|maxQuantity")
    local learned = d.apiSamples.NEW_RECIPE_LEARNED.sample
    H.eq(learned[1], LINEN_SHIRT)
    H.eq(learned[2], nil, "a nil gap")
    H.eq(learned[3], LINEN_SHIRT)
  end)
end
