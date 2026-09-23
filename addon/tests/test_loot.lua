-- ForeverLedger 0.2.4: sessions, corpses, stack sizes, money, boss loot rolls and group loot from chat.
local S = require("scenario")

local ADDON = "../ForeverLedger/ForeverLedger.lua"
local B = 61582
local MOB_A = "Creature-0-1-0-1-1234-0000A01" -- two Vile Familiars (npc 1234) and a Kobold (npc 99)
local MOB_B = "Creature-0-1-0-1-1234-0000A02"
local KOBOLD = "Creature-0-1-0-1-99-0000B01"

local function session(H, overrides, savedDB)
  local world = { items = S.items(), questLog = S.questLog() }
  for k, v in pairs(overrides or {}) do world[k] = v end
  local ctl = H.new(world)
  ctl.env.ForeverLedgerDB = savedDB
  ctl.load(ADDON)
  ctl.login("ForeverLedger")
  return ctl
end

local function loot(ctl, slots)
  ctl.world.loot = slots
  ctl.fire("LOOT_OPENED")
  ctl.fire("LOOT_CLOSED")
  ctl.world.loot = {}
end

-- In the Deadmines with two named party members.
local function grouped(H, overrides)
  local c = session(H, overrides)
  c.world.party = { { class = "WARRIOR", level = 18, name = S.PARTY_NAMES[1] },
                    { class = "PRIEST", level = 17, name = S.PARTY_NAMES[2] } }
  c.world.instance = S.DEADMINES
  c.fire("PLAYER_ENTERING_WORLD", false, false)
  return c
end

