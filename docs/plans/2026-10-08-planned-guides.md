# Planned guides (phase 5) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A guide asked for in Discord / the admin page is planned for the character (route planner + its stored
state) instead of replaying someone's run, delivered by the tray, and shown in game with travel steps ("Fly to
Ratchet", "Take the boat", "Hearth to Orgrimmar", "Travel Form").

**Architecture:** Guide format v2 in contracts (`travel` action with `how` / `note`; travel steps carry no quests).
Server: a `PlanStep[] → GuideStep[]` adapter; `createGuide` plans when the character has 0.8.0 state, else falls back
to the run-based builder; `GET /v1/guides?format=2` serves v2, older trays get the same guides with travel steps
removed (their parse would reject the whole response). Tray v0.3.3 asks for format 2. Addon 0.9.0 shows and completes
travel steps (guide data is not SavedVariables: no schema bump).

**Tech Stack:** TypeScript + zod (contracts), Fastify + Postgres (server), MCP server (`apps/mcp`), Discord bot
(`apps/discord`), Electron tray, WoW Lua 5.1 + harness. Gate `pnpm check`.

**Context:** design `docs/plans/2026-10-08-quest-atlas-planner-design.md` (Output); planner
`apps/server/src/planner/` (`plan()`, `PlanStep`), `apps/server/src/knowledge/character-state.ts` (`loadCharacter`),
`knowledge/atlas-load.ts` (`loadAtlas`), `knowledge/guides.ts` (`createGuide`, run-based today);
`docs/plans/2026-10-08-route-planner.md` "Phase 5 checklist".

**Rules:** branch `feat/planned-guides`; identity `John-Willikers <harlanbmiltonjr@gmail.com>`; commits end with a
blank line + `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`; never commit the untracked files
in the repo root; Lua literals only plain strings/numbers (guides end up as Lua — keep `toLua` escaping); push with
`GIT_ASKPASS= VSCODE_GIT_ASKPASS_NODE= git -c credential.helper= -c credential.helper='!gh auth git-credential' push`.

---

### Task 1: Contracts — guide format v2

`packages/contracts/src/guides.ts`:

- `GUIDE_ACTIONS = ['accept', 'complete', 'turn_in', 'travel']`; `GUIDE_FORMAT = 2`.
- `GuideStep` gains `how: z.enum(['walk','fly','boat','hearth']).optional()` (travel only), `note: text(120).optional()`
  ("Travel Form", "Ghost Wolf", "class quest", the transport's name), and `quests` may be empty for `travel` (keep
  `min(1)` for the other actions via a refinement).
- `GuideDoc` gains optional `planned: z.boolean()` (true when the planner built it) — `basedOn` stays (planned guides
  say "the route planner").
- `toFormat1(doc)`: drops travel steps and `how`/`note` (a doc left with no steps gets one note-free … keep it simple:
  a planned guide always has quest steps; if none remain, drop the doc).
- Tests: a v2 doc with travel steps parses; a travel step with quests parses; an accept step with no quests fails;
  `toFormat1` output parses with the v0.3.2 schema rules (no travel, `quests.min(1)`).

Commit `feat(contracts): guide format 2 — travel steps`.

### Task 2: Server — planned guides

- `apps/server/src/knowledge/plan-guide.ts`: `planGuide(db, charKey, toLevel)`: `loadCharacter` + `loadAtlas` (cache
  the atlas in memory for 10 minutes; it's ~20 ms to plan) → `plan()` → `GuideStep[]`:
  - `spot` (percent) → `mapId`/`x`/`y`; zone/subzone names from `geo.mapInfo` (subzone null);
  - `accept` quests get `minLevel` from the atlas `reqLevel` (`minLevelFrom: 'wowhead'`);
  - `turn_in` gets `levelAfter` from the step's `level`;
  - `complete` quests get their objectives text;
  - `travel` steps get `how`, `note`, the destination as `npc` (flight master / dock / inn name when known, else the
    zone) and the destination spot.
  - Returns `{ steps, gaps, fromLevel, toLevel, seconds }`.
- `createGuide` (`knowledge/guides.ts`): when `character_state` exists for the target and no `basedOn` run was asked
  for, use `planGuide` (title "Planned: <zone> <from>–<to>", `basedOn` "the route planner", `planned: true`), else the
  current run-based path. Gaps go into the existing response (Discord / admin show them).
- `GET /v1/guides` (`routes/guides.ts`): `?format=2` → v2 docs; anything else → `toFormat1`.
- MCP `leveling_route` (apps/mcp + `knowledge/answers.ts` or wherever it lives): a `planned` result when the asking
  character has state (route summary: steps, time, gaps); `send_guide` unchanged (it calls `createGuide`).
- Admin guides page: show "planned" vs "run" (small; follow the page's existing style; lazy CSS rule: memory
  `admin-lazy-css-hazard`).
- Tests (DB-backed): a character with state gets a planned guide with travel steps; without state → run-based as
  today; `/v1/guides` without `format` has no travel steps and parses with format-1 rules; with `format=2` has them.

Commit `feat(guides): plan guides for the character (route planner)`.

### Task 3: Tray v0.3.3

`apps/uploader/src/guides.ts`: request `/v1/guides?format=2`; `guidesLua` writes `version: 2`; tests. Bump
`apps/desktop/package.json` to 0.3.3 at release time (Task 5).

Commit `feat(tray): ask for guide format 2`.

### Task 4: Addon 0.9.0 — travel steps

`addon/ForeverLedger/GuideViewer.lua`, `GuideArrow.lua`, `GuideTracker.lua`, tests in `addon/tests/test_guide.lua`.

- Text: `how` fly → "Fly to <npc>" (+ "at the flight master" when the step before ended away from it), boat → "Take
  the <note or 'boat'> to <npc>", hearth → "Hearth to <npc>", walk → "Go to <npc/zone>" + " (<note>)" when a form note
  is present ("Travel Form"). Escape like other text.
- Arrow: points at the step's spot (already generic).
- Done: a travel step is done when the player is within 60 yd of its spot (same map), or on the step's map after a
  flight landed (`PLAYER_CONTROL_GAINED`) / a hearth or loading screen put them there; checked on the existing quest-log
  refresh + a light 2 s check only while the current step is travel. Back/Next work as for other steps.
- Auto quest: unaffected (no quests on travel steps).
- An addon reading a v1 guide behaves as today.
- `VERSION` 0.8.0 → 0.9.0, `.toc`; no SavedVariables change (no schema bump); regenerate fixtures the version touches
  (contracts `normalize.test.ts` asserts addonVersion of session fixtures — follow what 0.8.0 did with the legacy
  copy: add `addon/tests/legacy/ForeverLedger-0.8.0.lua` only if `session-v10.lua` must stay 0.8.0).

Commit `feat(addon): 0.9.0 — travel steps in the guide`.

### Task 5: Release

1. Deploy the server (no migration expected; if one appears, back up first).
2. Tray v0.3.3: bump, PR, tag `v0.3.3`.
3. Harlan test: a planned guide for a low-level character with 0.8.0 state (tray closed for the manual addon copy;
   then tray on to receive the guide).
4. `addon-v0.9.0` → `addon-cli publish 0.9.0`.
5. Plan / memory updates.
