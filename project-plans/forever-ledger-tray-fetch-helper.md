# 🤝 Forever Ledger — Tray "help fetch" (opt-in Wowhead helper in the tray app)

> Owner: John-Willikers <harlanbmiltonjr@gmail.com> · 2026-10-07 02:00 CDT · **Approved 2026-10-07 02:02 CDT** · Branch per step → PR →
> merge to master. Ships as tray **v0.2.0**. Builds on `forever-ledger-fetch-throughput.md` (per-worker budgets).

## 🧭 Context

Cruiser fetches Wowhead pages for the knowledge base, capped per worker by the server (400 a day, 25 an hour). Friends
who run the tray app (Cody first) offered to share the load. Harlan (2026-10-07):

- **Consent first.** Every friend sees a plain consent screen, on a new install and on the update that adds this. It is
  **off until they turn it on**, and they can turn it off any time.
- **It only does one thing:** take a list of Wowhead pages from the ledger server, load them, send the page back.
- **A sandbox, never their browser.** It must not use their Chrome, Edge or anything else of theirs, and it must be
  impossible for it to take anything from them.
- **No ad tricks.** Pages load the way a person sees them (no ad blocker). Nothing is clicked and no ads are "watched"
  on purpose.

## 🔒 What "sandboxed" means here (the guarantees we make, and test)

| Guarantee | How |
| --- | --- |
| Never their browser | The page loads in the tray app's **own** built-in browser (Electron's Chromium), in a separate, empty session (`partition: 'persist:fetch-helper'`). Their Chrome, Edge or Firefox is never opened, read or launched; their cookies, logins, history and passwords are never touched. |
| Nothing to steal | The helper session starts empty and stays logged out of everything (no Wowhead login). It has no access to the tray's own session or token. |
| Locked-down page | Hidden `BrowserWindow` with `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false` and **no preload**: the page can't reach Node, files or the app. |
| Only Wowhead pages | The page itself (main frame) is only ever a `https://www.wowhead.com/` item, quest, NPC, object, spell or zone page, enforced by a session-wide `webRequest` fence plus navigation and redirect guards; pop-ups and `window.open` are refused. Downloads are cancelled. Ads and trackers inside the page load like in any browser (Harlan, 2026-10-07), and the consent screen says so. |
| No device access | Every permission request (camera, microphone, location, notifications, clipboard, USB…) is denied via `setPermissionRequestHandler` and `setPermissionCheckHandler`. |
| Nothing else on disk | The helper writes only inside its own partition folder in the app's data directory. Turning the feature off clears it (`clearStorageData`, cache, auth cache) and the folder is removed at the next start while the helper is off. |
| Turning off means off | Off closes the window, wipes the session, hands the helper key back (`POST /v1/fetch/unenroll`) and forgets it; a lease in flight loads nothing. The tray keeps its own 200-a-day cap whatever the server says. A page that hangs is timed out and its renderer killed. |
| Revocable | Revoking a friend's upload token revokes their helper too; a revoked helper shows "Stopped" and loads nothing. |
| Reading the page | The HTML is read with the Chrome DevTools protocol (`DOM.getOuterHTML`) from the main process, the same way cruiser does, so no extra script runs in the page. |
| Server-side fence | Helper tokens may only lease `www.wowhead.com` entity pages; the server never hands a helper anything else, and Harlan approves each helper. |

## 👀 The consent screen (draft copy)

> **Help fill the Forever Ledger knowledge base?**
>
> When this is on, Forever Ledger loads pages from **wowhead.com** in the background: item, quest and NPC pages the
> ledger server asks for. It sends each page back to the ledger so your group's Discord helper can answer questions
> from real data.
>
> **What it does:** opens wowhead.com pages in a hidden window built into this app, at most **200 pages a day**, about
> one every few minutes, and only while you're away from the PC and WoW isn't running. Pages load like in any browser,
ads and trackers included, so expect a few MB per page.
>
> **What it never does:**
> - it never opens or reads your Chrome, Edge or any other browser, or their passwords, cookies or history
> - it never reads your files or anything else on your PC
> - it never logs in anywhere, and never clicks anything, ads included
> - it only ever opens wowhead.com item, quest, NPC, object, spell and zone pages; the ads and trackers on those pages
>   load from their own sites, as they would for you
> - it shows nothing on screen, makes no sound and never downloads files to your PC
>
> You can see every page it loaded under **Activity**, pause it, or turn it off. Turning it off deletes everything it
> stored.
>
> \[ Turn on \]   \[ Not now \]