-- Every string key and value anywhere in t.
local function strings(t, out, seen)
  out, seen = out or {}, seen or {}
  if seen[t] then return out end
  seen[t] = true
  for k, v in pairs(t) do
    if type(k) == "string" then out[#out + 1] = k end
    if type(v) == "string" then out[#out + 1] = v elseif type(v) == "table" then strings(v, out, seen) end
  end
  return out
end

local function assertNoPartyNames(H, db)
  for _, s in ipairs(strings(db)) do
    for _, name in ipairs(S.PARTY_NAMES) do
      H.ok(not s:find(name, 1, true), "party name stored: " .. s)
    end
  end
end

return function(H)
  H.test("loot: a fresh table gets a session once; it stays for the life of the table", function()
    local c = session(H)
    local d = c.env.ForeverLedgerDB
    local id = d.meta.session
    H.ok(type(id) == "string" and id:match("^" .. c.world.clock .. "%-%x%x%x%x$"), tostring(id))
    local again = session(H, { clock = c.world.clock + 30 }, d) -- a client that loads SavedVariables back
    H.eq(again.env.ForeverLedgerDB.meta.session, id)
    local fresh = session(H, { clock = c.world.clock + 30 }) -- Forever: every load starts empty
    H.ok(fresh.env.ForeverLedgerDB.meta.session ~= id, "a new table is a new session")
  end)

  H.test("loot: corpses are counted once per source GUID, with their copper", function()
    local c = session(H)
    loot(c, { { itemID = 2589, sourceGUID = MOB_A }, { money = 12, sourceGUID = MOB_A } })
    loot(c, { { itemID = 2589, sourceGUID = MOB_A }, { money = 12, sourceGUID = MOB_A } }) -- reopened
    loot(c, { { money = 30, sourceGUID = MOB_B } })
    loot(c, { { itemID = 2589, sourceGUID = KOBOLD } })
    local d = c.env.ForeverLedgerDB
    H.eq(d.corpses[B][1234].n, 2)
    H.eq(d.corpses[B][1234].copper, 42)
    H.eq(d.corpses[B][99].n, 1)
    H.eq(d.corpses[B][99].copper, 0)
    H.eq(d.drops[2589][B][1234], 1)
    H.eq(d.drops[2589][B][99], 1)
  end)

  H.test("loot: stack sizes go to dropQty, the source count stays in drops", function()
    local c = session(H)
    loot(c, { { itemID = 2589, sourceGUID = MOB_A, quantity = 3 } })
    loot(c, { { itemID = 2589, sourceGUID = MOB_B, quantity = 2 } })
    local d = c.env.ForeverLedgerDB
    H.eq(d.drops[2589][B][1234], 2)
    H.eq(d.dropQty[2589][B][1234], 5)
  end)

  H.test("loot: AoE loot splits one slot across its sources", function()
    local c = session(H)
    loot(c, {
      { itemID = 2589, quantity = 3, sources = { MOB_A, 2, KOBOLD, 1 } },
      { money = 50, sources = { MOB_A, 20, KOBOLD, 30 } },
      { itemID = 872, sources = { MOB_B, 1 } },
    })
    local d = c.env.ForeverLedgerDB
    H.eq(d.drops[2589][B][1234], 1)
    H.eq(d.dropQty[2589][B][1234], 2)
    H.eq(d.drops[2589][B][99], 1)
    H.eq(d.dropQty[2589][B][99], 1)
    H.eq(d.corpses[B][1234].n, 2)
    H.eq(d.corpses[B][1234].copper, 20)
    H.eq(d.corpses[B][99].n, 1)
    H.eq(d.corpses[B][99].copper, 30)
    H.eq(d.drops[872][B][1234], 1)
  end)

  H.test("loot: a money slot without a per-source amount takes the GetMoney gain for its first source", function()
    local c = session(H)
    c.world.money = 1000
    c.world.loot = { { money = 0, sources = { MOB_A } } }
    c.fire("LOOT_OPENED")
    c.world.money = 1017
    c.fire("PLAYER_MONEY")
    c.fire("LOOT_CLOSED")
    c.world.money = 5000 -- a vendor sale later is not loot
    c.fire("PLAYER_MONEY")
    H.eq(c.env.ForeverLedgerDB.corpses[B][1234].copper, 17)
  end)

  H.test("loot: unknown sources are drops of npc 0 without corpses; chests are node loot (schema 4)", function()
    local c = session(H, { missing = { GetLootSourceInfo = true } })
    loot(c, { { itemID = 2589, sourceGUID = MOB_A, quantity = 4 } })
    local d = c.env.ForeverLedgerDB
    H.eq(d.drops[2589][B][0], 1)
    H.eq(d.dropQty[2589][B][0], 4)
    H.eq(next(d.corpses), nil)
    local chest = session(H)
    loot(chest, { { itemID = 2589, sourceGUID = "GameObject-0-1-0-1-2843-0000C01" } })
    H.eq(chest.env.ForeverLedgerDB.drops[2589], nil)
    H.eq(chest.env.ForeverLedgerDB.nodeLoot[2589][B][2843].n, 1)
    H.eq(next(chest.env.ForeverLedgerDB.corpses), nil)
  end)

  -- The scenario rolls Rockslicer on Rhahk'Zor: Boudreaux (WARRIOR) wins with 91 over our 45.
  local c = H.new({ items = S.items(), questLog = S.questLog() })
  c.load(ADDON)
  S.play(c, "ForeverLedger")
  local db = c.env.ForeverLedgerDB
  local run = db.runs[1]

  H.test("loot: the run records the loot method as the Enum key", function()
    H.eq(run.lootMethod, "group")
  end)

  H.test("loot: boss loot keeps the winner's class and the rolls, updated as the roll resolves", function()
    H.eq(#run.bossLoot, 1)
    local e = run.bossLoot[1]
    H.eq(e.encounterID, 1)
    H.eq(e.lootListKey, 1)
    H.eq(e.itemID, 872)
    H.eq(e.winnerClass, "WARRIOR")
    H.eq(e.winnerIsSelf, false)
    H.eq(#e.rolls, 2)
    H.eq(e.rolls[1].class, "WARRIOR")
    H.eq(e.rolls[1].roll, 91)
    H.eq(e.rolls[1].state, "needmainspec")
    H.eq(e.rolls[2].class, "HUNTER")
    H.eq(e.rolls[2].roll, 45)
    H.eq(e.rolls[2].state, "greed")
  end)

  H.test("loot: boss loot is deduped by encounter and loot list key", function()
    local g = grouped(H)
    local link = require("harness").itemLink(872, g.world.items[872])
    g.world.lootHistory[7] = { { lootListKey = 1, itemHyperlink = link, rollInfos = {} },
                               { lootListKey = 2, itemHyperlink = link, rollInfos = {}, allPassed = true } }
    g.fire("ENCOUNTER_END", 7, "Boss", 1, 5, 1)
    g.fire("LOOT_HISTORY_UPDATE_ENCOUNTER", 7)
    g.fire("LOOT_HISTORY_UPDATE_DROP", 7, 1)
    g.fire("LOOT_HISTORY_UPDATE_DROP", 7, 2)
    local r = g.env.ForeverLedgerDB.runs[1]
    H.eq(#r.bossLoot, 2)
    H.eq(r.bossLoot[1].allPassed, nil)
    H.eq(r.bossLoot[2].allPassed, true)
    H.eq(r.bossLoot[1].winnerClass, nil)
    g.world.lootHistory[7][1].winner = { playerName = "Me", playerClass = "HUNTER", isSelf = true, isWinner = true }
    g.fire("LOOT_HISTORY_UPDATE_DROP", 7, 1)
    H.eq(#r.bossLoot, 2)
    H.eq(r.bossLoot[1].winnerClass, "HUNTER")
    H.eq(r.bossLoot[1].winnerIsSelf, true)
  end)

  H.test("loot: party loot from chat by class; self lines tagged self; won + received is one entry", function()
    local gl = run.groupLoot
    H.eq(#gl, 3)
    H.eq(gl[1].itemID, 872)
    H.eq(gl[1].by, "party")
    H.eq(gl[1].class, "WARRIOR")
    H.eq(gl[1].won, true)
    H.eq(gl[1].qty, 1)
    H.eq(gl[2].itemID, 2589)
    H.eq(gl[2].class, "PRIEST")
    H.eq(gl[2].qty, 2)
    H.eq(gl[2].won, nil)
    H.eq(gl[3].by, "self")
    H.eq(gl[3].class, nil)
    H.eq(gl[3].qty, 3)
    H.ok(db.items[2589] and db.items[2589].byBuild[B], "items others loot are snapshotted")
  end)

  H.test("loot: a received line before the won line is still one entry", function()
    local g = grouped(H)
    local link = require("harness").itemLink(872, g.world.items[872])
    g.lootLine("LOOT_ITEM", S.PARTY_NAMES[2], S.PARTY_NAMES[2], link)
    g.lootLine("LOOT_ROLL_WON", S.PARTY_NAMES[2], S.PARTY_NAMES[2], link)
    g.lootLine("LOOT_ROLL_YOU_WON", g.world.player.name, link)
    local gl = g.env.ForeverLedgerDB.runs[1].groupLoot
    H.eq(#gl, 2)
    H.eq(gl[1].class, "PRIEST")
    H.eq(gl[1].won, true)
    H.eq(gl[2].by, "self")
    H.eq(gl[2].won, true)
  end)

  H.test("loot: an unknown looter is party with no class; Name-Realm matches a party unit", function()
    local g = grouped(H)
    g.world.party[3] = { class = "MAGE", level = 17, name = "Hebert", realm = "Swamp" }
    local link = require("harness").itemLink(2589, g.world.items[2589])
    g.lootLine("LOOT_ITEM", "Stranger", "Stranger", link)
    g.lootLine("LOOT_ITEM", "Hebert-Swamp", "Hebert-Swamp", link)
    local gl = g.env.ForeverLedgerDB.runs[1].groupLoot
    H.eq(gl[1].by, "party")
    H.eq(gl[1].class, nil)
    H.eq(gl[2].class, "MAGE")
  end)

  H.test("loot: no group loot solo or outside a run", function()
    local solo = session(H)
    solo.world.instance = S.DEADMINES
    solo.fire("PLAYER_ENTERING_WORLD", false, false)
    local link = require("harness").itemLink(2589, solo.world.items[2589])
    solo.lootLine("LOOT_ITEM_SELF", solo.world.player.name, link)
    H.eq(#solo.env.ForeverLedgerDB.runs[1].groupLoot, 0)
    local outside = session(H)
    outside.world.party = { { class = "WARRIOR", level = 18, name = S.PARTY_NAMES[1] } }
    outside.lootLine("LOOT_ITEM", S.PARTY_NAMES[1], S.PARTY_NAMES[1], link)
    H.eq(#outside.env.ForeverLedgerDB.runs, 0)
  end)

  H.test("loot: patterns come from the client's GlobalStrings, positional ones included", function()
    local g = grouped(H, { globalStrings = {
      LOOT_ITEM = "%s erhält Beute: %s.",
      LOOT_ITEM_MULTIPLE = "%s erhält Beute: %sx%d.",
      LOOT_ITEM_SELF = "Ihr erhaltet Beute: %s.",
      LOOT_ITEM_SELF_MULTIPLE = "Ihr erhaltet Beute: %sx%d.",
      LOOT_ROLL_WON = "Gewonnen: %2$s (%1$s)", -- arguments in the other order
      LOOT_ROLL_YOU_WON = "Ihr habt gewonnen: %s",
    } })
    local H_ = require("harness")
    local linen = H_.itemLink(2589, g.world.items[2589])
    local axe = H_.itemLink(872, g.world.items[872])
    g.fire("CHAT_MSG_LOOT", S.PARTY_NAMES[2] .. " erhält Beute: " .. linen .. "x4.", S.PARTY_NAMES[2])
    g.fire("CHAT_MSG_LOOT", "Ihr erhaltet Beute: " .. linen .. ".", g.world.player.name)
    g.fire("CHAT_MSG_LOOT", "Gewonnen: " .. axe .. " (" .. S.PARTY_NAMES[1] .. ")", S.PARTY_NAMES[1])
    g.fire("CHAT_MSG_LOOT", "You receive loot: " .. linen .. ".", g.world.player.name) -- not this client's text
    local gl = g.env.ForeverLedgerDB.runs[1].groupLoot
    H.eq(#gl, 3)
    H.eq(gl[1].class, "PRIEST")
    H.eq(gl[1].qty, 4)
    H.eq(gl[2].by, "self")
    H.eq(gl[2].qty, 1)
    H.eq(gl[3].itemID, 872)
    H.eq(gl[3].class, "WARRIOR")
    H.eq(gl[3].won, true)
  end)

  H.test("loot: missing GlobalStrings fall back to the enUS text", function()
    local g = grouped(H, { missing = { LOOT_ITEM = true, LOOT_ITEM_MULTIPLE = true } })
    local linen = require("harness").itemLink(2589, g.world.items[2589])
    g.fire("CHAT_MSG_LOOT", S.PARTY_NAMES[2] .. " receives loot: " .. linen .. "x2.", S.PARTY_NAMES[2])
    local gl = g.env.ForeverLedgerDB.runs[1].groupLoot
    H.eq(#gl, 1)
    H.eq(gl[1].qty, 2)
  end)

  H.test("loot: party members' names are never stored", function()
    assertNoPartyNames(H, db)
    H.ok(#run.groupLoot > 0 and #run.bossLoot > 0, "the scenario did record group and boss loot")
  end)

  H.test("loot: group and boss loot lists are capped at 500 per run", function()
    local g = grouped(H)
    local linen = require("harness").itemLink(2589, g.world.items[2589])
    for i = 1, 510 do
      g.advance(61) -- outside the won/received pairing window
      g.lootLine("LOOT_ITEM_MULTIPLE", S.PARTY_NAMES[2], S.PARTY_NAMES[2], linen, i)
    end
    local drops = {}
    for i = 1, 505 do drops[i] = { lootListKey = i, itemHyperlink = linen, rollInfos = {} } end
    g.world.lootHistory[9] = drops
    g.fire("LOOT_HISTORY_UPDATE_ENCOUNTER", 9)
    local r = g.env.ForeverLedgerDB.runs[1]
    H.eq(#r.groupLoot, 500)
    H.eq(r.groupLoot[1].qty, 11)
    H.eq(r.groupLoot[500].qty, 510)
    H.eq(#r.bossLoot, 500)
    H.eq(r.bossLoot[500].lootListKey, 505)
  end)

  H.test("loot: without Enum, C_LootHistory and C_PartyInfo nothing breaks", function()
    local g = grouped(H, { missing = { Enum = true, C_LootHistory = true, C_PartyInfo = true,
                                       GetLootSlotType = true, GetLootSlotInfo = true, GetMoney = true },
                           lootMethod = 3 })
    loot(g, { { itemID = 2589, sourceGUID = MOB_A, quantity = 2 }, { money = 9, sourceGUID = MOB_A } })
    g.fire("ENCOUNTER_END", 1, "Rhahk'Zor", 1, 5, 1)
    g.fire("LOOT_HISTORY_UPDATE_ENCOUNTER", 1)
    g.fire("PLAYER_MONEY")
    local d = g.env.ForeverLedgerDB
    H.eq(d.drops[2589][B][1234], 1)
    H.eq(d.dropQty[2589][B][1234], 2) -- no GetLootSlotInfo: the per-source amount from GetLootSourceInfo
    H.eq(d.corpses[B][1234].n, 1)
    H.eq(d.corpses[B][1234].copper, 0) -- no slot type: the money slot is not recognised
    H.eq(d.runs[1].lootMethod, nil)
    H.eq(#d.runs[1].bossLoot, 0)
  end)

  H.test("loot: a raw loot method is kept when the client has no Enum for it", function()
    local g = grouped(H, { missing = { Enum = true }, lootMethod = 3 })
    H.eq(g.env.ForeverLedgerDB.runs[1].lootMethod, "3")
  end)

  H.test("loot: /fl reset wipes corpses and quantities too", function()
    local g = session(H)
    loot(g, { { itemID = 2589, sourceGUID = MOB_A, quantity = 2 } })
    g.slash("FOREVERLEDGER", "reset confirm")
    local d = g.env.ForeverLedgerDB
    H.eq(next(d.corpses), nil)
    H.eq(next(d.dropQty), nil)
    H.ok(d.meta.session ~= nil, "the session id stays")
  end)
end
