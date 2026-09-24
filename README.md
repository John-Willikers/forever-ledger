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

Since 0.3.3 (schema 5) a vendor item bought with items or currencies keeps that extended cost (amount, item or
currency, name) next to its gold price, and vendors and trainers keep the subtitle under their name ("Enchanting",
"Blacksmithing Supplies").

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

API (all but health need `Authorization: Bearer <token>`; the read routes also take an admin panel session):

| Route                                            | What                                                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `GET /v1/health`                                 | Liveness + DB check                                                                          |
| `POST /v1/ingest`                                | Idempotent batch upsert; returns acknowledged record keys + content hashes                   |
| `GET /v1/runs/summary?build=`                    | Per dungeon: runs, median/best clear, XP/min (mob vs quest), deaths, boss splits             |
| `GET /v1/quests/xp?build=`                       | Offered vs paid XP per quest                                                                 |
| `GET /v1/items/:id`                              | Item snapshots per build, drop sources, quest rewards, class/spec fit                        |
| `GET /v1/drops/rates?build=`                     | Per npc + item: corpses looted, dropped, rate, stack quantity, avg copper/corpse             |
| `GET /v1/professions/recipes?skillLine=&build=`  | Recipes: reagents, output, difficulty thresholds seen, learned by / via                      |
| `GET /v1/professions/sources?itemId=\|recipeId=` | Trainers (cost, rank), vendors (price, costs, stock), NPC titles, recipe drops               |
| `GET /v1/professions/gathering?build=`           | Per node (0 = fishing): opens, min rank, zones, top loot per open                            |
| `GET /v1/professions/skills?char=&build=`        | Per character: professions, rank / max rank, skill-up history with recipe                    |
| `GET /v1/export?format=json\|csv&table=`         | Full dump for offline analysis (times in America/Chicago)                                    |
| `POST /v1/diagnostics`                           | Tray app error report (30/min per token, 256 KB)                                             |
| `GET /v1/diagnostics?since=&limit=`              | Error reports and refused uploads, newest first (`since`: epoch secs or ISO)                 |
| `GET /v1/diagnostics?type=&level=&source=`       | Filters: `type=diagnostic\|ingest-error`; refused uploads are level `error`, source `ingest` |

Forever lists every profession twice: a base skill line and a "Classic" child line (`parentId` = the base) with the
same name and rank. The profession routes fold child lines into their base: `?skillLine=` takes either id and means
the whole profession, recipes carry `profession: { skillLineId, name }` of the base next to their own `skillLineId`,
gathering and trainer skill lines are the base (with `skillLineName`), and a rise recorded on both lines is one
skill-up.

## 🔐 Admin panel (ledger.willikers.dev/admin/)

A React app served by the API at `/admin/`, behind Battle.net login. Admin-only for now: everyone else who logs in
sees "not authorized yet". Plan: [`project-plans/forever-ledger-admin-panel.md`](project-plans/forever-ledger-admin-panel.md).

**Register the Battle.net client** (once):

1. Your Battle.net account needs an authenticator (Blizzard requires one to create API clients).
2. [develop.battle.net](https://develop.battle.net/) → **API Access** → **Create Client**.
3. Redirect URL: `https://ledger.willikers.dev/admin/auth/callback` (must match exactly). Service URL: optional.
4. Put the client id and secret in `deploy/.env` (never in the repo):

```bash
BNET_CLIENT_ID=...
BNET_CLIENT_SECRET=...
ADMIN_BATTLETAGS="JohnWilliker#1292"      # first-login bootstrap only; quoted (# starts a comment); exact, case-sensitive
COOKIE_SECRET=...                         # output of `openssl rand -hex 32`; signs cookies and CSRF tokens
```

| Variable             | Default                                            | What                                                                |
| -------------------- | -------------------------------------------------- | ------------------------------------------------------------------- |
| `BNET_CLIENT_ID`     | unset → `/admin/auth/login` answers 503            | Battle.net OAuth client                                             |
| `BNET_CLIENT_SECRET` | required with `BNET_CLIENT_ID`                     | Battle.net OAuth secret                                             |
| `BNET_REDIRECT_URI`  | `https://ledger.willikers.dev/admin/auth/callback` | Must match the client's redirect URL                                |
| `ADMIN_BATTLETAGS`   | empty                                              | Bootstrap: BattleTags made admin at login while no admin exists yet |
| `ADMIN_BNET_SUBS`    | empty                                              | Battle.net account ids (`sub`, digits) always made admin at login   |
| `COOKIE_SECRET`      | required with `BNET_CLIENT_ID` (≥ 32 chars)        | Signs the session/state cookies and derives CSRF tokens             |
| `COOKIE_INSECURE`    | off                                                | `1` drops the cookies' `Secure` flag — local http dev only          |
| `ADMIN_DIST_DIR`     | `apps/admin/dist`                                  | Built SPA; `/admin/` answers 503 "admin panel not built" if missing |

How it works: `/admin/auth/login` → Battle.net (`scope=openid`, signed single-use `__Host-fl_oauth_state` cookie
carrying its issued-at, refused after 10 minutes) → `/admin/auth/callback` exchanges the code, reads the account id
and BattleTag, ends any session the browser already had, and starts a 7-day sliding session that ends 30 days after
login at the latest (`__Host-fl_session` cookie: httpOnly, Secure, SameSite=Lax, Path=/; the database keeps only its
sha256). `/admin/api`, `/admin/auth` and session-authorized `/v1` reads answer `Cache-Control: no-store`. Failed
logins land on `/admin/?error=state|cancelled|failed|unauthorized`; the panel shows a fixed message per code and
nothing for any other value. With `COOKIE_INSECURE=1` the cookies drop `Secure` and the `__Host-` prefix. The panel
reads the `/v1/*` routes with its session and calls `/admin/api/*` (non-GET requests send the `x-csrf-token` from
`/admin/auth/me`). Nginx proxies `/admin/` to the API like `/v1/`.

Roles: `ADMIN_BATTLETAGS` is a **first-login bootstrap only** — a listed BattleTag becomes `admin` at login while no
admin exists yet (checked in the same transaction). Once any admin exists the list grants nothing: a second account
with the same BattleTag stays `member` and a demoted admin stays demoted; roles change only on the panel's Access
page (or in the database); the last admin can't be demoted. Empty it after your first login (if the last admin is ever demoted, a listed tag would bootstrap
again). The account id pins the user, so a BattleTag change keeps the role. `ADMIN_BNET_SUBS` (account ids) always
grants admin — pinned to the account, not the tag.

