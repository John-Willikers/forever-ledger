
ForeverLedgerDB = {
	["drops"] = {
		[872] = {
			[644] = 1,
		},
	},
	["items"] = {
		[872] = {
			["equipLoc"] = "INVTYPE_2HWEAPON",
			["ilvl"] = 21,
			["lastSeen"] = 1790000360,
			["link"] = "|cff0070dd|Hitem:872::::::::|h[Rockslicer]|h|r",
			["name"] = "Rockslicer",
			["quality"] = 3,
			["reqLevel"] = 16,
			["sellPrice"] = 2600,
			["stats"] = {
				["ITEM_MOD_STRENGTH_SHORT"] = 7,
			},
			["subtype"] = "Two-Handed Axes",
			["tooltip"] = {
				"Rockslicer", -- [1]
				"Two-Hand || Axe", -- [2]
				"|cff1eff00Equip: +7 Strength.|r", -- [3]
			},
			["type"] = "Weapon",
		},
		[5555] = {
			["equipLoc"] = "INVTYPE_FEET",
			["ilvl"] = 18,
			["lastSeen"] = 1790001080,
			["link"] = "|cff1eff00|Hitem:5555::::::::|h[Swampwalker's Boots]|h|r",
			["name"] = "Swampwalker's Boots",
			["quality"] = 2,
			["reqLevel"] = 13,
			["sellPrice"] = 420,
			["stats"] = {
				["ITEM_MOD_AGILITY_SHORT"] = 3,
				["RESISTANCE0_NAME"] = 45,
			},
			["subtype"] = "Leather",
			["tooltip"] = {
				"Swampwalker's Boots", -- [1]
				"Feet || Leather", -- [2]
				"45 Armor", -- [3]
				"+3 Agility", -- [4]
				"|cffffd100Requires Level 13|r", -- [5]
			},
			["type"] = "Armor",
		},
		[5556] = {
			["equipLoc"] = "INVTYPE_2HWEAPON",
			["ilvl"] = 18,
			["lastSeen"] = 1790001080,
			["link"] = "|cff1eff00|Hitem:5556::::::::|h[Bayou Staff]|h|r",
			["name"] = "Bayou Staff",
			["quality"] = 2,
			["reqLevel"] = 13,
			["sellPrice"] = 900,
			["stats"] = {
				["ITEM_MOD_INTELLECT_SHORT"] = 5,
			},
			["subtype"] = "Staves",
			["tooltip"] = {
				"Bayou Staff", -- [1]
				"Two-Hand || Staff", -- [2]
			},
			["type"] = "Weapon",
		},
	},
	["meta"] = {
		["addonVersion"] = "0.1.0",
		["build"] = {
			"1.15.7", -- [1]
			"61582", -- [2]
			"Sep 18 2026", -- [3]
			11507, -- [4]
		},
		["lastChar"] = {
			["class"] = "HUNTER",
			["faction"] = "Alliance",
			["level"] = 10,
			["name"] = "Thibodeaux",
			["race"] = "Human",
			["realm"] = "Bayou",
		},
	},
	["quests"] = {
		[1234] = {
			["acceptedAt"] = {
				["level"] = 10,
				["loc"] = {
					["mapID"] = 1429,
					["subzone"] = "Goldshire",
					["x"] = 42.1,
					["y"] = 65.9,
					["zone"] = "Elwynn Forest",
				},
				["time"] = 1790000000,
			},
			["category"] = "The Deadmines",
			["choices"] = {
				{
					["count"] = 1,
					["itemID"] = 5555,
				}, -- [1]
				{
					["count"] = 1,
					["itemID"] = 5556,
				}, -- [2]
			},
			["ender"] = {
				["id"] = 240,
				["loc"] = {
					["mapID"] = 1429,
					["subzone"] = "Goldshire",
					["x"] = 42.1,
					["y"] = 65.9,
					["zone"] = "The Deadmines",
				},
				["name"] = "Marshal Dughan",
			},
			["giver"] = {
				["id"] = 240,
				["loc"] = {
					["mapID"] = 1429,
					["subzone"] = "Goldshire",
					["x"] = 42.1,
					["y"] = 65.9,
					["zone"] = "Elwynn Forest",
				},
				["name"] = "Marshal Dughan",
			},
			["id"] = 1234,
			["level"] = 17,
			["moneyOffered"] = 500,
			["objectives"] = {
				"Red Silk Bandana: 0/10", -- [1]
			},
			["seenAtLevel"] = 10,
			["suggestedGroup"] = 5,
			["title"] = "Red Silk Bandanas",
			["turnIns"] = {
				{
					["char"] = "Thibodeaux",
					["level"] = 10,
					["money"] = 500,
					["time"] = 1790001080,
					["xp"] = 850,
				}, -- [1]
			},
			["xpOffered"] = 850,
		},
	},
	["runs"] = {
		{
			["activeSecs"] = 930,
			["awaySecs"] = 120,
			["bosses"] = {
				{
					["atSecs"] = 300,
					["id"] = 1,
					["killed"] = true,
					["name"] = "Rhahk'Zor",
				}, -- [1]
				{
					["atSecs"] = 900,
					["id"] = 2,
					["killed"] = true,
					["name"] = "Edwin VanCleef",
				}, -- [2]
			},
			["char"] = {
				["class"] = "HUNTER",
				["faction"] = "Alliance",
				["level"] = 10,
				["name"] = "Thibodeaux",
				["race"] = "Human",
				["realm"] = "Bayou",
			},
			["deaths"] = 1,
			["difficulty"] = 1,
			["endReason"] = "left",
			["finish"] = 1790001110,
			["instance"] = "The Deadmines",
			["instanceID"] = 36,
			["loot"] = {
				{
					["itemID"] = 872,
					["npcID"] = 644,
				}, -- [1]
			},
			["maxPlayers"] = 5,
			["mobXP"] = 3500,
			["party"] = {
				{
					["class"] = "WARRIOR",
					["level"] = 18,
				}, -- [1]
				{
					["class"] = "PRIEST",
					["level"] = 17,
				}, -- [2]
			},
			["questXP"] = 850,
			["start"] = 1790000060,
			["xpTotal"] = 4350,
		}, -- [1]
	},
}
