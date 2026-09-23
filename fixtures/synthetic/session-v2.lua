
ForeverLedgerDB = {
	["chars"] = {
		["Thibodeaux-Bayou"] = {
			["class"] = "HUNTER",
			["faction"] = "Alliance",
			["lastSeen"] = 1790087510,
			["level"] = 10,
			["name"] = "Thibodeaux",
			["race"] = "Human",
			["realm"] = "Bayou",
		},
	},
	["drops"] = {
		[872] = {
			[61582] = {
				[644] = 1,
			},
			[61600] = {
				[644] = 1,
			},
		},
	},
	["items"] = {
		[872] = {
			["byBuild"] = {
				[61582] = {
					["firstSeen"] = 1790000360,
					["ilvl"] = 21,
					["link"] = "|cff0070dd|Hitem:872::::::::|h[Rockslicer]|h|r",
					["reqLevel"] = 16,
					["sellPrice"] = 2600,
					["stats"] = {
						["ITEM_MOD_STRENGTH_SHORT"] = 7,
					},
					["tooltip"] = {
						"Rockslicer", -- [1]
						"Two-Hand	Axe", -- [2]
						"|cff1eff00Equip: +7 Strength.|r", -- [3]
					},
				},
				[61600] = {
					["firstSeen"] = 1790087510,
					["ilvl"] = 22,
					["link"] = "|cff0070dd|Hitem:872::::::::|h[Rockslicer]|h|r",
					["reqLevel"] = 16,
					["sellPrice"] = 2600,
					["stats"] = {
						["ITEM_MOD_STAMINA_SHORT"] = 2,
						["ITEM_MOD_STRENGTH_SHORT"] = 8,
					},
					["tooltip"] = {
						"Rockslicer", -- [1]
						"Two-Hand	Axe", -- [2]
						"|cff1eff00Equip: +7 Strength.|r", -- [3]
					},
				},
			},
			["equipLoc"] = "INVTYPE_2HWEAPON",
			["id"] = 872,
			["name"] = "Rockslicer",
			["quality"] = 3,
			["subtype"] = "Two-Handed Axes",
			["type"] = "Weapon",
		},
		[5555] = {
			["byBuild"] = {
				[61582] = {
					["firstSeen"] = 1790000000,
					["ilvl"] = 18,
					["link"] = "|cff1eff00|Hitem:5555::::::::|h[Swampwalker's Boots]|h|r",
					["reqLevel"] = 13,
					["sellPrice"] = 420,
					["stats"] = {
						["ITEM_MOD_AGILITY_SHORT"] = 3,
						["RESISTANCE0_NAME"] = 45,
					},
					["tooltip"] = {
						"Swampwalker's Boots", -- [1]
						"Feet	Leather", -- [2]
						"45 Armor", -- [3]
						"+3 Agility", -- [4]
						"|cffffd100Requires Level 13|r", -- [5]
					},
				},
			},
			["equipLoc"] = "INVTYPE_FEET",
			["id"] = 5555,
			["name"] = "Swampwalker's Boots",
			["quality"] = 2,
			["subtype"] = "Leather",
			["type"] = "Armor",
		},
		[5556] = {
			["byBuild"] = {
				[61582] = {
					["firstSeen"] = 1790000000,
					["ilvl"] = 18,
					["link"] = "|cff1eff00|Hitem:5556::::::::|h[Bayou Staff]|h|r",
					["reqLevel"] = 13,
					["sellPrice"] = 900,
					["stats"] = {
						["ITEM_MOD_INTELLECT_SHORT"] = 5,
					},
					["tooltip"] = {
						"Bayou Staff", -- [1]
						"Two-Hand	Staff", -- [2]
					},
				},
			},
			["equipLoc"] = "INVTYPE_2HWEAPON",
			["id"] = 5556,
			["name"] = "Bayou Staff",
			["quality"] = 2,
			["subtype"] = "Staves",
			["type"] = "Weapon",
		},
	},
	["meta"] = {
		["addonVersion"] = "0.2.3",
		["build"] = 61600,
		["buildDate"] = "Oct 01 2026",
		["interface"] = 11508,
		["lastChar"] = {
			["class"] = "HUNTER",
			["faction"] = "Alliance",
			["lastSeen"] = 1790087510,
			["level"] = 10,
			["name"] = "Thibodeaux",
			["race"] = "Human",
			["realm"] = "Bayou",
		},
		["schemaVersion"] = 2,
		["version"] = "1.15.8",
	},
	["quests"] = {
		[1234] = {
			["category"] = "The Deadmines",
			["id"] = 1234,
			["level"] = 17,
			["objectives"] = {
				"Red Silk Bandana: 0/10", -- [1]
			},
			["obs"] = {
				["61582:accept:Thibodeaux-Bayou"] = {
					["build"] = 61582,
					["char"] = "Thibodeaux-Bayou",
					["level"] = 10,
					["loc"] = {
						["mapID"] = 1429,
						["subzone"] = "Goldshire",
						["x"] = 42.1,
						["y"] = 65.9,
						["zone"] = "Elwynn Forest",
					},
					["stage"] = "accept",
					["time"] = 1790000000,
				},
				["61582:complete:Thibodeaux-Bayou"] = {
					["build"] = 61582,
					["char"] = "Thibodeaux-Bayou",
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
					["level"] = 10,
					["money"] = 500,
					["npc"] = {
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
					["stage"] = "complete",
					["time"] = 1790001080,
					["xp"] = 850,
				},
				["61582:detail:Thibodeaux-Bayou"] = {
					["build"] = 61582,
					["char"] = "Thibodeaux-Bayou",
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
					["level"] = 10,
					["money"] = 500,
					["npc"] = {
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
					["stage"] = "detail",
					["time"] = 1790000000,
					["xp"] = 850,
				},
			},
			["suggestedGroup"] = 5,
			["title"] = "Red Silk Bandanas",
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
			["build"] = 61582,
			["char"] = "Thibodeaux-Bayou",
			["charLevel"] = 10,
			["deaths"] = 1,
			["difficulty"] = 1,
			["endReason"] = "left",
			["finish"] = 1790001110,
			["id"] = "Thibodeaux-Bayou-36-1790000060",
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
		{
			["activeSecs"] = 1200,
			["awaySecs"] = 0,
			["bosses"] = {
			},
			["build"] = 61600,
			["char"] = "Thibodeaux-Bayou",
			["charLevel"] = 10,
			["deaths"] = 0,
			["difficulty"] = 1,
			["endReason"] = "left",
			["finish"] = 1790088710,
			["id"] = "Thibodeaux-Bayou-36-1790087510",
			["instance"] = "The Deadmines",
			["instanceID"] = 36,
			["loot"] = {
				{
					["itemID"] = 872,
					["npcID"] = 644,
				}, -- [1]
			},
			["maxPlayers"] = 5,
			["mobXP"] = 0,
			["party"] = {
			},
			["questXP"] = 0,
			["start"] = 1790087510,
			["xpTotal"] = 0,
		}, -- [2]
	},
	["turnIns"] = {
		{
			["build"] = 61582,
			["char"] = "Thibodeaux-Bayou",
			["choice"] = {
				["index"] = 1,
				["itemID"] = 5555,
			},
			["id"] = "Thibodeaux-Bayou-1234-1790001080",
			["level"] = 10,
			["money"] = 500,
			["questID"] = 1234,
			["runID"] = "Thibodeaux-Bayou-36-1790000060",
			["time"] = 1790001080,
			["xp"] = 850,
		}, -- [1]
	},
}
