# 🧭 Forever Ledger — Admin Panel (Battle.net login, dashboards)

> Owner: John-Willikers <harlanbmiltonjr@gmail.com> · Approved 2026-09-23 (America/Chicago) · Branch per phase, PR → green → merge.

## 📌 Context

The ledger now collects quests, XP, loot/drop rates, runs, professions, vendors, trainers, error reports — but the only
way to see it is curl + SQL. The user wants a web panel they log into with **Battle.net OAuth2**, **admin-only for now**
(BattleTag `JohnWilliker#1292`), that ties characters to the person who logs in, with good visualizations of what's
coming in. Decisions made: served at **`https://ledger.willikers.dev/admin/`** (same host/cert, no DNS change) as an
**interactive React app**.

Research facts that shape the design (sources: community.developer.battle.net guides, oauth.battle.net discovery):
- OAuth: `https://oauth.battle.net/{authorize,token,userinfo}`, auth-code flow, confidential client (secret + `state`;
  **no PKCE**, **no refresh tokens**; access token 24 h). `/userinfo` → `{ sub, id, battletag }` — **no email**, so the
  allow-list uses the BattleTag to bootstrap and then the stable account id (`sub`); BattleTags can change.
- Redirect URI must be HTTPS and match exactly → `https://ledger.willikers.dev/admin/auth/callback`.
- **Forever has no Blizzard profile API** (beta, realmless) → characters are tied to users through **upload tokens**:
  every upload already carries `raw_uploads.token_id`; tokens get an owner. (If Blizzard ships a Forever namespace,
  `/profile/user/wow` can be added later.)
- Server today: Fastify 5 with only `@fastify/rate-limit`; no cookie/session/static plugins. Bearer tokens
  (`verifyBearer` in `apps/server/src/auth.ts`) and `requireToken` (`routes/analysis.ts:9`) guard every read route.
  Nginx `ledger.willikers.dev`: `/v1/` → 127.0.0.1:3410, `/` → 404. PM2 `deploy/ecosystem.config.cjs` passes an
  explicit env list. No UI/chart libs in the repo; `vite` is present only as a vitest peer.

## ✅ Progress checks

Legend: ⬜ todo · 🟡 in progress · ✅ done · ⛔ blocked. Times America/Chicago.

- ✅ 1 🔐 Auth + shell — 2026-09-23 20:22 — `25e2e4f` server, `f25a671` admin shell, `d626e69` README (branch
  `feat/admin-auth-shell`). Migration 0008; Battle.net login + 7-day sliding sessions + CSRF; `requireReader` on
  every `/v1` read (manifest/ingest stay bearer-only); `/admin/api/ping` (GET + POST as the CSRF probe); SPA served
  at `/admin/` (503 until built). Notes: `ADMIN_BATTLETAGS` must be quoted in `deploy/.env` (unquoted `#` is a
  comment; the server refuses a tag without `#number`); request logs redact `code`/`state`/tokens in URLs.
  Security review fixes: `4e0b878` (I1: `ADMIN_BATTLETAGS` bootstraps only while no admin exists, `ADMIN_BNET_SUBS`),
  `8bcfd65` (M1 `__Host-` cookies + 600 s single-use state, M3 fixed `?error=` codes, M4 no session fixation),
  `1daf343` (M5 30-day absolute sessions, M5b query-safe API paths, M7 no-store/nosniff, M8 dotfiles deny),
  `f65127c` (M2 HSTS, M6 `/admin/auth/` access log without query strings).
- ✅ 2 🏠 Overview + Health + Access — 2026-09-23 21:05 — `c8ee1dd` server, `8333225` pages (branch
  `feat/admin-overview-health-access`, not deployed). Admin API: overview KPIs (records by kind via `jsonb_each` over
  `raw_uploads` payloads), uploads feed (`?before=` id cursor, counts per kind, never records) + hourly buckets
  (gap-filled, Chicago ISO), characters with owners (tokens whose uploads held the character), api-samples list/detail,
  tokens list/mint (plaintext only in the 201 response, never logged)/revoke (idempotent)/owner, users list/role
  (409 for the last admin, under the bootstrap advisory lock); `/v1/diagnostics` gains `type`/`level`/`source`
  filters (refused uploads = level `error`, source `ingest`). Pages: Overview (live feed 15 s, KPIs 60 s), Health,
  Access (inline confirms, copy-once token box), Characters (cards; charts in phase 3). No migration for the pages
  (no index needed). Notes: overview/characters read every payload's `records` (fine at today's 34 uploads / 241 kB;
  add per-kind counts at ingest if it grows to many MB); pages lazy-load so ECharts (~550 kB) stays off the login page.
  Review: token read scope (migration 0009), perf follow-up — store per-upload record counts at ingest before
  raw_uploads grows large. (`d3a5bfb` scope: `api_tokens.can_read` default false, upload-only tokens get 403 on
  every `/v1` read, Access page toggle + "can read" at mint, `tokens-cli mint --read`; `b4e7448` int4 query params
  → 400; mint box `reset()` so the plaintext leaves the mutation cache.)
