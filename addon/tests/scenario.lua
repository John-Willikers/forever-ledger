-- A scripted play session shared by the ledger and migration tests.
-- Quest in Goldshire, a Deadmines run with a boss, a death, loot, a zone-out/zone-in resume and a turn-in.
local S = {}

S.NPC_DUGHAN = "Creature-0-1-0-1-240-0000ABC"
S.NPC_RHAHK = "Creature-0-1-36-1-644-0000DEF"
S.NPC_VANCLEEF = "Creature-0-1-36-1-639-0000FED"
S.DEADMINES = { name = "The Deadmines", type = "party", difficulty = 1, maxPlayers = 5, instanceID = 36 }

function S.items()
  return {
    [5555] = { name = "Swampwalker's Boots", quality = 2, ilvl = 18, reqLevel = 13, type = "Armor",
               subtype = "Leather", equipLoc = "INVTYPE_FEET", sellPrice = 420,
               stats = { ITEM_MOD_AGILITY_SHORT = 3, RESISTANCE0_NAME = 45 },
               tooltip = { { "Swampwalker's Boots" }, { "Feet", "Leather" }, { "45 Armor" }, { "+3 Agility" },
                           { "|cffffd100Requires Level 13|r" } } },
    [5556] = { name = "Bayou Staff", quality = 2, ilvl = 18, reqLevel = 13, type = "Weapon", subtype = "Staves",
               equipLoc = "INVTYPE_2HWEAPON", sellPrice = 900, stats = { ITEM_MOD_INTELLECT_SHORT = 5 },
               tooltip = { { "Bayou Staff" }, { "Two-Hand", "Staff" } }, cached = false },
    [872] = { name = "Rockslicer", quality = 3, ilvl = 21, reqLevel = 16, type = "Weapon", subtype = "Two-Handed Axes",
              equipLoc = "INVTYPE_2HWEAPON", sellPrice = 2600, stats = { ITEM_MOD_STRENGTH_SHORT = 7 },
              tooltip = { { "Rockslicer" }, { "Two-Hand", "Axe" }, { "|cff1eff00Equip: +7 Strength.|r" } } },
  }
end

function S.questLog()
  return {
    { title = "The Deadmines", isHeader = true },
    { title = "Red Silk Bandanas", level = 17, suggestedGroup = 5, questID = 1234,
      objectives = { "Red Silk Bandana: 0/10" }, choices = { 5555, 5556 }, money = 500 },
  }
end

-- Runs the session against a harness controller whose addon is already loaded.
function S.play(ctl, addonName)
  local w = ctl.world
  local forever = w.api == "forever"
  ctl.login(addonName)

  -- Quest giver window (accept screen). 5556 is not cached yet.
  w.npc = { name = "Marshal Dughan", guid = S.NPC_DUGHAN }
  w.questFrame = { questID = 1234, title = "Red Silk Bandanas", xp = 850, money = 500,
                   choices = { { id = 5555, count = 1 }, { id = 5556, count = 1 } } }
  ctl.fire("QUEST_DETAIL")
  w.items[5556].cached = true
  ctl.fire("GET_ITEM_INFO_RECEIVED", 5556, true)
  if forever then
    ctl.fire("QUEST_ACCEPTED", 1234) -- Forever 1.60 sends (questID)
  else
    ctl.fire("QUEST_ACCEPTED", 2, 1234) -- Classic argument order (logIndex, questID)
  end
  w.questFrame, w.npc = nil, nil

  -- Deadmines
  ctl.advance(60)
  w.instance = S.DEADMINES
  w.party = { { class = "WARRIOR", level = 18 }, { class = "PRIEST", level = 17 } }
  ctl.fire("PLAYER_ENTERING_WORLD", false, false)
  ctl.advance(300)
  ctl.gainXP(1200)
  w.loot = { { itemID = 872, sourceGUID = S.NPC_RHAHK } }
  ctl.fire("LOOT_OPENED")
  ctl.fire("LOOT_OPENED") -- reopening the same corpse must not double count
  w.loot = {}
  ctl.fire("ENCOUNTER_END", 1, "Rhahk'Zor", 1, 5, 1)
  ctl.fire("PLAYER_DEAD")

  -- Zone out (corpse run) and back in within the resume window
  w.instance = nil
  ctl.fire("ZONE_CHANGED_NEW_AREA")
  ctl.advance(120)
  w.instance = S.DEADMINES
  ctl.fire("ZONE_CHANGED_NEW_AREA")
  ctl.advance(600)
  ctl.gainXP(2300)
  ctl.fire("ENCOUNTER_END", 2, "Edwin VanCleef", 1, 5, 1)

  -- Turn in inside the instance
  w.npc = { name = "Marshal Dughan", guid = S.NPC_DUGHAN }
  w.questFrame = { questID = 1234, title = "Red Silk Bandanas", xp = 850, money = 500,
                   choices = { { id = 5555, count = 1 }, { id = 5556, count = 1 } } }
  ctl.fire("QUEST_COMPLETE")
  ctl.fire("QUEST_TURNED_IN", 1234, 850, 500)
  ctl.gainXP(850)
  w.questFrame, w.npc = nil, nil
  ctl.advance(30)

  w.instance = nil
  ctl.fire("ZONE_CHANGED_NEW_AREA")
end

return S
