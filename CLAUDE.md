# Forever Ledger — conventions

Passive data collector for World of Warcraft: Forever. Addon → SavedVariables → uploader → ingest API → Postgres.
Plan and live progress: `project-plans/forever-ledger-m0-m5.md`.

## Hard rules

- **Never execute Lua.** SavedVariables are parsed as an AST by `packages/lua-sv-parser`; anything that is not a
  table/literal is rejected.
- The addon and uploader are **read-only observers**: no memory reading, no input automation, no gameplay automation.
- `packages/contracts` is the single source of truth for record shapes. Uploader and server both validate with it.
- Any change to the SavedVariables shape bumps `db.meta.schemaVersion` in the addon **and** `SCHEMA_VERSION` in
  contracts. The server rejects unknown schema majors.
- Every observation carries the client **build** it came from. Never overwrite data from another build.
- Server writes are idempotent (`INSERT … ON CONFLICT DO UPDATE` by natural key). The uploader acks `key → hash`.

## Workflow

- Public repo `John-Willikers/forever-ledger`. Work on a branch → PR → merge to `master` (alpha direct commits ended
  2026-09-23).
- Git identity (personal project): `John-Willikers <harlanbmiltonjr@gmail.com>`.
- Times shown to humans (logs, CSV, API text) are America/Chicago. Stored as `timestamptz` / epoch seconds.
- `pnpm check` must pass before commit (eslint + prettier + luacheck + typecheck + Lua harness + vitest).

## Layout

- `addon/ForeverLedger` — the addon; `addon/ForeverLedgerProbe` — client API/event probe; `addon/tests` — Lua 5.1
  harness with WoW stubs (generates `fixtures/synthetic`).
- `packages/lua-sv-parser`, `packages/contracts`, `apps/uploader`, `apps/server`, `apps/desktop` (Electron tray app; imports
  `@forever-ledger/uploader/lib`, never the bare package), `deploy/`.
- Addon releases: tag `addon-vX` → GitHub release created with `--latest=false` (app releases `vX` own "latest", which
  electron-updater reads) → `addon-cli publish X` on the VPS is what makes a version live. A published version's zip
  can never change; release a new version instead.
- Workspace packages export `src/*.ts` under the `development` condition and `dist/` otherwise; build with `pnpm build`.

## Deploy (this VPS)

- Postgres: `deploy/docker-compose.yml` on `127.0.0.1:5440`.
- API: PM2 app `forever-ledger-api` on `127.0.0.1:3410`, Nginx site `ledger.willikers.dev` (certbot TLS).

## Open questions about the Forever client

Tracked in the project plan; answer them from `ForeverLedgerProbe` dumps and record the answers here.
Full dump: `fixtures/real/api-69913.json` (probe 0.1.0, 2026-09-23 00:41 CDT, enUS).

| Question                  | Answer (build 69913)                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client build / interface  | `GetBuildInfo()` = `1.60.1`, `69913`, `Sep 17 2026`, **16001**. Both `.toc` files use `## Interface: 16001`.                                                                                                                                                                                                                                                                                   |
| API docs (`/api`)         | Available: 408 systems, 1802 events, 5958 global functions, 269 `C_` namespaces. Modern (retail-style) API surface.                                                                                                                                                                                                                                                                            |
| Quest log API             | **No** `GetQuestLogTitle`, `GetNumQuestLogEntries`, `SelectQuestLogEntry`, `GetQuestLogSelection`, `GetQuestTagInfo`. Use `C_QuestLog.GetInfo(i)` (table), `Get/SetSelectedQuest`.                                                                                                                                                                                                             |
| Item API                  | **No** global `GetItemInfo` / `GetItemStats`; `C_Item.GetItemInfo` / `C_Item.GetItemStats` exist (same return order).                                                                                                                                                                                                                                                                          |
| `QUEST_ACCEPTED` payload  | `(questID)` only — not Classic's `(logIndex, questID)`.                                                                                                                                                                                                                                                                                                                                        |
| `QUEST_TURNED_IN` payload | `(questID, xpReward, moneyReward)`.                                                                                                                                                                                                                                                                                                                                                            |
| Encounter / loot events   | `ENCOUNTER_END(encounterID, name, difficultyID, groupSize, success, encounterUnitStatus)`, `BOSS_KILL`, `LOOT_OPENED(autoLoot, isFromItem)`, `GetLootSourceInfo` all present.                                                                                                                                                                                                                  |
| Combat log                | `CombatLogGetCurrentEventInfo` is **nil** and `C_CombatLog.IsCombatLogRestricted` exists: don't plan on CLEU.                                                                                                                                                                                                                                                                                  |
| All 37 candidate events   | Register fine. `LoadAddOn` is nil (use `C_AddOns.LoadAddOn`).                                                                                                                                                                                                                                                                                                                                  |
| Container loot            | `LOOT_OPENED`'s `isFromItem` is **false** when opening a Small Chest (build 69977, 2026-09-24), but `GetLootSourceInfo` returns the container's `Item-…` GUID and `C_Item.GetItemIDByGUID` resolves it: never rely on `isFromItem` alone.                                                                                                                                                      |
| Level cap                 | **20** on the beta (owner, 2026-09-24): max-level characters earn 0 XP, so a run's `xp_total` 0 is expected there.                                                                                                                                                                                                                                                                             |
| Event arg order (sniffed) | Not sniffed yet — the payloads above come from the API docs. Confirm with `/flprobe sniff on` during real play.                                                                                                                                                                                                                                                                                |
| Item spec info populated? | **No** (build 70009, probe 0.3.0, 2026-09-25): `C_Item.GetItemSpecInfo` is nil (42 items) or `{}` (4) for every bag/equipped item; `C_Item.DoesItemContainSpec` is **true for all 9 classes on every equippable item** (a mail chest included); `IsItemSpecificToPlayerClass` always false. Spec fit must be estimated (`itemFit` in contracts). Dump: `fixtures/real/probe-70009-specs.json`. |
| Spec catalog per class    | Placeholder only (build 70009): each of the 9 Classic classes (ids 1,2,3,4,5,7,8,9,11) has **one** spec named after the class (ids 1482–1491), role `DAMAGER`, `primaryStat` 4 for all. No role or primary-stat signal; do not build on it.                                                                                                                                                    |