- ✅ 3 📜 Quests + 🧙 Characters — 2026-09-23 21:40 CDT — `eaa40d8` server (+ `23a019f` test), `e4b27ae` pages
  (branch `feat/admin-quests-characters`, not deployed). New `routes/adminQuests.ts` (admin session only):
  `GET /admin/api/quests` one row per quest at `?build=` or its newest build (all numbers from that build only:
  offered XP/money, turn-ins, avg XP paid, `xpMismatch`, reward choices with picks from `turn_ins.choice_item_id`,
  givers/enders, `foreverOnly` = id ≥ `FOREVER_QUEST_ID_MIN` 90000), filters `search`/`zone`/`minLevel`/`maxLevel`/
  `forever=1`/`mismatch=1`, `limit` ≤ 500 + `offset`, zone/build facets; `GET /admin/api/quests/:id` observations
  (locations sanitized to known fields), newest 500 turn-ins, reward options + picks per build;
  `GET /admin/api/characters/:key/timeline` level points (observations, turn-ins, character; deduped, runs at one
  level cut to first/last), turn-ins with running XP, XP per Chicago day. Pages: Quests (URL-kept filters, badges,
  XP-vs-level scatter with 3 zone colors + Other and Forever-only diamonds, `?quest=` drawer with pick bars and
  giver/ender zone plots), `/characters/:key` (level + cumulative XP lines, XP per day, turn-ins, professions from
  `/v1/professions/skills`). Notes: "XP sources stacked area (quests vs mobs)" left for 🏰 Dungeons (mob XP only exists
  per run); the list scans all observations + turn-ins per request (fine now; add a per-quest/build summary table if
  it gets slow); ECharts scatter/legend registered from `pages/quests/registerScatter.ts`, not `Chart.tsx`. Caveat:
  `xpMismatch` compares the max XP offered with the average XP paid across every level that turned the quest in, so
  a quest whose reward scales with level can be flagged without a real mismatch.
