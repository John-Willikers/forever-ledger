-- Plays the scenario with the real v0.1.0 addon, then loads the current addon on top of its SavedVariables.
-- Also: schema 1/2 files written by the real 0.2.2/0.2.3 addons are stamped schema 3, keep session "" (their drops
-- are running totals the server already stores under ""), and are otherwise left alone.
local S = require("scenario")

local LEGACY = "legacy/ForeverLedger-0.1.0.lua"
local ADDON_0_2_2 = "legacy/ForeverLedger-0.2.2.lua"
local ADDON_0_2_3 = "legacy/ForeverLedger-0.2.3.lua"
local ADDON = "../ForeverLedger/ForeverLedger.lua"
local FIXTURES = "../../fixtures/synthetic/"
local ME = "Thibodeaux-Bayou"

return function(H)
  local old = H.new({ items = S.items(), questLog = S.questLog() })
  old.load(LEGACY)
  S.play(old, "ForeverLedger")
  local v0 = old.env.ForeverLedgerDB
  H.writeFile(FIXTURES .. "session-v0.lua", H.serialize("ForeverLedgerDB", v0))

  H.test("migration: v0.1.0 produced the legacy shape", function()
    H.eq(v0.meta.schemaVersion, nil)
    H.eq(type(v0.meta.build), "table")
    H.eq(#v0.quests[1234].turnIns, 1)
    H.eq(v0.drops[872][644], 1)
  end)

  local new = H.new({ items = S.items(), questLog = S.questLog(), clock = old.world.clock + 60 })
  new.env.ForeverLedgerDB = H.copy(v0)
  new.load(ADDON)
  new.login("ForeverLedger")
  local db = new.env.ForeverLedgerDB
  H.writeFile(FIXTURES .. "session-migrated.lua", H.serialize("ForeverLedgerDB", db))

  H.test("migration: stamps the current schema (3) and flattens meta.build", function()
    H.eq(db.meta.schemaVersion, 3)
    H.eq(db.meta.session, "")
    H.eq(db.meta.build, 61582)
  end)

  H.test("migration: quest fields become observations under the old build", function()
    local q = db.quests[1234]
    H.eq(q.xpOffered, nil)
    H.eq(q.turnIns, nil)
    H.eq(q.giver, nil)
    local complete = q.obs["61582:complete:" .. ME]
    H.ok(complete, "complete obs")
    H.eq(complete.xp, 850)
    H.eq(#complete.choices, 2)
    H.eq(complete.npc.id, 240)
    H.ok(q.obs["61582:detail:" .. ME], "detail obs")
    H.ok(q.obs["61582:accept:" .. ME], "accept obs")
  end)

  H.test("migration: turn-ins move to the top level with ids", function()
    H.eq(#db.turnIns, 1)
    H.eq(db.turnIns[1].id, ME .. "-1234-" .. db.turnIns[1].time)
    H.eq(db.turnIns[1].build, 61582)
  end)

  H.test("migration: items and drops gain a build level", function()
    H.eq(db.items[872].byBuild[61582].ilvl, 21)
    H.eq(db.items[872].ilvl, nil)
    H.eq(db.drops[872][61582][644], 1)
  end)

  H.test("migration: runs get ids, build and a char key", function()
    local r = db.runs[1]
    H.eq(r.char, ME)
    H.eq(r.charLevel, 10)
    H.eq(r.build, 61582)
    H.eq(r.id, ME .. "-36-" .. r.start)
  end)

  H.test("migration: runs only once", function()
    local again = H.new({ items = S.items(), questLog = S.questLog() })
    again.env.ForeverLedgerDB = H.copy(db)
    again.load(ADDON)
    again.login("ForeverLedger")
    H.eq(#again.env.ForeverLedgerDB.turnIns, 1)
    H.eq(again.env.ForeverLedgerDB.drops[872][61582][644], 1)
  end)

  for _, legacy in ipairs({ { ADDON_0_2_2, 1 }, { ADDON_0_2_3, 2 } }) do
    H.test("migration: schema " .. legacy[2] .. " data is stamped 3, keeps session \"\" and is kept as is", function()
      local old2 = H.new({ items = S.items(), questLog = S.questLog() })
      old2.load(legacy[1])
      S.play(old2, "ForeverLedger")
      local v = old2.env.ForeverLedgerDB
      H.eq(v.meta.schemaVersion, legacy[2])
      local before = H.copy(v)

      local up = H.new({ items = S.items(), questLog = S.questLog(), clock = old2.world.clock + 60 })
      up.env.ForeverLedgerDB = H.copy(v)
      up.load(ADDON)
      up.login("ForeverLedger")
      local d = up.env.ForeverLedgerDB
      H.eq(d.meta.schemaVersion, 3)
      H.eq(d.meta.addonVersion, "0.2.4")
      H.eq(d.meta.session, "")
      H.eq(#d.turnIns, 1)
      H.eq(d.turnIns[1].id, before.turnIns[1].id)
      H.eq((d.turnIns[1].choice or {}).itemID, (before.turnIns[1].choice or {}).itemID)
      H.eq(H.count(d.quests[1234].obs), H.count(before.quests[1234].obs))
      H.eq(#d.runs, #before.runs)
      H.eq(d.drops[872][61582][644], 1)
      H.eq(next(d.corpses), nil)
    end)
  end
end
