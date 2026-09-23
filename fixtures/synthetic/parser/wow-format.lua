
ForeverLedgerDB = {
	["meta"] = {
		["addonVersion"] = "0.1.0",
		["build"] = {
			"1.15.7", -- [1]
			"61582", -- [2]
			"Sep 18 2026", -- [3]
			11507, -- [4]
		},
		["lastChar"] = {
			["name"] = "Thibodeaux",
			["realm"] = "Bayou",
			["class"] = "HUNTER",
			["faction"] = "Alliance",
			["level"] = 14,
		},
	},
	["quests"] = {
		[1234] = {
			["id"] = 1234,
			["title"] = "The \"Swamp\" Thing",
			["xpOffered"] = 850,
			["moneyOffered"] = 0,
			["choices"] = {
				{
					["itemID"] = 5555,
					["count"] = 1,
				}, -- [1]
				{
					["itemID"] = 5556,
					["count"] = 1,
				}, -- [2]
			},
			["giver"] = {
				["name"] = "Marshal Dughan",
				["id"] = 240,
				["loc"] = {
					["x"] = 42.1,
					["y"] = 65.9,
					["zone"] = "Elwynn Forest",
					["subzone"] = "Goldshire",
				},
			},
			["suggestedGroup"] = nil,
			["isDungeon"] = true,
			["objectives"] = {
				"Kobold Vermin slain: 0/10", -- [1]
			},
		},
	},
	["items"] = {
		[5555] = {
			["name"] = "Swampwalker's Boots",
			["link"] = "|cff1eff00|Hitem:5555::::::::14:::::::|h[Swampwalker's Boots]|h|r",
			["quality"] = 2,
			["stats"] = {
				["ITEM_MOD_AGILITY_SHORT"] = 3,
				["RESISTANCE0_NAME"] = 45,
			},
			["tooltip"] = {
				"Swampwalker's Boots", -- [1]
				"Feet || Leather", -- [2]
				"|cffffd100Requires Level 12|r", -- [3]
			},
		},
	},
	["drops"] = {
		[5555] = {
			[0] = 1,
			[1706] = 3,
		},
	},
	["runs"] = {
	},
	["weird"] = {
		[-5] = -12.5,
		[1.5] = "float key",
		[true] = "bool key",
		["esc"] = "tab\there\nnewline \\ backslash \065\066",
		["hex"] = 0x1F,
		["exp"] = 1.5e3,
		["negzero"] = -0,
	},
}
ForeverLedgerOtherVar = nil
