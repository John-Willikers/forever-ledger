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
    H.eq(pdb.loadCheck.probeVersion, "0.6.0")
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

  ---------------------------------------------------------------- /flprobe specs
  local function specWorld()
    return {
      classes = {
        [1] = { token = "WARRIOR", name = "Warrior", specs = {
          { id = 71, name = "Arms", role = "DAMAGER", primaryStat = 1 },
          { id = 72, name = "Fury", role = "DAMAGER", primaryStat = 1 },
          { id = 73, name = "Protection", role = "TANK", primaryStat = 1 } } },
        [3] = { token = "HUNTER", name = "Hunter", specs = {
          { id = 253, name = "Beast Mastery", role = "DAMAGER", primaryStat = 2 },
          { id = 254, name = "Marksmanship", role = "DAMAGER", primaryStat = 2 } } },
        [8] = { token = "MAGE", name = "Mage", specs = {
          { id = 62, name = "Arcane", role = "DAMAGER", primaryStat = 4 } } },
      },
      itemSpecs = { [872] = { 71, 72, 73 }, [2308] = { 62, 253, 254 } },
      equipped = { [16] = 872 },
      player = { classID = 3, specIndex = 1 },
    }
  end
  local SPEC_ITEMS = {
    [872] = { name = "Rockslicer", quality = 2, ilvl = 21, reqLevel = 16, type = "Weapon",
              subtype = "Two-Handed Axes", equipLoc = "INVTYPE_2HWEAPON", stats = { ITEM_MOD_STRENGTH_SHORT = 7 } },
    [2308] = { name = "Fine Leather Cloak", quality = 1, ilvl = 15, reqLevel = 10, type = "Armor", subtype = "Cloth",
               equipLoc = "INVTYPE_CLOAK", stats = { ITEM_MOD_STAMINA_SHORT = 2, RESISTANCE0_NAME = 14 } },
    [2589] = { name = "Linen Cloth", quality = 1, type = "Trade Goods", subtype = "Trade Goods", equipLoc = "" },
  }
  local SPEC_BAGS = { [0] = { [1] = 2308, [3] = 2589 } }

  -- A probe on a client with the spec API; `savedDB` shares the main fixture table so the dump carries `specs`.
  local function specProbe(overrides, savedDB)
    local o = { specAPI = specWorld(), items = H.copy(SPEC_ITEMS), bags = H.copy(SPEC_BAGS) }
    for k, v in pairs(overrides or {}) do o[k] = v end
    return freshProbe(o, savedDB)
  end
  local function itemById(s, id)
    for _, it in ipairs(s.items) do
      if it.id == id then return it end
    end
  end

  -- Loading the shared table again counts as another SavedVariables load; keep the fixture's load check as it was.
  local keepLoad = { loadCount = db.loadCount, loadCheck = db.loadCheck, loadHistory = H.copy(db.loadHistory) }
  local sc = specProbe({}, db)
  sc.slash("FOREVERLEDGERPROBE", "specs")
  db.loadCount, db.loadCheck, db.loadHistory = keepLoad.loadCount, keepLoad.loadCheck, keepLoad.loadHistory
  local specs = db.specs and db.specs[61582] or {}

  H.test("probe specs: the catalog lists every class's specs with role and primary stat", function()
    H.ok(specs, "specs for build 61582")
    H.eq(specs.probeVersion, "0.6.0")
    H.eq(specs.at, sc.world.clock)
    local warrior = specs.catalog[1]
    H.eq(warrior.info.values[2], "WARRIOR")
    H.eq(warrior.count.values[1], 3)
    H.eq(warrior.specs[3].forClass.values[1], 73)
    H.eq(warrior.specs[3].forClass.values[2], "Protection")
    H.eq(warrior.specs[3].forClass.values[5], "TANK")
    H.eq(warrior.specs[3].info.values[1], 73)
    H.eq(warrior.specs[3].info.values[6], 1, "primaryStat")
    H.eq(specs.catalog[3].specs[1].info.values[6], 2)
    H.eq(specs.catalog[2].count.values[1], 0, "a class id with no specs is still asked")
    H.eq(specs.catalog[8].specs[1].forClass.values[1], 62)
    H.eq(specs.player.classID, 3)
    H.eq(specs.player.class, "HUNTER")
    H.eq(specs.player.level, 10)
    H.eq(specs.player.specIndex.values[1], 1)
    H.eq(specs.player.specs[1].values[1], 253)
    H.eq(specs.api["C_Item.GetItemSpecInfo"], "function")
    H.eq(specs.api["C_Item.DoesItemContainSpec"], "function")
    H.eq(specs.api["C_SpecializationInfo.GetSpecializationInfo"], "function")
  end)

  H.test("probe specs: bag and equipped items record spec info, contains and stat keys", function()
    local axe = itemById(specs, 872)
    H.ok(axe, "equipped axe listed")
    H.eq(axe.where, "slot:16")
    H.eq(axe.link, H.itemLink(872, SPEC_ITEMS[872]))
    H.eq(axe.specInfo.ok, true)
    H.eq(#axe.specInfo.values[1], 3)
    H.eq(axe.specInfo.values[1][3], 73)
    H.eq(axe.contains[73], true)
    H.eq(axe.contains[62], nil, "only hits are stored")
    H.eq(axe.askedSpecs, 6)
    H.eq(axe.equippable.values[1], true)
    H.eq(axe.classSpecific.values[1], false)
    H.eq(axe.statKeys[1], "ITEM_MOD_STRENGTH_SHORT")
    local cloak = itemById(specs, 2308)
    H.eq(cloak.where, "bag:0:1")
    H.eq(cloak.contains[253], true)
    H.eq(cloak.contains[71], nil)
    H.eq(cloak.statKeys[1], "ITEM_MOD_STAMINA_SHORT")
    H.eq(cloak.statKeys[2], "RESISTANCE0_NAME")
    local cloth = itemById(specs, 2589)
    H.eq(cloth.where, "bag:0:3")
    H.eq(cloth.equippable.values[1], false)
    H.eq(#cloth.specInfo.values[1], 0)
    H.eq(cloth.contains, nil, "non-equippable items are not asked per spec")
    H.eq(specs.counts.items, 3)
    H.eq(specs.counts.equippable, 2)
    H.eq(specs.counts.withSpecInfo, 2)
    H.eq(specs.counts.emptySpecInfo, 1)
    H.eq(specs.counts.specInfoErrors, 0)
    H.eq(specs.counts.specInfoOther, 0)
    H.eq(specs.counts.containsAny, 2)
    H.eq(sc.world.calls.DoesItemContainSpec, 12, "6 catalog specs × 2 equippable items")
    H.ok(printedHas(sc, "3 item(s)"), "summary printed")
    H.ok(printedHas(sc, "/reload"), "tells the user to reload")
  end)

  H.test("probe specs: missing spec APIs are recorded, not thrown", function()
    local c = specProbe({ missing = { C_SpecializationInfo = true, GetSpecializationInfoForClassID = true } })
    c.env.C_Item.GetItemSpecInfo = nil
    c.env.C_Item.DoesItemContainSpec = nil
    c.slash("FOREVERLEDGERPROBE", "specs")
    local s = c.env.ForeverLedgerProbeDB.specs[61582]
    H.eq(s.api["C_Item.GetItemSpecInfo"], "nil")
    H.eq(s.api.C_SpecializationInfo, "nil")
    H.eq(s.catalog[1].count.missing, true)
    H.eq(s.catalog[1].specs[1].forClass.missing, true)
    H.eq(s.player.specIndex.missing, true)
    local axe = itemById(s, 872)
    H.eq(axe.specInfo.missing, true)
    H.eq(axe.contains, nil)
    H.eq(axe.equippable.values[1], true)
    H.eq(s.counts.items, 3)
    H.eq(s.counts.withSpecInfo, 0)
    H.eq(s.counts.containsAny, 0)
  end)

  H.test("probe specs: errors from the item calls are recorded per item", function()
    local w = specWorld()
    w.errors = { GetItemSpecInfo = "GetItemSpecInfo(): item not loaded", DoesItemContainSpec = "no such spec" }
    local c = specProbe({ specAPI = w })
    c.slash("FOREVERLEDGERPROBE", "specs")
    local s = c.env.ForeverLedgerProbeDB.specs[61582]
    local axe = itemById(s, 872)
    H.eq(axe.specInfo.ok, false)
    H.ok(axe.specInfo.err:find("item not loaded", 1, true), "error text kept")
    H.ok(axe.containsErr:find("no such spec", 1, true), "contains error kept")
    H.eq(H.count(axe.contains), 0)
    H.eq(s.counts.specInfoErrors, 3)
    H.eq(s.counts.containsAny, 0)
  end)

  H.test("probe specs: a nil or non-table GetItemSpecInfo is counted apart and never aborts the run", function()
    local w = specWorld()
    w.specInfoNil = true
    local c = specProbe({ specAPI = w })
    c.slash("FOREVERLEDGERPROBE", "specs")
    local s = c.env.ForeverLedgerProbeDB.specs[61582]
    H.ok(s, "entry written")
    local axe = itemById(s, 872)
    H.eq(axe.specInfo.ok, true)
    H.eq(axe.specInfo.values[1], "<nil>")
    H.eq(s.counts.withSpecInfo, 0)
    H.eq(s.counts.emptySpecInfo, 0)
    H.eq(s.counts.specInfoOther, 3)
    H.eq(s.counts.containsAny, 2, "DoesItemContainSpec still asked")

    local w2 = specWorld()
    w2.specInfoValue = false
    local c2 = specProbe({ specAPI = w2 })
    c2.slash("FOREVERLEDGERPROBE", "specs")
    local s2 = c2.env.ForeverLedgerProbeDB.specs[61582]
    H.eq(itemById(s2, 872).specInfo.values[1], false)
    H.eq(s2.counts.specInfoOther, 3)
    H.eq(s2.counts.items, 3)
  end)

  H.test("probe specs: class ids come from GetAllClassIDs as well as 1..13", function()
    local w = specWorld()
    w.classes[20] = { token = "TINKER", name = "Tinker", specs = {
      { id = 900, name = "Gadgets", role = "DAMAGER", primaryStat = 4 } } }
    local c = specProbe({ specAPI = w })
    c.slash("FOREVERLEDGERPROBE", "specs")
    local s = c.env.ForeverLedgerProbeDB.specs[61582]
    H.eq(s.catalog[20].specs[1].forClass.values[1], 900)
    H.eq(s.catalog[2].count.values[1], 0, "1..13 are still asked")
    H.eq(s.api["C_SpecializationInfo.GetAllClassIDs"], "function")
    H.eq(itemById(s, 872).askedSpecs, 7)
    local none = specProbe({ specAPI = specWorld(), missing = { C_SpecializationInfo = true } })
    none.slash("FOREVERLEDGERPROBE", "specs")
    H.eq(none.env.ForeverLedgerProbeDB.specs[61582].api["C_SpecializationInfo.GetAllClassIDs"], "nil")
  end)

  H.test("probe specs: a second run replaces the build's entry and reset wipes it", function()
    local c = specProbe()
    c.slash("FOREVERLEDGERPROBE", "specs")
    c.advance(30)
    c.slash("FOREVERLEDGERPROBE", "specs")
    local pdb = c.env.ForeverLedgerProbeDB
    H.eq(pdb.specs[61582].at, c.world.clock)
    H.eq(#pdb.specs[61582].items, 3)
    c.slash("FOREVERLEDGERPROBE", "reset confirm")
    H.eq(H.count(pdb.specs), 0)
    c.slash("FOREVERLEDGERPROBE", "status")
    H.ok(printedHas(c, "specs"), "help mentions specs")
  end)

  H.test("probe names: records every way the client names you, and finds surname functions", function()
    local c = freshProbe({})
    c.env.UnitFullName = function() return "Sam", "Classic Beta PvE" end
    c.env.GetUnitName = function(_, server) return server and "Sam-Classic Beta PvE" or "Sam" end
    c.env.PlayerLocation = { CreateFromUnit = function(_, unit) return { unit = unit } end }
    c.env.C_PlayerInfo = {
      ShouldDisplaySurname = function() return true end,
      GetPlayerSurname = function(loc) return loc and loc.unit == "player" and "Willikers" or nil end,
      GetClass = function() return { className = "Druid", classID = 11 } end,
      SetSomething = function() error("never called") end,
      SetCharacterName = function() error("setters are never called") end,
    }
    c.env.PlayerName = { GetText = function() return "Sam Willikers" end }
    c.slash("FOREVERLEDGERPROBE", "names")
    local n = c.env.ForeverLedgerProbeDB.names[61582]
    H.ok(n, "names for the build")
    H.eq(n.units.player.UnitFullName.values[1], "Sam")
    H.eq(n.units.player.GetUnitNameServer.values[1], "Sam-Classic Beta PvE")
    H.eq(n.units.player.calls.GetPlayerSurname.values[1], "Willikers")
    H.eq(n.units.player.calls.GetClass.values[1].className, "Druid", "tables kept one level deep")
    H.eq(n.units.player.calls.SetSomething, nil, "only getters are called")
    H.eq(n.ShouldDisplaySurname.values[1], true)
    H.eq(n.frames.PlayerName, "Sam Willikers")
    local found = false
    for _, name in ipairs(n.functions) do found = found or name == "C_PlayerInfo.GetPlayerSurname" end
    H.ok(found, "surname function found")
    H.eq(n.units.target, nil, "no target, no entry")
    H.eq(n.direct["C_PlayerInfo.SetCharacterName"], nil, "name-like setters are listed, not called")
    H.eq(n.direct["C_PlayerInfo.GetPlayerSurname"].player.ok, true)
  end)

  H.test("probe fish: records a cast's events, lure, tooltip, zone and loot sources", function()
    local c = freshProbe({ professionAPI = true, spells = { [7620] = { name = "Fishing" } }, fishing = true,
                           items = { [6359] = { name = "Firefin Snapper" } },
                           loot = { { itemID = 6359, sourceGUID = "GameObject-0-1-2-3-4-35591-0000" } } })
    c.env.GetWeaponEnchantInfo = function() return true, 540000, 0, 263 end
    c.slash("FOREVERLEDGERPROBE", "fish on")
    c.fire("UNIT_SPELLCAST_SENT", "player", "", "Cast-1", 7620)
    c.fire("UNIT_SPELLCAST_CHANNEL_START", "player", "Cast-1", 7620)
    c.fire("UNIT_SPELLCAST_SENT", "target", "", "Cast-x", 7620)
    c.fire("LOOT_OPENED", false, false)
    c.fire("LOOT_CLOSED")
    c.fire("UNIT_SPELLCAST_SENT", "player", "", "Cast-2", 133)
    local f = c.env.ForeverLedgerProbeDB.fish[61582]
    H.eq(#f, 1, "one fishing cast; a Fireball is not one")
    H.eq(f[1].lure.values[4], 263)
    H.eq(f[1].where.zone, "Elwynn Forest")
    H.eq(f[1].where.mapID, 1429)
    H.eq(f[1].loot.fishingLoot.values[1], true)
    H.eq(f[1].loot.slots[1].sources.values[1], "GameObject-0-1-2-3-4-35591-0000")
    H.eq(f[1].loot.slots[1].info.values[2], "Firefin Snapper")
    local events = {}
    for i, e in ipairs(f[1].events) do events[i] = e.event end
    H.eq(table.concat(events, ","), "UNIT_SPELLCAST_SENT,UNIT_SPELLCAST_CHANNEL_START,LOOT_OPENED,LOOT_CLOSED")
    c.slash("FOREVERLEDGERPROBE", "fish off")
    c.fire("UNIT_SPELLCAST_SENT", "player", "", "Cast-3", 7620)
    H.eq(#c.env.ForeverLedgerProbeDB.fish[61582], 1, "off stops recording")
  end)

  ---------------------------------------------------------------- /flprobe tracker, tracker watch, arrow
  -- A retail-style client: a quest tracker frame with modules, quest watches and super-tracking.
  local function trackerClient(overrides)
    local c = freshProbe(overrides or { professionAPI = true })
    local q = { watched = { [101] = 0 }, order = { 101 }, super = 101, calls = {} }
    local function rebuild()
      q.order = {}
      for id in pairs(q.watched) do q.order[#q.order + 1] = id end
      table.sort(q.order)
    end
    c.env.Enum.QuestWatchType = { Automatic = 0, Manual = 1 }
    c.env.C_QuestLog = {
      GetNumQuestLogEntries = function() return 3 end,
      GetInfo = function(i)
        return ({ { title = "Tirisfal Glades", isHeader = true },
                  { title = "The Mindless Ones", questID = 101, isOnMap = true },
                  { title = "Rattling the Rattlecages", questID = 102 } })[i]
      end,
      GetQuestWatchType = function(id) return q.watched[id] end,
      GetNumQuestWatches = function() return #q.order end,
      GetQuestIDForQuestWatchIndex = function(i) return q.order[i] end,
      AddQuestWatch = function(id) q.calls[#q.calls + 1] = "add " .. id; q.watched[id] = 1; rebuild() end,
      RemoveQuestWatch = function(id) q.calls[#q.calls + 1] = "remove " .. id; q.watched[id] = nil; rebuild() end,
      GetNextWaypoint = function(id) if id == 101 then return 2049, 0.31, 0.62 end end,
    }
    c.env.C_SuperTrack = { GetSuperTrackedQuestID = function() return q.super end,
                           SetSuperTrackedQuestID = function(id) q.super = id end }
    c.env.C_Map.GetWorldPosFromMapPos = function() return 0, { x = 1840.5, y = 1520.25 } end
    c.env.GetPlayerFacing = function() return c.world.facing or 1.5708 end
    c.env.ObjectiveTrackerFrame = { GetObjectType = function() return "Frame" end, IsShown = function() return true end,
      modules = { { GetName = function() return "QuestObjectiveTracker" end, headerText = "Quests", uiOrder = 3 } },
      AddModule = function() end }
    c.env.ObjectiveTrackerModuleMixin = { AddBlock = function() end, LayoutContents = function() end }
    return c, q
  end

  H.test("probe tracker: records the tracker frame, its modules, templates, watches and waypoints", function()
    local c = trackerClient({ professionAPI = true, rejectTemplates = { ObjectiveTrackerHeaderTemplate = true } })
    c.slash("FOREVERLEDGERPROBE", "tracker")
    local t = c.env.ForeverLedgerProbeDB.tracker[61582]
    H.ok(t, "tracker for the build")
    H.eq(t.globals.ObjectiveTrackerFrame, "table")
    H.eq(t.globals.ObjectiveTrackerModuleMixin, "table")
    local tf = t.objects.ObjectiveTrackerFrame
    H.eq(tf.objectType.values[1], "Frame")
    H.eq(tf.modules[1].name, "QuestObjectiveTracker")
    H.eq(tf.modules[1].header, "Quests")
    H.eq(t.objects.ObjectiveTrackerModuleMixin.methods[1], "AddBlock")
    H.eq(t.objects.QuestWatchFrame, nil, "a missing frame is nil")
    H.eq(t.templates.ObjectiveTrackerModuleTemplate.ok, true)
    H.eq(t.templates.ObjectiveTrackerHeaderTemplate.ok, false, "a missing template is an error, not a throw")
    H.eq(t.apis["C_QuestLog.AddQuestWatch"], "function")
    H.eq(t.apis["C_Navigation.GetDistance"], "nil")
    H.eq(t.watchTypes.Manual, 1)
    H.eq(#t.quests, 2, "headers are skipped")
    H.eq(t.quests[1].watchType.values[1], 0)
    H.eq(t.quests[1].waypoint.values[2], 0.31)
    H.eq(t.watches.ids[1], 101)
    H.eq(t.superTrackedQuest.values[1], 101)
    H.eq(t.nav.facing, 1.5708)
    H.eq(t.nav.mapID, 1429)
    H.eq(t.nav.world.values[2].x, 1840.5)
    H.ok(printedHas(c, "tracker Frame"), "summary line")
  end)

  H.test("probe tracker: a client with none of it records gaps and doesn't throw", function()
    local c = freshProbe({})
    c.slash("FOREVERLEDGERPROBE", "tracker")
    local t = c.env.ForeverLedgerProbeDB.tracker[61582]
    H.eq(t.objects.ObjectiveTrackerFrame, nil)
    H.eq(t.apis.GetPlayerFacing, "nil")
    H.eq(t.nav.facing.missing, true)
    H.eq(#t.quests, 0)
    c.slash("FOREVERLEDGERPROBE", "tracker watch")
    H.ok(printedHas(c, "no quests in your log"), "watch test needs a quest")
    c.slash("FOREVERLEDGERPROBE", "arrow")
    H.ok(printedHas(c, "C_Timer.After is missing"), "arrow needs timers")
  end)

  H.test("probe tracker watch: watches and super-tracks an unwatched quest, then puts both back", function()
    local c, q = trackerClient()
    c.slash("FOREVERLEDGERPROBE", "tracker watch")
    local w = c.env.ForeverLedgerProbeDB.tracker.watchTest[61582]
    H.eq(w.questID, 102, "the first unwatched quest")
    local byName = {}
    for _, s in ipairs(w.steps) do byName[s.name] = s end
    H.eq(byName.AddQuestWatch.watchType.values[1], 1)
    H.eq(byName.AddQuestWatch.watches.values[1], 2)
    H.eq(byName.SetSuperTrackedQuestID.superTracked.values[1], 102)
    H.eq(table.concat(q.calls, ","), "add 102,remove 102")
    H.eq(q.watched[102], nil, "unwatched again")
    H.eq(q.watched[101], 0, "the other watch untouched")
    H.eq(q.super, 101, "super-tracking restored")
    H.ok(printedHas(c, "restored"), "says it put things back")
  end)

  H.test("probe tracker: a non-number facing is kept as the call result, not rounded", function()
    local c = trackerClient()
    c.env.GetPlayerFacing = function() return nil end
    c.slash("FOREVERLEDGERPROBE", "tracker")
    local t = c.env.ForeverLedgerProbeDB.tracker[61582]
    H.eq(t.nav.facing.ok, true)
    H.eq(t.nav.facing.values[1], "<nil>")
    H.ok(printedHas(c, "facing <nil>,"), "summary shows the nil, not an error")
  end)

  H.test("probe tracker watch: refuses in combat", function()
    local c, q = trackerClient({ professionAPI = true, inCombat = true })
    c.slash("FOREVERLEDGERPROBE", "tracker watch")
    H.eq(#q.calls, 0)
    H.ok(printedHas(c, "out of combat only"), "says why")
  end)

  H.test("probe arrow: samples facing and position once a second, 20 times", function()
    local c = trackerClient()
    c.slash("FOREVERLEDGERPROBE", "arrow")
    for i = 1, 25 do
      c.world.facing = i / 10
      c.advance(1)
    end
    local a = c.env.ForeverLedgerProbeDB.tracker.arrow[61582]
    H.eq(#a, 20)
    H.eq(a[2].facing, 0.1)
    H.eq(a[20].facing, 1.9)
    H.ok(printedHas(c, "arrow: 20 sample(s)"), "summary when done")
  end)

  ---------------------------------------------------------------- /flprobe travel, trip
  -- A client with the retail-style taxi, bind, hearth, mount and map APIs.
  local function travelClient(overrides)
    local c = freshProbe(overrides or { professionAPI = true })
    local t = { taxiCalls = {}, opened = 0, taken = {} }
    local function vec(x, y) return { x = x, y = y, GetXY = function(self) return self.x, self.y end } end
    c.env.CreateVector2D = vec
    local maps = {
      [1414] = { mapID = 1414, name = "Kalimdor", mapType = 2, parentMapID = 947, w = 36800, h = 24533 },
      [1415] = { mapID = 1415, name = "Eastern Kingdoms", mapType = 2, parentMapID = 947, w = 40741, h = 27160 },
      [1429] = { mapID = 1429, name = "Elwynn Forest", mapType = 3, parentMapID = 1415, w = 3470, h = 2314 },
    }
    c.env.C_Map.GetMapInfo = function(id)
      local m = maps[id]
      if m then return { mapID = m.mapID, name = m.name, mapType = m.mapType, parentMapID = m.parentMapID } end
    end
    c.env.C_Map.GetMapWorldSize = function(id) local m = maps[id]; if m then return m.w, m.h end end
    c.env.C_Map.GetWorldPosFromMapPos = function(id, pos)
      local m = maps[id]
      if not m then return nil end
      return id == 1414 and 1 or 0, vec(1000 - pos.x * m.h, 500 - pos.y * m.w)
    end
    local nodes = {
      { nodeID = 2, name = "Stormwind, Elwynn", position = vec(0.4, 0.6), state = 0, slotIndex = 1 },
      { nodeID = 4, name = "Sentinel Hill, Westfall", position = vec(0.38, 0.72), state = 1, slotIndex = 2 },
    }
    c.env.C_TaxiMap = {
      GetAllTaxiNodes = function(id)
        t.taxiCalls[#t.taxiCalls + 1] = "all " .. id
        return id == 1415 and nodes or {}
      end,
      GetTaxiNodesForMap = function(id)
        t.taxiCalls[#t.taxiCalls + 1] = "map " .. id
        if id ~= 1415 then return {} end
        return { { nodeID = 2, name = "Stormwind, Elwynn", position = vec(0.4, 0.6), faction = 2 } }
      end,
    }
    c.env.GetTaxiMapID = function() return 1415 end
    c.env.NumTaxiNodes = function() return t.open and 2 or 0 end
    c.env.TaxiNodeName = function(i) return nodes[i] and nodes[i].name or "INVALID" end
    c.env.TaxiNodeGetType = function(i) return i == 1 and "CURRENT" or "REACHABLE" end
    c.env.TaxiNodePosition = function(i) return nodes[i].position.x, nodes[i].position.y end
    c.env.TakeTaxiNode = function(i) t.taken[#t.taken + 1] = i end
    c.env.UnitOnTaxi = function() return t.onTaxi or false end
    c.env.GetBindLocation = function() return "Goldshire" end
    c.env.C_Item = c.env.C_Item or {}
    c.env.C_Item.GetItemCount = function(id) return id == 6948 and 1 or 0 end
    c.env.C_Container = c.env.C_Container or {}
    c.env.C_Container.GetItemCooldown = function() return 1000, 1800, 1 end
    c.env.C_Spell = c.env.C_Spell or {}
    c.env.C_Spell.GetSpellCooldown = function()
      return { startTime = 1000, duration = 1800, isEnabled = true, modRate = 1 }
    end
    c.env.IsMounted = function() return t.mounted or false end
    c.env.IsIndoors = function() return false end
    c.env.IsFlying = function() return false end
    c.env.GetUnitSpeed = function() return t.speed or 0, 7, 7, 4.72 end
    c.env.C_MountJournal = {
      GetNumMounts = function() return 2 end,
      GetMountIDs = function() return { 6, 9 } end,
      GetMountInfoByID = function(id)
        local name = id == 6 and "Brown Horse" or "Pinto"
        return name, id * 100, 132261, false, true, 0, false, false, nil, false, true, id
      end,
    }
    return c, t
  end
  local function travel(c) return c.env.ForeverLedgerProbeDB.travel.snapshots[61582] end

  H.test("probe travel: records taxi nodes, bind, hearth, mount, speed and APIs", function()
    local c, t = travelClient()
    c.slash("FOREVERLEDGERPROBE", "travel")
    local s = travel(c)
    H.ok(s, "travel for the build")
    H.eq(s.probeVersion, "0.6.0")
    H.eq(s.apis["C_TaxiMap.GetAllTaxiNodes"], "function")
    H.eq(s.apis.TakeTaxiNode, "function")
    H.eq(s.apis.GetItemCooldown, "nil")
    H.eq(s.apis["C_MountJournal.GetMountIDs"], "function")
    H.eq(s.taxi[1415].all.count, 2)
    local n = s.taxi[1415].all.nodes[2]
    H.eq(n.name, "Sentinel Hill, Westfall")
    H.eq(n.nodeID, 4)
    H.eq(n.position[1], 0.38, "positions read through the vector")
    H.eq(n.position[2], 0.72)
    H.eq(s.taxi[1415].forMap.nodes[1].faction, 2)
    H.eq(s.taxi[1414].all.count, 0)
    H.ok(s.taxi[1429], "the current map is asked too")
    H.eq(#t.taken, 0, "never takes a flight")
    H.eq(s.bind.values[1], "Goldshire")
    H.eq(s.hearth.count["C_Item.GetItemCount"].values[1], 1)
    H.eq(s.hearth.count.GetItemCount.missing, true)
    H.eq(s.hearth.cooldown["C_Container.GetItemCooldown"].values[2], 1800)
    H.eq(s.hearth.cooldown["C_Spell.GetSpellCooldown"].values[1].duration, 1800)
    H.eq(s.hearth.cooldown.GetSpellCooldown.missing, true)
    H.eq(s.state.IsMounted.values[1], false)
    H.eq(s.state.GetUnitSpeed.values[2], 7, "run speed")
    H.eq(s.state.GetUnitSpeed.values[4], 4.72, "swim speed")
    H.eq(s.state.UnitOnTaxi.values[1], false)
    H.eq(s.mounts.num.values[1], 2)
    H.eq(s.mounts.ids, 2)
    H.eq(s.mounts.list[1].values[1], "Brown Horse")
    H.eq(s.mounts.list[2].values[12], 9)
    H.eq(s.here.mapID, 1429)
    H.eq(s.here.zone, "Elwynn Forest")
    H.ok(printedHas(c, "map catalog 3"), "summary line")
    H.eq(s.taxiOpen, false)
    H.ok(printedHas(c, "taxi map closed: run /flprobe travel again"), "hint when the taxi map is closed")
    H.eq(c.env.ForeverLedgerProbeDB.travel[61582], nil, "snapshots live under travel.snapshots")
    t.open = true
    local before = #c.world.printed
    c.slash("FOREVERLEDGERPROBE", "travel")
    H.eq(travel(c).taxiOpen, true)
    for i = before + 1, #c.world.printed do
      H.eq(c.world.printed[i]:find("taxi map closed", 1, true), nil, "no hint with the map open")
    end
  end)

  H.test("probe travel: the map catalog is compact rows with size and world corners", function()
    local c = travelClient()
    c.slash("FOREVERLEDGERPROBE", "travel")
    local m = travel(c).maps
    H.eq(m.count, 3)
    H.eq(m.scanned, 3000)
    H.eq(m.maxId, 1429)
    H.eq(m.vector, "CreateVector2D")
    H.eq(table.concat(m.fields, ","), "id,name,mapType,parentMapID,width,height,c0,x0,y0,c1,x1,y1")
    local byId = {}
    for _, row in ipairs(m.rows) do byId[row[1]] = row end
    local k = byId[1414]
    H.eq(k[2], "Kalimdor")
    H.eq(k[3], 2)
    H.eq(k[4], 947)
    H.eq(k[5], 36800)
    H.eq(k[6], 24533)
    H.eq(k[7], 1, "continent of the top-left corner")
    H.eq(k[8], 1000)
    H.eq(k[9], 500)
    H.eq(k[11], 1000 - 24533)
    H.eq(k[12], 500 - 36800)
    H.eq(byId[1429][4], 1415)
    H.eq(byId[1429][7], 0)
  end)

  H.test("probe travel: a throwing GetWorldPosFromMapPos leaves false corners", function()
    local c = travelClient()
    c.env.C_Map.GetWorldPosFromMapPos = function() error("bad vector") end
    c.slash("FOREVERLEDGERPROBE", "travel")
    local m = travel(c).maps
    H.eq(m.count, 3)
    local k = m.rows[1]
    H.eq(k[1], 1414)
    H.eq(k[5], 36800, "size still read")
    for i = 7, 12 do H.eq(k[i], false, "corner field " .. i) end
    H.eq(#k, 12)
  end)

  H.test("probe travel: a bare client records gaps and doesn't throw", function()
    local c = freshProbe({})
    c.slash("FOREVERLEDGERPROBE", "travel")
    local s = travel(c)
    H.ok(s, "entry written")
    H.eq(s.apis["C_TaxiMap.GetAllTaxiNodes"], "nil")
    H.eq(s.taxi[1414].all.missing, true)
    H.eq(s.bind.missing, true)
    H.eq(s.hearth.cooldown["C_Container.GetItemCooldown"].missing, true)
    H.eq(s.state.IsMounted.missing, true)
    H.eq(s.mounts.num.missing, true)
    H.eq(s.maps.missing, true)
    H.eq(s.maps.count, 0)
    H.ok(printedHas(c, "map catalog 0"), "summary still printed")
    c.slash("FOREVERLEDGERPROBE", "trip on")
    c.fire("ZONE_CHANGED")
    local trip = c.env.ForeverLedgerProbeDB.travel.trips[61582][1]
    H.eq(trip.hook, "missing")
    H.eq(trip.timer, "OnUpdate", "no C_Timer: an OnUpdate throttle")
    H.eq(#trip.events, 1)
    H.eq(#trip.samples, 1)
    H.eq(trip.samples[1].mapID, 1429)
    H.eq(trip.samples[1].onTaxi, nil, "a missing getter leaves the field out")
    local updater
    for _, f in ipairs(c.frames) do updater = updater or f.scripts.OnUpdate end
    H.ok(updater, "OnUpdate set")
    updater(nil, 1.5)
    updater(nil, 0.6)
    H.eq(#trip.samples, 2, "a sample once 2 s have passed")
    c.slash("FOREVERLEDGERPROBE", "trip off")
    H.ok(printedHas(c, "trip: 2 sample(s)"), "summary on off")
    for _, f in ipairs(c.frames) do H.eq(f.scripts.OnUpdate, nil, "off clears the throttle") end
  end)

  H.test("probe trip: records taxi windows, takeoffs, events and a sample every 2 s", function()
    local c, t = travelClient({ professionAPI = true, rejectEvents = { LOADING_SCREEN_ENABLED = true } })
    c.slash("FOREVERLEDGERPROBE", "trip on")
    local trip = c.env.ForeverLedgerProbeDB.travel.trips[61582][1]
    H.eq(trip.registered.TAXIMAP_OPENED, true)
    H.eq(trip.registered.LOADING_SCREEN_ENABLED, false, "a failed registration is recorded")
    H.eq(trip.hook, "TakeTaxiNode")
    H.eq(trip.timer, "C_Timer")
    H.eq(#trip.samples, 1, "a sample right away")
    t.open = true
    c.fire("TAXIMAP_OPENED", 1)
    local opened = trip.events[1]
    H.eq(opened.event, "TAXIMAP_OPENED")
    H.eq(opened.taxi.numNodes, 2)
    H.eq(opened.taxi.mapID, 1415)
    H.eq(opened.taxi.nodes[1].name, "Stormwind, Elwynn")
    H.eq(opened.taxi.nodes[1].type, "CURRENT")
    H.eq(opened.taxi.nodes[2].x, 0.38)
    H.eq(opened.taxi.all.count, 2)
    H.eq(opened.here.mapID, 1429)
    -- the player clicks a destination: the client's TakeTaxiNode runs, the post-hook only records
    c.env.TakeTaxiNode(2)
    H.eq(table.concat(t.taken, ","), "2", "the original ran once, the probe called nothing")
    local take = trip.events[2]
    H.eq(take.event, "TakeTaxiNode")
    H.eq(take.node, 2)
    H.eq(take.destination, "Sentinel Hill, Westfall")
    H.eq(take.from, "Stormwind, Elwynn")
    H.eq(take.x, 0.38)
    t.open, t.onTaxi, t.speed = false, true, 31.5
    c.fire("PLAYER_CONTROL_LOST")
    for _ = 1, 10 do c.advance(1) end
    t.onTaxi, t.speed = false, 0
    c.fire("PLAYER_CONTROL_GAINED")
    c.fire("ZONE_CHANGED_NEW_AREA")
    H.eq(#trip.samples, 6, "one at start + one every 2 s")
    H.eq(trip.samples[2].onTaxi, true)
    H.eq(trip.samples[2].speed, 31.5)
    H.eq(trip.samples[2].mapID, 1429)
    H.eq(trip.samples[2].x, 0.421)
    H.eq(trip.samples[2].mounted, false)
    H.eq(trip.samples[2].indoors, false)
    local names = {}
    for i, e in ipairs(trip.events) do names[i] = e.event end
    H.eq(table.concat(names, ","),
      "TAXIMAP_OPENED,TakeTaxiNode,PLAYER_CONTROL_LOST,PLAYER_CONTROL_GAINED,ZONE_CHANGED_NEW_AREA")
    c.slash("FOREVERLEDGERPROBE", "trip off")
    H.eq(trip.stoppedAt, c.world.clock)
    H.ok(printedHas(c, "trip: 6 sample(s)"), "summary on off")
    -- off stops everything: events, samples and the hook
    c.fire("ZONE_CHANGED")
    c.advance(10)
    c.env.TakeTaxiNode(1)
    H.eq(#trip.samples, 6)
    H.eq(#trip.events, 5)
    H.eq(table.concat(t.taken, ","), "2,1")
    -- on again: a new trip, the hook isn't stacked twice
    c.slash("FOREVERLEDGERPROBE", "trip on")
    c.env.TakeTaxiNode(2)
    local trips = c.env.ForeverLedgerProbeDB.travel.trips[61582]
    H.eq(#trips, 2)
    H.eq(#trips[2].events, 1)
    H.eq(#trips[2].samples, 1, "the old timer chain is dead")
    c.advance(2)
    H.eq(#trips[2].samples, 2)
  end)

  H.test("probe trip: off after /reload, samples capped, reset wipes travel", function()
    local c = travelClient()
    c.slash("FOREVERLEDGERPROBE", "trip on")
    for _ = 1, 950 do c.advance(2) end
    local pdb = c.env.ForeverLedgerProbeDB
    local full = pdb.travel.trips[61582][1]
    H.eq(#full.samples, 900)
    H.eq(full.lastSampleAt, full.startedAt + 899 * 2)
    H.eq(#c.world.timers, 0, "the sampler stops rescheduling at the cap")
    local back = freshProbe({ professionAPI = true }, pdb)
    back.fire("ZONE_CHANGED")
    H.eq(#pdb.travel.trips[61582][1].events, 0, "not recording after a reload")
    back.slash("FOREVERLEDGERPROBE", "travel")
    back.slash("FOREVERLEDGERPROBE", "status")
    H.ok(printedHas(back, "/flprobe travel"), "help mentions travel")
    H.ok(printedHas(back, "/flprobe trip on|off"), "help mentions trip")
    back.slash("FOREVERLEDGERPROBE", "reset confirm")
    H.eq(H.count(pdb.travel), 0)
  end)

  H.test("probe trip: keeps the last 6 trips and the full taxi window for the first 5 openings", function()
    local c, t = travelClient()
    t.open = true
    for i = 1, 8 do
      c.slash("FOREVERLEDGERPROBE", "trip on")
      if i == 8 then
        for _ = 1, 7 do c.fire("TAXIMAP_OPENED", 1) end
      end
      c.advance(1)
      c.slash("FOREVERLEDGERPROBE", "trip off")
    end
    local trips = c.env.ForeverLedgerProbeDB.travel.trips[61582]
    H.eq(#trips, 6, "the oldest trips are dropped")
    H.eq(trips[1].startedAt, c.world.clock - 6, "trip 3 is now the oldest")
    local last = trips[6]
    H.eq(last.taxiWindows, 7)
    H.eq(#last.events, 7)
    H.ok(last.events[5].taxi, "fifth window captured")
    H.eq(last.events[6].taxi, nil, "sixth window: event only")
    H.eq(last.events[7].here.mapID, 1429)
  end)

  H.writeFile(FIXTURES .. "probe-dump.lua", H.serialize("ForeverLedgerProbeDB", db))
end
