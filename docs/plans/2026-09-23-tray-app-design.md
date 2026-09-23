# Forever Ledger tray app and addon auto-update — design

> Owner: John-Willikers <harlanbmiltonjr@gmail.com> · Agreed 2026-09-23 (America/Chicago) · Implementation plan:
> `project-plans/forever-ledger-tray-app.md`

## Goal

A Windows tray app on the gaming PC that does what the uploader CLI does today and also keeps the `ForeverLedger`
addon at the version the ledger server recommends for the player's client build. The app updates itself from GitHub
Releases.

## Decisions

| Topic             | Decision                                                                                                                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App shape         | Tray app with a window, built with **Electron**.                                                                                                                                                                        |
| Code reuse        | The app imports `@forever-ledger/uploader` as a library (it already exports `startWatch`, `collectStatus`, `withLock` and the rest). Addon sync lives in the same package, so the CLI gets an `addon-sync` command too. |
| Hosting           | **Public** GitHub repo `John-Willikers/forever-ledger`. Release files are downloaded straight from GitHub.                                                                                                              |
| Who decides       | The ledger server. A tag makes a release available; `addon:publish` on the VPS makes it live.                                                                                                                           |
| What auto-updates | `ForeverLedger` only. `ForeverLedgerProbe` stays a manual dev tool.                                                                                                                                                     |
| Workflow          | Once the repo is public: branch → PR → merge (replaces "alpha: commit to master").                                                                                                                                      |

## Architecture

```
GitHub (public John-Willikers/forever-ledger)
  tag addon-v0.2.2 → Action: version check, pnpm check, zip addon/ForeverLedger → Release (marked NOT latest)
  tag v0.1.0       → Action (windows-latest): electron-builder NSIS + latest.yml → Release (latest)

ledger.willikers.dev
  GET /v1/addon/manifest?build=69913  (bearer token)
    → { addon, version, url, sha256, size }   pin for the build if any, else newest active release
  admin CLI: addon:publish <v> | addon:pin <min>-<max|> <v> | addon:unpin <id> | addon:yank <v> | addon:list

Gaming PC: Forever Ledger tray app
  main process: startWatch (uploads) + addon sync every 30 min + electron-updater (self-update)
  tray icon (idle / uploading / queued / error) + one window with four cards
```

App releases use electron-builder's default `v<version>` tags. Addon releases are created with `--latest=false`, so
GitHub's "latest release" (which `electron-updater` reads) is always an app release.

## UX

- **First run:** pick the WoW: Forever folder (the uploader's discovery lists the accounts it finds), paste the token
  (server URL pre-filled), install the addon if missing, then hide to the tray. Same config file as the CLI; the
  uploader's lock keeps the CLI `watch` and the app from running together.
- **Tray:** 🟢 idle · 🔵 uploading · 🟡 batches queued · 🔴 needs attention. Menu: Open, Upload now, Check for updates,
  Pause uploads, Open logs folder, Quit.
- **Window (four cards):** Uploads (last success in America/Chicago, records acked, batches queued, last error) ·
  Addon (installed version, recommended version, last client build seen, Update now / Roll back) · App (version,
  Restart to update) · Settings (WoW folder, token, Start with Windows [on, starts hidden], Auto-update addon [on]).
- **Toasts:** addon updated ("/reload to use v0.2.2"), app update ready, an error lasting over an hour.
- Plain TypeScript + HTML + CSS renderer. `contextIsolation` on, `nodeIntegration` off, a preload script exposing a
  few named IPC calls.

## Addon sync rules

1. Ask the manifest for the build last seen in SavedVariables (no build yet → no `build` parameter).
2. Install when the recommended version **differs** from the installed `.toc` `## Version` (a server pin to an older
   version is how rollback reaches the PC).
3. Verify before writing anything (`verifyAddonZip`, shared by the tray app and the server's publish step):
   - the zip is ≤ 5 MB and its sha256 matches the manifest;
   - every entry is under `ForeverLedger/` and every path segment matches `[A-Za-z0-9_-][A-Za-z0-9_.-]*`, doesn't end
     in `.` and isn't a Windows reserved name (`CON`, `AUX`, `COM1`, …), which rules out `..`, `C:`, `:ads` streams,
     backslashes, NUL and trailing spaces;
   - no duplicate names, no names that collide case-insensitively (NTFS), no file that is also a folder;
   - only stored or deflate entries; the unpacked total (counting stored entries by their real size and rejecting
     overlapping entries) is ≤ 5 MB, and each entry unpacks to its declared size;
   - the `.toc` Version equals the manifest version.
   - The manifest URL must be exactly `…/releases/download/addon-v<version>/ForeverLedger-<version>.zip` in our repo.
   - Any failure: install nothing, report 🔴, retry next cycle.
4. Swap: extract to `AddOns/.ForeverLedger.new` → rename `ForeverLedger` → `ForeverLedger.bak` (replacing an older
   `.bak`) → rename `.ForeverLedger.new` → `ForeverLedger`. Renames retry on Windows' transient EPERM/EBUSY; if the
   last rename fails, the `.bak` is renamed back.
5. Manual **Roll back** restores `.bak` and pauses auto-update until the server recommends a different version.
6. Never touch SavedVariables or any other addon. Swapping while WoW runs is fine: WoW reads addon files at login
   and `/reload` only.

## Server data

- `addon_releases`: `version` (PK), `url`, `sha256`, `size`, `status` (`active` | `yanked`), `published_at`.
- `addon_pins`: `id`, `build_min`, `build_max` (null = open-ended), `version` → `addon_releases`, `created_at`.
- Resolution: newest pin covering the build whose release is active, else the highest active version.
- `addon:publish` reads the GitHub release `addon-v<version>`, downloads `ForeverLedger-<version>.zip`, computes the
  sha256 itself and verifies the `.toc` Version before storing the row.

## Testing

- Uploader (vitest, temp dirs): version compare, manifest client, zip validation (sha mismatch, zip-slip, oversize,
  wrong `.toc`), swap success, rename failure → restore, rollback + pause, watch events.
- Server (testcontainers Postgres): manifest resolution (pin, yanked, newest, no build, 401, 404), publish with a fake
  GitHub fetch.
- `scripts/check-addon-version.ts` (used by the addon release Action) with its own tests.
- Desktop: pure tray-state and controller logic unit-tested without Electron; a Playwright `_electron` smoke test on
  the Windows CI runner (app starts, window shows four cards).
- Manual checklist on the gaming PC.
