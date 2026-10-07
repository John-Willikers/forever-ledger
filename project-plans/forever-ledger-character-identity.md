# 🪪 Forever Ledger — Character identity: merge the duplicates, stop new ones

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
>
> Owner: John-Willikers <harlanbmiltonjr@gmail.com> · **Draft 2026-09-25 18:52 CDT, awaiting approval** · Branch
> `fix/character-identity` → PR → green → merge to `master`.

**Goal:** One character = one row, even when the Forever client changes what `UnitName("player")` returns. Merge the
three duplicate pairs already in Postgres, and make the next rename collapse on its own.

**Architecture:** A server-side alias table maps any old character key onto a canonical one; ingest canonicalizes every
`char` field through it before storing (acks still use the uploader's original keys). A merge CLI re-points existing
rows. The addon starts reporting the player GUID (schema 7) so the server can create the alias automatically when a
known GUID shows up under a new name.

---

## 📊 Progress

| # | Task | Status |
| --- | --- | --- |
| 0 | Root-cause investigation | ✅ Done 2026-09-25 18:50 CDT |
| 1 | `character_aliases` table + migration `0013` | ⬜ |
| 2 | Ingest canonicalizes `char` / `characters.key` through aliases | ⬜ |
| 3 | `characters-cli suggest` / `merge` (transactional, conflict-safe) | ⬜ |
| 4 | Merge Sam, Vic, Jon on the VPS (backup first) | ⬜ |
| 5 | Admin: old character URLs resolve through aliases; "aka" names on the Character page | ⬜ |
| 6 | 🔒 Gate: `UnitGUID("player")` on build 70009 returns `Player-…` (owner checks in game) | ⬜ |
| 7 | Addon + contracts schema 7: `guid` on the character record; server auto-alias by GUID (schema 7 is **shared with fishing casts**, see `forever-knowledge-pipeline.md` phase 3) | ⬜ |
| 8 | Release addon 0.4.0 + tray (schema 7, shared with fishing casts), PR, merge, deploy | ⬜ |

---

## 🔍 Root cause (Task 0)

The addon keys every character as `UnitName("player") .. "-" .. GetRealmName()`
(`addon/ForeverLedger/ForeverLedger.lua:87`). **Forever build 70009 changed what `UnitName("player")` returns**: build
69977 gave the full name (`Sam Willikers`), 70009 gives only the first name (`Sam`). Every upload after the patch
came in under a new key, so the server created a new `characters` row and split each character's skills, skill-ups,
recipes, quests and runs across two keys.

Evidence, from `raw_uploads.payload->'records'->'characters'`:

| Account | Build 69977 key | Build 70009 key |
| --- | --- | --- |
| 57637379#1 | `Sam Willikers-Classic Beta PvE` (uploads 22–55) | `Sam-Classic Beta PvE` (68–69) |
| 57637379#1 | `Jon Willikers-Classic Beta PvE` (23–48) | `Jon-Classic Beta PvE` (72–73) |
| 804633897#1 | `Vic Vinny-Classic Beta PvE 2` (36–39) | `Vic-Classic Beta PvE 2` (67) |
| 93594136#1 | — (first upload was on 70009) | `Nyx-Classic Beta PvE` (61+) |

- Every pair shares account, realm, class, race and level; Sam's 8 skill lines have identical ranks under both keys.
- `Nyx Ashford` never reached the server (no raw upload contains "Ashford"): that player's first upload was already on
  build 70009, so the DB has only `Nyx`. No server-side duplicate to merge for Nyx.
- Not an addon or server regression: no commit touched `charKey`; the switch lines up exactly with the client build.

Tables carrying a character key: `characters.key`, `skills.char`, `skill_ups.char`, `recipe_status.char`,
`recipe_difficulty.char`, `recipes_learned.char`, `quest_observations.char`, `turn_ins.char`, `runs.char`
(`runs.id`, `turn_ins.id`, `run_bosses.run_id`, `run_party.run_id` embed the old key but are opaque ids: left alone).

Primary-key conflicts a merge must handle: `skills (char, skill_line_id)` collides for every shared line (keep the
newest observation); the others include `build`/time in their PK and don't collide for these pairs, but the merge
still uses `ON CONFLICT DO NOTHING` so a re-run is safe.

## 🛠️ Design

- **Canonical key = the oldest key** (it owns the history); `character_aliases(alias_key PK, canonical_key → characters.key,
  created_at, reason)`. Display name: see open question 1.
- **Ingest:** load aliases once per batch, map `char` on every record and `key` on character records before upserts.
  Acks are computed from the original records, so the uploader's key → hash bookkeeping is untouched.
- **Merge CLI** (`apps/server/src/characters-cli.ts`, same style as `tokens-cli`): `suggest` lists pairs with the same
  uploading account, realm, class and race where one name is the other's first word; `merge <from> <into>` runs in one
  transaction, prints row counts per table, inserts the alias, deletes the `from` row. Dry run by default, `--apply`
  to commit.
- **GUID (schema 7):** `whoAmI()` adds `guid = UnitGUID("player")`; contracts `Character.guid` optional;
  `characters.guid` unique. On ingest, a character whose key is new but whose GUID belongs to an existing row gets an
  automatic alias. Trays on schema ≤ 6 keep working (the schema gate only ships 0.4.0 to updated trays); their renames
  still need `characters-cli merge`.
- **Not doing:** re-keying everything by GUID. It would rewrite every table and lose readable keys, and the old data
  has no GUID to map from anyway.

## ✅ Answers (2026-10-07)

1. Full names: they mean a lot, and on Forever's single server first name + surname is the identity. The addon should
   read the surname too. Tasks 6–8 move to `forever-ledger-0.4.0-fishing-identity.md`.
2. "Nyx Ashford" is that character's full name; the addon only ever saw "Nyx".
3. Ship schema 7 (addon 0.4.0 + tray), together with the per-cast fishing log.

## ❓ Open questions for the owner (answered above)

1. Display name after a merge: keep the fuller old name (`Sam Willikers`) or follow the client (`Sam`)?
2. Where did `Nyx Ashford` show up (tray app, in game, somewhere in admin)? It isn't in Postgres.
3. OK to ship schema 7 (addon 0.4.0 + a tray release your friends must install), or stop after the server-side fix?
