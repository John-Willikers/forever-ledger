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

| Addon                | What it does                                                                                                                       | Commands                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `ForeverLedger`      | Records quests (offered XP, rewards, givers), turn-ins, items per client build, loot and drop rates, dungeon runs and professions. | `/fl` status · `/fl scanlog` · `/fl done` · `/fl nudge off` / `on` · `/fl reset confirm` |
| `ForeverLedgerProbe` | Development only: dumps what the client supports (same API docs as `/api`, globals, events) and can sniff event payloads.          | `/flprobe` dump · `/flprobe sniff on` / `off` · `/flprobe io …` · `/flprobe status`      |

Data reaches disk only on `/reload`, logout or a clean exit, so `/reload` after each dungeon. Upgrading from
v0.1.0 migrates your existing data the first time you log in.

Since 0.2.4 it also records loot for drop rates: every corpse you loot once (with the copper it held), stack sizes,
AoE loot split per corpse, and inside a grouped dungeon run the loot method, boss drops with rolls and winners from
the loot history, and what party members receive in loot chat. Party members are stored by class only, never by name.
Each load of the addon is a session (Forever starts every `/reload` with an empty file), and the server keeps every
session, so repeated `/reload`s no longer overwrite each other's counts.

Since 0.3.0 it also records professions: skill ranks and skill-ups, the recipes in your own profession window
(reagents, output, the difficulty colour at each rank), how each recipe was learned (trainer, recipe item or unknown),
crafts per recipe (casts, quantity, procs), gathering nodes and fishing (opens, the lowest rank seen, spots, loot),
and the services of profession trainers and the stock of vendors you open. `/fl` shows the counts. Forever runs the
retail profession API, whose field names aren't documented for this client, so the addon **self-reports** them: the
first table each profession API or event returns on a build is kept (trimmed) in `apiSamples`, and names it looked
for but didn't find go to `apiSamples["ForeverLedger.fieldMisses"]`. Both reach the server's `api_samples` table,
so a wrong reader shows up there without anyone sending files.

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

## 🖥️ Tray app (gaming PC, recommended)

**Forever Ledger** for Windows does everything the uploader CLI does, keeps the `ForeverLedger` addon at the version the
server recommends, and updates itself.

