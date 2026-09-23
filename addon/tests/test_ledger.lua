-- ForeverLedger v0.2.1 behaviour and fixture generation.
local S = require("scenario")

local ADDON = "../ForeverLedger/ForeverLedger.lua"
local FIXTURES = "../../fixtures/synthetic/"
local ME = "Thibodeaux-Bayou"

local function newSession(H, overrides, savedDB)
  local world = { items = S.items(), questLog = S.questLog() }
  for k, v in pairs(overrides or {}) do world[k] = v end
  local ctl = H.new(world)
  ctl.env.ForeverLedgerDB = savedDB
  ctl.load(ADDON)
  return ctl
end

return function(H)
  local ctl = newSession(H)
  local start = ctl.world.clock
  S.play(ctl, "ForeverLedger")
  local db = ctl.env.ForeverLedgerDB

  H.test("ledger: meta carries schema and build", function()
    H.eq(db.meta.schemaVersion, 1)
    H.eq(db.meta.build, 61582)
    H.eq(db.meta.interface, 11507)
    H.eq(db.meta.addonVersion, "0.2.1")
    H.eq(db.chars[ME].class, "HUNTER")
  end)

  H.test("ledger: quest observations are keyed by build, stage and character", function()
    local q = db.quests[1234]
    H.eq(q.title, "Red Silk Bandanas")
    H.eq(q.level, 17)
    H.eq(q.category, "The Deadmines")
    H.eq(q.suggestedGroup, 5)
    local detail = q.obs["61582:detail:" .. ME]
    H.ok(detail, "detail observation")
    H.eq(detail.xp, 850)
    H.eq(detail.money, 500)
    H.eq(#detail.choices, 2)
    H.eq(detail.npc.id, 240)
    H.eq(detail.npc.loc.x, 42.1)
    H.ok(q.obs["61582:accept:" .. ME], "accept observation")
    local complete = q.obs["61582:complete:" .. ME]
    H.ok(complete, "complete observation")
    H.eq(complete.npc.loc.zone, "The Deadmines")
  end)

  H.test("ledger: items are snapshotted per build, late item info is picked up", function()
    local boots = db.items[5555]
    H.eq(boots.name, "Swampwalker's Boots")
    H.eq(boots.byBuild[61582].ilvl, 18)
    H.eq(boots.byBuild[61582].stats.ITEM_MOD_AGILITY_SHORT, 3)
    H.eq(boots.byBuild[61582].tooltip[2], "Feet\tLeather")
    H.ok(db.items[5556] and db.items[5556].byBuild[61582], "5556 scanned after GET_ITEM_INFO_RECEIVED")
  end)

  H.test("ledger: one resumed run with bosses, death, loot and xp split", function()
    H.eq(#db.runs, 1)
    local r = db.runs[1]
    H.eq(r.id, ME .. "-36-" .. (start + 60))
    H.eq(r.build, 61582)
    H.eq(r.char, ME)
    H.eq(r.awaySecs, 120)
    H.eq(r.activeSecs, 300 + 600 + 30)
    H.eq(r.endReason, "left")
    H.eq(#r.bosses, 2)
    H.eq(r.bosses[2].name, "Edwin VanCleef")
    H.eq(r.bosses[2].atSecs, 900)
    H.eq(r.deaths, 1)
    H.eq(#r.loot, 1)
    H.eq(r.xpTotal, 1200 + 2300 + 850)
    H.eq(r.questXP, 850)
    H.eq(r.mobXP, 3500)
    H.eq(#r.party, 2)
  end)

  H.test("ledger: turn-ins are top-level with stable ids and a run link", function()
    H.eq(#db.turnIns, 1)
    local t = db.turnIns[1]
    H.eq(t.questID, 1234)
    H.eq(t.xp, 850)
    H.eq(t.build, 61582)
    H.eq(t.id, ME .. "-1234-" .. t.time)
    H.eq(t.runID, db.runs[1].id)
  end)

  H.test("ledger: drops are counted per build and source npc, once per corpse", function()
    H.eq(db.drops[872][61582][644], 1)
  end)

  -- Second session on a newer build with changed item stats: both snapshots must survive.
  local items2 = S.items()
  items2[872].ilvl, items2[872].stats = 22, { ITEM_MOD_STRENGTH_SHORT = 8, ITEM_MOD_STAMINA_SHORT = 2 }
  local ctl2 = newSession(H, { items = items2, buildInfo = { "1.15.8", "61600", "Oct 01 2026", 11508 },
                               clock = ctl.world.clock + 86400 }, db)
  ctl2.login("ForeverLedger")
  ctl2.world.instance = S.DEADMINES
  ctl2.fire("PLAYER_ENTERING_WORLD", false, false)
  ctl2.world.loot = { { itemID = 872, sourceGUID = "Creature-0-1-36-1-644-0000999" } }
  ctl2.fire("LOOT_OPENED")
  ctl2.advance(1200)
  ctl2.world.instance = nil
  ctl2.fire("ZONE_CHANGED_NEW_AREA")
  local db2 = ctl2.env.ForeverLedgerDB

  H.test("ledger: a new build adds snapshots instead of overwriting", function()
    H.eq(db2.meta.build, 61600)
    H.eq(db2.items[872].byBuild[61582].ilvl, 21)
    H.eq(db2.items[872].byBuild[61600].ilvl, 22)
    H.eq(db2.items[872].byBuild[61600].stats.ITEM_MOD_STAMINA_SHORT, 2)
    H.eq(db2.drops[872][61582][644], 1)
    H.eq(db2.drops[872][61600][644], 1)
    H.eq(#db2.runs, 2)
    H.eq(db2.runs[2].build, 61600)
  end)

  H.test("ledger: history lists are trimmed FIFO at 2000", function()
    local c = newSession(H)
    c.login("ForeverLedger")
    for i = 1, 2005 do
      c.advance(1)
      c.fire("QUEST_TURNED_IN", 9000 + i, 10, 0)
    end
    local d = c.env.ForeverLedgerDB
    H.eq(#d.turnIns, 2000)
    H.eq(d.turnIns[1].questID, 9006)
    H.eq(d.turnIns[2000].questID, 11005)
  end)

  H.test("ledger: Forever 1.60 client (C_QuestLog only, QUEST_ACCEPTED(questID))", function()
    local c = newSession(H, { api = "forever", buildInfo = { "1.60.1", "69913", "Sep 17 2026", 16001 } })
    S.play(c, "ForeverLedger")
    local d = c.env.ForeverLedgerDB
    H.eq(d.meta.interface, 16001)
    local q = d.quests[1234]
    H.eq(q.title, "Red Silk Bandanas")
    H.eq(q.level, 17)
    H.eq(q.category, "The Deadmines")
    H.eq(q.suggestedGroup, 5)
    H.eq(q.objectives[1], "Red Silk Bandana: 0/10")
    H.ok(q.obs["69913:accept:" .. ME], "accept observation")
    H.eq(d.items[5555].byBuild[69913].stats.ITEM_MOD_AGILITY_SHORT, 3)
    H.eq(#d.turnIns, 1)

    c.env.C_QuestLog.SetSelectedQuest(0)
    c.slash("FOREVERLEDGER", "scanlog")
    local log = q.obs["69913:log:" .. ME]
    H.ok(log, "log observation")
    H.eq(#log.choices, 2)
    H.eq(log.money, 500)
  end)

  H.test("ledger: missing client APIs and events do not break loading", function()
    local c = newSession(H, { missing = { GetRewardXP = true, GetLootSourceInfo = true },
                              rejectEvents = { QUEST_TURNED_IN = true, ENCOUNTER_END = true } })
    S.play(c, "ForeverLedger")
    local d = c.env.ForeverLedgerDB
    H.eq(d.quests[1234].obs["61582:detail:" .. ME].xp, nil)
    H.eq(#d.turnIns, 0)
    H.eq(#d.runs[1].bosses, 0)
    H.eq(d.drops[872][61582][0], 1) -- unknown source npc
  end)

  H.writeFile(FIXTURES .. "session-v1.lua", H.serialize("ForeverLedgerDB", db2))
end
