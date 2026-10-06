# 🛰️ Cruiser fetch worker — handoff

Paste everything below the line into Claude Code **on cruiser** (`/home/john/stream-recorder`). Plan:
`project-plans/forever-knowledge-pipeline.md` (phase 1). Server side: `apps/server/src/routes/fetch.ts`, contracts
`packages/contracts/src/knowledge.ts`.

---

**Step 0.** Run `hostname` and confirm it says `cruiser` and that `/home/john/stream-recorder` exists. If either check
fails, stop and tell me. Don't change anything on the wrong machine.

**Step 1, backup first.** This repo has no git remote. I'll give you a private GitHub repo URL. Add it as `origin`
and push `master` before you change anything else. Then create a branch `feat/page-fetcher`.

**Goal.** Fetch web pages for my Forever Ledger knowledge base through a real, logged-in, headed Chrome, at a human
pace. The VPS at `https://ledger.willikers.dev` keeps the URL queue. This worker pulls URLs from it and posts the
pages back. The VPS never runs a browser, and cruiser opens no inbound port.

**Build** `recorder/fetchpage.py` (one page fetch), `recorder/fetcher.py` (the loop), and
`systemd/stream-recorder-fetcher.service` (a `--user` unit), reusing what's already here:

- **Chrome.** One long-lived Chrome for fetching, started the way `job.py` starts recording Chrome:
  - Slot **9**, `--remote-debugging-port=9309`, its own Xvfb display `:109`.
  - Its profile is cloned from `profile-seed/` with the same exclusions as `_prepare_profile`, refreshed at most once
    a day.
  - It must never touch the recording slots (`MAX_CONCURRENT=4`), their ports or displays, or the recording disk gate.
- **CDP.** Reuse `recorder/control.py`. Add `dump_html()` using `DOM.getDocument` (depth -1) + `DOM.getOuterHTML`, not
  `Runtime.evaluate`. Enable `Network` and record the main document's `responseReceived` status and the final URL.
- **Readiness.** Wait for `document.readyState === 'complete'`, then 1.5 s with no network requests in flight, then an
  optional per-site selector, all within 45 s.
- **Challenges.** Watch for a Cloudflare or CloudFront interstitial: title "Just a moment", "Attention Required",
  "Access denied" or "Verifying you are human", or `window._cf_chl_opt`, or a `challenge-form` / `challenge-running`
  element.
  - Wait up to 30 s once for it to clear by itself.
  - If it doesn't clear, report `outcome: "challenge"` with no page.
  - Never click through a challenge. Never post a challenge page as `ok`.
- **Per-site modules.** `recorder/platforms/wowhead.py` and `mobalytics.py` dismiss consent banners and give a ready
  selector. Wowhead's data sits in inline scripts, so don't click tabs.
- **Pacing.**
  - Lease up to 3 URLs and fetch them one at a time, **60–120 s apart with random jitter**.
  - **At most 200 pages a day.** Pause **02:00–08:00 America/Chicago**.
  - After a 403, 429 or challenge, back off exponentially (15 min doubling, capped at 6 h).
  - **After 3 in a row, stop**, send `curl -d "<why>" ntfy.sh/m0kuNjxWbhNSGY4c`, and wait for a human.
- **Spool.** Write each report to `state/fetch-spool/` before POSTing it, and delete it once the server answers 2xx.
  Retry 5xx or network errors with backoff. Move anything the server answers 4xx to `state/fetch-dead/`. Model this on
  `uploader.py`.
- **Token.** It goes in an env file the unit reads (`FETCH_TOKEN=flt_…`, minted on the VPS with
  `token:mint "cruiser fetcher" --fetch`). Never log it.

**API** (JSON, `Authorization: Bearer $FETCH_TOKEN`, 60 requests/min per token):

```
POST https://ledger.willikers.dev/v1/fetch/lease
  {"worker": "cruiser", "max": 3}
→ {"leases": [{"url": "...", "site": "wowhead.com", "entityType": "item"|null, "entityId": 7973|null,
               "leaseUntil": "2026-10-06T07:27:03-05:00"}]}     # a lease lasts 15 minutes

POST https://ledger.willikers.dev/v1/fetch/snapshots
  {"url": "<the leased url, exactly>", "worker": "cruiser", "fetcher": "fetchpage/0.1.0",
   "outcome": "ok" | "challenge" | "http_error" | "error",
   "fetchedAt": "2026-10-06T07:12:03-05:00",          # ISO 8601 WITH an offset
   "finalUrl": "...", "httpStatus": 200,               # finalUrl required for ok
   "sha256": "<hex sha256 of the UTF-8 HTML>",          # required for ok
   "htmlGzBase64": "<base64 of gzip(html)>",            # required for ok; at most 4 MB of base64
   "error": "<short text, optional>"}
→ {"result": "stored"|"unchanged"|"challenge"|"recorded", "snapshotId": 12, "claims": 4}
  400 bad report · 401/403 token · 404 url not on the queue · 422 sha256 doesn't match
```

The server re-checks every `ok` page for a challenge and refuses to store one. A 404 or 410 page fails the URL. A 403,
429 or 5xx page, or `error`, puts it back in the queue with backoff.

**Test**, then open a PR:

1. Fetch one Mobalytics page and one Wowhead page through the worker, run by hand at slot 9.
2. Report each one's size, time taken, and whether it rendered. For Wowhead, say whether the page has
   `WH.Gatherer.addData(` and `new Listview(` in its HTML, and what Wowhead's Forever URL scheme looks like (for
   example `/forever/item=…`). The server's parser and `enqueue-seen` need both answers.
3. Save both pages into the ledger repo as `fixtures/real/web/` golden files: send them to me, don't commit them on
   cruiser.

Don't touch the recording pool, its slots, the supervisor queue or `pubapi.py`.
