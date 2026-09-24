-- ForeverLedger 0.3.4 (schema 6): what opened items (clams, lockboxes, a Message in a Bottle) held.
-- LOOT_OPENED(autoLoot, isFromItem) with isFromItem, or an "Item-" loot source GUID, is a container open. The
-- container is C_Item.GetItemIDByGUID of that GUID, else the last bag ITEM_LOCK_CHANGED within 3 s, else 0.
local P = require("professions_world")
local S = require("scenario")

local B = P.B
local BOTTLE, SCHEMATIC, CLAM, CLAM_MEAT, PEARL = 6307, 4409, 5523, 5503, 5498
local BOTTLE_GUID, CLAM_GUID, openItem = P.BOTTLE_GUID, P.CLAM_GUID, P.openItem
local MOB = "Creature-0-1-0-1-1234-0000A01"

local function session(H, overrides)
  local o = { itemGUIDs = { [BOTTLE_GUID] = BOTTLE, [CLAM_GUID] = CLAM } }
  for k, v in pairs(overrides or {}) do o[k] = v end
  return P.session(H, o)
end

local function bottle(c)
  openItem(c, { { itemID = SCHEMATIC, sourceGUID = BOTTLE_GUID } }, true)
end

local function printed(c, text)
  for _, l in ipairs(c.world.printed) do
    if l:find(text, 1, true) then return true end
  end
  return false
end

