# 🎯 Forever Ledger — Item spec fit (who really wants an item)

> Owner: John-Willikers <harlanbmiltonjr@gmail.com> · 2026-09-25 (America/Chicago) · Branch `feat/probe-specs` →
> PR → merge → owner runs the probe in game → gate → branch `feat/item-specs` (addon **0.4.0**, schema **7**,
> tray **v0.1.6**, migration **0013**).

## ✅ Progress checks

Legend: ⬜ todo · 🟡 in progress · ✅ done · ⛔ blocked. Times America/Chicago.

- ✅ 0 📝 Analysis of the current score against the live DB, plan written, branch `feat/probe-specs` from master
  (0d9787e) — 2026-09-25
- ✅ 1 🔬 Probe 0.3.0: `/flprobe specs` (spec catalog per class, `C_Item.GetItemSpecInfo` /
  `DoesItemContainSpec` / `IsEquippableItem` for bag + equipped items), harness `world.specAPI` stubs, 5 Lua tests
  (harness 210 passed, +5), uploader `probe-dump` specs summary (2 vitest, 904 passed total), CLAUDE.md
  open-question rows — 00:00 CDT
- ✅ 1b 🔍 PR #30 review + CI green → merged (080bad8) — 00:30 CDT
  - ✅ 🔍 Review: 8 findings, 7 fixed — 00:20 CDT (Lua harness 212 passed, +2; uploader probe tests 7): a nil or
    non-table `GetItemSpecInfo` answer is counted as `specInfoOther` instead of aborting the run or passing as "with
    spec info"; `contains` stores hits only (+ `askedSpecs`) so a 200-item run doesn't write thousands of `false`
    rows; class ids come from `GetAllClassIDs` as well as 1..13; the summary reads 1..n `contains` keys, shows
    `equippable ?` when the API is missing, and prints the non-table count. Skipped: the pre-existing `{ ...arr }`
    build-key convention in untouched io/dumps code (keys there are build numbers, never lists).
  - ✅ CI green on the first push — 00:12 CDT
- ✅ 2 🎮 Owner ran `/flprobe specs` on build **70009** (00:20 CDT); `probe-dump` → `fixtures/real/probe-70009-specs.json`;
  CLAUDE.md rows answered; **gate: branch D** (see below) — 00:25 CDT
- ⛔ 3 🧩 Addon 0.4.0 (schema 7) — **not needed**: the client has nothing worth capturing (gate D)
- ⛔ 4 📐 Contracts schema 7 / 🗄️ migration 0013 — **not needed** (gate D)
- ✅ 5 🧮 Query-time fit on branch `feat/item-fit`: `itemFit()` / `rolesFromStats()` / `classFits()` replace
  `specsWanting` (`RULES_VERSION 2026-09-25.1`): primary stats by share (Stamina neutral), secondary stats by
  presence, weapon subtype / shield signals, reqLevel 0 → level 1, relics → one class, `fromLevel` for later
  proficiency; `/v1/items/:id` returns `{ rulesVersion, atLevel, roles, classes }` (13 contracts tests) — 00:40 CDT
- ✅ 6 🖥️ Admin "Who wants it": role rows with a confidence bar, class chips with "best armor" / "at 40" /
  "later", an "estimated" note (admin `roleLabel` / `classNote` tests) — 00:45 CDT
- ⬜ 7 🔍 `pnpm check` → PR → review → CI → merge
- ⬜ 8 🚀 Rollout: server deploy only (no migration, no addon or tray release)

## 📌 Context

The item page's "Who wants it" card scores every class/spec 0–100%. Checked against the live Postgres on 2026-09-25
the number is close to meaningless:

| # | Problem | Evidence |
|---|---------|----------|
| 1 | Only STR/AGI/INT/SPI/STA are read; the client reports 43 stat keys (spell power, healing, AP, crit, hit, defense, DPS…). | `ITEM_MOD_SPELL_POWER_SHORT` on 315 snapshots, `SPELL_HEALING_DONE` 129, `DEFENSE_SKILL_RATING` 46 |
| 2 | 29% of equippable snapshots have no primary stat → every fit scores 0, sorted by declaration order. | 471 of 1626; every DPS-only weapon shows "Warrior/Arms 0%" first |
| 3 | Stamina counts as wanted by every spec and Cloth is wearable by all, so tanks win every STA piece. | Hillman's Cloak (+4 STA, +5 SP) → Demonology 100%, Prot Warrior 100% |
| 4 | Healers vs damage casters are indistinguishable. | Truefaith Gloves (+15 healing) → Shadow = Holy = Fire Mage |
| 5 | Specs in a class mostly share one stat list, so "which spec" is really "which class". | Arms = Fury, all Rogue, Disc = Holy = Shadow |
| 6 | reqLevel 0 → nobody can wear Mail/Leather/Plate (`?? 20` keeps 0; armor lookup falls back to Cloth). | 1174 snapshots with `req_level = 0` |
| 7 | Relics (Idols/Librams/Totems) → 0 fits. | 24 items |
| 8 | Rules table is Classic guesswork (header says Interface 11507; Forever is 16001). | `classRules.ts` |

