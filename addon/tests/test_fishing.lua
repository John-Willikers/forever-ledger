-- Schema 7: one fishing record per cast (zone, spot, skill, lure, outcome, catch) and full-name character keys.
-- Event shapes are the ones probe 0.4.0 recorded on build 70245 (spell 7732, bobber object 35591, enchant 265).
local P = require("professions_world")

local FISHING = 7732
local BOBBER = "GameObject-0-4621-1-9-35591-0000C5D666"
local LURE = 265

-- A fisher at Steamwheedle Port: Fishing 225/225 (modifier 5, or 80 with the +75 lure), C_Timer for the grace check.
local function fisher(H, overrides)
  local o = {
    fishing = false,
    spells = { [FISHING] = { name = "Fishing" } },
    professions = { { name = "Alchemy", rank = 1, maxRank = 75, skillLine = 171 },
                    { name = "Herbalism", rank = 1, maxRank = 75, skillLine = 182 },
                    { name = "Cooking", rank = 1, maxRank = 75, skillLine = 185 },
                    { name = "Fishing", rank = 225, maxRank = 225, skillLine = 356, modifier = 5 } },
    items = { [4603] = { name = "Raw Spotted Yellowtail" }, [13422] = { name = "Stonescale Eel" } },
  }
  for k, v in pairs(overrides or {}) do o[k] = v end
  local c = P.gatherer(H, o)
  c.world.zone = { zone = "Tanaris", subzone = "Steamwheedle Port", mapID = 1446, x = 0.682, y = 0.228 }
  c.world.player.name, c.world.player.surname, c.world.player.guid = "Sam", "Willikers", "Player-4618-00A9A08A"
  c.env.C_PlayerInfo = { ShouldDisplaySurname = function() return true end }
  c.env.GetWeaponEnchantInfo = function()
    if c.world.lure then return true, 599126, 0, LURE end
    return false
  end
  c.fire("PLAYER_LOGIN") -- the character record again, now with the surname
  return c
end

-- The real order (probe 0.4.0): SENT, CHANNEL_START(castBar), SUCCEEDED; on a recast the old channel's STOP comes
-- after the new SENT (`stopBar`).
local casts = 0
local function cast(c, stopBar)
  casts = casts + 1
  local guid = "Cast-3-4621-1-9-7732-" .. casts
  c.fire("UNIT_SPELLCAST_SENT", "player", nil, guid, FISHING)
  if stopBar then c.fire("UNIT_SPELLCAST_CHANNEL_STOP", "player", nil, FISHING, nil, stopBar) end
  c.fire("UNIT_SPELLCAST_CHANNEL_START", "player", nil, FISHING, "CastBar-" .. casts)
  c.fire("UNIT_SPELLCAST_SUCCEEDED", "player", guid, FISHING, nil)
  return "CastBar-" .. casts
end

local function stop(c, bar)
  c.fire("UNIT_SPELLCAST_CHANNEL_STOP", "player", nil, FISHING, nil, bar or ("CastBar-" .. casts))
end

local function catch(c, slots, secs)
  c.advance(secs or 15)
  stop(c)
  c.world.fishing = true
  c.world.loot = slots
  c.fire("LOOT_OPENED", true, false)
  c.fire("LOOT_CLOSED")
  c.world.loot = {}
  c.world.fishing = false
end

