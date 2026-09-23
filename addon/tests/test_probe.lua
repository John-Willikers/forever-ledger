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

  ---------------------------------------------------------------- /flprobe io
  local function freshProbe(overrides, savedDB)
    local c = H.new(overrides or {})
    c.env.ForeverLedgerProbeDB = savedDB
    c.load(PROBE)
    c.fire("ADDON_LOADED", "ForeverLedgerProbe")
    return c
  end
  local function io(c) return c.env.ForeverLedgerProbeDB.io[61582] or {} end
  local function lastIo(c) local l = io(c); return l[#l] end
  local function printedHas(c, pattern)
    for _, line in ipairs(c.world.printed) do
      if line:find(pattern, 1, true) then return true end
    end
    return false
  end
  local function combatCalls(c)
    local n = 0
    for _, call in ipairs(c.world.loggingCalls) do
      if call.name == "LoggingCombat" then n = n + 1 end
    end
    return n
  end

  H.test("probe io: first load records an empty arrival and loadCount 1", function()
    local c = freshProbe()
    local pdb = c.env.ForeverLedgerProbeDB
    H.eq(pdb.loadCount, 1)
    H.eq(pdb.loadCheck.loadCount, 1)
    H.eq(pdb.loadCheck.arrivedNil, true)
    H.eq(pdb.loadCheck.arrivedEmpty, true)
    H.eq(pdb.loadCheck.arrivedKeys, 0)
    H.eq(pdb.loadCheck.arrivedType, "nil")
    H.eq(pdb.loadCheck.probeVersion, "0.2.0")
    H.eq(#pdb.loadHistory, 1)
  end)

  H.test("probe io: loadCount grows only when SavedVariables are loaded back", function()
    local c = freshProbe()
    local saved = H.copy(c.env.ForeverLedgerProbeDB)
    local keys = H.count(saved)
    c.advance(60)
    local back = freshProbe({ clock = c.world.clock }, saved)
    local pdb = back.env.ForeverLedgerProbeDB
    H.eq(pdb.loadCount, 2)
    H.eq(pdb.loadCheck.arrivedNil, false)
    H.eq(pdb.loadCheck.arrivedEmpty, false)
    H.eq(pdb.loadCheck.arrivedKeys, keys)
    H.eq(pdb.loadCheck.previousLoadAt, c.world.clock - 60)
    H.eq(#pdb.loadHistory, 2)
    -- The Forever bug: the file is written but the next load starts empty again.
    local lost = freshProbe({ clock = c.world.clock })
    H.eq(lost.env.ForeverLedgerProbeDB.loadCount, 1)
  end)

  H.test("probe io: the ledger's table is checked read-only at login", function()
    local ledger = { meta = { schemaVersion = 1 }, quests = {}, items = { [5555] = { id = 5555 } }, drops = {},
                     runs = {}, turnIns = {}, chars = { ["Thibodeaux-Bayou"] = {} } }
    local before = H.serialize("x", ledger)
    ctl.world.loadedAddons.ForeverLedger = true
    ctl.env.ForeverLedgerDB = ledger
    ctl.fire("PLAYER_LOGIN")
    local l = db.ledgerCheck
    H.eq(l.addonLoaded, true)
    H.eq(l.type, "table")
    H.eq(l.keys, 7)
    H.eq(l.counts.items, 1)
    H.eq(l.counts.chars, 1)
    H.eq(l.records, 1)
    H.eq(l.empty, false)
    H.eq(H.serialize("x", ctl.env.ForeverLedgerDB), before, "ForeverLedgerDB untouched")

    local c = freshProbe()
    c.env.ForeverLedgerDB = { quests = {}, items = {}, drops = {}, runs = {}, turnIns = {}, meta = {} }
    c.world.loadedAddons.ForeverLedger = true
    c.fire("PLAYER_LOGIN")
    H.eq(c.env.ForeverLedgerProbeDB.ledgerCheck.empty, true)
    local off = freshProbe()
    off.fire("PLAYER_LOGIN")
    H.eq(off.env.ForeverLedgerProbeDB.ledgerCheck.addonLoaded, false)
    H.eq(off.env.ForeverLedgerProbeDB.ledgerCheck.counts, nil)
  end)

  H.test("probe io: /flprobe io records the logging state", function()
    ctl.world.cvars.advancedCombatLogging = "1"
    ctl.slash("FOREVERLEDGERPROBE", "io")
    local e = lastIo(ctl)
    H.eq(e.action, "state")
    H.eq(e.at, ctl.world.clock)
    H.eq(e.state.LoggingChat.ok, true)
    H.eq(e.state.LoggingChat.values[1], false)
    H.eq(e.state.LoggingCombat.values[1], false)
    H.eq(e.state["C_ChatInfo.IsLoggingChat"].values[1], false)
    H.eq(e.state["C_ChatInfo.IsLoggingCombat"].values[1], false)
    H.eq(e.state["GetCVar(advancedCombatLogging)"].values[1], "1")
    H.eq(e.state["C_CombatLog.IsCombatLogRestricted"].values[1], true)
    H.ok(printedHas(ctl, "LoggingCombat: false"), "state printed")
    H.ok(printedHas(ctl, "loadCount"), "load check printed")
    -- querying never changes the state
    H.eq(ctl.world.logging.chat, false)
    H.eq(ctl.world.logging.combat, false)
  end)

  H.test("probe io: missing APIs and errors are recorded, not thrown", function()
    local c = freshProbe({ missing = { C_CombatLog = true, GetCVar = true },
                           loggingErrors = { LoggingChat = "LoggingChat is blocked" } })
    c.slash("FOREVERLEDGERPROBE", "io")
    local s = lastIo(c).state
    H.eq(s["C_CombatLog.IsCombatLogRestricted"].missing, true)
    H.eq(s["GetCVar(advancedCombatLogging)"].missing, true)
    H.eq(s.LoggingChat.ok, false)
    H.ok(s.LoggingChat.err:find("LoggingChat is blocked", 1, true), "error text kept")
    H.eq(s.LoggingCombat.ok, true)
    c.slash("FOREVERLEDGERPROBE", "io on")
    local e = lastIo(c)
    H.eq(e.calls[1].ok, false)
    H.eq(e.calls[2].ok, true)
    local noFrame = freshProbe({ missing = { DEFAULT_CHAT_FRAME = true } })
    noFrame.slash("FOREVERLEDGERPROBE", "io on")
    H.eq(lastIo(noFrame).addMessage.ok, false)
  end)

  H.test("probe io: on turns both logs on and prints markers", function()
    local marker = ctl.world.clock
    ctl.slash("FOREVERLEDGERPROBE", "io on")
    local e = lastIo(ctl)
    H.eq(e.action, "on")
    H.eq(e.marker, marker)
    H.eq(e.calls[1].call, "LoggingChat(true)")
    H.eq(e.calls[1].values[1], true)
    H.eq(e.calls[2].call, "LoggingCombat(true)")
    H.eq(e.calls[2].values[1], true)
    H.eq(e.after["C_ChatInfo.IsLoggingChat"].values[1], true)
    H.eq(e.after["C_ChatInfo.IsLoggingCombat"].values[1], true)
    H.eq(e.after.LoggingCombat, nil, "read-back does not spend LoggingCombat calls")
    H.eq(e.addMessage.ok, true)
    H.eq(ctl.world.logging.chat, true)
    H.eq(ctl.world.logging.combat, true)
    H.ok(printedHas(ctl, "FLPROBE-PRINT-" .. marker), "print marker")
    H.eq(ctl.world.chatFrame[#ctl.world.chatFrame], "FLPROBE-ADDMSG-" .. marker)
    H.ok(printedHas(ctl, "_classic_beta_\\Logs\\"), "tells the user where to look")
  end)

  H.test("probe io: toggle turns each log off then on, at most once per 10 s", function()
    ctl.advance(20)
    local first = #ctl.world.loggingCalls
    ctl.slash("FOREVERLEDGERPROBE", "io toggle")
    local calls = ctl.world.loggingCalls
    H.eq(#calls, first + 4)
    H.eq(calls[first + 1].name, "LoggingCombat"); H.eq(calls[first + 1].arg, false)
    H.eq(calls[first + 2].name, "LoggingCombat"); H.eq(calls[first + 2].arg, true)
    H.eq(calls[first + 3].name, "LoggingChat"); H.eq(calls[first + 3].arg, false)
    H.eq(calls[first + 4].name, "LoggingChat"); H.eq(calls[first + 4].arg, true)
    local e = lastIo(ctl)
    H.eq(e.action, "toggle")
    H.eq(#e.calls, 4)
    H.eq(e.calls[1].call, "LoggingCombat(false)")
    H.ok(printedHas(ctl, "FLPROBE-TOGGLE-" .. ctl.world.clock), "toggle marker")

    local entries = #io(ctl)
    ctl.advance(5)
    ctl.slash("FOREVERLEDGERPROBE", "io toggle")
    H.eq(#ctl.world.loggingCalls, first + 4, "refused toggle makes no calls")
    H.eq(#io(ctl), entries)
    H.ok(printedHas(ctl, "toggle refused"), "says why")
    ctl.advance(5)
    ctl.slash("FOREVERLEDGERPROBE", "io toggle")
    H.eq(#ctl.world.loggingCalls, first + 8)
  end)

  H.test("probe io: never more than 5 combat-log calls in 10 s", function()
    local c = freshProbe()
    for _, cmd in ipairs({ "io", "io on", "io off", "io", "io on" }) do c.slash("FOREVERLEDGERPROBE", cmd) end
    H.eq(combatCalls(c), 5)
    c.slash("FOREVERLEDGERPROBE", "io off")
    H.eq(combatCalls(c), 5)
    H.ok(printedHas(c, "refused"), "says why")
    c.advance(10)
    c.slash("FOREVERLEDGERPROBE", "io off")
    H.eq(combatCalls(c), 6)
  end)

  H.test("probe io: off turns both logs off", function()
    ctl.advance(20)
    ctl.slash("FOREVERLEDGERPROBE", "io off")
    local e = lastIo(ctl)
    H.eq(e.action, "off")
    H.eq(e.calls[1].call, "LoggingChat(false)")
    H.eq(e.calls[2].call, "LoggingCombat(false)")
    H.eq(e.calls[2].values[1], false)
    H.eq(ctl.world.logging.chat, false)
    H.eq(ctl.world.logging.combat, false)
  end)

  H.test("probe io: reloadbtn refuses in combat", function()
    ctl.world.inCombat = true
    ctl.slash("FOREVERLEDGERPROBE", "io reloadbtn")
    H.eq(ctl.env.ForeverLedgerProbeReloadSecure, nil)
    H.eq(ctl.env.ForeverLedgerProbeReloadUI, nil)
    H.ok(printedHas(ctl, "in combat"), "says why")
    ctl.world.inCombat = false
  end)

  H.test("probe io: reload buttons act only on the player's click", function()
    ctl.slash("FOREVERLEDGERPROBE", "io reloadbtn")
    local secure, plain = ctl.env.ForeverLedgerProbeReloadSecure, ctl.env.ForeverLedgerProbeReloadUI
    H.ok(secure and plain, "both buttons exist")
    H.ok(secure.template:find("SecureActionButtonTemplate", 1, true), "secure template")
    H.eq(secure:GetAttribute("type"), "macro")
    H.eq(secure:GetAttribute("macrotext"), "/reload")
    H.eq(secure.text, "Reload (probe)")
    H.eq(secure.movable, true)
    H.eq(plain.template, "UIPanelButtonTemplate")
    local e = lastIo(ctl)
    H.eq(e.action, "reloadbtn")
    H.eq(e.secure.ok, true)
    H.eq(e.plain.ok, true)
    H.eq(ctl.world.reloads, 0, "nothing reloads by itself")
    H.eq(#ctl.world.secureMacros, 0)

    secure:Click()
    H.eq(ctl.world.secureMacros[1], "/reload")
    H.eq(lastIo(ctl).action, "secure-click")

    ctl.world.reloadBlocked = "Interface action failed because of an AddOn"
    plain:Click()
    local list = io(ctl)
    H.eq(list[#list - 1].action, "reloadui-click")
    H.eq(list[#list - 1].fn, "ReloadUI")
    H.eq(list[#list].action, "reloadui-result")
    H.eq(list[#list].result.ok, false)
    H.ok(list[#list].result.err:find("Interface action failed", 1, true), "error kept")
    H.eq(ctl.world.reloads, 1)
    ctl.world.reloadBlocked = nil

    -- a second /flprobe io reloadbtn reuses the buttons
    local frames = #ctl.frames
    ctl.slash("FOREVERLEDGERPROBE", "io reloadbtn hide")
    H.eq(secure.shown, false)
    ctl.slash("FOREVERLEDGERPROBE", "io reloadbtn")
    H.eq(#ctl.frames, frames)
    H.eq(secure.shown, true)
  end)

  H.test("probe io: a missing secure template is recorded", function()
    local c = freshProbe({ rejectTemplates = { SecureActionButtonTemplate = true } })
    c.slash("FOREVERLEDGERPROBE", "io reloadbtn")
    local e = lastIo(c)
    H.eq(e.secure.ok, false)
    H.eq(e.plain.ok, true)
    H.ok(c.env.ForeverLedgerProbeReloadUI, "plain button still made")
  end)

  H.test("probe io: blocked actions naming the probe are recorded", function()
    local before = #io(ctl)
    ctl.fire("ADDON_ACTION_BLOCKED", "SomeOtherAddon", "CastSpellByName()")
    H.eq(#io(ctl), before)
    ctl.fire("ADDON_ACTION_BLOCKED", "ForeverLedgerProbe", "ReloadUI()")
    local e = lastIo(ctl)
    H.eq(e.action, "blocked")
    H.eq(e.event, "ADDON_ACTION_BLOCKED")
    H.eq(e.func, "ReloadUI()")
  end)

  H.writeFile(FIXTURES .. "probe-dump.lua", H.serialize("ForeverLedgerProbeDB", db))
end
