-- Schema 8: what each character wears (db.gear), read at login and after equipment changes settle.
local P = require("professions_world")

local BOOTS, STAFF, AXE = 5555, 5556, 872 -- the staff is not in the client cache yet (cached = false)

local function dressed(H, equipped)
  return P.session(H, { equipped = equipped })
end

local function gearOf(c)
  local d = c.env.ForeverLedgerDB
  local _, g = next(d.gear)
  return g, d
end

return function(H)
  H.test("gear: read 2 s after login, with links and per-item stats", function()
    local c = dressed(H, { [8] = BOOTS, [16] = AXE })
    H.eq(next(c.env.ForeverLedgerDB.gear), nil, "nothing before the read settles")
    c.advance(3)
    local g, d = gearOf(c)
    H.eq(g.build, d.meta.build)
    H.eq(g.slots[8].itemID, BOOTS)
    H.eq(g.slots[8].stats.ITEM_MOD_AGILITY_SHORT, 3)
    H.ok(g.slots[16].link:find("item:872", 1, true))
    H.ok(d.items[BOOTS], "worn items are scanned into items")
  end)

  H.test("gear: a swap (one event per slot) is read once, after it settles", function()
    local c = dressed(H, { [8] = BOOTS })
    c.advance(3)
    local reads = 0
    local orig = c.env.GetInventoryItemLink
    c.env.GetInventoryItemLink = function(...) reads = reads + 1; return orig(...) end
    c.world.equipped = { [16] = AXE }
    c.fire("PLAYER_EQUIPMENT_CHANGED", 8, true)
    c.fire("PLAYER_EQUIPMENT_CHANGED", 16, false)
    c.advance(1)
    H.eq(reads, 0, "not while it settles")
    c.advance(2)
    H.eq(reads, 19, "one read of the 19 slots")
    local g = gearOf(c)
    H.eq(g.slots[8], nil)
    H.eq(g.slots[16].itemID, AXE)
  end)

  H.test("gear: an item without stats yet is read again until they arrive", function()
    local c = dressed(H, { [16] = STAFF })
    c.advance(3)
    local g = gearOf(c)
    H.eq(g.slots[16].itemID, STAFF, "kept even without stats")
    H.eq(g.slots[16].stats, nil)
    c.world.items[STAFF].cached = true
    c.advance(6)
    g = gearOf(c)
    H.eq(g.slots[16].stats.ITEM_MOD_INTELLECT_SHORT, 5, "the retry got them")
  end)

  H.test("gear: /fl reset confirm wipes it", function()
    local c = dressed(H, { [8] = BOOTS })
    c.advance(3)
    c.slash("FOREVERLEDGER", "reset confirm")
    H.eq(next(c.env.ForeverLedgerDB.gear), nil)
  end)
end
