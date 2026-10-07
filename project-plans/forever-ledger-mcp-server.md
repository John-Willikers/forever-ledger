# 🔌 Forever Ledger — MCP server (knowledge pipeline phase 5)

> Owner: John-Willikers <harlanbmiltonjr@gmail.com> · 2026-10-07 03:15 CDT (America/Chicago)
> Parent plan: `forever-knowledge-pipeline.md` phase 5. Branch `feat/mcp-server` → PR → merge to `master`.

## 🧭 Why

Claude Code and the group's Discord helper should answer WoW: Forever questions **only from the ledger**: every fact
with its label (VERIFIED / CLASSIC / ANECDOTE / UNVERIFIED), its source tier and URL and the build it applies to, and an
explicit "no data" when the ledger doesn't know. No answers from model memory dressed up as facts (the Black Pearl
lesson).

## 🏗️ Shape

```
Claude Code / Discord bot ── HTTPS /mcp (Bearer flt_ read token) ──▶ nginx ledger.willikers.dev
                                                                     │ location /mcp (no buffering)
                                                                     ▼
                                          PM2 forever-ledger-mcp 127.0.0.1:3411 (apps/mcp)
                                            @modelcontextprotocol/server v2 (stateless HTTP, zod 4)
                                            auth: verifyBearerToken → canRead; writes: admin-owned token
                                                                     │ imports @forever-ledger/server
                                                                     ▼
                                          apps/server/src/knowledge/answers.ts → Postgres :5440
```

- **Answers live in the server package** (`knowledge/answers.ts`, pure `db → {facts, gaps}` functions) so they are tested
  against the real Postgres harness; `apps/mcp` is a thin layer (auth, tool schemas, formatting).
- **Answer contract** for every tool:
  `{ query, entity, firstParty: {…}, facts: [{ claimId, entity, attribute, value, label, tier, source: {kind, site, url, title}, build, gameVersion, quote }], gaps: [string] }`.
  First-party data (our own uploads: drops, nodes, fishing casts, quests seen) comes first; then claims by tier.
  **FALSE claims are never returned as facts** (only `check_claim` lists them, as refuted).
- **No republishing of pages:** tools return structured facts, a URL and at most a short quote (≤ 240 chars); never
  page HTML or comment bodies (comments are counted, not quoted).

## 🧰 Tools (v1)

| Tool | Answers from |
| --- | --- |
| `search` (name → ids) | `items`, `quests`, claims `name`, vendors/trainers/quest NPC names, zone names |
| `lookup_item` | item row + snapshots, first-party drop/node/container/fishing/quest sources, claims for the item |
| `lookup_quest` | `quests` + observations (giver, location, rewards, XP seen), claims (`level`, `req_level`, `xp_reward`, …) |
| `lookup_npc` | vendors/trainers/quest NPC rows, `drops` by that NPC, claims (`level_range`, `zones`, `drops`, `sells`) |
| `lookup_zone` | zone level-range claims, fishing yield in the zone, first-party nodes seen there |
| `where_to_get(item)` | first-party rates first (drops per kill, node/container/fishing yields), then claims ranked by tier |
| `fishing_yield` | `fishingYield` / `whereCaught` (zone, subzone, skill, lure filters) |
| `check_claim(text, entity?)` | matching claims incl. FALSE ones, plus `findDisputes` |
| `log_observation` ✍️ | `importSeed`-style tier-1 `field_observations` row (admin-owned token only) |
| `add_claim` ✍️ | `addManualClaim` (quote must be on a fetched page; admin-owned token only) |

Deferred: `character_advice` (needs phase 4 guides), `route` (no travel data yet: returns a gap).

## 🔐 Auth

- `Authorization: Bearer flt_…` with **read scope** (`tokens-cli mint --read`); fetch tokens and upload-only tokens get
  403, no/invalid token 401. Write tools (✍️) are only listed and callable when the token's owner is an **admin** user
  (no new scope, no migration).
- Rate limit per token; request bodies capped; Host/Origin checked (`ledger.willikers.dev`, localhost).

## ✅ Progress checks

Legend: ⬜ todo · 🟡 in progress · ✅ done · ⛔ blocked. Times America/Chicago.

- ✅ 0 📝 Plan written; SDK checked with context7 (`@modelcontextprotocol/server` 2.3.1 + `/node`, zod 4) — 03:15 CDT
- ✅ 1 🧠 `knowledge/answers.ts` (search, item, where-to-get, quest, NPC, zone, fishing, check-claim) exported from
  `@forever-ledger/server`; at most 12 facts per attribute, 120 per answer; 6 tests on real Postgres; checked read-only
  against production (Big-mouth Clam → the 0-clam Steamwheedle observation first) — 03:16 CDT
- ✅ 2 🔌 `apps/mcp`: stateless HTTP (`createMcpHandler`, JSON responses), bearer check in front (read token, not a
  fetch token; write tools only for an admin-owned token), host check, no browser origins, 120 calls/min per token,
  256 KB bodies; 4 end-to-end tests with the real MCP client; `pnpm check` 1055 tests — 03:21 CDT
- ✅ 2a 🔍 Review (0 Critical left after fixes): a claim's value no longer names an id-only entity (it had named item
  7973 "Muckshell Pincer" and lost the 0-clam observations); FALSE claims bypass the caps in `check_claim`; database
  errors are logged, never sent (ints capped at int4); observation keys can't collide; failed token checks limited per
  address; `pipeline` for responses; bad URLs are a claim error. Live recheck: 7973 and "Big-mouth Clam" both answer
  the Steamwheedle observation first — 03:28 CDT
- ✅ 3 🚀 (03:34 CDT) Deploy: PM2 `forever-ledger-mcp` :3411 in `deploy/ecosystem.config.cjs`, nginx `location /mcp`, read token
  minted for Harlan (token 10, admin-owned: write tools on), `claude mcp add --scope user` here → ✔ Connected;
  live call over HTTPS: where_to_get(Big-mouth Clam) → both 0-clam observations first, check_claim(Fishing Hut at
  225) → refuted
- ✅ 4 🔍 Review → PR #56 → merged → deployed; try it: "where do I get Black Pearls?" answers the 0-clam Steamwheedle observation first
- ✅ 5 🤖 Discord helper → `forever-ledger-discord-bot.md`: live in Ninjas With Attitude 2026-10-07 04:01 CDT (own
  tokens: read-only for everyone, admin-owned for Warchief / War Council)

## ⚠️ Risks

- **Wowhead terms:** a Discord-facing tool must not republish their pages: facts + links + short quotes only.
- **Thin Forever data:** most claims are CLASSIC until more pages and first-party uploads land; the answers say so
  through labels and `gaps` rather than hiding it.
