-- luacheck config for the Forever Ledger addons (WoW Lua 5.1 environment)
std = "lua51"
max_line_length = 120
codes = true

globals = {
  -- SavedVariables
  "ForeverLedgerDB", "ForeverLedgerProbeDB",
  -- slash commands
  "SlashCmdList", "SLASH_FOREVERLEDGER1", "SLASH_FOREVERLEDGER2", "SLASH_FOREVERLEDGERPROBE1",
}

read_globals = {
  -- Lua helpers WoW adds to the global env
  "wipe", "floor", "format", "strsplit", "strjoin", "strtrim", "tinsert", "tremove", "time", "date",
  "debugprofilestop", "GetTime", "GetServerTime", "select", "hooksecurefunc",
  -- frames / UI
  "CreateFrame", "WorldFrame", "UIParent", "DEFAULT_CHAT_FRAME",
  -- namespaces
  "C_Item", "C_Map", "C_QuestLog", "C_AddOns", "C_Container", "C_Timer", "APIDocumentation",
  "C_ChatInfo", "C_CombatLog", "C_UI", "C_LootHistory", "C_PartyInfo", "Enum",
  "C_SkillInfo", "C_TradeSkillUI", "C_MerchantFrame", "C_Spell",
  -- client / addon
  "GetBuildInfo", "LoadAddOn", "IsAddOnLoaded", "GetLocale", "GetCVar", "ReloadUI", "InCombatLockdown",
  "LoggingChat", "LoggingCombat",
  -- units
  "UnitLevel", "UnitName", "UnitXP", "UnitXPMax", "UnitClass", "UnitRace", "UnitGUID", "UnitFactionGroup",
  "UnitExists", "GetRealmName", "UnitAffectingCombat", "IsInGroup", "GetNumGroupMembers", "GetLootMethod",
  -- zone / instance
  "GetRealZoneText", "GetSubZoneText", "IsInInstance", "GetInstanceInfo",
  -- quests
  "GetQuestID", "GetTitleText", "GetRewardXP", "GetRewardMoney", "GetNumQuestChoices", "GetNumQuestRewards",
  "GetQuestItemLink", "GetQuestItemInfo", "GetNumQuestLogEntries", "GetQuestLogTitle", "GetQuestLogSelection",
  "SelectQuestLogEntry", "GetNumQuestLogChoices", "GetQuestLogItemLink", "GetQuestLogRewardMoney",
  "GetNumQuestLeaderBoards", "GetQuestLogLeaderBoard", "GetQuestReward",
  -- items / loot
  "GetItemInfo", "GetItemStats", "GetNumLootItems", "GetLootSlotLink", "GetLootSourceInfo", "GetLootSlotType",
  "GetLootSlotInfo", "GetMoney", "LOOT_SLOT_MONEY", "random",
  -- professions
  "GetProfessions", "GetProfessionInfo", "UnitCastingInfo", "IsFishingLoot", "GetSpellInfo", "GameTooltip",
  "GameTooltipTextLeft1", "LOOT_ITEM_CREATED_SELF", "LOOT_ITEM_CREATED_SELF_MULTIPLE",
  "IsTradeskillTrainer", "GetNumTrainerServices", "GetTrainerServiceInfo", "GetTrainerServiceCost",
  "GetTrainerServiceSkillReq", "GetTrainerServiceLevelReq", "GetTrainerServiceItemLink", "GetTrainerServiceSkillLine",
  "GetTrainerServiceTypeFilter",
  "GetMerchantNumItems", "GetMerchantItemID", "GetMerchantItemLink", "GetItemSpell",
  "GetMerchantItemCostInfo", "GetMerchantItemCostItem", "GetMerchantCurrencies",
  -- NPC subtitles (unit tooltips) and the level-line templates
  "C_TooltipInfo", "TOOLTIP_UNIT_LEVEL", "TOOLTIP_UNIT_LEVEL_TYPE", "UNIT_LEVEL_TEMPLATE", "LEVEL",
}

-- The test harness defines WoW stubs as globals on purpose.
files["addon/tests"] = { ignore = { "111", "112", "113", "121", "122", "131", "142", "143", "212" } }
