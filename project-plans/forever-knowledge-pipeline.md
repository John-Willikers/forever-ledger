# 📚 Forever Ledger — Knowledge pipeline (sources, claims, fishing log, guides, MCP)

> Owner: John-Willikers <harlanbmiltonjr@gmail.com> · 2026-10-06 (America/Chicago)
> **Approved 2026-10-06 06:47 CDT.** Branch `feat/knowledge-pipeline` → PR → all checks green → merge.
> Schema 7 / addon 0.4.0 is shared with `forever-ledger-character-identity.md`.

## ✅ Progress checks

Legend: ⬜ todo · 🟡 in progress · ✅ done · ⛔ blocked. Times America/Chicago.

- 🟡 0 📝 Plan approved and written, branch `feat/knowledge-pipeline` from master (354ee78), identity plan tasks 7–8
  marked shared — 06:47 CDT
  - ✅ 0b 💾 Cruiser backup: `stream-recorder` pushed to private `John-Willikers/stream-recorder` (master, 2a6cc57) —
    checked 2026-10-06 20:56 CDT
- 🟡 1 🛰️ Cruiser fetch worker built: stream-recorder PR #1 (`feat/page-fetcher`), hand-run test fetches
  2026-10-06 21:15 CDT stored both Mobalytics maps through the lease API (sha256 contract confirmed).
  - ✅ 1a 🔎 Answers: Wowhead pages carry `WH.Gatherer.addData(` and `new Listview(` (with `dropped-by`, `fished-in`)
    with no tab clicks; Wowhead's Forever scheme is `/forever/<type>=<id>` (redirects to a slug)
  - ✅ 1b 🧩 Parsers checked against the real pages — 2026-10-06 22:35 CDT: Mobalytics keeps zone levels in the map sidebar, not
    a table (0 claims) → new `mobalytics@1` sidebar parser; `table@2` labels tables under a "WoW Classic" heading
    CLASSIC and marks raids; `reparse --replace` swaps an old parser's claims; `relabel` for curation
  - ✅ 1c 🎯 First real Wowhead page (item 7973, snapshot 3, 22:43 CDT): 112 claims, 46 comments. Its loot and
    fishing lists are Classic-era (comments from 2005, ~1M Azshara catches) → `wowhead@2` labels player-collected
    lists CLASSIC, drops `count: -1`, reads ISO comment dates — 22:45 CDT
  - ✅ 1d ▶️ Harlan merged stream-recorder PR #1 and enabled the fetcher; first lease 22:43 CDT
- ✅ 2 🗄️ Server: migration 0013, `fetch_targets`, `web_snapshots`, `sources`, `claims`, `web_comments`,
  `field_observations`, lease + snapshot routes, `can_fetch` scope — 07:06 CDT (cc7281c)
  - ✅ 2a 🧩 Parsers `wowhead@1` (embedded JSON, no eval) and `table@1` (zone/dungeon level tables) +
    `knowledge-cli reparse`. Written against hand-made fixtures in `fixtures/synthetic/web/`; recheck on the first real
    pages
  - ✅ 2b 🌱 Seed `knowledge/seed/2026-10-06-brief.json`: 16 sources, 41 claims + the Steamwheedle observation, 14 URLs
  - ✅ 2c 🖥️ Admin `/admin/knowledge` (claims, disputes, observations, sources, fetch queue + "queue page")
  - ✅ 2d 🔍 Code review: 0 Critical, 6 Important fixed (refused or crashing reports no longer loop; only the
    lease holder may report (409); fetch tokens are fetch-only; tier and version come from the final URL; the Wowhead
    parser handles JSON-style keys and the nearest `data` variable, and ignores markers inside strings and comments;
    challenge titles must match whole). Minors fixed: disputes are one row per claim, comments update, list limits,
    a manual claim must quote a fetched page, reparse survives a bad page.
  - ✅ 2e 🚀 PR #37 CI green → merged (62c9651) → deployed 07:20 CDT: backup `forever_ledger-2026-10-06-0719-pre0013.sql.gz`,
    migration 0013 applied, seed loaded (17 sources, 42 claims, 1 observation, 14 URLs queued), `/v1/fetch/lease` answers
    401 without a token
  - 📝 Changes from the plan: on-demand enqueue is `knowledge-cli enqueue-seen <template>` (no hook after ingest
    until the Forever URL scheme is confirmed); snapshots are JSON with base64 gzip, not a raw gzip body; seed claims
    stay on their seed sources, and re-checking them against fetched pages is a manual `knowledge-cli claim`.
