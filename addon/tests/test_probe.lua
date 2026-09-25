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
    H.eq(pdb.loadCheck.probeVersion, "0.3.0")
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
    H.eq(specs.probeVersion, "0.3.0")
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

  H.writeFile(FIXTURES .. "probe-dump.lua", H.serialize("ForeverLedgerProbeDB", db))
end