Pages: **Overview** (KPIs, uploads per hour, records by kind, live upload feed every 15 s, builds, addon/tray
versions in use), **Characters** (cards with owners), **Health** (diagnostics + refused uploads with filters, client
API samples with the addon's `ForeverLedger.errors` / `fieldMisses` reports first), **Access** (users and roles,
upload tokens: mint with an owner, assign owners, revoke). Admin API (admin session; writes need `x-csrf-token`):

| Route                                                     | What                                                                   |
| --------------------------------------------------------- | ---------------------------------------------------------------------- |
| `GET /admin/api/overview`                                 | KPIs, records by kind, builds, versions in use, 7-day health           |
| `GET /admin/api/uploads?limit=&before=`                   | Recent uploads: token, owner, versions, counts per kind (no data)      |
| `GET /admin/api/uploads/hourly?days=`                     | Uploads per hour (America/Chicago), empty hours included, ≤ 31 d       |
| `GET /admin/api/characters`                               | Characters with the owners of the tokens that uploaded them            |
| `GET /admin/api/api-samples`, `…/api-samples/:api?build=` | Client API samples (list without JSON; one sample)                     |
| `GET /admin/api/tokens`, `POST /admin/api/tokens`         | List; mint `{ label, ownerUserId? }` (plaintext in that response only) |
| `POST /admin/api/tokens/:id/revoke`, `…/:id/owner`        | Revoke (idempotent); set owner `{ userId \| null }`                    |
| `GET /admin/api/users`, `POST /admin/api/users/:id/role`  | Users with token counts; `{ role }` (409 for the last admin)           |

Deploy: `pnpm install && pnpm build` (builds `apps/admin/dist` too), fill `deploy/.env`, copy the Nginx site
(`deploy/nginx/ledger.willikers.dev.conf`) **and** its `log_format` snippet (`deploy/nginx/ledger-noquery-log.conf` →
`/etc/nginx/conf.d/`, http level), `sudo nginx -t && sudo systemctl reload nginx`,
`pm2 restart forever-ledger-api --update-env`. The first login creates your user as admin. Nginx sends HSTS (1 year)
and logs `/admin/auth/` to `/var/log/nginx/ledger-auth.access.log` by path only (no OAuth codes or states).

Local development:

```bash
# API on 127.0.0.1:3410 against a local Postgres; http, so no Secure cookies
DATABASE_URL=postgres://... COOKIE_INSECURE=1 COOKIE_SECRET=$(openssl rand -hex 32) \
  pnpm --filter @forever-ledger/server dev
pnpm --filter @forever-ledger/admin dev    # Vite on http://localhost:5173/admin/, proxies /v1, /admin/api, /admin/auth
```

To log in locally, add `http://localhost:5173/admin/auth/callback` as a second redirect URL on the Battle.net
client (if Blizzard accepts it for your client) and start the API with `BNET_CLIENT_ID`, `BNET_CLIENT_SECRET` and
`BNET_REDIRECT_URI=http://localhost:5173/admin/auth/callback`. `LEDGER_API` points the Vite proxy elsewhere.

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
