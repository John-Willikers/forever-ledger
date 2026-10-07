# 🎣 Forever Ledger 0.4.0 — per-cast fishing log + full-name identity (schema 7)

> Owner: John-Willikers <harlanbmiltonjr@gmail.com> · 2026-10-06 23:26 CDT · Branches per step → PR → merge to master.
> Release: addon **0.4.0**, schema **7**, tray **v0.1.6**. Replaces `forever-ledger-character-identity.md` tasks 6–8 and
> `forever-knowledge-pipeline.md` phase 3.

## 🧭 Context

- **Fishing data can't be searched by zone.** The addon counts fishing per play session (`nodes` object 0). A session
  of 283 catches across Tanaris and the Hinterlands (build 70235, 0 Big-mouth Clams) can't say how many catches came
  from each zone, with which lure, or from a pool.
- **Short names lose identity.** Build 70009 started returning first names only from `UnitName`. Forever runs a single
  server, so there can be many "Sam"s, and the full name (first + surname) is the character's identity (Harlan,
  2026-10-07). "Nyx Ashford" is a character's full name; the addon only ever saw "Nyx".
- **Deadline.** The beta stays at level cap 30 until about Oct 20, then the servers go down until launch on Nov 4.
  0.4.0 has to reach players' trays well before Oct 20 to collect any per-cast data.

## ✅ Progress checks

Legend: ⬜ todo · 🟡 in progress · ✅ done · ⛔ blocked · 🔒 gate (needs Harlan in game). Times America/Chicago.

- ✅ 0 📝 Decisions (2026-10-07): full names are the identity; ship 0.4.0 + tray; Nyx Ashford is a full name
- ✅ 1 🔬 Probe 0.4.0 (`/flprobe names`, `/flprobe fish on|off`) — written and tested 2026-10-06 23:26 CDT
  - ✅ 1a Harlan ran it on build 70245 (names with a target, 11 casts, 5 with a lure) — 2026-10-07
  - ✅ 1b Answers in CLAUDE.md: `UnitName` returns the surname as its 2nd value (`GetUnitName`,
    `C_PlayerInfo.GetName`, `GetPlayerInfoByGUID` give "Sam Willikers"); fishing is spell 7732; lure = enchant 265
    (+75 modifier); loot source is always the bobber (35591), so no pool field — 2026-10-07 00:36 CDT
- ✅ 2 🧩 Addon 0.4.0 (schema 7) — 2026-10-07 00:36 CDT
  - ✅ 2a Full name: `charKey` = first + surname (when `ShouldDisplaySurname`), the record keeps `firstName` and `guid`
  - ✅ 2b `db.fishingCasts`: one record per cast `{build, char, time, mapID, zone, subzone, x, y, skill, skillMax,
    modifier, lure, outcome, loot, money}`. It opens on the cast and closes on loot, on its own channel stopping
    (matched by CastBar id: on a recast the old STOP comes after the new SENT), or after 35 s, so casts that got away
    are counted too. No `pool` field: 1b showed the loot always comes from the bobber.
  - ✅ 2c Lua harness 222 passed (+8: `test_fishing.lua`, the 0.3.4 → 7 migration, the `session-v7.lua` fixture);
    0.3.4 frozen in `tests/legacy/` still writes `session-v6.lua` byte-identical
- ✅ 3 📐 Contracts: schema 7, `FishingCast`, `Character.firstName` / `guid`, normalize, keys
- 🟡 4 🗄️ Server (migration 0015)
  - ✅ 4a Migration: `fishing_casts` (keyed on uploader, account, char, cast time, seq) and the ingest upsert
  - ✅ 4b Identity: `character_aliases`; the canonical key is the full name (`Sam Willikers-Classic Beta PvE`).
    Ingest maps short keys to it by GUID or by full name; `characters-cli suggest|merge` handles the old rows
    (Sam, Jon, Vic)
  - ✅ 4c 🔎 Searchable fishing: `GET /v1/fishing/casts` and `/v1/fishing/yield`
    (`?zone=&subzone=&build=&char=&lure=&minSkill=`; `/where?item=`), and an admin **Fishing** page: yield per zone and subzone,
    catch table, rare catches, and a search by item ("where did Big-mouth Clams come from?")
  - ⬜ 4d (after release) Knowledge: per-zone fishing yields become tier 1 claims automatically, for the MCP server
- 🟡 5 🔍 Code review (2 Critical, 6 Important): all fixed 00:47 CDT — recasts matched by CastBar id; GUID merges
  never go from a full name to a short key, never cross accounts, refuse an alias as target, take the run lock;
  aliases are per account; the player's surname doesn't depend on the display setting; `db.chars` follows a new key;
  group loot tells same-first-name party members apart; a bad GUID or off-map spot drops the field, not the record
  - ⬜ PR → merge → deploy → merge the old short keys in prod → 🚀 Release: PRs merged with CI green → tag `addon-v0.4.0` → `addon-cli publish 0.4.0` → tray v0.1.6 → friends
  update their trays. Target: **before Oct 15**

## ⚠️ Risks

- **Surname source.** If no API or frame gives the surname, the identity falls back to GUID plus a manual
  `characters-cli merge`, and full names are entered by hand. The probe answers this first.
- **Time.** The addon, tray and server changes all have to land in about a week. The fishing log and the full name are
  independent, so either can ship without the other.
- **Old trays** stay on 0.3.4 because of the manifest's schema gate. Their data keeps flowing; it just has no per-cast
  fishing records.
