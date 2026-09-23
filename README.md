# Forever Ledger

Collects World of Warcraft: Forever quest, reward, item, loot and dungeon-run data from real play and ships it to
a self-hosted server for analysis (XP per minute by dungeon, quest rewards by class/spec, clear times, loot tables).

```
WoW client + ForeverLedger addon ──/reload──▶ SavedVariables/ForeverLedger.lua
        ──▶ uploader (gaming PC: parse → validate → diff → queue) ──HTTPS + token──▶
        ledger.willikers.dev (Fastify API, PM2) ──▶ PostgreSQL (Docker)
```

The addon and uploader only **read** what the game already shows and writes to disk. Nothing reads game memory,
sends input or automates play. SavedVariables files are parsed as data and never executed.

Plan and live progress: [`project-plans/forever-ledger-m0-m5.md`](project-plans/forever-ledger-m0-m5.md).

## 🎮 Addons (in game)

Copy both folders from `addon/` into the Forever client's `Interface/AddOns/` folder:

| Addon                | What it does                                                                                                              | Commands                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `ForeverLedger`      | Records quests (offered XP, rewards, givers), turn-ins, items per client build, drops and dungeon runs.                   | `/fl` status · `/fl scanlog` · `/fl done` · `/fl nudge off` / `on` · `/fl reset confirm` |
| `ForeverLedgerProbe` | Development only: dumps what the client supports (same API docs as `/api`, globals, events) and can sniff event payloads. | `/flprobe` dump · `/flprobe sniff on` / `off` · `/flprobe io …` · `/flprobe status`      |

Data reaches disk only on `/reload`, logout or a clean exit, so `/reload` after each dungeon. Upgrading from
v0.1.0 migrates your existing data the first time you log in.