- ✅ 4 🎒 Loot + 🏰 Dungeons — 2026-09-23 21:37 — `50a3ec1` server, `22141f7` test fix, `5fad1b4` pages (branch
  `feat/admin-loot-dungeons`, not deployed). New `routes/adminLoot.ts` (admin session only): `/admin/api/loot/mobs`
  (per build + npc: corpses, avg copper, items, top 5 by rate with the `/v1/drops/rates` session rules; best-known
  npc name from quest givers/vendors/trainers, else null; `?build= ?search= ?limit=` ≤ 200 `?offset=`),
  `/loot/mobs/:npcId`, `/loot/items` (latest snapshot, distinct source counts, `FOREVER_ID_MIN` flag, `?quality=
  ?class=`), `/admin/api/items/:id` (stat/field diffs between consecutive builds, drop rates with names, vendors with
  named costs + title, recipes making/using it — complements `/v1/items/:id`), `/admin/api/runs` (+ instances facet),
  `/runs/:id`, `/dungeons/clear-times`. Pages: Loot (mob table + drop chart, item search), 🧾 Item, Dungeons (summary,
  clear-time dots, mob vs quest XP/min), 🏃 Run (boss split timeline, loot, boss loot rolls, party). Notes: run ids
  over 100 chars couldn't be fetched by path (Fastify `maxParamLength`; fixed in review, now 512); the clear-time
  chart is a dot plot, not a box plot (few runs per instance so far); Chart.tsx untouched — scatter/legend register
  from `pages/dungeons/echartsExtra.ts`.
  🔧 Review fixes for phases 3–5 — 2026-09-23 21:58 CDT (branch `integrate/admin-phases-3-5`, PR #19): `340bfa2`
  contracts int4 caps; `e52ea86` server (safe jsonb readers `routes/sqlJson.ts` for every uploaded-jsonb cast,
  shared `routes/shared.ts` helpers + `FOREVER_ID_THRESHOLDS`, text params 400 instead of truncating, indexed quest
  `last_seen`, `maxParamLength` 512 so long run ids / character keys route); `1794a95` admin (skill chart cycles its
  palette, drop-rate axis past 100%, one `formatMoney`).
- ✅ 5 ⚒️ Professions + 🏪 Vendors/trainers — 2026-09-23 21:41 — `57db63d` server, `379c434` pages (branch
  `feat/admin-professions-vendors`, not deployed). New `routes/adminProfessions.ts` (admin session only):
  professions overview (per base profession, child lines folded: characters rank/max + recipes known, recipes
  known/seen, crafts, harvests/nodes, trainers, recipe vendors), skill-history (one point per rise, oldest first,
  ≤ 2000 per profession), crafts (per recipe + build, procs), gathering-map (spots per mapId, each session's opens
  spread evenly over its spots, zone names from NPC locs), cost calculator (cheapest vendor gold price per item =
  price / stack; extended-cost and 0-gold listings ignored; unknowns listed; output value = sell price × average
  qty; profit only when complete), vendors / trainers lists (`search` name/tag/npc id with literal wildcards,
  `title`, `foreverOnly` = npc id ≥ `FOREVER_NPC_MIN` 200000, `limit`/`offset`, `titles`) and details (`?build=`,
  newest by default; cost items named from `items`). jsonb fields read by type (untrusted); `skillBase` exported
  from analysis.ts. Pages: profession cards, skill rank step lines, recipe browser with difficulty bands, recipe
  detail (sources + cost calculator), crafts, gathering scatter (y inverted, size = opens, color + shape per node
  type, "Other" past 7) + yield table; Vendors/Trainers tabs with tag chips, Forever-only, vendor costs
  "3× [Item] + 25 [Currency]", trainer partial-scan note. Tests: 20 server (real Postgres: session-v4/v5 +
  professions-v4 + a fold batch; authz 401/403/200, folding, cost math, Forever filter), 21 admin unit (money,
  costs, bands, scatter, skill series, labels); `pnpm check` green (624 vitest, 179 Lua). Deviations: extra routes
  crafts + gathering-map (no /v1 answer for crafts or spot points); Chart.tsx untouched (scatter/legend
  registered by the page); page CSS in `pages/professions/professions.css`; gathering defaults to all builds merged
  (build picker).
- ⬜ 6 🧪 Builds
- 🟡 7 🚀 Deploy — Phase 1 live 20:45 CDT 2026-09-23: nginx /admin/ + HSTS + no-query auth log, PM2 reloaded from ecosystem (BNET env), migration 0008 applied, pm2 saved. ✅ First admin login 20:47 CDT: user #1 JohnWilliker#1292 role=admin (pinned to account id)
- ✅ 🧾 Recipe details + vendor→item links — 2026-09-23 22:30 CDT — `81f3017` server, `2d06f2c` admin (branch
  `feat/admin-recipe-details`, not deployed). `GET /admin/api/professions/recipes/:recipeId` (`?build=`, newest by
  default): output item (quality, class, ilvl, req level, sell price, numeric stats, tooltip cleaned of
  `|c|r|H|h|T|t|A|a|K|k` codes, coin atlases → g/s/c, tabs kept as columns), reagents, requirements — skill rank to
  learn (same-named trainer service in the same profession first, else the recipe item's last own line naming the
  profession with a "(N)"), character level (recipe item's own "Requires Level N", else its req_level > 1, else a
  trainer level > 0), level to use the output (req_level > 1, else its tooltip), max trivial + observed bands — and
  sources (trainers, vendors of recipe items with costs, drops from mobs/objects, learned-via). Forever recipe items
  embed the output's tooltip ("\n<name>" … "Use: Teaches…"): that block is skipped, so the output's "Requires
  Level" is never read as a level to learn. Vendor listings gain `teaches`, trainer services `recipeId`, the item
  route `recipes.teaches` + makers' `profession`/`skillRank`. Pages: recipe detail card (Makes + tooltip, Learn at /
  Character level with source hints, band bar + gray-at, reagents, where to get it; `?recipe=` opens it), vendor
  items link to /items/:id with "teaches <recipe>", trainer services link to recipes, Item page Teaches / Made by
  (<profession> N). Live (1011 recipes): skill rank from trainer 31, from recipe item 121, unknown 859 (only 32
  trainer services and 121 name-matched recipe items so far); character level from any source 0; description from
  the output tooltip 897, from the recipe item 3. Tests: 17 server unit + 11 server integration, 7 admin unit + 1
  item tooltip; `pnpm check` green (746 vitest, 179 Lua).
