# 🤝 Forever Ledger — Tray "help fetch" (opt-in Wowhead helper in the tray app)

> Owner: John-Willikers <harlanbmiltonjr@gmail.com> · 2026-10-07 02:00 CDT · **Draft, awaiting approval** · Branch per step → PR →
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
| Only Wowhead | Main-frame navigation is allowed only to `https://www.wowhead.com/` URLs the server leased; anything else (redirects off-site, pop-ups, `window.open`) is refused. Downloads are cancelled. |
| No device access | Every permission request (camera, microphone, location, notifications, clipboard, USB…) is denied via `setPermissionRequestHandler` and `setPermissionCheckHandler`. |
| Nothing else on disk | The helper writes only inside its own partition folder in the app's data directory. Turning the feature off **deletes** that folder (`session.clearStorageData` + remove). |
| Reading the page | The HTML is read with the Chrome DevTools protocol (`DOM.getOuterHTML`) from the main process, the same way cruiser does, so no extra script runs in the page. |
| Server-side fence | Helper tokens may only lease `www.wowhead.com` entity pages; the server never hands a helper anything else, and Harlan approves each helper. |

## 👀 The consent screen (draft copy)

> **Help fill the Forever Ledger knowledge base?**
>
> When this is on, Forever Ledger loads pages from **wowhead.com** in the background: item, quest and NPC pages the
> ledger server asks for. It sends each page back to the ledger so your group's Discord helper can answer questions
> from real data.
>
> **What it does:** opens wowhead.com pages in a hidden window built into this app, at most **N pages a day**, about
> one every few minutes, and only while you're away from the PC and WoW isn't running. Each page is about 400 KB.
>
> **What it never does:**
> - it never opens or reads your Chrome, Edge or any other browser, or their passwords, cookies or history
> - it never reads your files or anything else on your PC
> - it never logs in anywhere, and never clicks anything, ads included
> - it never visits any site but wowhead.com
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
- ⬜ 1 ❓ Harlan answers the open questions below and approves
- ⬜ 2 🗄️ Server: enroll endpoint, pending/approved helper tokens, per-helper budget, site fence, admin Access controls
- ⬜ 3 🖥️ Tray: `fetchHelper.ts` (sandboxed session, idle/WoW/AC gating, lease loop), unit tests for every guarantee
  in the table (window options, partition, permission handlers, navigation fence, download cancel, data wipe)
- ⬜ 4 👀 Tray: consent screen (new install + first launch after update), settings toggle, Activity list; Playwright
  smoke test for the consent flow
- ⬜ 5 🔍 Security review of the helper (a dedicated reviewer pass on the sandbox guarantees)
- ⬜ 6 🚀 Release tray v0.2.0; Cody opts in; Harlan approves his helper; watch the first day

## ❓ Open questions for Harlan

1. Daily pages per helper (default suggestion **200**; cruiser keeps 400)?
2. Only when the PC is idle and WoW is closed (recommended), or any time the tray runs?
3. Should helpers ever log in to Wowhead? Recommended **no**: nothing to protect, nothing to steal.

## ⚠️ Risks

- Electron's user agent names Electron; Wowhead or Cloudflare may challenge it more than a normal Chrome. A helper that
  hits challenges just stops and reports "needs a human" like cruiser; we'd look at it then, not before.
- Friends' home IPs carry their own traffic: the per-helper budget stays small and they can see and stop it any time.