return function(H)
  H.test("containers: an isFromItem open with an Item- GUID counts the container and its loot", function()
    local c = session(H)
    bottle(c)
    local d = c.env.ForeverLedgerDB
    H.eq(d.containers[BOTTLE][B].opened, 1)
    H.eq(d.containers[BOTTLE][B].copper, 0)
    H.eq(d.containerLoot[SCHEMATIC][B][BOTTLE], 1)
    H.eq(d.containerQty[SCHEMATIC][B][BOTTLE], 1)
    H.eq(d.items[SCHEMATIC].byBuild[B] ~= nil, true, "the loot is snapshotted")
    H.eq(d.items[BOTTLE].name, "Message in a Bottle", "the container is snapshotted")
    H.eq(c.world.calls.GetItemIDByGUID, 1)
    local s = d.apiSamples["GetLootSourceInfo:container"]
    H.eq(s.build, B)
    H.eq(s.sample.isFromItem, true)
    H.eq(s.sample.containerID, BOTTLE)
    H.eq(s.sample.via, "guid")
    H.eq(s.sample.returns[1], BOTTLE_GUID)
    H.eq(s.sample.returns[2], 1)
  end)

  H.test("containers: nothing lands in drops, dropQty, corpses, nodes or run loot", function()
    local c = session(H)
    c.world.instance = S.DEADMINES
    c.fire("PLAYER_ENTERING_WORLD", false, false)
    bottle(c)
    openItem(c, { { money = 40, sourceGUID = CLAM_GUID } }, true)
    local d = c.env.ForeverLedgerDB
    H.eq(next(d.drops), nil)
    H.eq(next(d.dropQty), nil)
    H.eq(next(d.corpses), nil)
    H.eq(next(d.nodes), nil)
    H.eq(next(d.nodeLoot), nil)
    H.eq(#d.runs[1].loot, 0)
  end)

  H.test("containers: an Item- source GUID is a container even without isFromItem (older clients)", function()
    local c = session(H)
    openItem(c, { { itemID = SCHEMATIC, sourceGUID = BOTTLE_GUID } }, nil)
    local d = c.env.ForeverLedgerDB
    H.eq(d.containers[BOTTLE][B].opened, 1)
    H.eq(d.drops[SCHEMATIC], nil)
  end)

  H.test("containers: without a GUID the item of the last ITEM_LOCK_CHANGED within 3 s is the container", function()
    local c = session(H, { itemGUIDs = false, bags = { [0] = { [3] = CLAM } }, missing = { GetLootSourceInfo = true } })
    c.fire("ITEM_LOCK_CHANGED", 0, 3)
    c.advance(1)
    openItem(c, { { itemID = CLAM_MEAT, quantity = 1 } }, true)
    local d = c.env.ForeverLedgerDB
    H.eq(d.containers[CLAM][B].opened, 1)
    H.eq(d.containerLoot[CLAM_MEAT][B][CLAM], 1)
    H.eq(d.drops[CLAM_MEAT], nil)
    c.advance(4) -- the lock is too old now
    openItem(c, { { itemID = CLAM_MEAT, quantity = 1 } }, true)
    H.eq(d.containers[0][B].opened, 1)
    H.eq(d.containers[CLAM][B].opened, 1)
  end)

  H.test("containers: a GUID the client cannot name falls back to the item lock", function()
    local c = session(H, { itemGUIDs = {}, bags = { [1] = { [7] = CLAM } } })
    c.fire("ITEM_LOCK_CHANGED", 1, 7)
    openItem(c, { { itemID = CLAM_MEAT, sourceGUID = CLAM_GUID } }, true)
    local d = c.env.ForeverLedgerDB
    H.eq(d.containers[CLAM][B].opened, 1)
    H.eq(d.apiSamples["GetLootSourceInfo:container"].sample.via, "lock")
  end)

  H.test("containers: an equipment lock (no slot) or an empty bag slot names nothing", function()
    local c = session(H, { itemGUIDs = false, bags = { [0] = { [3] = CLAM } }, missing = { GetLootSourceInfo = true } })
    c.fire("ITEM_LOCK_CHANGED", 16, nil) -- an equipment slot
    c.fire("ITEM_LOCK_CHANGED", 0, 9)    -- an empty bag slot
    openItem(c, { { itemID = CLAM_MEAT } }, true)
    local d = c.env.ForeverLedgerDB
    H.eq(d.containers[0][B].opened, 1)
    H.eq(d.containers[CLAM], nil)
  end)

  H.test("containers: unknown container (no GUID, no lock) is container 0, never a drop of npc 0", function()
    local c = session(H, { itemGUIDs = false, missing = { GetLootSourceInfo = true } })
    openItem(c, { { itemID = SCHEMATIC } }, true)
    local d = c.env.ForeverLedgerDB
    H.eq(d.containers[0][B].opened, 1)
    H.eq(d.containerLoot[SCHEMATIC][B][0], 1)
    H.eq(d.drops[SCHEMATIC], nil)
    H.eq(d.apiSamples["GetLootSourceInfo:container"], nil, "no GetLootSourceInfo, no sample")
  end)

  H.test("containers: two opens of one stack (one GUID) both count", function()
    local c = session(H)
    openItem(c, { { itemID = CLAM_MEAT, sourceGUID = CLAM_GUID, quantity = 1 } }, true)
    openItem(c, { { itemID = CLAM_MEAT, sourceGUID = CLAM_GUID, quantity = 2 },
                  { itemID = PEARL, sourceGUID = CLAM_GUID } }, true)
    local d = c.env.ForeverLedgerDB
    H.eq(d.containers[CLAM][B].opened, 2)
    H.eq(d.containerLoot[CLAM_MEAT][B][CLAM], 2)
    H.eq(d.containerQty[CLAM_MEAT][B][CLAM], 3)
    H.eq(d.containerLoot[PEARL][B][CLAM], 1)
    H.eq(d.containerQty[PEARL][B][CLAM], 1)
  end)

  H.test("containers: one item in two slots of one open is one open that held it; quantities add", function()
    local c = session(H)
    openItem(c, { { itemID = CLAM_MEAT, sourceGUID = CLAM_GUID, quantity = 2 },
                  { itemID = CLAM_MEAT, sourceGUID = CLAM_GUID, quantity = 1 } }, true)
    local d = c.env.ForeverLedgerDB
    H.eq(d.containerLoot[CLAM_MEAT][B][CLAM], 1)
    H.eq(d.containerQty[CLAM_MEAT][B][CLAM], 3)
  end)

  H.test("containers: money slots add to the container's copper", function()
    local c = session(H)
    openItem(c, { { itemID = CLAM_MEAT, sourceGUID = CLAM_GUID }, { money = 35, sourceGUID = CLAM_GUID } }, true)
    openItem(c, { { money = 12, sourceGUID = CLAM_GUID } }, true)
    local d = c.env.ForeverLedgerDB
    H.eq(d.containers[CLAM][B].opened, 2)
    H.eq(d.containers[CLAM][B].copper, 47)
    H.eq(next(d.corpses), nil)
  end)

  H.test("containers: a money slot without an amount takes the GetMoney gain", function()
    local c = session(H, { itemGUIDs = false, missing = { GetLootSourceInfo = true } })
    c.world.money = 1000
    c.world.loot = { { money = 0 } }
    c.fire("LOOT_OPENED", false, true)
    c.world.money = 1025
    c.fire("PLAYER_MONEY")
    c.fire("LOOT_CLOSED")
    c.world.money = 9000 -- a vendor sale later is not the container's
    c.fire("PLAYER_MONEY")
    local d = c.env.ForeverLedgerDB
    H.eq(d.containers[0][B].copper, 25)
    H.eq(next(d.corpses), nil)
  end)

  H.test("containers: mob, fishing and node loot are unchanged next to a recent item lock", function()
    local c = session(H, { bags = { [0] = { [3] = CLAM } } })
    c.fire("ITEM_LOCK_CHANGED", 0, 3) -- moving a clam in the bags, then looting as usual
    openItem(c, { { itemID = 2589, sourceGUID = MOB, quantity = 2 }, { money = 9, sourceGUID = MOB } }, false)
    P.lootNode(c, { { itemID = 2770, sourceGUID = P.VEIN, quantity = 2 } })
    c.world.fishing = true
    openItem(c, { { itemID = BOTTLE, sourceGUID = P.BOBBER } }, false)
    c.world.fishing = false
    local d = c.env.ForeverLedgerDB
    H.eq(d.drops[2589][B][1234], 1)
    H.eq(d.dropQty[2589][B][1234], 2)
    H.eq(d.corpses[B][1234].n, 1)
    H.eq(d.corpses[B][1234].copper, 9)
    H.eq(d.nodeLoot[2770][B][1731].n, 1)
    H.eq(d.nodeLoot[BOTTLE][B][0].n, 1, "a fished bottle is fishing loot")
    H.eq(next(d.containers), nil)
    H.eq(next(d.containerLoot), nil)
  end)

  H.test("containers: without C_Item, C_Container or GetLootSlotInfo nothing breaks", function()
    local c = session(H, { itemGUIDs = false, missing = { GetLootSlotInfo = true } })
    c.fire("ITEM_LOCK_CHANGED", 0, 3)
    openItem(c, { { itemID = CLAM_MEAT, sourceGUID = CLAM_GUID, quantity = 2 } }, true)
    local d = c.env.ForeverLedgerDB
    H.eq(d.containers[0][B].opened, 1)
    H.eq(d.containerQty[CLAM_MEAT][B][0], 2, "the source's own amount")
    H.eq(d.apiSamples["ForeverLedger.errors"], nil)
  end)

  ---------------------------------------------------------------- one open, several windows
  local MEAT2 = { itemID = CLAM_MEAT, sourceGUID = CLAM_GUID, quantity = 2 }
  local PEARL1 = { itemID = PEARL, sourceGUID = CLAM_GUID }
  local COIN = { money = 30, sourceGUID = CLAM_GUID }

  H.test("containers: bags full, one item taken, the clam reopened: one open, no item counted twice", function()
    local c = session(H)
    openItem(c, { MEAT2, PEARL1, COIN }, true, { [2] = true }) -- the pearl stays behind (bags full)
    c.advance(60)
    openItem(c, { PEARL1 }, true) -- the same clam again: only the pearl is left
    local d = c.env.ForeverLedgerDB
    H.eq(d.containers[CLAM][B].opened, 1)
    H.eq(d.containers[CLAM][B].copper, 30)
    H.eq(d.containerLoot[CLAM_MEAT][B][CLAM], 1)
    H.eq(d.containerQty[CLAM_MEAT][B][CLAM], 2)
    H.eq(d.containerLoot[PEARL][B][CLAM], 1)
    H.eq(d.containerQty[PEARL][B][CLAM], 1)
    openItem(c, { MEAT2 }, true) -- everything was taken: the next clam of the stack is a new open
    H.eq(d.containers[CLAM][B].opened, 2)
    H.eq(d.containerLoot[CLAM_MEAT][B][CLAM], 2)
    H.eq(d.containerQty[CLAM_MEAT][B][CLAM], 4)
  end)

  H.test("containers: leftovers reopened twice, money left behind too, still one open", function()
    local c = session(H)
    c.fire("LOOT_SLOT_CLEARED", 1) -- an earlier loot this session: the client sends slot clears
    openItem(c, { MEAT2, PEARL1, COIN }, true, { [1] = true, [2] = true, [3] = true }) -- nothing taken
    openItem(c, { MEAT2, PEARL1, COIN }, true, { [2] = true })
    openItem(c, { PEARL1 }, true)
    local d = c.env.ForeverLedgerDB
    H.eq(d.containers[CLAM][B].opened, 1)
    H.eq(d.containers[CLAM][B].copper, 30)
    H.eq(d.containerQty[CLAM_MEAT][B][CLAM], 2)
    H.eq(d.containerQty[PEARL][B][CLAM], 1)
  end)

  H.test("containers: full loot, then the next clam of the stack with the same contents: two opens", function()
    local c = session(H)
    openItem(c, { MEAT2 }, true)
    openItem(c, { MEAT2 }, true)
    local d = c.env.ForeverLedgerDB
    H.eq(d.containers[CLAM][B].opened, 2)
    H.eq(d.containerLoot[CLAM_MEAT][B][CLAM], 2)
    H.eq(d.containerQty[CLAM_MEAT][B][CLAM], 4)
  end)

  H.test("containers: a window holding anything that was not left behind is a new open", function()
    local c = session(H)
    openItem(c, { MEAT2, PEARL1 }, true, { [2] = true })
    openItem(c, { MEAT2 }, true) -- the meat was taken last time: this is another clam of the stack
    local d = c.env.ForeverLedgerDB
    H.eq(d.containers[CLAM][B].opened, 2)
    H.eq(d.containerQty[CLAM_MEAT][B][CLAM], 4)
  end)

  H.test("containers: leftovers reopened after 15 min, or from another GUID, are a new open", function()
    local c = session(H, { itemGUIDs = { [BOTTLE_GUID] = BOTTLE, [CLAM_GUID] = CLAM, ["Item-1-0-OTHER"] = CLAM } })
    openItem(c, { MEAT2, PEARL1 }, true, { [2] = true })
    c.advance(901)
    openItem(c, { PEARL1 }, true)
    local d = c.env.ForeverLedgerDB
    H.eq(d.containers[CLAM][B].opened, 2)
    openItem(c, { MEAT2, PEARL1 }, true, { [2] = true })
    openItem(c, { { itemID = PEARL, sourceGUID = "Item-1-0-OTHER" } }, true)
    H.eq(d.containers[CLAM][B].opened, 4)
    H.eq(d.containerLoot[PEARL][B][CLAM], 4)
  end)

  H.test("containers: LOOT_OPENED twice for one window counts once", function()
    local c = session(H)
    c.world.loot = { MEAT2, PEARL1, COIN }
    c.fire("LOOT_OPENED", false, true)
    c.fire("LOOT_SLOT_CLEARED", 1)
    c.fire("LOOT_OPENED", false, true)
    c.fire("LOOT_SLOT_CLEARED", 2)
    c.fire("LOOT_SLOT_CLEARED", 3)
    c.fire("LOOT_CLOSED")
    c.world.loot = {}
    local d = c.env.ForeverLedgerDB
    H.eq(d.containers[CLAM][B].opened, 1)
    H.eq(d.containers[CLAM][B].copper, 30)
    H.eq(d.containerLoot[CLAM_MEAT][B][CLAM], 1)
    H.eq(d.containerQty[CLAM_MEAT][B][CLAM], 2)
    H.eq(d.containerQty[PEARL][B][CLAM], 1)
    openItem(c, { MEAT2 }, true) -- fully looted: the next one is new
    H.eq(d.containers[CLAM][B].opened, 2)
  end)

  H.test("containers: item-lock route: LOOT_OPENED twice and a reopen of the leftovers stay one open", function()
    local c = session(H, { itemGUIDs = false, bags = { [0] = { [3] = CLAM } }, missing = { GetLootSourceInfo = true } })
    c.fire("ITEM_LOCK_CHANGED", 0, 3)
    c.world.loot = { { itemID = CLAM_MEAT, quantity = 2 }, { itemID = PEARL } }
    c.fire("LOOT_OPENED", false, true)
    c.fire("LOOT_OPENED", false, true) -- the lock is used up; still the clam's window
    c.fire("LOOT_SLOT_CLEARED", 1)
    c.fire("LOOT_CLOSED")
    c.advance(30)
    c.fire("ITEM_LOCK_CHANGED", 0, 3) -- the leftover clam, used again
    c.world.loot = { { itemID = PEARL } }
    c.fire("LOOT_OPENED", false, true)
    c.fire("LOOT_SLOT_CLEARED", 1)
    c.fire("LOOT_CLOSED")
    local d = c.env.ForeverLedgerDB
    H.eq(d.containers[CLAM][B].opened, 1)
    H.eq(d.containers[0], nil)
    H.eq(d.containerQty[CLAM_MEAT][B][CLAM], 2)
    H.eq(d.containerQty[PEARL][B][CLAM], 1)
  end)

  H.test("containers: unknown containers (0) never merge across windows", function()
    local c = session(H, { itemGUIDs = false, missing = { GetLootSourceInfo = true } })
    c.fire("LOOT_SLOT_CLEARED", 9) -- the client sends slot clears
    openItem(c, { { itemID = CLAM_MEAT }, { itemID = PEARL } }, true, { [2] = true })
    openItem(c, { { itemID = PEARL } }, true)
    H.eq(c.env.ForeverLedgerDB.containers[0][B].opened, 2)
  end)

  H.test("containers: a client that never sends LOOT_SLOT_CLEARED counts every window as an open", function()
    local c = session(H)
    for _ = 1, 2 do
      c.world.loot = { MEAT2 }
      c.fire("LOOT_OPENED", false, true)
      c.fire("LOOT_CLOSED")
    end
    H.eq(c.env.ForeverLedgerDB.containers[CLAM][B].opened, 2)
  end)

  H.test("containers: an item lock names one container only, and an unlock names none", function()
    local c = session(H, { itemGUIDs = false, bags = { [0] = { [3] = CLAM, [4] = BOTTLE } },
                           bagLocks = { [0] = { [3] = true, [4] = false } },
                           missing = { GetLootSourceInfo = true } })
    c.fire("ITEM_LOCK_CHANGED", 0, 3)
    openItem(c, { { itemID = CLAM_MEAT } }, true)
    openItem(c, { { itemID = SCHEMATIC } }, true) -- within 3 s, but the clam's lock was used
    local d = c.env.ForeverLedgerDB
    H.eq(d.containers[CLAM][B].opened, 1)
    H.eq(d.containers[0][B].opened, 1)
    c.fire("ITEM_LOCK_CHANGED", 0, 4) -- the bottle's slot unlocking
    openItem(c, { { itemID = SCHEMATIC } }, true)
    H.eq(d.containers[BOTTLE], nil)
    H.eq(d.containers[0][B].opened, 2)
  end)

  H.test("containers: /fl shows opens; /fl reset wipes them", function()
    local c = session(H)
    bottle(c)
    bottle(c)
    c.world.printed = {}
    c.slash("FOREVERLEDGER", "")
    H.ok(printed(c, "2 containers opened."), table.concat(c.world.printed, "\n"))
    c.slash("FOREVERLEDGER", "reset confirm")
    local d = c.env.ForeverLedgerDB
    H.eq(next(d.containers), nil)
    H.eq(next(d.containerLoot), nil)
    H.eq(next(d.containerQty), nil)
  end)
end
