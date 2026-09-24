# 🗺️ Forever Ledger — Real zone maps (wow.export → admin upload → overlays)

> Owner: John-Willikers <harlanbmiltonjr@gmail.com> · 2026-09-23 (America/Chicago) · On approval: copy to
> `project-plans/forever-ledger-zone-maps.md` (live progress checks), branch `feat/zone-maps`, PR → green → merge.

## ✅ Progress checks

Legend: ⬜ todo · 🟡 in progress · ✅ done · ⛔ blocked. Times America/Chicago.

- ✅ 0 📝 Plan approved, branch `feat/zone-maps` from `origin/master` (434958c) — 22:52 CDT 2026-09-23
- ✅ 1 🗄️ Server: migration `zone_maps`, image validation module, maps routes, nginx body size — 22:56 CDT (85ada50;
  migration generated as `0010_zone_maps` because `feat/run-groups` (0010_run_groups) isn't on master yet → regenerate
  as 0011 after it merges; 288 server tests)
- 🟡 2 🖥️ UI: `ZoneMap` component, 🗺️ Maps page, gathering/quest/vendor/trainer integrations, CSP check
- ⬜ 3 🚀 Deploy: backup, migrate, nginx reload, PM2 reload; export Durotar + The Barrens and upload (not in this branch)

## 📌 Context

The admin panel's gathering map plots node spots on a blank 0–100 grid. The user wants the **real in-game zone maps**
underneath, exported **from their own game client only** ("no reason for everyone and their mama to upload the same
maps"), and chose **wow.export** (MIT desktop app that reads a local WoW install) to do the exporting.

Research facts (wow.export source `src/js/modules/tab_zones.js`, Blizzard `Blizzard_MapCanvas*.lua`, WoWDBDefs):
- wow.export's **Zones** tab builds a zone map from `UiMapXMapArt → UiMapArt → UiMapArtStyleLayer → UiMapArtTile`,
  on a canvas of **LayerWidth × LayerHeight = 1002 × 668** for Classic zones, and composites **all**
  `WorldMapOverlay` tiles → a **fully explored** map; export as PNG/WebP.
- The game places map pins at `canvasWidth·x, canvasHeight·y` with x,y = `C_Map.GetPlayerMapPosition` (0–1). Our
  addon stores those as 0–100 per **uiMapID** → overlay is exact: `left = x% · width`, `top = y% · height`.
- wow.export supports local product `wow_classic_beta`; WoWDBDefs already has build **1.60.1.69977** for all needed
  tables. Live data so far: uiMapIDs **1411 Durotar**, **1413 The Barrens** (gathering spots) plus quest/NPC locations.
- Map art is Blizzard's: keep it in the private, login-gated panel with a copyright notice (fan-content policy:
  personal, non-commercial). No hotlinking of third-party map images (Wowhead ToS forbids it).

## 🧭 Approach

No extractor code in our apps. **You export with wow.export; the admin panel takes admin-only uploads; every map view
overlays our points on the uploaded image.** Nothing changes for other contributors' tray apps or addons.

### Server (`apps/server`)
- Migration **0011** (additive): `zone_maps` — `ui_map_id int PK`, `name text` (zone name), `mime text`
  (`image/png|image/webp|image/jpeg`), `width int`, `height int`, `bytes bytea` (≤ 8 MB), `sha256 text`,
  `build int null` (client build it came from, optional), `uploaded_by int → users`, `uploaded_at timestamptz`.
  Stored in Postgres so the existing pg_dump backups cover it.
