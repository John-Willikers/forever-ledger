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
- 🟡 5 🔍 Review (0 Critical) → fixed: no off-hand suggestions over a worn two-hander (a one-hander replaces it in
  the main hand); Classic dual wield (rogues, warriors and hunters from 20, never shamans); a surname arriving late
  re-reads gear under the new key; shirts and tabards don't trigger retries and a new change ends an old retry chain;
  one bad slot is dropped, not the whole record; an exact first name wins → PR #61
- ⬜ 6 🚀 Tray v0.2.1, then addon 0.5.0 published; Sam's gear uploads after the next login; "@Forever Ledger Sam
  Willikers' gear upgrades" answered in Discord

## ⚠️ Risks

- **Estimates, not truth:** stat weights per role are a Classic-era rule of thumb; answers label them as estimates.
- **Only items the ledger has seen:** an upgrade nobody has looted, been offered or seen at a vendor isn't listed
  (Wowhead claims name sources but carry no stats). The answer says so.
- **Time:** gear only exists after each friend's tray updates and they log in once before the servers go down (~Oct 20).