- **`apps/admin`** — React 19 + TypeScript + Vite SPA (base `/admin/`), **Apache ECharts** (`echarts` +
  `echarts-for-react`) for charts, **TanStack Query** for data + polling, **TanStack Table** for sortable/filterable
  tables, React Router. Built to `apps/admin/dist`. Dark/light via CSS vars. Times rendered America/Chicago.
- **Server (`apps/server`)** gains:
  - `@fastify/cookie` + `@fastify/static` (serves `apps/admin/dist` at `/admin/`, SPA fallback to `index.html`).
  - **Battle.net login** (hand-rolled, ~100 lines, no PKCE): `GET /admin/auth/login` (random `state` in a signed
    httpOnly cookie → 302 to authorize with `scope=openid`), `GET /admin/auth/callback` (verify state, POST
    `/token` with Basic auth, GET `/userinfo`, upsert user, create session), `POST /admin/auth/logout`,
    `GET /admin/auth/me`.
  - **Tables (migration 0008, additive):** `users` (id, bnet_sub unique, battletag, role `admin|member`,
    created_at, last_login_at), `sessions` (id = random 32-byte hash, user_id, created_at, expires_at 7 d,
    user_agent, ip), `api_tokens.user_id` (nullable FK → users: token owner).
  - **Authorization:** a user is admin if `role = 'admin'`, or — bootstrap, only while no admin exists yet — their
    BattleTag is in `ADMIN_BATTLETAGS` (then `role` is saved and the `sub` pins them), or their account id is in
    `ADMIN_BNET_SUBS`. Once an admin exists, roles change only in the database. Non-admins get 403 for now (the
    panel shows "not authorized yet"). Session cookie `__Host-fl_session`: httpOnly, Secure, SameSite=Lax, Path=/,
    sliding expiry, 30 days absolute.
  - **Reads:** a new `requireReader` preHandler = bearer token **or** admin session, swapped into the existing
    `/v1/*` read routes, so the panel reuses them (no duplicate SQL). Session reads don't touch `last_used_at`.
  - **Admin API `/admin/api/*`** (session + CSRF header for writes; double-submit token from `/admin/auth/me`):
    overview metrics, uploads feed, characters (+ owner), tokens list/mint/revoke/assign-owner, diagnostics +
    ingest errors, api_samples viewer, build diff, level timeline — only what `/v1/*` doesn't already answer.
  - Env: `BNET_CLIENT_ID`, `BNET_CLIENT_SECRET`, `BNET_REDIRECT_URI`, `ADMIN_BATTLETAGS`, `COOKIE_SECRET` →
    `deploy/.env` + the `ecosystem.config.cjs` env list; `.env.example` documented.
- **Nginx:** add `location /admin/ { proxy_pass http://127.0.0.1:3410; … }` (same headers as `/v1/`).
- **Character ↔ person:** characters uploaded with a token owned by user U belong to U (via `raw_uploads`); the
  panel shows "My characters" and lets the admin assign token owners. Minting a token from the panel for a friend
  (with owner) replaces the CLI for day-to-day use.

## 📊 Pages and data points

