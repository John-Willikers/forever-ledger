# 🗺️ Forever Ledger — Implementation Plan (M0 → M5)

> Owner: John-Willikers <harlanbmiltonjr@gmail.com> · Created 2026-09-23 (America/Chicago)
> On approval, first action: copy this file to `/home/ubuntu/wow-addon/project-plans/forever-ledger-m0-m5.md` and keep its progress checks updated live.

## 📌 Context

The pasted architecture doc defines Forever Ledger: a passive WoW: Forever addon → SavedVariables → Node uploader (gaming PC) → Fastify ingest API → Postgres, so quest XP, rewards, items-by-build, drops and dungeon runs can be analyzed. `/home/ubuntu/wow-addon` holds only the v0.1.0 addon (`addon/ForeverLedger/ForeverLedger.lua`, 334 lines, `.toc` Interface 11507). No git repo, no packages yet. This plan builds M0–M5 per the doc, with these **decisions from the user**:

- 🖥️ **Deploy on this VPS**: Postgres in docker-compose (bound to `127.0.0.1:5440`), Fastify under **PM2** on `127.0.0.1:3410`, **Nginx** site `ledger.willikers.dev` + certbot TLS. (Replaces the doc's Tailscale/Caddy option.)
- 🌿 **Alpha: work directly on `master`**, local git only. No GitHub repo / branch / PR until launch.
- 🔐 Git identity (personal project): `John-Willikers <harlanbmiltonjr@gmail.com>`, set in repo-local config; same in `package.json` author fields.
- 🕰️ Timestamps: store `timestamptz` (epoch from addon), but server `TZ=America/Chicago`, Postgres session `timezone=America/Chicago`, pino timestamps and CSV exports rendered in America/Chicago.

## 🔍 Findings in addon v0.1.0 that drive the schema v1 changes

| Area | v0.1.0 today | Problem | v1 change |
|---|---|---|---|
| Build | `db.meta.build = { GetBuildInfo() }` once | not per record | `build = tonumber((select(2, GetBuildInfo())))` stamped on every record |
| Quests | one mutable record per questID; `giver`/`ender`/`xpOffered` overwritten | loses per-build/per-stage/per-char data | `quests[qid]` = static fields; `quests[qid].obs["<build>:<stage>:<char>"]` = offered XP/money, NPC+coords, level, choices/rewards |
| Turn-ins | nested `q.turnIns[]`, no id | can't dedupe/trim | top-level `db.turnIns[]` with `id = char-realm-questID-epoch`, `build`, FIFO cap 2000 |
| Items | overwritten per itemID | beta stat changes lost | `items[id]` = name/quality/type/subtype/equipLoc; `items[id].byBuild[build]` = ilvl, reqLevel, stats, tooltip, sellPrice, lastSeen |
| Drops | `drops[item][npc] = count` | no build, no char → not idempotent across contributors | `drops[item][build][npc] = count`; server keys by item+npc+build+**character** and *sets* the count (it's a running total) |
| Runs | no id; resumed runs mutate an earlier entry | can't dedupe; record changes after upload | `id = char-realm-instanceID-startEpoch`, `build`; FIFO cap 2000 |
| Schema | none | server can't gate | `db.meta.schemaVersion = 1`, one-time migration of v0 data in `ADDON_LOADED` |

⚠️ **Key design consequence:** records (runs, item snapshots, quest obs, drop counts) **change after first upload**. So the uploader's ack state is `recordKey → contentHash`, not just ids, and the server does `INSERT … ON CONFLICT DO UPDATE`. Same batch twice = no-op; changed record = update, never duplicate.

## 🏗️ Repo layout (as in doc, plus)

```
forever-ledger (= /home/ubuntu/wow-addon)
├─ addon/ForeverLedger/            ForeverLedger.toc, ForeverLedger.lua, .luacheckrc
├─ addon/tests/                    Lua 5.1 harness: WoW API stubs + event driver + WoW-style serializer
├─ packages/contracts/             zod schemas, types, class/spec rules (rules/classRules.ts, versioned)
├─ packages/lua-sv-parser/         luaparse-based safe parser
├─ apps/uploader/                  commander CLI
├─ apps/server/                    Fastify + Drizzle + migrations + admin token CLI
├─ fixtures/{synthetic,real}/      .lua SavedVariables samples (+ truncated.lua)
├─ deploy/                         docker-compose.yml (postgres only), ecosystem.config.cjs (PM2), nginx/ledger.willikers.dev.conf, .env.example
├─ project-plans/                  this plan
├─ CLAUDE.md, pnpm-workspace.yaml, tsconfig.base.json, eslint.config.js, .prettierrc, vitest.workspace.ts
```

Tooling present: Node 22.22 (LTS), pnpm 11, Docker 28 + compose v2, PM2 6, Nginx 1.18. Missing: `luacheck`, `lua5.1` → `sudo apt install lua-check lua5.1`. Add deps via `pnpm add` (latest stable; use context7 to check current APIs for Fastify 5, Drizzle, zod 4, chokidar 4, luaparse).

---

## ✅ Progress checks

### 🧱 M0 — Scaffold
- [x] `git init -b master`, set local user.name/email, `.gitignore` (node_modules, dist, .env, `*.state.json`, queue dirs)
- [x] pnpm workspace, `tsconfig.base.json` (ESM, strict, NodeNext), eslint flat config + typescript-eslint, prettier, vitest workspace
- [x] Empty packages/apps each with `src/index.ts`, `build`, `test`, `lint`, `typecheck` scripts; root `pnpm check` = lint + typecheck + test + `luacheck addon/`
- [x] `.luacheckrc` with WoW globals (std lua51 + read_globals list: CreateFrame, GetItemInfo, C_Item, C_Map, strsplit, wipe, format, floor, SlashCmdList, …; globals: ForeverLedgerDB, SLASH_FOREVERLEDGER1/2)
- [x] `CLAUDE.md`: conventions (never execute Lua, contracts are source of truth, schemaVersion bump rule, master-only during alpha, git identity, America/Chicago)
- [x] `.github/workflows/ci.yml` stub (inactive until repo exists at launch)
- **Done when:** `pnpm check` passes. ✅ Done 2026-09-23 00:12 CDT (note: `pnpm ci` is a pnpm built-in, so the script is `pnpm check`; TypeScript pinned ~6.0 for typescript-eslint).

### 🧩 M1 — `lua-sv-parser`
- [x] `parseSavedVariables(text): Record<string, unknown>` — `luaparse.parse(text, { luaVersion: '5.1', comments: false, encodingMode: 'pseudo-latin1' })`, then decode string bytes → UTF-8 via `Buffer.from(v, 'latin1').toString('utf8')`
- [x] Walker accepts only: top-level `AssignmentStatement` to plain identifiers; `TableConstructorExpression` (keyed `[k]=`, `name=`, positional); String/Numeric/Boolean/Nil literals; unary `-` on numerics. Anything else → `SavedVariablesParseError` with line/col. **Never evaluate.**
- [x] Table → JS: pure 1..n sequential integer keys → array, otherwise object (numeric keys stringified). `nil` values dropped.
- [x] Preserve WoW color codes `|cff…|r` and `|Hitem:…|h[…]|h` verbatim; export helpers `stripColorCodes()`, `parseItemLink()`
- [x] Fixtures: hand-written WoW-format sample, escapes (`\"`, `\\`, `\n`, `\ddd`), UTF-8 names, color codes/links, empty tables, sparse arrays, large (5k+ records) perf test, **`truncated.lua` must throw cleanly**, a file with a function call must be rejected
- **Done when:** all fixture tests pass. ✅ Done 2026-09-23 00:16 CDT — 25 tests; truncation detected by error index at end of input (covers cut mid-string and mid-table).

### 🔬 M1.5 — Client API probe (answers open questions before we lock schema v1)
User idea: use the client's `/api` docs to find out what Forever really supports. Build a tiny **separate addon `ForeverLedgerProbe`** (own SavedVariables `ForeverLedgerProbeDB`, so the ledger file stays small). Read-only, runs on `/flprobe`:
- [x] Dump `GetBuildInfo()` (version, build, date, interface number) → open questions 2
- [x] `LoadAddOn("Blizzard_APIDocumentation")` (C_AddOns fallback) and walk `APIDocumentation.systems` → every namespace, function (args/returns) and event (payload fields) — same data `/api` shows → questions 3, 4
- [x] Presence check for globals we depend on (`GetRewardXP`, `GetLootSourceInfo`, `GetQuestID`, `C_Item.*`, `C_QuestLog.*`, `C_Map.*`, …) and `pcall(RegisterEvent)` result for each candidate event (`QUEST_TURNED_IN`, `ENCOUNTER_END`, `GET_ITEM_INFO_RECEIVED`, `QUEST_ACCEPTED`, …)
- [x] Live event sniffer toggle (`/flprobe sniff on|off`): records the first N payloads per event (`QUEST_ACCEPTED` arg order, `QUEST_TURNED_IN` xp/money, `ENCOUNTER_END`) to answer arg-order questions from real play
- [x] Uploader gets `probe-dump <file>` → parses `ForeverLedgerProbe.lua` with our parser → `fixtures/real/api-<build>.json`; later: diff two dumps to see API changes between beta builds
- **Done when:** probe passes luacheck + harness test; after the user runs it in-game once, open questions 2–4 are answered in `CLAUDE.md` and M2 adapts accordingly.
  - 🟡 2026-09-23 00:22 CDT — probe built + 6 harness tests pass; **waiting on the user to run `/flprobe` in-game.**
  - ✅ 2026-09-23 00:49 CDT — real dump received (build 69913, 1.60.1, interface 16001) → `fixtures/real/api-69913.json`; answers recorded in `CLAUDE.md`.
    - 🐛 Found: Forever has **no** `GetQuestLogTitle` / `SelectQuestLogEntry` / `GetQuestLogSelection`, so v0.2.0 threw a Lua error on every `QUEST_ACCEPTED` and on `/fl scanlog`. Fixed in **v0.2.1** (falls back to `C_QuestLog.GetInfo` / `Get/SetSelectedQuest`), `.toc` Interface → 16001, new harness profile `api = "forever"` + test (23 Lua tests).
    - 📝 SavedVariables shape unchanged → no schema bump. Real `ForeverLedger.lua` (only a character so far) normalizes and validates with 0 problems.
    - ⏳ Sniffer payloads still empty — confirm arg order from real play with `/flprobe sniff on`.

### 📜 M2 — Contracts + addon schema v1
- [x] Addon changes per the findings table; migration of v0 data (quests' nested turnIns → `db.turnIns`, flat item fields → `byBuild[meta.build or 0]`, drops → `drops[item][0][npc]`); FIFO trim helper; bump to v0.2.0, `/fl` status prints schema + build
- [x] Keep `pcall`-guarded event registration; keep `QUEST_ACCEPTED (a, b)` handling (open question #4)
- [x] `addon/tests/`: Lua 5.1 harness with stubbed WoW globals drives a scripted session (login, accept, turn in, enter dungeon, loot, boss kill, die, leave, re-enter within 15 min) and writes `fixtures/synthetic/session-*.lua` using a WoW-style serializer. Asserts ids, build stamps, byBuild, caps.
- [x] `packages/contracts`: zod `Meta`, `Quest`, `QuestObservation`, `QuestRewardOption`, `TurnIn`, `Item`, `ItemBuildSnapshot`, `Drop`, `Run`, `RunBoss`, `RunLoot`, `RunPartyMember`, `UploadBatch` (`{ uploaderId, schemaVersion, clientBuild, character, records: { quests, questObservations, turnIns, items, itemSnapshots, drops, runs } }`)
- [x] `normalize(svObject) → records` (SavedVariables shape → flat record lists with natural keys) lives in contracts so uploader and server share it; `recordKey()` + stable `contentHash()` (sorted-key JSON → sha256)
- [x] `rules/classRules.ts`: armor type per class, primary stat per spec, weapon types — versioned, used at query time only
- **Done when:** every synthetic fixture parses → normalizes → validates; luacheck clean. ✅ Done 2026-09-23 00:22 CDT — 22 Lua tests (incl. migration tested against the real v0.1.0 addon) + 16 contract tests.
  - 📝 Change vs doc: `UploadBatch` carries `account` (SavedVariables file = one WoW account, many characters) instead of one `character`; each record names its own `char`. Drop counts keyed item+build+npc+uploader+account.

### 🗄️ M3 — Server ingest + DB + deploy
- [x] Drizzle schema for all 13 tables in the doc, with deltas: `drops` PK = item+npc+build+character; `quest_observations` PK = quest+build+stage+character; `api_tokens` (sha256 hash, label, created/revoked) table; `raw_uploads` JSONB
- [x] `POST /v1/ingest`: bearer auth → zod validate → reject unknown schema major (409) → one transaction: insert `raw_uploads`, upsert builds/characters, then each record type `ON CONFLICT DO UPDATE` → return `{ acknowledged: [{ key, hash }] }`
- [x] `@fastify/rate-limit`, `bodyLimit` 5 MB (uploader chunks under it), pino with America/Chicago timestamps, `GET /v1/health` (checks DB)
- [x] Admin CLI `pnpm --filter server token:mint <label>` / `token:revoke <id>` / `token:list` (plaintext shown once)
- [x] `deploy/docker-compose.yml`: postgres (current official image, `127.0.0.1:5440:5432`, named volume, `TZ`/`PGTZ=America/Chicago`); `ecosystem.config.cjs`: `forever-ledger-api`, port 3410, `TZ=America/Chicago`; Nginx site proxy → 127.0.0.1:3410, `client_max_body_size 6m`, then `certbot --nginx -d ledger.willikers.dev`
- [x] Integration tests (Vitest + testcontainers Postgres): same batch twice → no duplicate rows; changed run → updated; bad token 401; revoked token 401; oversized 413; malformed 400; unknown schema 409
- **Done when:** idempotency tests pass and `https://ledger.willikers.dev/v1/health` returns ok.
  - 🟡 2026-09-23 00:30 CDT — 16 integration tests pass on real Postgres 18 (testcontainers). Deployed: Postgres `forever-ledger-postgres` on 127.0.0.1:5440, PM2 `forever-ledger-api` on 127.0.0.1:3410, Nginx site enabled (routes correctly via the public IP). Token #1 minted (plaintext in gitignored `deploy/.first-token`).
  - ✅ 2026-09-23 01:03 CDT — DNS live; TLS cert issued (expires 2026-12-22), HTTP → HTTPS redirect, `https://ledger.willikers.dev/v1/health` ok. `pm2 save` done with the user's OK (old 17-app dump kept at `~/.pm2/dump.pm2.pre-ledger-2026-09-23`).
    - ⚠️ `certbot --nginx` left a stray nginx outside systemd (nginx.service crash-looped); handed back to systemd. Renewal set to `standalone` to fit the box's global stop/start-nginx hooks. ⏳ Renewal dry run blocked by Let's Encrypt staging "Service busy" — re-run `sudo certbot renew --cert-name ledger.willikers.dev --dry-run --no-random-sleep-on-renew` later.
  - ⚠️ Did **not** run `pm2 save`: the saved dump holds 17 other apps (freshy-*, ticket-bot, …) that aren't running now, and saving would erase them from it. The ledger API won't come back after a reboot until the user decides.
  - 📝 Read routes (analysis/export) also need a token, since the data includes contributors' character names.

### 📤 M4 — Uploader
- [x] Config file (`~/.config/forever-ledger/config.json` or `%APPDATA%` on Windows): wowPath, accounts, serverUrl, token, uploaderId; `init` discovers `WTF/Account/*/SavedVariables/ForeverLedger.lua` under the given install path (folder name unconfirmed → user-supplied, globbed)
- [x] `watch`: chokidar with `awaitWriteFinish` + own size/mtime-stable check; parse failure → retry with backoff (mid-write), never crash
- [x] Pipeline: parse → normalize → validate → diff vs local state (`key → hash`) → chunk batches → POST → mark acked only for keys returned on 2xx
- [x] Offline queue: pending batches persisted to disk (atomic write-rename), exponential backoff retry; replays before new batches
- [x] Commands: `init`, `watch`, `upload-once`, `status` (pending/acked counts, last success), `export <file>` (normalized JSON, no server needed)
- [x] Tests: diff logic, queue persistence, and an e2e test: start server, upload, kill server mid-session, append records, restart → everything arrives exactly once
- **Done when:** that kill/restart test passes. ✅ Done 2026-09-23 00:38 CDT
  - 53 uploader tests (mock server) + a manual run against the **real** API/Postgres: 17 records uploaded, second pass sent 0, server killed → changed run queued on disk (exit 1), restart → exactly 1 record acked, DB has no duplicates.
  - 📝 Built by a sub-agent. Deviations: config is checked by a small hand-written validator instead of zod (zod isn't a direct uploader dependency); a 400 splits the batch until only the bad record is left, and that record alone is parked in `rejected/`.

### 📊 M5 — Stub analysis + export
- [x] `GET /v1/quests/xp` (XP offered vs paid per quest per build, XP-per-minute by dungeon from `runs` = xp_total / active_secs×60, split mob/quest)
- [x] `GET /v1/runs/summary` (per instance: median/best clear time, boss splits, deaths, runs count)
- [x] `GET /v1/items/:id` (item + all build snapshots + drop sources + which classes/specs can use it via `classRules`)
- [x] `GET /v1/export?format=json|csv&table=…` (times in America/Chicago)
- **Done when:** XP-per-minute per dungeon returns from synthetic data now, and from real data once the user uploads a play session.
  - 🟡 2026-09-23 00:30 CDT — built early alongside M3; synthetic Deadmines run gives 280.6 XP/min (225.8 mob + 54.8 quest). Real data pending the user's first play session.

---

## 🔁 Execution approach
- Sequential M0 → M1 → M2 (contracts are the spine). After M2, M3 (server) and M4 (uploader) run in **parallel sub-agents** against the shared contracts; M5 after M3.
- Commit to `master` at each milestone's "done when" (personal identity + Co-Authored-By trailer).
- Update the progress checks in `project-plans/forever-ledger-m0-m5.md` as each item lands; ntfy to `m0kuNjxWbhNSGY4c` at end of each prompt.

## 🧑‍🔧 Needs the user
1. ~~**DNS:** A record `ledger.willikers.dev` → `135.148.136.99`~~ ✅ done 2026-09-23.
2. Install `ForeverLedgerProbe`, run `/flprobe` (+ a short session with `sniff on`), `/reload`, and send back `ForeverLedgerProbe.lua`.
3. Real SavedVariables from a Forever install (answers open questions 1–6) → dropped in `fixtures/real/` (anonymized by a small `scripts/anonymize-sv` tool we'll include).
4. In-game manual checklist (doc §9) once v0.2.0 addon is installed.

## 🧪 Verification
- `pnpm check` (lint, typecheck, unit + integration tests, luacheck) green.
- `lua5.1 addon/tests/run.lua` generates fixtures; `pnpm --filter lua-sv-parser test` parses them; truncated fixture fails with a clean error.
- `docker compose -f deploy/docker-compose.yml up -d`, `pm2 start deploy/ecosystem.config.cjs`, `curl https://ledger.willikers.dev/v1/health`.
- `token:mint` → `uploader upload-once` against a synthetic fixture twice → row counts unchanged on second run (`psql` check).
- Kill-server e2e test in M4; `curl …/v1/quests/xp` and `/v1/runs/summary` return sensible numbers for synthetic runs.
