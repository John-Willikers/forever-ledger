-- ForeverLedgerProbe: API dump, event support and the sniffer.
local PROBE = "../ForeverLedgerProbe/ForeverLedgerProbe.lua"
local FIXTURES = "../../fixtures/synthetic/"

local function fakeApiDocs(env)
  env.APIDocumentation = { systems = {
    { Name = "QuestLog", Namespace = "C_QuestLog",
      Functions = { { Name = "GetInfo", Arguments = { { Name = "questLogIndex", Type = "number", Nilable = false } },
                      Returns = { { Name = "info", Type = "QuestInfo", Nilable = true } } } },
      Events = { { Name = "QuestAccepted", LiteralName = "QUEST_ACCEPTED",
                   Payload = { { Name = "questId", Type = "number", Nilable = false } } } },
      Tables = { { Name = "QuestInfo", Type = "Structure",
                   Fields = { { Name = "title", Type = "string", Nilable = false } } } } },
  } }
end

return function(H)
  local ctl = H.new({ addons = { Blizzard_APIDocumentation = fakeApiDocs },
                      missing = { GetRewardXP = true }, rejectEvents = { ENCOUNTER_END = true } })
  ctl.env.C_QuestLog = { GetInfo = function() end, GetNumQuestLogEntries = function() return 0 end }
  ctl.load(PROBE)
  ctl.fire("ADDON_LOADED", "ForeverLedgerProbe")
  ctl.slash("FOREVERLEDGERPROBE", "")
  local db = ctl.env.ForeverLedgerProbeDB
  local d = db.dumps[61582]

  H.test("probe: dump records build info", function()
    H.ok(d, "dump for build 61582")
    H.eq(d.buildInfo.build, 61582)
    H.eq(d.buildInfo.interface, 11507)
  end)

  H.test("probe: dump records which globals and events exist", function()
    H.eq(d.globals.GetRewardXP, "nil")
    H.eq(d.globals.GetQuestID, "function")
    H.eq(d.globals["C_QuestLog.GetInfo"], "function")
    H.eq(d.events.ENCOUNTER_END, false)
    H.eq(d.events.QUEST_TURNED_IN, true)
    H.ok(#d.globalFunctions > 20, "global function list")
    H.eq(d.namespaces.C_QuestLog[1], "GetInfo")
  end)

  H.test("probe: dump walks API documentation like /api", function()
    H.eq(d.api.available, true)
    local sys = d.api.systems[1]
    H.eq(sys.namespace, "C_QuestLog")
    H.eq(sys.functions[1].args[1].name, "questLogIndex")
    H.eq(sys.events[1].literal, "QUEST_ACCEPTED")
    H.eq(sys.tables[1].fields[1].name, "title")
  end)

  H.test("probe: sniffer keeps a few payloads per event, with nils and arg counts", function()
    ctl.slash("FOREVERLEDGERPROBE", "sniff on")
    for i = 1, 8 do ctl.fire("QUEST_ACCEPTED", i, 1000 + i) end
    ctl.fire("ENCOUNTER_END", 1, "Rhahk'Zor", 1, 5, 1)
    ctl.fire("LOOT_OPENED", false, nil)
    local s = db.sniff[61582]
    H.eq(s.QUEST_ACCEPTED.count, 8)
    H.eq(#s.QUEST_ACCEPTED.samples, 5)
    H.eq(s.QUEST_ACCEPTED.samples[1].n, 2)
    H.eq(s.QUEST_ACCEPTED.samples[1][2], 1001)
    H.eq(s.ENCOUNTER_END.samples[1][2], "Rhahk'Zor")
    H.eq(s.LOOT_OPENED.samples[1][2], "<nil>")
  end)

  H.test("probe: sniffing survives a reload and can be turned off", function()
    local again = H.new({})
    again.env.ForeverLedgerProbeDB = db
    again.load(PROBE)
    again.fire("ADDON_LOADED", "ForeverLedgerProbe")
    again.fire("PLAYER_DEAD")
    H.eq(db.sniff[61582].PLAYER_DEAD.count, 1)
    again.slash("FOREVERLEDGERPROBE", "sniff off")
    again.fire("PLAYER_DEAD")
    H.eq(db.sniff[61582].PLAYER_DEAD.count, 1)
  end)

  H.test("probe: works without API documentation", function()
    local c = H.new({})
    c.load(PROBE)
    c.fire("ADDON_LOADED", "ForeverLedgerProbe")
    c.slash("FOREVERLEDGERPROBE", "")
    H.eq(c.env.ForeverLedgerProbeDB.dumps[61582].api.available, false)
  end)

  H.writeFile(FIXTURES .. "probe-dump.lua", H.serialize("ForeverLedgerProbeDB", db))
end
