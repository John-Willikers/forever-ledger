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
- 🟡 2 🏠 Overview + Health + Access
- ⬜ 3 📜 Quests + 🧙 Characters
- ⬜ 4 🎒 Loot + 🏰 Dungeons
- ⬜ 5 ⚒️ Professions + 🏪 Vendors/trainers
- ⬜ 6 🧪 Builds
- 🟡 7 🚀 Deploy — Phase 1 live 20:45 CDT 2026-09-23: nginx /admin/ + HSTS + no-query auth log, PM2 reloaded from ecosystem (BNET env), migration 0008 applied, pm2 saved. ✅ First admin login 20:47 CDT: user #1 JohnWilliker#1292 role=admin (pinned to account id)
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
