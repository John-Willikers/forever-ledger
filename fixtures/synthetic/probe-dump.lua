
ForeverLedgerProbeDB = {
	["dumps"] = {
		[61582] = {
			["api"] = {
				["available"] = true,
				["systems"] = {
					{
						["events"] = {
							{
								["literal"] = "QUEST_ACCEPTED",
								["name"] = "QuestAccepted",
								["payload"] = {
									{
										["name"] = "questId",
										["type"] = "number",
									}, -- [1]
								},
							}, -- [1]
						},
						["functions"] = {
							{
								["args"] = {
									{
										["name"] = "questLogIndex",
										["type"] = "number",
									}, -- [1]
								},
								["name"] = "GetInfo",
								["returns"] = {
									{
										["name"] = "info",
										["nilable"] = true,
										["type"] = "QuestInfo",
									}, -- [1]
								},
							}, -- [1]
						},
						["name"] = "QuestLog",
						["namespace"] = "C_QuestLog",
						["tables"] = {
							{
								["fields"] = {
									{
										["name"] = "title",
										["type"] = "string",
									}, -- [1]
								},
								["name"] = "QuestInfo",
								["type"] = "Structure",
							}, -- [1]
						},
					}, -- [1]
				},
			},
			["at"] = 1790000000,
			["buildInfo"] = {
				["build"] = 61582,
				["date"] = "Sep 18 2026",
				["interface"] = 11507,
				["version"] = "1.15.7",
			},
			["events"] = {
				["ADDON_LOADED"] = true,
				["BOSS_KILL"] = true,
				["CHAT_MSG_COMBAT_XP_GAIN"] = true,
				["CHAT_MSG_LOOT"] = true,
				["CHAT_MSG_MONEY"] = true,
				["ENCOUNTER_END"] = false,
				["ENCOUNTER_START"] = true,
				["GET_ITEM_INFO_RECEIVED"] = true,
				["GROUP_ROSTER_UPDATE"] = true,
				["INSTANCE_ENCOUNTER_ENGAGE_UNIT"] = true,
				["ITEM_DATA_LOAD_RESULT"] = true,
				["LFG_COMPLETION_REWARD"] = true,
				["LOOT_CLOSED"] = true,
				["LOOT_OPENED"] = true,
				["LOOT_READY"] = true,
				["LOOT_SLOT_CLEARED"] = true,
				["PLAYER_ALIVE"] = true,
				["PLAYER_DEAD"] = true,
				["PLAYER_ENTERING_WORLD"] = true,
				["PLAYER_LEVEL_UP"] = true,
				["PLAYER_LOGIN"] = true,
				["PLAYER_REGEN_DISABLED"] = true,
				["PLAYER_REGEN_ENABLED"] = true,
				["PLAYER_UNGHOST"] = true,
				["PLAYER_XP_UPDATE"] = true,
				["QUEST_ACCEPTED"] = true,
				["QUEST_COMPLETE"] = true,
				["QUEST_DETAIL"] = true,
				["QUEST_LOG_UPDATE"] = true,
				["QUEST_PROGRESS"] = true,
				["QUEST_REMOVED"] = true,
				["QUEST_TURNED_IN"] = true,
				["QUEST_WATCH_UPDATE"] = true,
				["SCENARIO_COMPLETED"] = true,
				["UNIT_QUEST_LOG_CHANGED"] = true,
				["UPDATE_INSTANCE_INFO"] = true,
				["ZONE_CHANGED_NEW_AREA"] = true,
			},
			["globalFunctions"] = {
				"CreateFrame", -- [1]
				"GetBuildInfo", -- [2]
				"GetCVar", -- [3]
				"GetInstanceInfo", -- [4]
				"GetItemInfo", -- [5]
				"GetItemStats", -- [6]
				"GetLootSlotLink", -- [7]
				"GetLootSourceInfo", -- [8]
				"GetNumLootItems", -- [9]
				"GetNumQuestChoices", -- [10]
				"GetNumQuestLeaderBoards", -- [11]
				"GetNumQuestLogChoices", -- [12]
				"GetNumQuestLogEntries", -- [13]
				"GetNumQuestRewards", -- [14]
				"GetQuestID", -- [15]
				"GetQuestItemInfo", -- [16]
				"GetQuestItemLink", -- [17]
				"GetQuestLogItemLink", -- [18]
				"GetQuestLogLeaderBoard", -- [19]
				"GetQuestLogRewardMoney", -- [20]
				"GetQuestLogSelection", -- [21]
				"GetQuestLogTitle", -- [22]
				"GetQuestReward", -- [23]
				"GetRealZoneText", -- [24]
				"GetRealmName", -- [25]
				"GetRewardMoney", -- [26]
				"GetSubZoneText", -- [27]
				"GetTitleText", -- [28]
				"InCombatLockdown", -- [29]
				"IsInInstance", -- [30]
				"LoadAddOn", -- [31]
				"LoggingChat", -- [32]
				"LoggingCombat", -- [33]
				"ReloadUI", -- [34]
				"SelectQuestLogEntry", -- [35]
				"UnitAffectingCombat", -- [36]
				"UnitClass", -- [37]
				"UnitExists", -- [38]
				"UnitFactionGroup", -- [39]
				"UnitGUID", -- [40]
				"UnitLevel", -- [41]
				"UnitName", -- [42]
				"UnitRace", -- [43]
				"UnitXP", -- [44]
				"UnitXPMax", -- [45]
				"date", -- [46]
				"floor", -- [47]
				"format", -- [48]
				"hooksecurefunc", -- [49]
				"print", -- [50]
				"strsplit", -- [51]
				"time", -- [52]
				"wipe", -- [53]
			},
			["globals"] = {
				["C_AddOns"] = "table",
				["C_AddOns.LoadAddOn"] = "function",
				["C_ChatInfo.IsLoggingChat"] = "function",
				["C_ChatInfo.IsLoggingCombat"] = "function",
				["C_CombatLog.IsCombatLogRestricted"] = "function",
				["C_Container"] = "nil",
				["C_EncounterJournal"] = "nil",
				["C_Item"] = "nil",
				["C_Item.GetItemInfo"] = "nil",
				["C_Item.GetItemStats"] = "nil",
				["C_Item.RequestLoadItemDataByID"] = "nil",
				["C_Map"] = "table",
				["C_Map.GetBestMapForUnit"] = "function",
				["C_Map.GetPlayerMapPosition"] = "function",
				["C_QuestLog"] = "table",
				["C_QuestLog.GetInfo"] = "function",
				["C_QuestLog.GetNumQuestLogEntries"] = "function",
				["C_QuestLog.GetQuestIDForLogIndex"] = "nil",
				["C_QuestLog.GetQuestTagInfo"] = "nil",
				["C_QuestLog.GetTitleForQuestID"] = "nil",
				["C_TooltipInfo"] = "nil",
				["C_TooltipInfo.GetHyperlink"] = "nil",
				["C_UI.Reload"] = "nil",
				["CombatLogGetCurrentEventInfo"] = "nil",
				["EJ_GetEncounterInfo"] = "nil",
				["GetBuildInfo"] = "function",
				["GetCVar"] = "function",
				["GetDifficultyInfo"] = "nil",
				["GetInstanceInfo"] = "function",
				["GetItemInfo"] = "function",
				["GetItemStats"] = "function",
				["GetLocale"] = "nil",
				["GetLootSlotInfo"] = "nil",
				["GetLootSlotLink"] = "function",
				["GetLootSourceInfo"] = "function",
				["GetNumLootItems"] = "function",
				["GetNumQuestChoices"] = "function",
				["GetNumQuestLeaderBoards"] = "function",
				["GetNumQuestLogChoices"] = "function",
				["GetNumQuestLogEntries"] = "function",
				["GetNumQuestRewards"] = "function",
				["GetQuestDifficultyColor"] = "nil",
				["GetQuestID"] = "function",
				["GetQuestItemInfo"] = "function",
				["GetQuestItemLink"] = "function",
				["GetQuestLogItemLink"] = "function",
				["GetQuestLogLeaderBoard"] = "function",
				["GetQuestLogRewardMoney"] = "function",
				["GetQuestLogRewardXP"] = "nil",
				["GetQuestLogSelection"] = "function",
				["GetQuestLogTitle"] = "function",
				["GetQuestTagInfo"] = "nil",
				["GetRealmName"] = "function",
				["GetRewardMoney"] = "function",
				["GetRewardXP"] = "nil",
				["GetServerTime"] = "nil",
				["GetTitleText"] = "function",
				["InCombatLockdown"] = "function",
				["IsInInstance"] = "function",
				["LoadAddOn"] = "function",
				["LoggingChat"] = "function",
				["LoggingCombat"] = "function",
				["ReloadUI"] = "function",
				["SelectQuestLogEntry"] = "function",
				["UnitClass"] = "function",
				["UnitFactionGroup"] = "function",
				["UnitGUID"] = "function",
				["UnitLevel"] = "function",
				["UnitRace"] = "function",
				["UnitXP"] = "function",
				["UnitXPMax"] = "function",
			},
			["namespaces"] = {
				["C_AddOns"] = {
					"IsAddOnLoaded", -- [1]
					"LoadAddOn", -- [2]
				},
				["C_ChatInfo"] = {
					"IsLoggingChat", -- [1]
					"IsLoggingCombat", -- [2]
				},
				["C_CombatLog"] = {
					"IsCombatLogRestricted", -- [1]
				},
				["C_Map"] = {
					"GetBestMapForUnit", -- [1]
					"GetPlayerMapPosition", -- [2]
				},
				["C_QuestLog"] = {
					"GetInfo", -- [1]
					"GetNumQuestLogEntries", -- [2]
				},
			},
			["probeVersion"] = "0.2.0",
		},
	},
	["io"] = {
		[61582] = {
			{
				["action"] = "state",
				["at"] = 1790000000,
				["state"] = {
					["C_ChatInfo.IsLoggingChat"] = {
						["ok"] = true,
						["values"] = {
							false, -- [1]
						},
					},
					["C_ChatInfo.IsLoggingCombat"] = {
						["ok"] = true,
						["values"] = {
							false, -- [1]
						},
					},
					["C_CombatLog.IsCombatLogRestricted"] = {
						["ok"] = true,
						["values"] = {
							true, -- [1]
						},
					},
					["GetCVar(advancedCombatLogging)"] = {
						["ok"] = true,
						["values"] = {
							"1", -- [1]
						},
					},
					["LoggingChat"] = {
						["ok"] = true,
						["values"] = {
							false, -- [1]
						},
					},
					["LoggingCombat"] = {
						["ok"] = true,
						["values"] = {
							false, -- [1]
						},
					},
				},
			}, -- [1]
			{
				["action"] = "on",
				["addMessage"] = {
					["ok"] = true,
					["values"] = {
					},
				},
				["after"] = {
					["C_ChatInfo.IsLoggingChat"] = {
						["ok"] = true,
						["values"] = {
							true, -- [1]
						},
					},
					["C_ChatInfo.IsLoggingCombat"] = {
						["ok"] = true,
						["values"] = {
							true, -- [1]
						},
					},
					["C_CombatLog.IsCombatLogRestricted"] = {
						["ok"] = true,
						["values"] = {
							true, -- [1]
						},
					},
					["GetCVar(advancedCombatLogging)"] = {
						["ok"] = true,
						["values"] = {
							"1", -- [1]
						},
					},
				},
				["at"] = 1790000000,
				["calls"] = {
					{
						["call"] = "LoggingChat(true)",
						["ok"] = true,
						["values"] = {
							true, -- [1]
						},
					}, -- [1]
					{
						["call"] = "LoggingCombat(true)",
						["ok"] = true,
						["values"] = {
							true, -- [1]
						},
					}, -- [2]
				},
				["marker"] = 1790000000,
			}, -- [2]
			{
				["action"] = "toggle",
				["after"] = {
					["C_ChatInfo.IsLoggingChat"] = {
						["ok"] = true,
						["values"] = {
							true, -- [1]
						},
					},
					["C_ChatInfo.IsLoggingCombat"] = {
						["ok"] = true,
						["values"] = {
							true, -- [1]
						},
					},
					["C_CombatLog.IsCombatLogRestricted"] = {
						["ok"] = true,
						["values"] = {
							true, -- [1]
						},
					},
					["GetCVar(advancedCombatLogging)"] = {
						["ok"] = true,
						["values"] = {
							"1", -- [1]
						},
					},
				},
				["at"] = 1790000020,
				["calls"] = {
					{
						["call"] = "LoggingCombat(false)",
						["ok"] = true,
						["values"] = {
							false, -- [1]
						},
					}, -- [1]
					{
						["call"] = "LoggingCombat(true)",
						["ok"] = true,
						["values"] = {
							true, -- [1]
						},
					}, -- [2]
					{
						["call"] = "LoggingChat(false)",
						["ok"] = true,
						["values"] = {
							false, -- [1]
						},
					}, -- [3]
					{
						["call"] = "LoggingChat(true)",
						["ok"] = true,
						["values"] = {
							true, -- [1]
						},
					}, -- [4]
				},
				["marker"] = 1790000020,
			}, -- [3]
			{
				["action"] = "toggle",
				["after"] = {
					["C_ChatInfo.IsLoggingChat"] = {
						["ok"] = true,
						["values"] = {
							true, -- [1]
						},
					},
					["C_ChatInfo.IsLoggingCombat"] = {
						["ok"] = true,
						["values"] = {
							true, -- [1]
						},
					},
					["C_CombatLog.IsCombatLogRestricted"] = {
						["ok"] = true,
						["values"] = {
							true, -- [1]
						},
					},
					["GetCVar(advancedCombatLogging)"] = {
						["ok"] = true,
						["values"] = {
							"1", -- [1]
						},
					},
				},
				["at"] = 1790000030,
				["calls"] = {
					{
						["call"] = "LoggingCombat(false)",
						["ok"] = true,
						["values"] = {
							false, -- [1]
						},
					}, -- [1]
					{
						["call"] = "LoggingCombat(true)",
						["ok"] = true,
						["values"] = {
							true, -- [1]
						},
					}, -- [2]
					{
						["call"] = "LoggingChat(false)",
						["ok"] = true,
						["values"] = {
							false, -- [1]
						},
					}, -- [3]
					{
						["call"] = "LoggingChat(true)",
						["ok"] = true,
						["values"] = {
							true, -- [1]
						},
					}, -- [4]
				},
				["marker"] = 1790000030,
			}, -- [4]
			{
				["action"] = "off",
				["after"] = {
					["C_ChatInfo.IsLoggingChat"] = {
						["ok"] = true,
						["values"] = {
							false, -- [1]
						},
					},
					["C_ChatInfo.IsLoggingCombat"] = {
						["ok"] = true,
						["values"] = {
							false, -- [1]
						},
					},
					["C_CombatLog.IsCombatLogRestricted"] = {
						["ok"] = true,
						["values"] = {
							true, -- [1]
						},
					},
					["GetCVar(advancedCombatLogging)"] = {
						["ok"] = true,
						["values"] = {
							"1", -- [1]
						},
					},
				},
				["at"] = 1790000050,
				["calls"] = {
					{
						["call"] = "LoggingChat(false)",
						["ok"] = true,
						["values"] = {
							false, -- [1]
						},
					}, -- [1]
					{
						["call"] = "LoggingCombat(false)",
						["ok"] = true,
						["values"] = {
							false, -- [1]
						},
					}, -- [2]
				},
			}, -- [5]
			{
				["action"] = "reloadbtn",
				["at"] = 1790000050,
				["plain"] = {
					["ok"] = true,
					["values"] = {
						"created", -- [1]
					},
				},
				["secure"] = {
					["ok"] = true,
					["values"] = {
						"created", -- [1]
					},
				},
			}, -- [6]
			{
				["action"] = "secure-click",
				["at"] = 1790000050,
			}, -- [7]
			{
				["action"] = "reloadui-click",
				["at"] = 1790000050,
				["fn"] = "ReloadUI",
			}, -- [8]
			{
				["action"] = "reloadui-result",
				["at"] = 1790000050,
				["result"] = {
					["err"] = "./harness.lua:171: Interface action failed because of an AddOn",
					["ok"] = false,
				},
			}, -- [9]
			{
				["action"] = "blocked",
				["at"] = 1790000050,
				["event"] = "ADDON_ACTION_BLOCKED",
				["func"] = "ReloadUI()",
			}, -- [10]
		},
	},
	["ledgerCheck"] = {
		["addonLoaded"] = true,
		["at"] = 1790000000,
		["counts"] = {
			["chars"] = 1,
			["drops"] = 0,
			["items"] = 1,
			["quests"] = 0,
			["runs"] = 0,
			["turnIns"] = 0,
		},
		["empty"] = false,
		["keys"] = 7,
		["records"] = 1,
		["type"] = "table",
	},
	["loadCheck"] = {
		["arrivedEmpty"] = false,
		["arrivedKeys"] = 9,
		["arrivedNil"] = false,
		["arrivedType"] = "table",
		["at"] = 1790000000,
		["build"] = 61582,
		["loadCount"] = 2,
		["previousLoadAt"] = 1790000000,
		["probeVersion"] = "0.2.0",
	},
	["loadCount"] = 2,
	["loadHistory"] = {
		{
			["arrivedKeys"] = 0,
			["at"] = 1790000000,
			["build"] = 61582,
			["loadCount"] = 1,
		}, -- [1]
		{
			["arrivedKeys"] = 9,
			["at"] = 1790000000,
			["build"] = 61582,
			["loadCount"] = 2,
		}, -- [2]
	},
	["probeVersion"] = "0.2.0",
	["sniff"] = {
		[61582] = {
			["ADDON_ACTION_BLOCKED"] = {
				["count"] = 2,
				["firstAt"] = 1790000050,
				["samples"] = {
					{
						[1] = "SomeOtherAddon",
						[2] = "CastSpellByName()",
						["n"] = 2,
					}, -- [1]
					{
						[1] = "ForeverLedgerProbe",
						[2] = "ReloadUI()",
						["n"] = 2,
					}, -- [2]
				},
			},
			["ENCOUNTER_END"] = {
				["count"] = 1,
				["firstAt"] = 1790000000,
				["samples"] = {
					{
						[1] = 1,
						[2] = "Rhahk'Zor",
						[3] = 1,
						[4] = 5,
						[5] = 1,
						["n"] = 5,
					}, -- [1]
				},
			},
			["LOOT_OPENED"] = {
				["count"] = 1,
				["firstAt"] = 1790000000,
				["samples"] = {
					{
						[1] = false,
						[2] = "<nil>",
						["n"] = 2,
					}, -- [1]
				},
			},
			["PLAYER_DEAD"] = {
				["count"] = 1,
				["firstAt"] = 1790000000,
				["samples"] = {
					{
						["n"] = 0,
					}, -- [1]
				},
			},
			["PLAYER_LOGIN"] = {
				["count"] = 1,
				["firstAt"] = 1790000000,
				["samples"] = {
					{
						["n"] = 0,
					}, -- [1]
				},
			},
			["QUEST_ACCEPTED"] = {
				["count"] = 8,
				["firstAt"] = 1790000000,
				["samples"] = {
					{
						[1] = 1,
						[2] = 1001,
						["n"] = 2,
					}, -- [1]
					{
						[1] = 2,
						[2] = 1002,
						["n"] = 2,
					}, -- [2]
					{
						[1] = 3,
						[2] = 1003,
						["n"] = 2,
					}, -- [3]
					{
						[1] = 4,
						[2] = 1004,
						["n"] = 2,
					}, -- [4]
					{
						[1] = 5,
						[2] = 1005,
						["n"] = 2,
					}, -- [5]
				},
			},
		},
	},
	["sniffEventCount"] = 6,
	["sniffing"] = false,
}
