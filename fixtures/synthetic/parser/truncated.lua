
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
				"Kobold Vermi