| Page | What it shows (visualizations) | Source |
|---|---|---|
| **🏠 Overview** | KPI tiles (uploads today, records by kind, characters, builds, addon/tray versions in use, last upload); uploads per hour chart; **live feed** of recent uploads (auto-refresh 15 s) with record counts; health strip (ingest errors, diagnostics, fieldMisses) | new `/admin/api/overview`, `/admin/api/uploads` |
| **🧙 Characters** | cards per character (class/race/level, owner, last seen); **level-over-time line** per character from quest/turn-in levels; XP sources stacked area (quests vs mobs from runs) | `characters`, turn_ins, quest_observations |
| **📜 Quests** | searchable table (zone, level, XP offered/paid, reward choices + **pick popularity**), **XP vs level scatter**, offered≠paid highlight, **Forever-only badge** (new ids), quest detail (givers/enders on a zone plot, observations per build) | `/v1/quests/xp` + new detail route |
| **🎒 Loot** | drop rates per mob (bar chart, corpses count, avg copper), item search → **item page**: stats across builds (diff highlights), drop sources, node sources, vendor prices, recipes using it | `/v1/drops/rates`, `/v1/items/:id` |
| **🏰 Dungeons** | runs table; **clear-time distribution**; **boss split timeline**; XP/min mob vs quest; deaths; loot per run incl. boss loot winners (class) and loot method | `/v1/runs/summary` + runs |
| **⚒️ Professions** | skill rank over time per char (line); **recipe browser** with difficulty color bands (observed thresholds), reagents, output; **gathering map**: node spots scatter per zone, yield per harvest, min rank; crafts & procs; **cost calculator** (reagent vendor prices) | `/v1/professions/*` |
| **🏪 Vendors & trainers** | searchable, NPC subtitle tag, prices incl. extended costs; **Forever-only recipe vendors** view; trainer catalogs with cost/skill req | `/v1/professions/sources`, vendors/trainers |
| **🧪 Builds** | builds timeline; **what changed between builds**: item stat diffs, quest XP changes, recipe reagent changes | new `/admin/api/build-diff` |
| **🩺 Health** | diagnostics + ingest errors feed with filters; api_samples viewer (field names, fieldMisses/errors highlighted); addon releases & pins (read-only) | `/v1/diagnostics`, api_samples |
| **🔑 Access** | users, tokens (label, owner, last used, revoked), mint/revoke/assign owner | new admin routes |

"Forever-only" heuristic: quest id ≥ 90000, item id ≥ 200000, npc id ≥ 200000 (tunable constant, shown as a badge).

## 🗺️ Phases (one PR each; merge only when all checks are green)

1. **🔐 Auth + shell** — migration 0008 (users, sessions, tokens.user_id), cookie/static plugins, Battle.net login
   routes, `requireReader`, `/admin/auth/me`, env + ecosystem + nginx location, `apps/admin` scaffold (Vite, router,
   layout, login page, "not authorized"), `pnpm check` wiring (eslint browser globals for `apps/admin/src`, vitest
   project, build in `pnpm build`). Tests: login flow against a mocked Battle.net (fetch stub), state mismatch,
   non-admin 403, session expiry, logout, admin bootstrap by BattleTag then pinned by sub, reader works with bearer
   and with session, CSRF on writes.
2. **🏠 Overview + Health + Access** — overview/uploads/tokens/diagnostics admin routes + pages.
3. **📜 Quests + 🧙 Characters** — level timeline route, quest detail route, pages.
4. **🎒 Loot + 🏰 Dungeons** — pages on existing routes (+ run detail route).
5. **⚒️ Professions + 🏪 Vendors/trainers** — pages, gathering map, cost calculator.
6. **🧪 Builds** — build-diff route + page.
7. **🚀 Deploy** — you register the Battle.net client (redirect `https://ledger.willikers.dev/admin/auth/callback`),
   secrets into `deploy/.env`, nginx reload, PM2 restart; first login pins your account.

Phase 1 + 2 is a usable MVP; later phases can ship as they're done.

## ✅ Verification

- `pnpm check` (+ new admin unit tests: formatting, chart data mappers) and CI Linux + Windows green per PR.
- Server integration tests (real Postgres) for auth/session/authorization and every new admin route.
- Local run: `pnpm --filter @forever-ledger/admin dev` with a Vite proxy to the API; Playwright smoke (login stubbed
  via a test-only session seed) checking each page renders against the fixture data.
- Live: after deploy, log in with Battle.net → you land on Overview, your user shows `admin`, token #2 assigned to
  you so Jon/Sam/Jim/John appear under "My characters"; a second (non-admin) Battle.net account gets "not authorized".

## ⚠️ Notes

- Blizzard requires an **authenticator on your Battle.net developer account** to create API clients.
- No refresh tokens: sessions are ours (7 days, sliding); Battle.net's own SSO cookie makes re-login near-silent.
- Admin reads everything; later a member role could see only their own characters (owner filter already modeled).
