# 🎁 Forever Ledger — Container loot (what comes out of opened items)

> Owner: John-Willikers <harlanbmiltonjr@gmail.com> · 2026-09-24 (America/Chicago) · Branch `feat/container-loot` →
> PR → all checks green → merge. Addon **0.3.4**, schema **6**, tray **v0.1.5**, migration **0012**.

## ✅ Progress checks

Legend: ⬜ todo · 🟡 in progress · ✅ done · ⛔ blocked. Times America/Chicago.

- ✅ 0 📝 Plan written, branch `feat/container-loot` from master (c4acc13) — 01:29 CDT
- ✅ 1 🧩 Addon 0.3.4 (schema 6): container opens + contents, Lua harness tests, synthetic fixtures — 01:36 CDT
  (9c3cdd1; Lua harness 195 passed, +16: `test_containers.lua`, the session-v6 fixture, schema 5 → 6 migration;
  0.3.3 kept in `addon/tests/legacy` still writes session-v5 byte-identical)
- ✅ 2 📐 Contracts: schema 6 records `containerOpens` + `containerLoot`, normalize, keys, int4 caps — 01:43 CDT
  (e0acd7c, with the uploader and the server ingest half of phase 3; contracts 116 tests, uploader 153)
- ✅ 3 🗄️ Server: migration 0012, ingest upserts, admin item routes (contents / opened from) — 01:43 CDT
  (ingest in e0acd7c, `/admin/api/items/:id` `contents` + `openedFrom` in 5c8c646; named PKs `container_opens_pk` /
  `container_loot_pk`: generated names pass Postgres' 63-byte limit; both tables in `/v1/export`)
- ✅ 4 🖥️ Admin UI: item page "Contents" (for containers) and "Opened from" (for their loot) — 01:45 CDT (f9c5cd9;
  `pnpm check` green: Lua harness 195 passed, vitest 889 passed in 74 files, +16 over master's 873; admin builds)
- 🟡 5 🔍 Review + `pnpm check` + CI green → merge
  - ✅ 🔍 PR #27 review: 2 Important + 3 minors fixed — 02:05 CDT
    - ✅ I1 partly looted container counted twice — 01:56 CDT (0be560e; Lua harness 205 passed, +10): the addon keeps
      the last container window; a reopen of its leftovers (same GUID, else same known id; ≤ 15 min; nothing new in
      it) or a second LOOT_OPENED is the same open. Two full opens of one clam stack stay two opens.
    - ✅ I2 addon auto-update ignored schema compatibility — 02:02 CDT (414fc7c; vitest 901 passed, +12; 902 with the minors):
      `addon_releases.schema_version` in migration 0012 (regenerated, still one 0012), `publish` reads it from the
      zip's `ForeverLedger.lua` text, the manifest takes `?schema=` (default 5), the uploader/tray sends
      `MAX_SUPPORTED_SCHEMA`.
    - ✅ Minors — 02:05 CDT: `lastLock` used up per container and unlock events ignored (in 0be560e); admin "Came from"
      wording for opened and processed items; `contentsByBuild` tolerates a response without `contents`/`openedFrom`.
  - ⬜ CI green → merge
- ⬜ 6 🚀 Rollout: server deploy (backup first) → tag `v0.1.5` → **owner confirms the App card shows 0.1.5** → tag
  `addon-v0.3.4` → `addon-cli publish 0.3.4` → owner opens a Message in a Bottle (or any clam/lockbox) → verify
  (the schema gate now protects trays ≤ 0.1.4 automatically: they keep 0.3.3 even once 0.3.4 is live)

## 📌 Context

Sam fished up a **Message in a Bottle** (6307) and opened it: **Schematic: Small Seaforium Charge** (4409). The addon
recorded the schematic as a `drops` row with `npcId 0` ("unknown source"): `lootItem` only knows mobs (npc GUIDs),
gathering nodes and fishing. When loot comes from an opened item (`LOOT_OPENED(autoLoot, isFromItem)` with
`isFromItem = true`), the container is lost.

## 🧭 Approach

### 🧩 Addon (`addon/ForeverLedger`, 0.3.4, `SCHEMA_VERSION = 6`)
- `LOOT_OPENED` passes `isFromItem` through. When it is true (or a loot source GUID starts with `Item-`), the window is
  a **container open**:
  1. Container item id: `C_Item.GetItemIDByGUID(guid)` for an `Item-` source GUID (API present on Forever: probe dump);
  2. else the item of the last `ITEM_LOCK_CHANGED(bag, slot)` within 3 s (`C_Container.GetContainerItemID`);
  3. else `0` (unknown container) — still not a mob drop.
- Records, per SavedVariables session like drops/corpses: `db.containers[containerId][build] = { opened, copper }`
  and `db.containerLoot[itemId][build][containerId] = count` + `db.containerQty[...] = quantity`.
- Each open counts once, keyed per open (`open#n`), **not** by item GUID: a stack of clams shares one GUID, so a
  GUID key would drop the second open's loot.
- 🔍 One open can take several windows (review I1): with full bags the player takes some items and the container stays
  in the bags with the rest. The addon keeps the last container window (GUID or container id, open key, slots) and
  counts slots down on `LOOT_SLOT_CLEARED`. When `LOOT_CLOSED` leaves slots behind, the next container window within
  15 min from the same GUID (else the same known container id, via the item lock) holding only leftovers continues that
  open: no new open, nothing counted twice. A second `LOOT_OPENED` before `LOOT_CLOSED` is the same window. A full loot
  ends the open, so two full opens of one clam stack stay two opens. Limits: container 0 never merges; a client that
  never sends `LOOT_SLOT_CLEARED` counts every window as an open (old behaviour).
- 🔍 An item lock names one container only (used up), and an unlock (`C_Container.GetContainerItemInfo(...).isLocked`
  false, pcall-guarded) names nothing.
- ⚗️ Disenchanting, prospecting and milling open the same kind of window (`isFromItem`, an `Item-` GUID of the processed
  item), so their results land here too, keyed by the processed item (a disenchanted sword "contains" its dust). Kept
  on purpose: it's useful data; the admin wording covers both.
- Container loot never goes to `db.drops`/`db.corpses`, and never to run loot.
- Money slots of a container add to its `copper`.
- One `apiSamples` entry of `GetLootSourceInfo` for a container open (learns the GUID shape on Forever).
- Read-only observer as always: events + read APIs only, no protected calls, no hooks on item use.

### 📐 Contracts (`packages/contracts`, `SCHEMA_VERSION = 6`, supported 1–6)
- `ContainerOpen { build, containerId, session, opened, copper }`, key `containers.<id>.<build>`.
- `ContainerLoot { build, containerId, itemId, session, count, quantity }`, key `containerLoot.<item>.<build>.<id>`.
- Older schemas normalize to empty lists. int4 caps like the other counters.

### 🗄️ Server (`apps/server`)
- Migration **0012** (additive): `container_opens` (PK container_id, build, uploader_id, account, session) and
  `container_loot` (PK item_id, build, container_id, uploader_id, account, session); counters are **set** per session
  (idempotent upserts, like drops/corpses).
- Admin item detail gains `contents` (when the item was opened: opens, copper, each item with count, quantity, chance
  per open) and `openedFrom` (containers that yielded this item, with chance per open). Existing `npcId 0` drops stay.

### 🖥️ Admin UI (`apps/admin`)
- Item page: **🎁 Contents** table for containers (item links, chance per open, avg quantity, copper per open) and
  **Came from** for items that came out of an opened or processed item (links to that item's page). A server response
  without `contents` / `openedFrom` reads as empty.

### 🚦 Addon manifest schema gate (review I2)
- Trays auto-install the newest addon; a tray ≤ 0.1.4 (reads schemas ≤ 5) that installed 0.3.4 (schema 6) would refuse
  every SavedVariables file. Three live uploaders are on 0.1.4.
- `addon_releases.schema_version int` (nullable: null = published before the gate, schema ≤ 5), in migration 0012.
- `addon-cli publish` reads `local SCHEMA_VERSION = <int>` from the zip's `ForeverLedger/ForeverLedger.lua` as text
  (strict regex, exactly once, never executed) and refuses a release it can't read. `list` shows the schema.
- `GET /v1/addon/manifest?schema=<max the tray reads>` (missing/invalid → 5) serves the newest active release whose
  schema is null or ≤ that. A pin whose release needs a newer schema falls back to the newest release that fits (the
  newest pin is the current intent for the build; every fitting release is older than it). 404 `NO_ADDON_RELEASE`
  only when nothing fits.
- The uploader (and the tray, through it) sends `schema=` = `MAX_SUPPORTED_SCHEMA` (max of `SUPPORTED_SCHEMA_VERSIONS`).

## 🚀 Rollout order (the tray validates schemas too)

The schema gate (above) protects old trays automatically: once the server with it is deployed, trays ≤ 0.1.4 are served
0.3.3 even after 0.3.4 is published, and switch to 0.3.4 only after they update themselves to 0.1.5. Asking for the
App card version stays as a check that the tray update reached the owner, no longer the only guard.

1. Server deploy (accepts schema 6; pg_dump first; migration 0012 at startup).
2. Tray **v0.1.5** (bundles contracts with schema 6): bump `apps/desktop/package.json`, tag `v0.1.5`.
3. **Ask the owner for the App card version** — must read 0.1.5 before the addon ships.
4. Tag `addon-v0.3.4` → `node apps/server/dist/addon-cli.js publish 0.3.4`.
5. Owner opens a container → verify `container_opens` / `container_loot` rows and the item page.

## ✅ Verification
- Lua harness: isFromItem open with an `Item-` GUID; fallback via ITEM_LOCK_CHANGED; unknown container → 0; two opens
  of one stack both counted; container money; mob/fishing/node loot unchanged; nothing lands in `drops` for a container.
- Lua harness (review): partial loot + reopen = 1 open, no double items; full loot then the next clam of the stack = 2
  opens; double `LOOT_OPENED` = 1 open; lock route reopen; lock used up; unlock ignored.
- Contracts/uploader: schema 6 fixture round trip; schema 5 files still normalize; the schema regex (real addon and
  every legacy release); the manifest request sends `schema=`.
- Server (real Postgres, review): old tray gets the 0.3.3-class release, new tray the 0.3.4-class; pins; 404 only when
  nothing fits; publish records the schema, refuses an unreadable one.
- Server (real Postgres): ingest idempotent (re-upload sets, never doubles); item routes return contents/openedFrom.
- `pnpm check` + CI (Linux + Windows) green.

## ⚠️ Notes
- The bottle Sam already opened stays a `npcId 0` drop (no container recorded then).
- Item locks can come from moving items too; the 3 s window plus `isFromItem` keeps false matches rare, and a wrong
  guess is still better than "unknown" — the GUID route is preferred whenever the client gives it.
