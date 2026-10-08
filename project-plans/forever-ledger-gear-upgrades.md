# 🛡️ Forever Ledger — Character gear and upgrades (schema 8 / addon 0.5.0)

> Owner: John-Willikers <harlanbmiltonjr@gmail.com> · 2026-10-07 04:35 CDT (America/Chicago)
> Branch `feat/gear-upgrades` → PR → merge to `master`.

## 🧭 Why

In Discord: "@Forever Ledger pull up Sam Willikers and tell me where his gear upgrades are." The bot had no character
tools and the ledger has never recorded gear, so it couldn't. Goal: look up any character the ledger knows, see what
they wear, and list better items they can get, each with where to get it and how sure we are.

## ✅ Decisions (Harlan, 2026-10-07)

1. **Anyone in the Discord server** may look up any character the ledger knows (same as Claude Code).
2. **Ship gear now:** addon 0.5.0 (SavedVariables schema 8) records equipped gear; tray v0.2.1 accepts schema 8.
3. **Role:** the asker can name it ("Sam as a tank"); without one it is guessed from the stats on what the character
   wears, and the answer says it was guessed.

## 🏗️ Shape

- **Addon 0.5.0 (schema 8):** `db.gear[charKey] = { build, at, slots = { [slotID] = { itemID, link, stats } } }`: what
  the character wears now (inventory slots 1–19; the link keeps enchant and random suffix, `stats` comes from
  `GetItemStats(link)` so "of the Bear" counts). Read at login and after `PLAYER_EQUIPMENT_CHANGED` (debounced 2 s),
  and each worn item is scanned into `db.items` like any other item. Additive: older data is valid as is.
- **Contracts:** `SCHEMA_VERSION = 8`, `CharacterGear` record, normalize, keys, caps.
- **Server (migration 0019):** `character_gear` keyed (character key, build, slot): item id, link, stats, seen at; the
  newest build's rows are "now". Ingest upsert; old builds are never overwritten.