The Forever client (probe dump, build 69913) exposes the real answer: `C_Item.GetItemSpecInfo(item) → specIDs`,
`C_Item.DoesItemContainSpec(item, classID, specID)` (any class, not just the player's), `C_Item.IsEquippableItem`,
`C_SpecializationInfo.GetNumSpecializationsForClassID` / `GetSpecializationInfo(…, classID)` (role + `primaryStat`),
global `GetSpecializationInfoForClassID`. None of it is captured today.

## 🧭 Approach

### 🔬 Phase 1 — Probe (`/flprobe specs`, read-only)
- Writes `ForeverLedgerProbeDB.specs[build]` (a sibling of `dumps`, so a later `/flprobe` never erases it):
  `player` (class, level, own specs with `primaryStat`), `catalog[classID]` (class info, spec count, each spec via
  both `GetSpecializationInfoForClassID` and `C_SpecializationInfo.GetSpecializationInfo(…, classID)`),
  `items[]` for bags 0–4 and equipped slots 1–19 (`specInfo`, `contains[specID]` from `DoesItemContainSpec` over
  the catalog, `equippable`, `classSpecific`, `statKeys`), `api` (which functions exist) and `counts`.
- Every call is pcall-guarded; missing functions are recorded as `{ missing = true }`, errors as `{ ok = false, err }`.
- Uploader `probe-dump` summarises it (classes, specs, items with non-empty spec tables, `DoesItemContainSpec` hits).

### 🚦 Phase 2 — Gate (decided from the real dump)

| Probe result | Branch |
|---|---|
| A. `DoesItemContainSpec` true for other classes' specs, or `GetItemSpecInfo` cross-class | Phases 3–7 in full; capture via `DoesItemContainSpec` over the catalog, `GetItemSpecInfo` as fallback |
| B. Works only for the player's class | Phases 3–7; per-character partial `specs`, server upsert unions arrays across uploads |
| C. Always-empty tables | Capture the catalog only; card always "estimated" |
| D. nil / error / missing | No schema bump; heuristic repair only (Phases 5–7) |

### 🧩 Phases 3–7 — Ground truth (after the gate)
- Addon 0.4.0 (schema 7): `db.specs[build].catalog[specID] = { classID, class, name, role, primaryStat }` at login;
  `byBuild[build].specs = { specID, … }` for equippable items (nil when unavailable, never overwritten with nil).
- Contracts: `ItemBuildSnapshot.specs?: number[]`, `SpecCatalogEntry` records keyed `spec:<id>:<build>`.
- Server: migration 0013, `specs = coalesce(excluded.specs, item_snapshots.specs)`, `spec_catalog` in export.
- Query time: `itemFit()` → `{ source: 'client' | 'heuristic', roles: [{ role, confidence, specs? }], classes: [{ cls,
  canEquip, fromLevel?, bestArmor }] }`. Heuristic repair: secondary stats map to roles, Stamina is neutral, weapon
  subtype gives a type signal, reqLevel 0 evaluates at level 1, relics force Druid / Paladin / Shaman.
- Admin: role rows with a confidence bar and a "from client (build N)" / "estimated from stats" line, then class chips.

## 🎮 In-game step for the owner (Phase 2)

1. Install probe 0.3.0 (`addon/ForeverLedgerProbe`), log in on a character with cross-class items in the bags
   (a Mail piece on a caster, a caster weapon on a Warrior helps).
2. `/flprobe specs`, then `/reload`.
3. Send `WTF/Account/<ACCOUNT>/SavedVariables/ForeverLedgerProbe.lua`; on the VPS:
   `node --conditions=development --import tsx apps/uploader/src/cli.ts probe-dump <file> fixtures/real/api-<build>.json`.

## 📓 Gate decision — **D: the client does not know** (build 70009, 2026-09-25 00:20 CDT)

From `fixtures/real/probe-70009-specs.json` (46 bag/equipped items, 18 equippable, Warrior level 13):

- `C_Item.GetItemSpecInfo` → nil for 42 items, `{}` for 4. Never a spec id.
- `C_Item.DoesItemContainSpec` → **true for all 9 class specs on all 18 equippable items**, mail chest and
  two-handed axes included. It carries no information.
- Spec catalog: one placeholder spec per class (ids 1482–1491, named after the class, role `DAMAGER`, `primaryStat`
  4 for everyone). No role or primary-stat signal.
- `C_Item.IsItemSpecificToPlayerClass` → false everywhere; `IsEquippableItem` works and is the one useful call.

So there is no schema bump and nothing for the addon to capture. Phases 5–7 repair the estimate at query time and
say so on the card.
