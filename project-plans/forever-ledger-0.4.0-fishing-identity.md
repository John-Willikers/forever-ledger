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
- 🟡 1 🔬 Probe 0.4.0 (`/flprobe names`, `/flprobe fish on|off`) — written and tested 23:26 CDT
  - 🔒 1a In game on build 70235+: `/flprobe names` (also with another player targeted), `/flprobe fish on`, ~10
    casts with and without a lure, one into a pool, `/flprobe fish off`, `/reload`, send `ForeverLedgerProbe.lua`
  - ⬜ 1b Answers recorded in the CLAUDE.md table: where the surname comes from, `GetWeaponEnchantInfo` with a lure, the
    fishing channel events, the loot source GUID, whether a pool can be told apart
- ⬜ 2 🧩 Addon 0.4.0 (schema 7)
  - ⬜ 2a Full name: the character record carries `fullName` (from the surname source in 1b) and `guid`
  - ⬜ 2b `db.fishingCasts`: one record per cast `{build, char, time, mapID, zone, subzone, x, y, skill, skillMax,
    modifier, lure, pool, outcome, loot, money}`. It opens on the cast and closes on loot, on the channel stopping, or
    after 25 s, so casts that got away are counted too. `pool` is nil (unknown) unless 1b proves we can tell.
  - ⬜ 2c Lua harness tests, 0.3.4 frozen in `tests/legacy/`, the `session-v7.lua` fixture, the 6 → 7 migration
- ⬜ 3 📐 Contracts: schema 7, `FishingCast`, `Character.fullName` / `guid`, normalize, keys, int4 caps
- ⬜ 4 🗄️ Server
  - ⬜ 4a Migration: `fishing_casts` (keyed on uploader, account, char, cast time, seq) and the ingest upsert
  - ⬜ 4b Identity: `character_aliases`; the canonical key is the full name (`Sam Willikers-Classic Beta PvE`).
    Ingest maps short keys to it by GUID or by full name; `characters-cli suggest|merge` handles the old rows
    (Sam, Jon, Vic)
  - ⬜ 4c 🔎 Searchable fishing: `GET /v1/fishing/casts` and `/v1/fishing/yield`
    (`?zone=&subzone=&item=&build=&lure=&pool=&minSkill=`), and an admin **Fishing** page: yield per zone and subzone,
    catch table, rare catches, and a search by item ("where did Big-mouth Clams come from?")
  - ⬜ 4d Knowledge: per-zone fishing yields become tier 1 claims automatically, for the MCP server
- ⬜ 5 🚀 Release: PRs merged with CI green → tag `addon-v0.4.0` → `addon-cli publish 0.4.0` → tray v0.1.6 → friends
  update their trays. Target: **before Oct 15**

## ⚠️ Risks

- **Surname source.** If no API or frame gives the surname, the identity falls back to GUID plus a manual
  `characters-cli merge`, and full names are entered by hand. The probe answers this first.
- **Time.** The addon, tray and server changes all have to land in about a week. The fishing log and the full name are
  independent, so either can ship without the other.
- **Old trays** stay on 0.3.4 because of the manifest's schema gate. Their data keeps flowing; it just has no per-cast
  fishing records.