1. Download `Forever-Ledger-Setup-<version>.exe` from the
   [latest release](https://github.com/John-Willikers/forever-ledger/releases/latest). The build is unsigned, so
   SmartScreen asks once: **More info → Run anyway**.
2. Setup: pick the game folder (the one that contains `WTF`, e.g. `…\World of Warcraft\_classic_beta_`), paste your
   token, **Save**. It installs the addon right away if it's missing.
3. It lives in the tray and starts with Windows (hidden). Tray colours: 🟢 up to date · 🔵 uploading · 🟡 batches
   queued (server unreachable, retrying) · 🔴 needs attention.
4. Play. Every `/reload`, logout or exit writes SavedVariables and the app uploads within seconds. **Keep it running
   whenever WoW runs**: the Forever client doesn't load SavedVariables back, so each write replaces the last one
   ([details](docs/plans/2026-09-23-live-data-research.md)).
5. When a new addon version goes live the app installs it (within 30 min, or **Update now**) and shows a toast:
   type `/reload` in game to use it. **Roll back** restores the previous version and pauses auto-update until the
   server recommends a different one.

Logs: `%APPDATA%\Forever Ledger\logs\forever-ledger.log` (tray menu → **Open logs folder**); the window's Activity
list shows the latest lines. The app and the CLI share `%APPDATA%\forever-ledger\config.json`.

### 🩺 Error reports

So problems on your PC can be fixed without asking for log files, the app sends short error reports to the server
(`POST /v1/diagnostics`, with your upload token), every 5 minutes when something new went wrong and about 10 s after
something serious.

- **What's sent:** warnings and errors from the log, failed uploads, SavedVariables that don't parse, addon update
  failures, app update failures, crashes, and a summary of records the server refused (why, the validation issues,
  record kind and key — never the record itself). Plus your uploader id, the app version and Windows version.
  Repeats are sent once with a count; at most 50 events per report.
- **What's stripped:** upload tokens (`flt_…` becomes `flt_***`, `Bearer …` becomes `Bearer ***`) and your user
  folder (`C:\Users\<you>` becomes `~`). Messages are capped at 500 characters, details at 4 KB. No game data, no
  SavedVariables contents.
- **Turn it off:** Settings → uncheck **Send error reports** (stored in `prefs.json`; pending reports are dropped).
  The App card shows when the last report went out and how many are waiting.

Separately, the server keeps a note of every upload it refuses (invalid batch or unsupported schema), without the
token. Both show up in `GET /v1/diagnostics`.

## 📤 Uploader CLI (gaming PC)

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
node apps/uploader/dist/cli.js addon-sync     # install/update the addon now (--force, --rollback)
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

| Route                                            | What                                                                             |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| `GET /v1/health`                                 | Liveness + DB check                                                              |
| `POST /v1/ingest`                                | Idempotent batch upsert; returns acknowledged record keys + content hashes       |
| `GET /v1/runs/summary?build=`                    | Per dungeon: runs, median/best clear, XP/min (mob vs quest), deaths, boss splits |
| `GET /v1/quests/xp?build=`                       | Offered vs paid XP per quest                                                     |
| `GET /v1/items/:id`                              | Item snapshots per build, drop sources, quest rewards, class/spec fit            |
| `GET /v1/drops/rates?build=`                     | Per npc + item: corpses looted, dropped, rate, stack quantity, avg copper/corpse |
| `GET /v1/professions/recipes?skillLine=&build=`  | Recipes: reagents, output, difficulty thresholds seen, learned by / via          |
| `GET /v1/professions/sources?itemId=\|recipeId=` | Trainers (cost, rank), vendors (price, stock), Recipe-class item drops           |
| `GET /v1/professions/gathering?build=`           | Per node (0 = fishing): opens, min rank, zones, top loot per open                |
| `GET /v1/export?format=json\|csv&table=`         | Full dump for offline analysis (times in America/Chicago)                        |
| `POST /v1/diagnostics`                           | Tray app error report (30/min per token, 256 KB)                                 |
| `GET /v1/diagnostics?since=&limit=`              | Error reports and refused uploads, newest first (`since`: epoch secs or ISO)     |

## 🏷️ Releasing

Addon (goes live only when published on the server):

```bash
# bump `## Version` in addon/ForeverLedger/ForeverLedger.toc and VERSION in ForeverLedger.lua, merge to master
git tag addon-v0.2.2 && git push origin addon-v0.2.2     # Action: checks, zips, GitHub release (not "latest")
set -a; . deploy/.env; set +a
node apps/server/dist/addon-cli.js publish 0.2.2         # downloads, verifies, makes it live
node apps/server/dist/addon-cli.js pin 69913-69999 0.2.1 # these client builds stay on 0.2.1
node apps/server/dist/addon-cli.js yank 0.2.2            # pull a bad version (clients fall back to the newest active)
node apps/server/dist/addon-cli.js list
```

Tray app: bump `apps/desktop/package.json` `version`, merge to master, `git tag v0.1.1 && git push origin v0.1.1`.
The Action builds the installer and publishes it as the latest release; installed apps update themselves.
Addon releases must stay `--latest=false` so GitHub's "latest release" is always the app.

## 🛠️ Development

```bash
pnpm install
pnpm check            # eslint + prettier + luacheck + typecheck + Lua harness + vitest
pnpm test:lua         # addon tests (Lua 5.1 harness with WoW API stubs; regenerates fixtures/synthetic)
pnpm anonymize in.lua fixtures/real/out.lua   # scrub character names before committing a real file
```

Needs Node 22+, pnpm, Docker (integration tests start Postgres with testcontainers), `lua5.1` and `luacheck`
(`sudo apt install lua5.1 lua-check`). Conventions live in [`CLAUDE.md`](CLAUDE.md).
