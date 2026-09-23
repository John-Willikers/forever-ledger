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

- Alpha: commit straight to `master`. Branch → PR → merge starts at launch.
- Git identity (personal project): `John-Willikers <harlanbmiltonjr@gmail.com>`.
- Times shown to humans (logs, CSV, API text) are America/Chicago. Stored as `timestamptz` / epoch seconds.
- `pnpm check` must pass before commit (eslint + prettier + luacheck + typecheck + Lua harness + vitest).

## Layout

- `addon/ForeverLedger` — the addon; `addon/ForeverLedgerProbe` — client API/event probe; `addon/tests` — Lua 5.1
  harness with WoW stubs (generates `fixtures/synthetic`).
- `packages/lua-sv-parser`, `packages/contracts`, `apps/uploader`, `apps/server`, `deploy/`.
- Workspace packages export `src/*.ts` under the `development` condition and `dist/` otherwise; build with `pnpm build`.

## Deploy (this VPS)

- Postgres: `deploy/docker-compose.yml` on `127.0.0.1:5440`.
- API: PM2 app `forever-ledger-api` on `127.0.0.1:3410`, Nginx site `ledger.willikers.dev` (certbot TLS).

## Open questions about the Forever client

Tracked in the project plan; answer them from `ForeverLedgerProbe` dumps and record the answers here.
