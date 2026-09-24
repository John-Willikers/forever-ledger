
ForeverLedgerDB = {
	["apiSamples"] = {
		["C_MerchantFrame.GetItemInfo"] = {
			["build"] = 61582,
			["sample"] = {
				["hasExtendedCost"] = false,
				["isPurchasable"] = true,
				["isQuestStartItem"] = false,
				["isUsable"] = true,
				["name"] = "?",
				["numAvailable"] = -1,
				["price"] = 10,
				["stackCount"] = 5,
				["texture"] = 134939,
			},
			["time"] = 1790001200,
		},
		["C_SkillInfo.GetSkillLineInfo"] = {
			["build"] = 61582,
			["sample"] = {
				["costType"] = 0,
				["description"] = "",
				["isAbandonable"] = true,
				["isCollapsed"] = false,
				["isHeader"] = false,
				["maxRank"] = 75,
				["minLevel"] = 5,
				["modifier"] = 0,
				["name"] = "Tailoring",
				["parentSkillLineID"] = 0,
				["rank"] = 50,
				["rankCost"] = 0,
				["skillID"] = 197,
				["skillLineCategoryID"] = 11,
				["stepCost"] = 0,
				["tempPoints"] = 0,
			},
			["time"] = 1790000000,
		},
		["C_TradeSkillUI.GetAllRecipeIDs"] = {
			["build"] = 61582,
			["sample"] = {
				2963, -- [1]
				2393, -- [2]
				2389, -- [3]
			},
			["time"] = 1790001230,
		},
		["C_TradeSkillUI.GetBaseProfessionInfo"] = {
			["build"] = 61582,
			["sample"] = {
				["expansionName"] = "Classic",
				["isPrimaryProfession"] = true,
				["maxSkillLevel"] = 75,
				["parentProfessionID"] = 0,
				["professionID"] = 197,
				["professionName"] = "Tailoring",
				["skillLevel"] = 50,
				["skillModifier"] = 0,
			},
			["time"] = 1790001230,
		},
		["C_TradeSkillUI.GetProfessionInfoByRecipeID"] = {
			["build"] = 61582,
			["sample"] = {
				["expansionName"] = "Classic",
				["isPrimaryProfession"] = true,
				["maxSkillLevel"] = 75,
				["parentProfessionID"] = 0,
				["professionID"] = 197,
				["professionName"] = "Tailoring",
				["skillLevel"] = 50,
				["skillModifier"] = 0,
			},
			["time"] = 1790001230,
		},
		["C_TradeSkillUI.GetRecipeInfo"] = {
			["build"] = 61582,
			["sample"] = {
				["categoryID"] = 1001,
				["craftable"] = true,
				["disabled"] = false,
				["favorite"] = false,
				["hyperlink"] = "|Henchant:2963|h[Bolt of Linen Cloth]|h",
				["icon"] = 132149,
				["learned"] = true,
				["maxTrivialLevel"] = 90,
				["name"] = "Bolt of Linen Cloth",
				["numSkillUps"] = 1,
				["recipeID"] = 2963,
				["relativeDifficulty"] = 3,
				["supportsQualities"] = false,
			},
			["time"] = 1790001230,
		},
		["C_TradeSkillUI.GetRecipeSchematic"] = {
			["build"] = 61582,
			["sample"] = {
				["isRecraft"] = false,
				["name"] = "Bolt of Linen Cloth",
				["outputItemID"] = 2996,
				["quantityMax"] = 1,
				["quantityMin"] = 1,
				["reagentSlotSchematics"] = {
					"<table>", -- [1]
				},
				["recipeID"] = 2963,
				["recipeType"] = 1,
			},
			["time"] = 1790001230,
		},
		["C_TradeSkillUI.GetRecipeSchematic:reagent"] = {
			["build"] = 61582,
			["sample"] = {
				["itemID"] = 2589,
			},
			["time"] = 1790001230,
		},
		["C_TradeSkillUI.GetRecipeSchematic:reagentSlot"] = {
			["build"] = 61582,
			["sample"] = {
				["dataSlotIndex"] = 1,
				["quantityRequired"] = 2,
				["reagentType"] = 1,
				["reagents"] = {
					"<table>", -- [1]
				},
				["required"] = true,
				["slotIndex"] = 1,
			},
			["time"] = 1790001230,
		},
		["C_TradeSkillUI.GetRecipeSourceText"] = {
			["build"] = 61582,
			["sample"] = {
				"|cffffd100Vendor: |rMisensi", -- [1]
			},
			["time"] = 1790001230,
		},
		["ForeverLedger.errors"] = {
			["build"] = 61582,
			["sample"] = {
				["blocked:UseAction()"] = {
					["count"] = 1,
					["last"] = 1790001513,
					["msg"] = "UseAction()",
				},
			},
			["time"] = 1790001513,
		},
		["ForeverLedger.fieldMisses"] = {
			["build"] = 61582,
			["sample"] = {
				["C_TradeSkillUI.GetRecipeSchematic:quantityMax"] = "quantityMax|maxQuantity",
			},
			["time"] = 1790001230,
		},
		["GetTrainerServiceInfo"] = {
			["build"] = 61582,
			["sample"] = {
				"Tailoring", -- [1]
				"", -- [2]
				"header", -- [3]
				true, -- [4]
			},
			["time"] = 1790001170,
		},
		["NEW_RECIPE_LEARNED"] = {
			["build"] = 61582,
			["sample"] = {
				[1] = 2393,
				[3] = 2393,
			},
			["time"] = 1790001170,
		},
		["TRADE_SKILL_ITEM_CRAFTED_RESULT"] = {
			["build"] = 61582,
			["sample"] = {
				["hasIngenuityProc"] = false,
				["hyperlink"] = "|cffffffff|Hitem:2996::::::::|h[Bolt of Linen Cloth]|h|r",
				["isCrit"] = false,
				["itemID"] = 2996,
				["multicraft"] = 2,
				["operationID"] = 1,
				["quantity"] = 3,
			},
			["time"] = 1790001240,
		},
		["UnitCastingInfo"] = {
			["build"] = 61582,
			["sample"] = {
				"Craft", -- [1]
				"", -- [2]
				132149, -- [3]
				0, -- [4]
				1000, -- [5]
				true, -- [6]
				"Cast-V4-1", -- [7]
				false, -- [8]
				2963, -- [9]
				0, -- [10]
				0, -- [11]
			},
			["time"] = 1790001240,
		},
	},
	["chars"] = {
		["Thibodeaux-Bayou"] = {
			["class"] = "HUNTER",
			["faction"] = "Alliance",
			["lastSeen"] = 1790000000,
			["level"] = 10,
			["name"] = "Thibodeaux",
			["race"] = "Human",
			["realm"] = "Bayou",
		},
	},
	["corpses"] = {
		[61582] = {
			[644] = {
				["copper"] = 245,
				["n"] = 1,
			},
		},
	},
	["crafts"] = {
		[61582] = {
			[2393] = {
				["casts"] = 1,
				["procs"] = 0,
				["qty"] = 1,
				["skillUps"] = 0,
			},
			[2963] = {
				["casts"] = 1,
				["procs"] = 1,
				["qty"] = 3,
				["skillUps"] = 1,
			},
		},
	},
	["dropQty"] = {
		[872] = {
			[61582] = {
				[644] = 1,
			},
		},
	},
	["drops"] = {
		[872] = {
			[61582] = {
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
			},
			["equipLoc"] = "INVTYPE_2HWEAPON",
			["id"] = 872,
			["name"] = "Rockslicer",
			["quality"] = 3,
			["subtype"] = "Two-Handed Axes",
			["type"] = "Weapon",
		},
		[2320] = {
			["byBuild"] = {
				[61582] = {
					["firstSeen"] = 1790001200,
					["ilvl"] = 5,
					["link"] = "|cffffffff|Hitem:2320::::::::|h[Coarse Thread]|h|r",
					["reqLevel"] = 0,
					["sellPrice"] = 10,
					["stats"] = {
					},
					["tooltip"] = {
						"Coarse Thread", -- [1]
					},
				},
			},
			["classID"] = 7,
			["equipLoc"] = "",
			["id"] = 2320,
			["name"] = "Coarse Thread",
			["quality"] = 1,
			["subclassID"] = 5,
			["subtype"] = "Cloth",
			["type"] = "Trade Goods",
		},
		[2568] = {
			["byBuild"] = {
				[61582] = {
					["firstSeen"] = 1790001170,
					["ilvl"] = 5,
					["link"] = "|cffffffff|Hitem:2568::::::::|h[Brown Linen Vest]|h|r",
					["reqLevel"] = 0,
					["sellPrice"] = 10,
					["stats"] = {
					},
					["tooltip"] = {
						"Brown Linen Vest", -- [1]
					},
				},
			},
			["classID"] = 4,
			["equipLoc"] = "INVTYPE_CHEST",
			["id"] = 2568,
			["name"] = "Brown Linen Vest",
			["quality"] = 1,
			["subclassID"] = 1,
			["subtype"] = "Cloth",
			["type"] = "Armor",
		},
		[2572] = {
			["byBuild"] = {
				[61582] = {
					["firstSeen"] = 1790001170,
					["ilvl"] = 5,
					["link"] = "|cffffffff|Hitem:2572::::::::|h[Red Linen Robe]|h|r",
					["reqLevel"] = 0,
					["sellPrice"] = 10,
					["stats"] = {
					},
					["tooltip"] = {
						"Red Linen Robe", -- [1]
					},
				},
			},
			["classID"] = 4,
			["equipLoc"] = "INVTYPE_ROBE",
			["id"] = 2572,
			["name"] = "Red Linen Robe",
			["quality"] = 1,
			["subclassID"] = 1,
			["subtype"] = "Cloth",
			["type"] = "Armor",
		},
		[2589] = {
			["byBuild"] = {
				[61582] = {
					["firstSeen"] = 1790000360,
					["ilvl"] = 5,
					["link"] = "|cffffffff|Hitem:2589::::::::|h[Linen Cloth]|h|r",
					["reqLevel"] = 0,
					["sellPrice"] = 13,
					["stats"] = {
					},
					["tooltip"] = {
						"Linen Cloth", -- [1]
						"Max Stack: 20", -- [2]
					},
				},
			},
			["classID"] = 7,
			["equipLoc"] = "",
			["id"] = 2589,
			["name"] = "Linen Cloth",
			["quality"] = 1,
			["subclassID"] = 5,
			["subtype"] = "Cloth",
			["type"] = "Trade Goods",
		},
		[2598] = {
			["byBuild"] = {
				[61582] = {
					["firstSeen"] = 1790001200,
					["ilvl"] = 5,
					["link"] = "|cffffffff|Hitem:2598::::::::|h[Pattern: Red Linen Robe]|h|r",
					["reqLevel"] = 0,
					["sellPrice"] = 10,
					["stats"] = {
					},
					["tooltip"] = {
						"Pattern: Red Linen Robe", -- [1]
						"Teaches you how to sew a Red Linen Robe.", -- [2]
					},
				},
			},
			["classID"] = 9,
			["equipLoc"] = "",
			["id"] = 2598,
			["name"] = "Pattern: Red Linen Robe",
			["quality"] = 1,
			["subclassID"] = 2,
			["subtype"] = "Tailoring",
			["type"] = "Recipe",
		},
		[2770] = {
			["byBuild"] = {
				[61582] = {
					["firstSeen"] = 1790001323,
					["ilvl"] = 5,
					["link"] = "|cffffffff|Hitem:2770::::::::|h[Copper Ore]|h|r",
					["reqLevel"] = 0,
					["sellPrice"] = 10,
					["stats"] = {
					},
					["tooltip"] = {
						"Copper Ore", -- [1]
					},
				},
			},
			["classID"] = 7,
			["equipLoc"] = "",
			["id"] = 2770,
			["name"] = "Copper Ore",
			["quality"] = 1,
			["subclassID"] = 7,
			["subtype"] = "Cloth",
			["type"] = "Trade Goods",
		},
		[2996] = {
			["byBuild"] = {
				[61582] = {
					["firstSeen"] = 1790001200,
					["ilvl"] = 5,
					["link"] = "|cffffffff|Hitem:2996::::::::|h[Bolt of Linen Cloth]|h|r",
					["reqLevel"] = 0,
					["sellPrice"] = 10,
					["stats"] = {
					},
					["tooltip"] = {
						"Bolt of Linen Cloth", -- [1]
					},
				},
			},
			["classID"] = 7,
			["equipLoc"] = "",
			["id"] = 2996,
			["name"] = "Bolt of Linen Cloth",
			["quality"] = 1,
			["subclassID"] = 5,
			["subtype"] = "Cloth",
			["type"] = "Trade Goods",
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
		[6303] = {
			["byBuild"] = {
				[61582] = {
					["firstSeen"] = 1790001483,
					["ilvl"] = 5,
					["link"] = "|cffffffff|Hitem:6303::::::::|h[Raw Slitherskin Mackerel]|h|r",
					["reqLevel"] = 0,
					["sellPrice"] = 10,
					["stats"] = {
					},
					["tooltip"] = {
						"Raw Slitherskin Mackerel", -- [1]
					},
				},
			},
			["classID"] = 7,
			["equipLoc"] = "",
			["id"] = 6303,
			["name"] = "Raw Slitherskin Mackerel",
			["quality"] = 1,
			["subclassID"] = 8,
			["subtype"] = "Cloth",
			["type"] = "Trade Goods",
		},
	},
	["learned"] = {
		{
			["build"] = 61582,
			["char"] = "Thibodeaux-Bayou",
			["recipeID"] = 2393,
			["time"] = 1790001170,
			["via"] = "trainer:1103",
		}, -- [1]
		{
			["build"] = 61582,
			["char"] = "Thibodeaux-Bayou",
			["recipeID"] = 2389,
			["time"] = 1790001263,
			["via"] = "item:2598",
		}, -- [2]
	},
	["meta"] = {
		["addonVersion"] = "0.3.2",
		["build"] = 61582,
		["buildDate"] = "Sep 18 2026",
		["interface"] = 11507,
		["lastChar"] = {
			["class"] = "HUNTER",
			["faction"] = "Alliance",
			["lastSeen"] = 1790000000,
			["level"] = 10,
			["name"] = "Thibodeaux",
			["race"] = "Human",
			["realm"] = "Bayou",
		},
		["schemaVersion"] = 4,
		["session"] = "1790000000-9e37",
		["version"] = "1.15.7",
	},
	["nodeLoot"] = {
		[2770] = {
			[61582] = {
				[1731] = {
					["n"] = 2,
					["qty"] = 4,
				},
			},
		},
		[6303] = {
			[61582] = {
				[0] = {
					["n"] = 1,
					["qty"] = 1,
				},
			},
		},
	},
	["nodes"] = {
		[61582] = {
			[0] = {
				["opened"] = 1,
				["rankMin"] = 25,
				["skillLineID"] = 356,
				["spots"] = {
					[1429] = {
						"50.0,70.0", -- [1]
					},
				},
			},
			[1731] = {
				["name"] = "Copper Vein",
				["opened"] = 2,
				["rankMin"] = 70,
				["skillLineID"] = 186,
				["spots"] = {
					[1429] = {
						"42.1,65.9", -- [1]
						"50.0,70.0", -- [2]
					},
				},
			},
		},
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
	["recipeSeen"] = {
		[61582] = {
			["Thibodeaux-Bayou"] = {
				[2389] = {
					["byDifficulty"] = {
						["optimal"] = {
							["maxRank"] = 51,
							["minRank"] = 51,
						},
					},
					["difficulty"] = "optimal",
					["learned"] = true,
					["rank"] = 51,
					["seenAt"] = 1790001263,
				},
				[2393] = {
					["byDifficulty"] = {
						["medium"] = {
							["maxRank"] = 51,
							["minRank"] = 51,
						},
						["optimal"] = {
							["maxRank"] = 50,
							["minRank"] = 50,
						},
					},
					["difficulty"] = "medium",
					["learned"] = true,
					["rank"] = 51,
					["seenAt"] = 1790001263,
				},
				[2963] = {
					["byDifficulty"] = {
						["trivial"] = {
							["maxRank"] = 51,
							["minRank"] = 50,
						},
					},
					["difficulty"] = "trivial",
					["learned"] = true,
					["rank"] = 51,
					["seenAt"] = 1790001263,
				},
			},
		},
	},
	["recipes"] = {
		[2389] = {
			["byBuild"] = {
				[61582] = {
					["firstSeen"] = 1790001230,
					["maxTrivial"] = 90,
					["outputItemID"] = 2572,
					["qtyMin"] = 1,
					["reagents"] = {
						{
							["itemID"] = 2996,
							["qty"] = 3,
						}, -- [1]
						{
							["itemID"] = 2320,
							["qty"] = 2,
						}, -- [2]
					},
					["sourceText"] = "|cffffd100Vendor: |rMisensi",
				},
			},
			["categoryID"] = 1001,
			["id"] = 2389,
			["name"] = "Red Linen Robe",
			["skillLineID"] = 197,
		},
		[2393] = {
			["byBuild"] = {
				[61582] = {
					["firstSeen"] = 1790001230,
					["maxTrivial"] = 90,
					["outputItemID"] = 2568,
					["qtyMax"] = 1,
					["qtyMin"] = 1,
					["reagents"] = {
						{
							["itemID"] = 2996,
							["qty"] = 1,
						}, -- [1]
						{
							["itemID"] = 2320,
							["qty"] = 1,
						}, -- [2]
					},
				},
			},
			["categoryID"] = 1001,
			["id"] = 2393,
			["name"] = "Brown Linen Vest",
			["skillLineID"] = 197,
		},
		[2963] = {
			["byBuild"] = {
				[61582] = {
					["firstSeen"] = 1790001230,
					["maxTrivial"] = 90,
					["outputItemID"] = 2996,
					["qtyMax"] = 1,
					["qtyMin"] = 1,
					["reagents"] = {
						{
							["itemID"] = 2589,
							["qty"] = 2,
						}, -- [1]
					},
				},
			},
			["categoryID"] = 1001,
			["id"] = 2963,
			["name"] = "Bolt of Linen Cloth",
			["skillLineID"] = 197,
		},
	},
	["runs"] = {
		{
			["activeSecs"] = 930,
			["awaySecs"] = 120,
			["bossLoot"] = {
				{
					["encounterID"] = 1,
					["itemID"] = 872,
					["lootListKey"] = 1,
					["rolls"] = {
						{
							["class"] = "WARRIOR",
							["roll"] = 91,
							["state"] = "needmainspec",
						}, -- [1]
						{
							["class"] = "HUNTER",
							["roll"] = 45,
							["state"] = "greed",
						}, -- [2]
					},
					["winnerClass"] = "WARRIOR",
					["winnerIsSelf"] = false,
				}, -- [1]
			},
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
			["groupLoot"] = {
				{
					["by"] = "party",
					["class"] = "WARRIOR",
					["itemID"] = 872,
					["qty"] = 1,
					["won"] = true,
				}, -- [1]
				{
					["by"] = "party",
					["class"] = "PRIEST",
					["itemID"] = 2589,
					["qty"] = 2,
				}, -- [2]
				{
					["by"] = "self",
					["itemID"] = 2589,
					["qty"] = 3,
				}, -- [3]
			},
			["id"] = "Thibodeaux-Bayou-36-1790000060",
			["instance"] = "The Deadmines",
			["instanceID"] = 36,
			["loot"] = {
				{
					["itemID"] = 872,
					["npcID"] = 644,
				}, -- [1]
			},
			["lootMethod"] = "group",
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
	["skillUps"] = {
		{
			["build"] = 61582,
			["char"] = "Thibodeaux-Bayou",
			["from"] = 50,
			["recipeID"] = 2963,
			["skillLineID"] = 197,
			["time"] = 1790001241,
			["to"] = 51,
		}, -- [1]
	},
	["skills"] = {
		["Thibodeaux-Bayou"] = {
			[129] = {
				["lastSeen"] = 1790001241,
				["maxRank"] = 75,
				["modifier"] = 0,
				["name"] = "First Aid",
				["rank"] = 1,
			},
			[182] = {
				["lastSeen"] = 1790001241,
				["maxRank"] = 75,
				["modifier"] = 0,
				["name"] = "Herbalism",
				["rank"] = 40,
			},
			[186] = {
				["lastSeen"] = 1790001241,
				["maxRank"] = 75,
				["modifier"] = 0,
				["name"] = "Mining",
				["rank"] = 70,
			},
			[197] = {
				["lastSeen"] = 1790001241,
				["maxRank"] = 75,
				["modifier"] = 0,
				["name"] = "Tailoring",
				["rank"] = 51,
			},
			[356] = {
				["lastSeen"] = 1790001241,
				["maxRank"] = 75,
				["modifier"] = 0,
				["name"] = "Fishing",
				["rank"] = 25,
			},
		},
	},
	["trainers"] = {
		[61582] = {
			[1103] = {
				["complete"] = true,
				["loc"] = {
					["mapID"] = 1429,
					["subzone"] = "Goldshire",
					["x"] = 42.1,
					["y"] = 65.9,
					["zone"] = "Elwynn Forest",
				},
				["name"] = "Eldrin",
				["seenAt"] = 1790001170,
				["services"] = {
					{
						["cost"] = 100,
						["itemID"] = 2568,
						["level"] = 5,
						["name"] = "Brown Linen Vest",
						["skill"] = "Tailoring",
						["skillRank"] = 10,
						["type"] = "available",
					}, -- [1]
					{
						["cost"] = 250,
						["itemID"] = 2572,
						["level"] = 8,
						["name"] = "Red Linen Robe",
						["skill"] = "Tailoring",
						["skillRank"] = 40,
						["type"] = "unavailable",
					}, -- [2]
					{
						["cost"] = 500,
						["level"] = 10,
						["name"] = "Journeyman Tailoring",
						["type"] = "used",
					}, -- [3]
				},
				["skillLineID"] = 197,
			},
		},
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
	["vendors"] = {
		[61582] = {
			[1347] = {
				["items"] = {
					{
						["extendedCost"] = false,
						["itemID"] = 2320,
						["numAvailable"] = -1,
						["price"] = 10,
						["stack"] = 5,
					}, -- [1]
					{
						["extendedCost"] = false,
						["itemID"] = 2598,
						["numAvailable"] = 1,
						["price"] = 1200,
						["stack"] = 1,
					}, -- [2]
					{
						["currencyID"] = 1901,
						["extendedCost"] = true,
						["itemID"] = 2996,
						["numAvailable"] = -1,
						["price"] = 0,
						["stack"] = 1,
					}, -- [3]
				},
				["loc"] = {
					["mapID"] = 1429,
					["subzone"] = "Goldshire",
					["x"] = 42.1,
					["y"] = 65.9,
					["zone"] = "Elwynn Forest",
				},
				["name"] = "Alexandra Bolero",
				["seenAt"] = 1790001200,
			},
		},
	},
}
