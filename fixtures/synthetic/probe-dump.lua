
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
				"GetInstanceInfo", -- [3]
				"GetItemInfo", -- [4]
				"GetItemStats", -- [5]
				"GetLootSlotLink", -- [6]
				"GetLootSourceInfo", -- [7]
				"GetNumLootItems", -- [8]
				"GetNumQuestChoices", -- [9]
				"GetNumQuestLeaderBoards", -- [10]
				"GetNumQuestLogChoices", -- [11]
				"GetNumQuestLogEntries", -- [12]
				"GetNumQuestRewards", -- [13]
				"GetQuestID", -- [14]
				"GetQuestItemInfo", -- [15]
				"GetQuestItemLink", -- [16]
				"GetQuestLogItemLink", -- [17]
				"GetQuestLogLeaderBoard", -- [18]
				"GetQuestLogRewardMoney", -- [19]
				"GetQuestLogSelection", -- [20]
				"GetQuestLogTitle", -- [21]
				"GetRealZoneText", -- [22]
				"GetRealmName", -- [23]
				"GetRewardMoney", -- [24]
				"GetSubZoneText", -- [25]
				"GetTitleText", -- [26]
				"IsInInstance", -- [27]
				"LoadAddOn", -- [28]
				"SelectQuestLogEntry", -- [29]
				"UnitClass", -- [30]
				"UnitExists", -- [31]
				"UnitFactionGroup", -- [32]
				"UnitGUID", -- [33]
				"UnitLevel", -- [34]
				"UnitName", -- [35]
				"UnitRace", -- [36]
				"UnitXP", -- [37]
				"UnitXPMax", -- [38]
				"date", -- [39]
				"floor", -- [40]
				"format", -- [41]
				"print", -- [42]
				"strsplit", -- [43]
				"time", -- [44]
				"wipe", -- [45]
			},
			["globals"] = {
				["C_AddOns"] = "table",
				["C_AddOns.LoadAddOn"] = "function",
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
				["CombatLogGetCurrentEventInfo"] = "nil",
				["EJ_GetEncounterInfo"] = "nil",
				["GetBuildInfo"] = "function",
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
				["IsInInstance"] = "function",
				["LoadAddOn"] = "function",
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
					"LoadAddOn", -- [1]
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
			["probeVersion"] = "0.1.0",
		},
	},
	["probeVersion"] = "0.1.0",
	["sniff"] = {
		[61582] = {
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
	["sniffEventCount"] = 4,
	["sniffing"] = false,
}