- Routes (new `routes/adminMaps.ts`, `requireAdmin`; writes need CSRF):
  - `GET /admin/api/maps` → every uiMapID seen in our data (node spots, quest giver/ender locs, trainer/vendor locs,
    runs) with the zone name we know + point counts + whether an image exists (size, uploaded when/by).
  - `PUT /admin/api/maps/:uiMapId` (raw image body, `content-type` image/*; route body limit 8 MB) → validate by
    **magic bytes** (PNG/WebP/JPEG only — no SVG), read dimensions from the header without native deps (PNG IHDR,
    WebP VP8/VP8L/VP8X, JPEG SOFn), reject > 4096 px per side; store; return metadata + a warning when the aspect ratio
    isn't ≈ 1002:668.
  - `DELETE /admin/api/maps/:uiMapId`.
  - `GET /admin/maps/:uiMapId` (admin session) → the image with the stored mime, `ETag` = sha256, `Cache-Control:
    private, max-age=86400`, `nosniff`; 404 when none.
- nginx: `/admin/api/maps/` needs `client_max_body_size 8m` (the site default is 6m) — repo conf + deploy step.
- CSP of the SPA: make sure `img-src 'self' blob: data:` allows the map images and upload previews.

### Admin UI (`apps/admin`)
- **🗺️ Maps page** (Access-style admin page): table of uiMapIDs with zone name, point counts, image status; per row
  **Upload** (file picker → local preview with our points overlaid → **alignment check** → Save) and Delete. A short
  "How to export with wow.export" panel (below). Blizzard copyright notice under every map.
- Shared **`<ZoneMap uiMapId points=[…]>`** component: the image (natural aspect) with an absolutely positioned SVG
  overlay (`viewBox 0 0 100 100`, `preserveAspectRatio="none"`), points as circles (size = opens, color = node
  type/marker kind), React-rendered tooltips (text only). Falls back to today's grid when no image exists, with a
  link to the Maps page.
- Use it in: ⚒️ **Gathering map** (replace the grid), 📜 quest drawer (giver/ender locations), 🏪 vendor/trainer
  detail (NPC location), 🏰 run page (instance entrance when present).

### Your export steps (documented in README + the Maps page)
1. Download wow.export (github.com/Kruithne/wow.export/releases) on the gaming PC.
2. Open it → **Open Local Installation** → pick the WoW: Forever folder → choose the `wow_classic_beta` 1.60.1 build.
3. **Zones** tab → pick the zone (e.g. Durotar, The Barrens) → export as **PNG** (or WebP) at full size.
4. Admin panel → 🗺️ Maps → **Upload** on that zone's row → check the dots line up → Save.
(If a patch changes a zone's art, re-export and re-upload; `build` is recorded for reference.)

## 🗺️ Phases (one PR, merge only when all checks are green)
1. **🗄️ Server:** migration 0011, image validation module (magic + dimensions, unit-tested with tiny fixture images
   incl. truncated/fake headers, SVG, oversized), maps routes, nginx body size.
2. **🖥️ UI:** `ZoneMap` component (+ unit tests for point projection/fallback), Maps page with preview/alignment
   check, gathering map + quest/vendor/trainer/run integrations, CSP check.
3. **🚀 Deploy:** backup, migrate, nginx reload, PM2 reload; you export Durotar + The Barrens and upload.

## ✅ Verification
- `pnpm check` + CI (Linux + Windows) green.
- Server tests (real Postgres): upload PNG/WebP/JPEG → metadata + served bytes identical with ETag; SVG/HTML/fake
  magic/oversized/too-large-dimensions → 400/413; member/anonymous → 401/403; CSRF required on PUT/DELETE; list shows
  uiMapIDs from fixtures with point counts.
- UI: overlay math unit tests (x%,y% → SVG coords; aspect preserved); visual check in headless Chrome with a
  generated 1002×668 test image and known points at the corners/center.
- Live: after your upload, Durotar's Copper Vein spot and The Barrens' herb spots sit on the right terrain; quest
  givers (e.g. Kaltunk at 43.2, 68.5 in Durotar) land at the Valley of Trials camp.

## ⚠️ Notes
- **Run grouping (Sam + Vic)** is paused mid-work on branch `feat/run-groups` (server half done, uncommitted); it
  resumes right after this plan is approved and ships separately.
- Future (not now): the addon could record `C_Map.GetMapArtID` per uiMapID so the panel can flag when a patch
  changed a zone's art and the upload should be refreshed.