Shown: on first launch of a new install (after the token setup), and once on the first launch after updating to
v0.2.0. "Not now" is remembered; the setting stays reachable in the tray's settings.

## 🧩 Design

- **Tray (apps/desktop)**
  - `src/main/fetchHelper.ts`: the hidden window and session above, a loop that runs only when the feature is on,
    the PC is idle (`powerMonitor.getSystemIdleTime() >= 300`), WoW isn't running, and it's on AC power; one lease at
    a time; 120–200 s between pages; readiness and challenge detection as on cruiser; posts `/v1/fetch/snapshots`.
    No Node or Electron objects ever reach the page.
  - Consent screen + settings toggle + **Activity** list (last 50 pages, with time and result) in the renderer.
  - Its own **fetch token**, separate from the upload token (fetch tokens can't upload and upload tokens can't fetch).
- **Server (apps/server)**
  - `POST /v1/fetch/enroll` (upload token): asks for a helper token; creates it **pending** (label "helper: <upload
    token label>"); the token can't lease until Harlan approves it.
  - Admin **Access** page: approve / pause / revoke helpers, set each one's daily budget (default **200**), see pages
    fetched.
  - Helper tokens: per-token budget (already built), leases limited to `www.wowhead.com` entity pages.
- **Contracts:** enroll request and response, helper status in the lease answer.

## ✅ Progress checks

Legend: ⬜ todo · 🟡 in progress · ✅ done · ⛔ blocked. Times America/Chicago.

- ✅ 0 📝 Plan drafted — 2026-10-07 02:00 CDT
- ✅ 1 ❓ Harlan answered: 200 pages a day per helper, only while idle with WoW closed, never log in — 2026-10-07 02:02 CDT
- ✅ 2 🗄️ Server: `POST /v1/fetch/enroll` (upload token → helper token, pending), `GET /v1/fetch/status`, approval gate
  (403 until approved; pause), per-helper budget (200/day, 13/hour), site fence (wowhead.com entity pages), Access
  page approve / pause / resume / budget, migration 0018 (additive) — 02:13 CDT
- ✅ 3 🖥️ Tray (02:24 CDT): `src/main/helper/` — policy, core loop, sandboxed browser, gate, encrypted store, server API;
  helper tests pin the guarantees. Was: `fetchHelper.ts` (sandboxed session, idle/WoW/AC gating, lease loop), unit tests for every guarantee
  in the table (window options, partition, permission handlers, navigation fence, download cancel, data wipe)
- ✅ 4 👀 (02:24 CDT, smoke test passes under xvfb, screenshots checked) Tray: consent screen (new install + first launch after update), settings toggle, Activity list; Playwright
  smoke test for the consent flow
- ✅ 5 🔍 (2026-10-07 02:40 CDT) Security review of the helper, every finding fixed: load/CDP timeouts with a renderer
  kill, entity-page-only fence on the whole session, load-validity check, no dialogs/focus/taskbar, real wipe on off +
  folder removal at start, unenroll, cascade revoke, transactional enroll, tray-side daily cap, revoked state, lost-key
  re-approval, IPC sender check, full-path `tasklist`. Consent text now says plainly that ads and trackers load.
- 🟡 6 🚀 (2026-10-07 02:46 CDT, PR #53 merged, server deployed, tray v0.2.0 is GitHub latest) Release tray v0.2.0;
  Cody opts in; Harlan approves his helper; watch the first day

## ✅ Decisions (Harlan, 2026-10-07)

1. **200 pages a day** per helper by default (cruiser keeps 400); Harlan can change it per helper.
2. Runs **only while the PC is idle (5 min), WoW is closed and the PC is on AC power.**
3. Helpers **never log in** to Wowhead or anything else.
4. **Pages load like a browser:** ads and trackers are not blocked (no ad blocking, no clicking), and the consent screen
   says so honestly.

## ⚠️ Risks

- Electron's user agent names Electron; Wowhead or Cloudflare may challenge it more than a normal Chrome. A helper that
  hits challenges just stops and reports "needs a human" like cruiser; we'd look at it then, not before.
- Friends' home IPs carry their own traffic: the per-helper budget stays small and they can see and stop it any time.