- ⬜ 3 🎣 Fishing casts (schema 7 / addon 0.4.0) — 🔒 probe `/flprobe fish` in game first; ⛔ release waits on the
  identity plan's open questions
- ⬜ 4 🧾 Character guides (DB rows, admin render)
- ⬜ 5 🔌 MCP server `apps/mcp` (PM2 :3411, Nginx `/mcp`)

## 🧭 Context
A Google AI answer about farming Black Pearls was half wrong. It blended Classic data, a forum anecdote and invented
details, and Harlan lost 40 minutes testing it (0 clams in 40 min at Steamwheedle). Goal: a knowledge base where
**every fact carries its source, a tier, a confidence label and the build it applies to**. Guides and an MCP server
then answer only from that base, and say so when there's no data.

Decisions so far (2026-10-06):
- **Fetching happens on `cruiser`.** It's a headless home server that's always on and has the stream-recorder: a
  logged-in `profile-seed/`, a headed Chrome over CDP on Xvfb, a queue, a token API and an uploader with retries. Plain
  HTTP from there gets 403 from Wowhead and a Cloudflare challenge from Mobalytics, so a real browser is required. The
  VPS never runs a browser.
- **The MCP server is hosted on this VPS** (PM2 + Nginx).
- **Wowhead is fetched on demand.** That means ids the addon has already seen, plus URLs added by hand.
- **Fishing-cast logging is in scope and shares schema 7 / addon 0.4.0** with the character-identity GUID work.
- Guides default to DB rows that the admin panel renders.

## 🏗️ Architecture
```
cruiser (stream-recorder)                          VPS ns1009340 = ledger.willikers.dev
 fetcher.service ── POST /v1/fetch/lease ───────▶  fetch_targets (queue + leases)
   long-lived Chrome, slot 9, port 9309, :109      │
   dump_html + readiness + challenge detection     ▼
   ── POST /v1/fetch/snapshots (gzip) ──────────▶  web_snapshots (raw, never altered)
                                                   │  parsers (re-runnable)
WoW addon ─ tray ─ /v1/ingest (schema 7) ───────▶  claims ◀── sources (tier, game_version, build)
   + fishingCasts                                  fishing_casts, field_observations
                                                   │
                       admin /admin/knowledge ◀────┤
            Claude Code / Discord ── /mcp ─────────┘  forever-ledger-mcp (PM2 :3411)
```
Cruiser pulls work over HTTPS with a `flt_` token, so it needs no inbound port and no new tunnel.

## 🔁 Phase 0 — Plan and backup (no code)
- Copy this plan to `project-plans/forever-knowledge-pipeline.md` on a branch `feat/knowledge-pipeline` cut from `master`.
  The untracked character-identity plan on `fix/character-identity` stays as it is.
- Update `forever-ledger-character-identity.md` tasks 7–8 to read "schema 7 / addon 0.4.0, shared with fishing casts".
  That plan still has its 3 open questions and still needs approval before 0.4.0 can ship.
- **Cruiser backup first:** the stream-recorder has no git remote. Harlan creates a private GitHub repo and the
  cruiser session pushes to it before anything is changed there.

## 🛰️ Phase 1 — Cruiser fetch worker (done by Claude Code on cruiser; this plan carries the handoff prompt)
New `recorder/fetchpage.py` + `recorder/fetcher.py` + `systemd/stream-recorder-fetcher.service`, built on what's there:
- **Transport:** reuse `recorder/control.py`. Add `dump_html()` using `DOM.getDocument` + `DOM.getOuterHTML`. Turn on
  `Network.enable` and read the main document's `responseReceived` to get the HTTP status and the final URL.
- **Readiness:** wait for `document.readyState === 'complete'`, then 1.5 s with no network activity, then an optional
  per-site selector, all under a 45 s timeout.