return function(H)
  H.test("fishing: a cast with a catch records zone, spot, skill, lure and the catch", function()
    local c = fisher(H)
    c.world.lure = true
    c.world.professions[4].modifier = 80
    cast(c)
    catch(c, { { itemID = 4603, sourceGUID = BOBBER } }, 14)
    local list = c.env.ForeverLedgerDB.fishingCasts
    H.eq(#list, 1)
    local f = list[1]
    H.eq(f.char, "Sam Willikers-Bayou")
    H.eq(f.zone, "Tanaris")
    H.eq(f.subzone, "Steamwheedle Port")
    H.eq(f.mapID, 1446)
    H.eq(f.x, 68.2)
    H.eq(f.y, 22.8)
    H.eq(f.skill, 225)
    H.eq(f.skillMax, 225)
    H.eq(f.modifier, 80)
    H.eq(f.lure, LURE)
    H.eq(f.lureSecs, 599)
    H.eq(f.spellID, FISHING)
    H.eq(f.outcome, "loot")
    H.eq(f.secs, 14)
    H.eq(#f.loot, 1)
    H.eq(f.loot[1].itemID, 4603)
    H.eq(f.loot[1].qty, 1)
    H.eq(f.money, 0)
    H.ok(f.id:find("^Sam Willikers%-Bayou%-%d+%-1$"), "id: char, time and cast number")
  end)

  H.test("fishing: casts that end without a catch are kept, with how they ended", function()
    local c = fisher(H)
    -- The channel times out and no window opens: "none" once the grace has passed.
    cast(c)
    c.advance(24)
    stop(c)
    c.advance(4)
    -- The fish got away.
    cast(c)
    c.advance(10)
    c.fire("UI_ERROR_MESSAGE", 1, "Your fish got away!")
    -- Clicked too early.
    cast(c)
    c.advance(3)
    c.fire("UI_ERROR_MESSAGE", 1, "No fish are hooked.")
    -- Recast before the old channel stopped (it caught nothing): the old STOP arrives after the new SENT and must not
    -- end the new cast; the new cast's catch is its own.
    local old = cast(c)
    c.advance(7)
    cast(c, old)
    c.advance(5) -- past the grace: an old STOP taken for this cast would have ended it as "none"
    catch(c, { { itemID = 13422, sourceGUID = BOBBER, quantity = 2 } })
    local outcomes = {}
    for i, f in ipairs(c.env.ForeverLedgerDB.fishingCasts) do outcomes[i] = f.outcome end
    H.eq(table.concat(outcomes, ","), "none,escaped,notHooked,none,loot")
    local last = c.env.ForeverLedgerDB.fishingCasts[5]
    H.eq(last.loot[1].qty, 2)
    H.eq(last.lure, nil, "no lure")
    H.eq(last.modifier, 5)
  end)

  H.test("fishing: a recast's catch stays with the recast (real event order)", function()
    local c = fisher(H)
    local first = cast(c)
    c.advance(8)
    cast(c, first)
    c.advance(10)
    catch(c, { { itemID = 4603, sourceGUID = BOBBER } }, 4)
    local list = c.env.ForeverLedgerDB.fishingCasts
    H.eq(#list, 2)
    H.eq(list[1].outcome, "none")
    H.eq(list[2].outcome, "loot")
    H.eq(list[2].loot[1].itemID, 4603)
    H.eq(list[2].secs, 14)
  end)

  H.test("fishing: a new key mid-session gets its character record", function()
    local c = fisher(H)
    c.world.player.name = "Samuel"
    cast(c)
    H.ok(c.env.ForeverLedgerDB.chars["Samuel Willikers-Bayou"], "noted on the first cast")
  end)

  H.test("fishing: other spells, other units and non-fishing windows are not casts", function()
    local c = fisher(H, { spells = { [FISHING] = { name = "Fishing" }, [133] = { name = "Fireball" } } })
    c.fire("UNIT_SPELLCAST_SENT", "player", nil, "Cast-Fire", 133)
    c.fire("UNIT_SPELLCAST_SENT", "party1", nil, "Cast-Party", FISHING)
    c.world.loot = { { itemID = 4603, sourceGUID = "Creature-0-1-2-3-4-5431-0000" } }
    c.fire("LOOT_OPENED", true, false) -- a corpse, not a fishing window
    c.fire("LOOT_CLOSED")
    H.eq(#c.env.ForeverLedgerDB.fishingCasts, 0)
    c.fire("UI_ERROR_MESSAGE", 1, "Your fish got away!") -- no cast open
    H.eq(#c.env.ForeverLedgerDB.fishingCasts, 0)
  end)

  H.test("fishing: the old per-session fishing counts still add up", function()
    local c = fisher(H)
    cast(c)
    catch(c, { { itemID = 4603, sourceGUID = BOBBER } })
    local db = c.env.ForeverLedgerDB
    local byBuild = db.nodes[c.env.ForeverLedgerDB.meta.build]
    H.eq(byBuild[0].opened, 1)
    H.eq(db.nodeLoot[4603][db.meta.build][0].n, 1)
  end)

  H.test("identity: characters are keyed by full name; the record keeps first name and GUID", function()
    local c = fisher(H)
    local db = c.env.ForeverLedgerDB
    local me = db.chars["Sam Willikers-Bayou"]
    H.ok(me, "keyed by full name")
    H.eq(me.name, "Sam Willikers")
    H.eq(me.firstName, "Sam")
    H.eq(me.guid, "Player-4618-00A9A08A")
    -- The player's surname doesn't depend on the client showing surnames (a display setting).
    local hidden = fisher(H)
    hidden.env.C_PlayerInfo = { ShouldDisplaySurname = function() return false end }
    hidden.fire("PLAYER_LOGIN")
    H.eq(hidden.env.ForeverLedgerDB.chars["Sam-Bayou"], nil, "surnames hidden: still the full name")
    -- A client whose UnitName has no second value (Classic) keys by first name.
    local classic = fisher(H)
    classic.world.player.surname = nil
    classic.fire("PLAYER_LOGIN")
    H.ok(classic.env.ForeverLedgerDB.chars["Sam-Bayou"], "no surname: first name")
  end)

  H.test("fishing: /fl reset confirm wipes fishing casts", function()
    local c = fisher(H)
    cast(c)
    catch(c, { { itemID = 4603, sourceGUID = BOBBER } })
    c.slash("FOREVERLEDGER", "reset confirm")
    H.eq(#c.env.ForeverLedgerDB.fishingCasts, 0)
  end)
end
