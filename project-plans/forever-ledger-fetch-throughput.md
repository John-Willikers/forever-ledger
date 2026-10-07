# 🚀 Forever Ledger — Wowhead fetch throughput (pace, budget, coverage)

> Owner: John-Willikers <harlanbmiltonjr@gmail.com> · 2026-10-07 01:47 CDT · Branch `feat/fetch-throughput` → PR → merge to master.
> Part of `forever-knowledge-pipeline.md`. Queue on 2026-10-07 01:47: 3,241 pages (385 quests, 2,201 items, 655 NPCs).

## 🧭 Context

Cruiser fetched 24/24 pages with no 403, 429 or challenge, at about 30 pages an hour, but its 200-a-day cap stops it
after about 6½ hours. The cap is the bottleneck, not the pacing. Harlan (2026-10-07): raise the pace, spread it evenly,
re-fetch less, give the server a budget, and see how far NPC and quest pages can stand in for item pages.

Next (its own plan): a second fetch worker in Cody's tray app, with his consent: a hidden Electron window with its own
session, Cody logged into Wowhead once, its own token and budget. No unattended ad viewing (Harlan, 2026-10-07: pages
just load normally, without an ad blocker).

## ✅ Progress checks

Legend: ⬜ todo · 🟡 in progress · ✅ done · ⛔ blocked. Times America/Chicago.

- ✅ 1 🛰️ Cruiser prompt in `docs/cruiser-fetcher-handoff.md` (update 2026-10-07): 400/day, 120–200 s gaps, 1 lease at a
  time, honor the server budget, no ad blocker — 01:52 CDT
- ✅ 2 🔁 Re-fetch (01:52 CDT): Classic ids after 90 days, Forever ids and guides after 30
- ✅ 3 🧮 Server budget (per worker token, migration 0017) on `/v1/fetch/lease`: `FETCH_DAILY_BUDGET` (400) and `FETCH_HOURLY_BUDGET` (25), counted in
  `fetch_budget`; the lease response says what's left
- ✅ 4 🧩 Coverage
  - ✅ 4a Quest pages: level, required level, XP, money, reputation, side from `g_quests` (`wowhead@3`)
  - ✅ 4b NPC `drops` lists also become `dropped_by` claims on each item; media tabs (screenshots, videos) are
    ignored
  - ✅ 4c `knowledge-cli coverage [--apply]`: item pages whose every drop source we have seen is covered by fetched
    NPC pages drop to priority 5 (uncovered items go first); nothing is skipped without Harlan
- ✅ 5 🔍 Review → PR #50 → merged → deployed; Wowhead pages reparsed with `--replace` (all 519 Wowhead claims are
  `wowhead@3`, checked 2026-10-07 03:10 CDT)