- **Challenges:** detect Cloudflare/CloudFront interstitials by page title or markers (`cf-mitigated`, "Just a
  moment"). Wait up to 30 s once. If the page is still a challenge, report `needs_human`. **Never store a challenge
  page as content.**
- **One long-lived Chrome** for fetching, on its own slot/port/display (slot 9, port 9309, Xvfb :109). It's above
  `MAX_CONCURRENT=4`, so it can't hijack a recording, and it stays out of the recording disk gate. Its profile is
  rsynced from `profile-seed/` once per day, not once per fetch.
- **Per-site modules** in `recorder/platforms/` (`wowhead.py`, `mobalytics.py`) handle consent banners and site
  selectors.
- **Pull loop:**
  1. Lease up to 3 URLs.
  2. Fetch them one at a time, **60–120 s apart with jitter, at most 200 pages a day**, and pause 2–8 AM CDT.
  3. After a 403, 429 or `needs_human`, back off exponentially. After 3 of them in a row, stop and send an ntfy alert.
  4. POST the gzipped HTML plus metadata (requested URL, final URL, status, ISO time with timezone, sha256, fetcher
     version).
  5. Keep a local spool with retries and a dead-letter folder, modeled on `uploader.py`.

## 🗄️ Phase 2 — Server: queue, snapshots, sources, claims (this repo)
Migrations use the next free number (identity may claim 0013). Drizzle goes in `apps/server/src/db/schema.ts`, and
upserts reuse `upsert()` from `apps/server/src/ingest.ts:46-92`.
- **`fetch_targets`** is the queue: url (normalized, PK), site, entity_type/entity_id (nullable), priority, state,
  lease_until, attempts, last_status, next_due_at, added_by. It's filled three ways:
  - **On demand:** after each ingest, Forever ids above `FOREVER_ID_THRESHOLDS` (`routes/shared.ts:9`) that don't have
    a target yet.
  - **By hand:** `knowledge-cli add <url>`, and an admin form.
  - **Seed:** the 14 URLs from the brief.
- **Routes:** `POST /v1/fetch/lease` and `POST /v1/fetch/snapshots` need a new `api_tokens.can_fetch` scope. Snapshots
  accept a gzip body (`fflate` is already a dependency), and the Nginx 6 MB limit already fits.
- **`web_snapshots`** [url, sha256]: final_url, status, fetched_at (timestamptz), bytes, `html_gz bytea`, fetcher.
  These rows are **raw and never modified**.
- **`sources`** gets one row per snapshot or first-party origin: url, site, **tier 1–7** (the brief's ranking),
  `game_version` (forever/classic/unknown), build if the page states one, page_updated_at, snapshot_id.
- **`claims`** is append-only. Its natural key is source_id + entity + attribute + value hash, plus:
  - entity_type/entity_id (bare game ids, joined to `items`, `drops`, `quest_observations`), attribute, `value jsonb`
  - `label` (VERIFIED/CLASSIC/ANECDOTE/UNVERIFIED/FALSE), `observed_build`, `quote` (the passage it rests on),
    parser_version
  - A new build **adds** rows and never overwrites old ones.
  - "Disputed" is a view: claims where a higher-tier source on the same build says something else.
- **`web_comments`**: Wowhead comments, low trust, with posted_at and rating, kept out of claims unless promoted (tier 6).
- **`field_observations`**: first-party sessions like Steamwheedle (character, build, location, duration, method,
  setup jsonb, result jsonb, notes). Each one also gets a tier 1 `sources` row.
- **Parsers** go in `apps/server/src/knowledge/parsers/`.
  - **Wowhead:** pull the embedded `WH.Gatherer.addData(...)` and `new Listview({...})` data out as JSON text and
    `JSON.parse` it. **No eval**, which follows the same spirit as the SV parser rule. This yields item names,
    dropped-by/contained-in/fished-in lists and quest data.
  - **Mobalytics and guides:** use `node-html-parser` to get headings, tables and passages. Table rows (zone level
    ranges) become claims automatically. Prose claims are added with `knowledge-cli claim add`, or with an MCP write
    tool during a Claude session, and **must include a quote** from a stored snapshot.
  - `knowledge-cli reparse [--site]` re-runs every parser from the raw snapshots.
- **Seed import:** `knowledge/seed/2026-10-06-brief.json` holds the brief's section 3 claims with their labels and
  original URLs, plus section 4 as a `field_observations` row. When their pages are fetched, the claims get re-pointed
  at real snapshots.
- **Admin page `/admin/knowledge`:** queue status (including needs-human), sources, claims with label and tier badges,
  disputes, observations. Page CSS stays in its lazy chunk (per memory).

## 🎣 Phase 3 — Addon fishing casts (schema 7 / addon 0.4.0, shared with identity)
Builds on the existing gather block in `addon/ForeverLedger/ForeverLedger.lua` (1255-1427):
`FISHING_LINE=356`, `GATHER_SPELLS[7620]`, `isFishingLoot()`, `onGatherSent`, `skillRank()`, `where()` (103-117).
- **Probe first** (ForeverLedgerProbe, `/flprobe fish`): check during a real cast what `GetWeaponEnchantInfo()` returns
  with a lure on, what `UNIT_SPELLCAST_CHANNEL_START/STOP` sends for 7620, the GUID that `GetLootSourceInfo` reports,
  and whether a pool can be identified (bobber GUID vs pool object, mouseover tooltip "School of …"). Record the
  answers in the CLAUDE.md table.
- **New `db.fishingCasts[#+1]`:**
  - `{build, char, guid, time, mapID, zone, subzone, x, y, skill, skillMax, modifier, lure={enchantID, expiresIn} | nil, pool=name | nil, outcome, loot={{itemID, qty}}, money}`
  - `outcome` is `loot`, `escaped` or `interrupted`. The record opens when the channel starts and closes on
    `LOOT_OPENED`, on channel stop, or after 25 s.
  - `pool=nil` means unknown, never "open water", unless the probe proves we can tell them apart.
  - Trimmed with `HISTORY_CAP`, and added to `PROFESSION_TABLES` so `/fl reset` wipes it too.
- **Tests:** a new `addon/tests/test_fishing.lua`, stubs for `GetWeaponEnchantInfo` and the channel events in
  `harness.lua`, freeze 0.3.4 into `tests/legacy/`, and a new `fixtures/synthetic/session-v7.lua`.
- **Contracts:** `FishingCast` in `schemas.ts`, normalize, keys, int4 caps, and `SCHEMA_VERSION=7`. The **server**
  gets a `fishing_casts` table keyed on uploader, account, char, cast time and seq, and its ingest upsert. The
  **uploader** gets batches. This follows the file checklist from the schema-6 bump (commits 9c3cdd1, e0acd7c).
- **Admin:** yield by zone, subzone, skill, lure and pool, with Chicago times.
- **Release:** addon 0.4.0 bundled with the identity GUID, then a new tray version (the manifest schema gate keeps
  old trays on 0.3.4).

## 🧾 Phase 4 — Character guides (DB rows)
- **`guides` table** [race, class, faction, bracket, build]: generated_at, sections jsonb. Each recommendation in it
  carries `claim_ids` and `observation_ids`.
- **Generator** (`knowledge-cli guides generate`): deterministic v1 sections pulled from the DB, with no LLM prose:
  - zones for each level bracket
  - first-party quests and XP by level
  - dungeons by level
  - gear `itemFit` (an estimate, per memory)
  - profession notes from claims and fishing casts
- **Labels:** CLASSIC claims are flagged inline, disputed ones are shown as disputed, FALSE ones are dropped.
- **Regenerating:** when a new build shows up in `builds`, or when new first-party data lands (`knowledge-cli guides
  regen`).
- Rendered on `/admin/knowledge/guides`.

## 🔌 Phase 5 — MCP server (`apps/mcp`)
- **Stack:** `@modelcontextprotocol/sdk` over Streamable HTTP (check the current API with context7 before coding). It
  reads the same Postgres through the server's Drizzle schema as a workspace dependency.
- **Deploy:** PM2 app `forever-ledger-mcp` on `127.0.0.1:3411`, added to `deploy/ecosystem.config.cjs`. Nginx gets a
  `location /mcp` with `proxy_buffering off` and a longer read timeout. Auth uses read-scope `flt_` bearer tokens, and
  writes need a new `can_observe` scope. It's added to Claude Code at user scope.
- **Tools:** `lookup_item`, `lookup_quest`, `lookup_npc`, `lookup_zone`, `where_to_get(item)` (first-party
  drops/node/container/fishing rates first, then claims ranked by tier), `character_advice(...)` (from `guides`),
  `check_claim(text, entity?)` (matching claims plus disputes), `log_observation(...)`, `add_claim(...)` (quote
  required).
- **Answer contract:** every result is `{facts:[{value, label, tier, source:{site,url}, build, observed_at}], gaps:[…]}`.
  When nothing is found, it returns `gaps` explicitly and never answers from model memory.
- **`route()` is deferred.** There's no flight-path or travel data yet, so for now it returns the travel claims plus a
  gap.

## ⚠️ Risks and unknowns
- **Your account and home IP are easy to single out.** One home IP plus one logged-in profile is a sharper identifier
  than a datacenter bot. The defenses are slow pacing, a daily cap, quiet hours and stopping on challenges. If a block
  happens anyway, it lands on Harlan's account.
- **Site terms:** Wowhead and Mobalytics restrict automated collection. Keep it personal-scale, cache everything, and
  don't republish raw content, including through a Discord-facing MCP. That's Harlan's call to make deliberately.
- **Unknowns:**
  - What Wowhead's Forever URL scheme is and whether its pages embed the same `Listview` data. The first fetches answer
    this.
  - Whether a fishing pool and a lure can be told apart on build 70xxx (the probe answers this).
  - The beta level cap in the brief is 30, while CLAUDE.md says 20; confirm which build that's on.
- **Profile coupling:** if the seed profile's session expires, recording and fetching break together. `scripts/login.sh`
  is the fix.
- **Schema 7 coupling:** fishing can't ship until the identity plan's open questions are answered.

## ✅ Verification
- `pnpm check` passes on every branch: eslint, prettier, luacheck, typecheck, the Lua harness and vitest.
- **Server tests** use the testcontainers Postgres:
  - lease and expiry
  - snapshot dedupe by sha256
  - challenge pages rejected
  - parser golden tests against saved Wowhead and Mobalytics HTML in `fixtures/real/web/`
  - claims append-only across builds
  - the disputes view
  - the fishing_casts ingest from session-v7
- **Lua harness:** cast → loot, cast → escaped, a lure present, a 0.3.4 legacy fixture that stays byte-identical, and
  the 6 → 7 migration.
- **End to end:**
  1. Cruiser fetches the Mobalytics zone map; it appears in `/admin/knowledge` and its zone claims are labeled VERIFIED.
  2. Big-mouth Clam on Wowhead produces a CLASSIC or Forever claim.
  3. MCP `where_to_get("Black Pearl")` returns the 0-clam Steamwheedle observation first, then the labeled claims.
  4. `check_claim("craft a Fishing Hut at 225")` shows the dispute.
- After 0.4.0: a real 15-minute Revantusk fishing session shows up as per-cast rows.

## 🌿 Branches → PR → merge to master
1. `feat/knowledge-pipeline`: the plan, server tables, routes, parsers, seed, admin.
2. On cruiser, a separate repo: the fetch worker.
3. `feat/fishing-casts`, merged together with the identity schema 7 work.
4. `feat/knowledge-guides`.
5. `feat/mcp-server`.

Each one: review → `pnpm check` → CI green → PR → merge → deploy with `pnpm build && pm2 reload && pm2 save`.

## 📎 Handoff prompt for cruiser (used in Phase 1)
> On cruiser in `/home/john/stream-recorder`: first add the private GitHub remote I give you and push `master`. Then,
> on a branch, build `recorder/fetchpage.py` and `recorder/fetcher.py` plus a systemd `--user` unit, following the
> Phase 1 spec I paste: dedicated slot 9 / port 9309 / Xvfb :109, `control.py` transport, `dump_html` through
> `DOM.getOuterHTML`, readiness and challenge detection, the lease and POST loop against `https://ledger.willikers.dev`
> with a `can_fetch` token, pacing caps, a spool with retries and dead-lettering, and ntfy on stop. Don't touch the
> recording pool, its slots or its disk gate. Test it with one Mobalytics page and one Wowhead page, then open a PR.