- **Upgrade finder (`knowledge/upgrades.ts`):** for each slot, the equipped item's score against every item the ledger
  has stats for that fits the slot, that the class can wear at its level (`canEquip`) and whose required level is at
  most the character's level (plus "soon": up to 3 levels above). Score = the item's stats weighted for the role
  (`ROLE_WEIGHTS` in contracts' class rules, an **estimate**: Forever has no spec data) + armor. Each candidate carries
  its first-party sources (drops per kill, quest rewards, vendors, containers) and its claims (where Wowhead says it
  drops), so the answer can say how to get it and whether that is Forever data or Classic.
- **MCP tools:** `lookup_character` (class, race, level, professions, gear) and `gear_upgrades(character, role?)`.
  The bot's system prompt learns that players ask about their characters by full name.
- **Release:** tray v0.2.1 first (accepts schema 8), then `addon-v0.5.0` and `addon-cli publish 0.5.0`; the manifest's
  schema gate keeps addon 0.5.0 away from trays that can't upload it.

## ✅ Progress checks

Legend: ⬜ todo · 🟡 in progress · ✅ done · ⛔ blocked. Times America/Chicago.

- ✅ 0 📝 Plan and decisions — 04:35 CDT; PR #60 (bot logs cache writes and USD per answer) merged and deployed
- ✅ 1 🧩 Addon 0.5.0: gear capture (login + `PLAYER_EQUIPMENT_CHANGED`, 2 s settle, re-read while stats are missing,
  stale short-key read dropped when the surname arrives), `test_gear.lua`, `session-v8.lua`, 0.4.0 frozen in
  `tests/legacy/` (session-v7 byte-identical); 230 Lua tests
- ✅ 2 📐 Contracts schema 8 (`CharacterGear`, keys, normalize) + gear scores (`gearScore`, `guessRole`, slot maps)
  + uploader
- ✅ 3 🗄️ Server: migration 0019 `character_gear` (only a newer read replaces), ingest, character merge, export;
  `lookupCharacter` / `gearUpgrades` (5 tests on real Postgres); read-only on production: Sam Willikers (Druid 30,
  no gear yet) gets the best known item per slot with sources in ~150 ms
- ✅ 4 🔌 MCP tools `lookup_character`, `gear_upgrades`; bot prompt knows players ask by full name; `pnpm check`
  1082 tests — 04:41 CDT
- ✅ 5 🔍 Review (0 Critical) → fixed: no off-hand suggestions over a worn two-hander (a one-hander replaces it in
  the main hand); Classic dual wield (rogues, warriors and hunters from 20, never shamans); a surname arriving late
  re-reads gear under the new key; shirts and tabards don't trigger retries and a new change ends an old retry chain;
  one bad slot is dropped, not the whole record; an exact first name wins → PR #61 merged; backup
  `forever_ledger-2026-10-07-0450-pre0019.sql.gz` (47 COPY); migration 0019 applied; API, MCP and bot restarted
- 🟡 6 🚀 (04:57 CDT) Tray v0.2.1 is GitHub latest; addon 0.5.0 published (schema 8); manifest gate checked (schema 7
  trays get 0.4.0, schema 8 get 0.5.0). Waiting on: Sam's gear uploading after his next login, then "@Forever Ledger
  Sam Willikers' gear upgrades" in Discord

## 🔧 After the first Discord answer (Harlan, 2026-10-07 05:05 CDT)

- 🟡 7 🏷️ NPC names: answers said "NPC #4275" because the addon records only a looted NPC's id. A resolver now
  names NPCs from every source the ledger has (NPC page names, other pages' "dropped by" / vendor lists, our vendors,
  trainers and quest givers); the 449 looted NPCs' Wowhead pages moved to priority 35 (ahead of quests) so names fill
  in within about a day of fetching. Only 3 of 450 were nameable before.
- 🟡 8 📝 Discord layout: no tables (Discord shows raw pipes); a bold one-line answer, `###` groups, two lines per
  entry (`**Slot** — Item`, then a `-#` source line), caveats as `-#` lines at the end.

- 🟡 9 🧵 Crafted gear (Harlan, 2026-10-07): Sam Willikers' upgrades were full of Tailoring and Leatherworking items
  he can't make. An upgrade is crafted when a recipe our players scanned makes it, or Wowhead's `created_by_spell`
  names it (the spell's profession from our `recipes`, else the row's `skills`; parser `wowhead@4` stops dropping
  Wowhead's `skill: [197]` array). Crafted items stay only when the character has the profession (`crafted`:
  professions, `byCharacter`, `knowsRecipe`); the rest are counted in a gap by profession, and `includeCrafted`
  (MCP `gear_upgrades`) lists them. Deploy: `knowledge-cli reparse --site wowhead.com --replace` so existing item
  pages get the profession. No real spec: Forever's spec catalog is still a placeholder (one spec per class), so the
  role stays asked-or-guessed.

- 🟡 10 🗺️ Leveling routes (Harlan, 2026-10-07 21:10 CDT): "quickest way to 13 as an undead" got "no quest data" three
  times although Tirisfal was quested to 13. The data was there (turn-ins with level, XP and time; quest-log zone
  header in `quests.category`; givers in `quest_observations`), but no tool could reach it: `search` matches titles,
  `lookup_zone` listed only nodes. New `knowledge/leveling.ts` + MCP `leveling_route(start: race|zone, character?,
  toLevel, fromLevel?)`: our characters of that race (or who quested in that zone), the one that reached the level in
  the least play time first, its turn-ins in order (zone, quest/character level, XP, giver, turn-in NPC), level-ups,
  others' progress, and the zone's quests. `lookup_zone` gains `questsSeen`. Play time is an estimate: only quest
  events are timed, pauses over an hour between them are dropped.
  21:30 CDT: the bot (still the old build) found only "Scavenging Deathknell", by title search, although Timmy
  Willikers quested to ~12. The route is now a **guide** (Zygor-style): steps in played order, `accept` (NPC,
  subzone, coordinates, quests), `complete` (objectives, "0/8" → "8") and `turn_in` (NPC, coordinates, XP, level
  after); same-NPC steps merge; abandoned quests are dropped. `forCharacter` starts at the asker's level and skips
  quests they've turned in. Objective locations aren't recorded (addon follow-up).
  21:40 CDT, checked on production (read-only) before merge: the undead with quest data is **Timbo** (Scourge
  Warlock 13, 63 turn-ins to level 12, 6.6 h of play); "Timmy" is a Human Rogue, no aliases involved. Fixed on real
  data: pickups had no giver (Forever's `accept` event carries no NPC; the `detail` window before it does: now 46/46
  pickups named with coordinates), Forever's objective form "0/8 Mindless Zombie slain" (count first), class quests'
  "complete" steps placed in "Warlock" (now the turn-in's zone), and the start zone's own header (Deathknell, 12
  quests) added to each race's zones. Crafted filter on Sam: 32 Tailoring / Leatherworking / Engineering upgrades
  left out, professions named once (Forever has two skill lines per profession).

## ⚠️ Risks

- **Estimates, not truth:** stat weights per role are a Classic-era rule of thumb; answers label them as estimates.
- **Only items the ledger has seen:** an upgrade nobody has looted, been offered or seen at a vendor isn't listed
  (Wowhead claims name sources but carry no stats). The answer says so.
- **Time:** gear only exists after each friend's tray updates and they log in once before the servers go down (~Oct 20).