Since 0.2.2 the addon reminds you at natural checkpoints (a boss kill, a dungeon run closing, a quest turn-in, a
dungeon finder reward): `Forever Ledger: N new records since your last /reload — type /reload to save them`. It
prints at most once every 5 minutes, waits until you leave combat, and only prints; the tray app uploads within
seconds of the `/reload`. `/fl` shows the unsaved count. `/fl nudge off` silences it until your next `/reload` or
logout (the switch isn't saved, so the SavedVariables shape is unchanged).

**First thing to do on a real Forever install:** enable `ForeverLedgerProbe`, run `/flprobe`, then
`/flprobe sniff on`, accept and turn in a quest, run a dungeon, `/reload`, and send back
`WTF/Account/<ACCOUNT>/SavedVariables/ForeverLedgerProbe.lua`. It answers the open questions in the plan
(interface number, which events exist, `QUEST_ACCEPTED` argument order, …).

**Live-data checks (probe 0.2.0, see [`docs/plans/2026-09-23-live-data-research.md`](docs/plans/2026-09-23-live-data-research.md)).**
Every step runs only when you type it or click a probe button; results go to `ForeverLedgerProbeDB.io`:

| Command                 | What it does                                                                                                                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/flprobe io`           | Records and prints the chat/combat logging state (`LoggingChat()`, `LoggingCombat()`, `C_ChatInfo.IsLogging*`, `advancedCombatLogging`, `C_CombatLog.IsCombatLogRestricted`) and the SavedVariables load check.                               |
| `/flprobe io on`        | Turns chat and combat logging on and prints `FLPROBE-PRINT-<epoch>` / `FLPROBE-ADDMSG-<epoch>`. Then loot, kill a mob, turn in a quest and search `<WoW>\_classic_beta_\Logs\WoWChatLog.txt` and `WoWCombatLog*.txt` for `FLPROBE`.           |
| `/flprobe io toggle`    | Prints `FLPROBE-TOGGLE-<epoch>`, then turns each log off and on again, to see whether that flushes the files. At most once per 10 s (the client allows 5 combat-log calls per 10 s).                                                          |
| `/flprobe io off`       | Turns both logs off.                                                                                                                                                                                                                          |
| `/flprobe io reloadbtn` | Out of combat only: shows a secure `/reload` macro button and a plain button that calls `ReloadUI()` (right-drag to move). Each records its click before acting, so you can tell which one reloaded. `/flprobe io reloadbtn hide` hides them. |

The load check counts loads in `ForeverLedgerProbeDB.loadCount`. If it stays at 1 after a `/reload`, Forever didn't
load the file back (bug #34) and each write replaces the last, so copy `ForeverLedgerProbe.lua` after every `/reload`.
`forever-ledger probe-dump` prints an `io` section with the load check, the logging state and the last 10 entries.

## 📤 Uploader (gaming PC)

A Node CLI (Node 22+) that watches `WTF/Account/*/SavedVariables/ForeverLedger.lua`, uploads only new or changed
records, and keeps an on-disk queue while the server is unreachable.

```bash
pnpm install && pnpm build
node apps/uploader/dist/cli.js init --wow-path "C:\Games\Forever" \
  --server https://ledger.willikers.dev --token flt_...     # lists the accounts it found
node apps/uploader/dist/cli.js watch          # upload now, then on every /reload; retries while offline
node apps/uploader/dist/cli.js upload-once    # one pass (exit code 1 if anything is still queued)
node apps/uploader/dist/cli.js status         # acked records, queued batches, last upload per account
node apps/uploader/dist/cli.js export out.json            # normalized records, no server needed
node apps/uploader/dist/cli.js probe-dump ForeverLedgerProbe.lua probe.json
```

`--wow-path` can be the install folder, the game flavor folder or the `WTF` folder. Config lives in
`%APPDATA%\forever-ledger\config.json` (Windows) or `~/.config/forever-ledger/config.json`; the queue and upload
state sit next to it. Records the server rejects are parked in `rejected/` and not resent until they change.

## 🖥️ Server (ledger.willikers.dev)

Postgres runs in Docker; the API runs under PM2 on `127.0.0.1:3410` behind Nginx.

```bash
cp deploy/.env.example deploy/.env            # set POSTGRES_PASSWORD and DATABASE_URL
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d
pnpm install && pnpm build
pm2 start deploy/ecosystem.config.cjs         # runs migrations on start
```

Tokens (one per contributor; only the hash is stored):

```bash
set -a; . deploy/.env; set +a
pnpm --filter @forever-ledger/server token:mint "Friend's PC"
pnpm --filter @forever-ledger/server token:list
pnpm --filter @forever-ledger/server token:revoke 3
```

API (all but health need `Authorization: Bearer <token>`):

| Route                                    | What                                                                             |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| `GET /v1/health`                         | Liveness + DB check                                                              |
| `POST /v1/ingest`                        | Idempotent batch upsert; returns acknowledged record keys + content hashes       |
| `GET /v1/runs/summary?build=`            | Per dungeon: runs, median/best clear, XP/min (mob vs quest), deaths, boss splits |
| `GET /v1/quests/xp?build=`               | Offered vs paid XP per quest                                                     |
| `GET /v1/items/:id`                      | Item snapshots per build, drop sources, quest rewards, class/spec fit            |
| `GET /v1/export?format=json\|csv&table=` | Full dump for offline analysis (times in America/Chicago)                        |

## 🛠️ Development

```bash
pnpm install
pnpm check            # eslint + prettier + luacheck + typecheck + Lua harness + vitest
pnpm test:lua         # addon tests (Lua 5.1 harness with WoW API stubs; regenerates fixtures/synthetic)
pnpm anonymize in.lua fixtures/real/out.lua   # scrub character names before committing a real file
```

Needs Node 22+, pnpm, Docker (integration tests start Postgres with testcontainers), `lua5.1` and `luacheck`
(`sudo apt install lua5.1 lua-check`). Conventions live in [`CLAUDE.md`](CLAUDE.md).
