# 🖥️ Forever Ledger Tray App + Addon Auto-Update — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development in
> this session) to implement this plan task-by-task.

> Owner: John-Willikers <harlanbmiltonjr@gmail.com> · Created 2026-09-23 (America/Chicago) · Branch `feat/tray-app`
> Design: `docs/plans/2026-09-23-tray-app-design.md`

**Goal:** A Windows tray app (Electron) that uploads like the CLI and keeps the `ForeverLedger` addon at the version
the ledger server recommends for the player's client build, updating itself from public GitHub Releases.

**Architecture:** Shared addon logic (manifest schema, version compare, zip verification) lives in
`packages/contracts` so the server and PC run the same checks. `apps/uploader` gains addon install/sync and a
watch event hook; the new `apps/desktop` bundles the uploader library into an Electron main process with esbuild.
The server stores releases and build pins, serves `/v1/addon/manifest`, and an admin CLI publishes from GitHub.

**Tech Stack:** TypeScript (NodeNext ESM), pnpm workspace, vitest, testcontainers Postgres, Fastify 5, Drizzle,
zod 4, fflate (zip), Electron + electron-builder + electron-updater, esbuild, Playwright `_electron`, GitHub
Actions, gitleaks.

---

## ✅ Progress checks

Status legend: ⬜ todo · 🟡 in progress · ✅ done · ⛔ blocked. Timestamps America/Chicago.

### 🌐 Phase 0 — Go public

- ✅ 0.1 gitleaks scan of full history is clean — 2026-09-23 01:13 CDT (11 commits, no leaks, no `flt_` tokens, no secret files)
- ✅ 0.2 Public repo created, `master` + `feat/tray-app` pushed — 2026-09-23 01:13 CDT → https://github.com/John-Willikers/forever-ledger
- ✅ 0.3 CI green on GitHub (run 35825738526, master) — 2026-09-23 01:14 CDT; `CLAUDE.md` workflow → branch/PR (e2d69ec)

### 📦 Phase 1 — Shared addon logic + uploader sync

- ✅ 1.1 contracts: `compareVersions`, `tocVersion`, `AddonManifest` schema, names — 2026-09-23 01:28 CDT (b34acd4)
- ✅ 1.2 contracts: `verifyAddonZip` (sha, zip-slip, size, `.toc` version) — 2026-09-23 01:28 CDT (28056c4, hardened after 2 review rounds: 03c40c5, 633871c; 63 tests)
- ✅ 1.3 uploader: `fetchManifest` client — 2026-09-23 01:56 CDT (6968487)
- ✅ 1.4 uploader: `installAddon` / `rollbackAddon` / `readInstalledVersion` — 2026-09-23 01:56 CDT (a2d4d82; crash-safe after review: a23687d, 0af5c43 — swap marker, recoverAddon, Windows-patient renames)
- ✅ 1.5 uploader: `syncAddon` orchestrator + pause-after-rollback state — 2026-09-23 01:56 CDT (0ceeb0f, da6a5a1; mutex, build from upload state; 218 tests)
- ✅ 1.6 uploader: `addon-sync` CLI command — 2026-09-23 02:05 CDT (ef2e4d7)
- ✅ 1.7 uploader: `startWatch` `onEvent` hook + `trigger()` — 2026-09-23 02:05 CDT (5634e4f)

### 🗄️ Phase 2 — Server

- ✅ 2.1 `addon_releases` + `addon_pins` tables, migration 0001 — 2026-09-23 02:07 CDT (930ff82)
- ✅ 2.2 `resolveManifest` + `GET /v1/addon/manifest` — 2026-09-23 02:07 CDT (f47da1e)
- ✅ 2.3 `publishRelease` (GitHub) + admin CLI `addon publish|pin|unpin|yank|list` — 2026-09-23 02:07 CDT (2900de2; a version's zip can never be swapped)
- ✅ 2.4 Deploy to VPS (build, PM2 restart, curl manifest → 404 "none published") — 2026-09-23 02:07 CDT (live: 401 without token, 404 `no addon release published` with)

### 🏷️ Phase 3 — Addon release automation

- ✅ 3.1 `scripts/check-addon-version.ts` + tests — 2026-09-23 02:07 CDT (024f317; also `--zip` verifies the release zip)
- ✅ 3.2 `.github/workflows/addon-release.yml` — 2026-09-23 02:07 CDT (2b9b67d; tag via env)
- ✅ 3.3 First release `addon-v0.2.1` → `addon publish 0.2.1` → manifest returns it — 2026-09-23 02:09 CDT (release run 35830126937; sha256 d3dc9190…; e2e `addon-sync` on the VPS installed 0.2.1 into a `_classic_beta_` tree, second run up to date)

### 🖥️ Phase 4 — Desktop app

- ✅ 4.1 Scaffold `apps/desktop` (esbuild, electron-builder, icons) — 2026-09-23 02:05 CDT (198fd11; Electron 44, `./lib` export, 962 KB bundle)
- ✅ 4.2 `deriveTrayState` + tests — 2026-09-23 02:05 CDT (cc2a467)
- 🟡 4.3 `LedgerController` (no Electron imports) + tests
- 🟡 4.4 Electron main: single instance, tray, window, IPC, login item, updater, toasts
- 🟡 4.5 Preload + renderer (setup view + four cards)
- ⬜ 4.6 Playwright Electron smoke test
- ⬜ 4.7 `app-release.yml` + Windows smoke job in CI
- ⬜ 4.8 First app release `v0.1.0`

### 🎁 Phase 5 — Wrap up

- ⬜ 5.1 README + CLAUDE.md updated, `pnpm check` green
- ⬜ 5.2 PR `feat/tray-app` → `master`, merged
- ⬜ 5.3 Manual checklist on the gaming PC (user)

---

## 📐 Conventions for every task

- TDD: write the failing test, run it and see it fail, implement, run it and see it pass, commit.
- Run one package's tests: `pnpm --filter <pkg> test -- <file>` (pkg names: `@forever-ledger/contracts`,
  `@forever-ledger/uploader`, `@forever-ledger/server`, `@forever-ledger/desktop`).
- Commit on `feat/tray-app` with identity `John-Willikers <harlanbmiltonjr@gmail.com>` (check `git config user.email`)
  and the trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- `pnpm check` before each phase's last commit. Prettier formats everything except `project-plans/`.
- Update this file's progress checks as each task lands (with a CDT timestamp: `TZ=America/Chicago date`).
- Code style: match the surrounding files (short doc comments, `node:` imports, `.js` import suffixes, no default
  exports).

---

## 🌐 Phase 0 — Go public

### Task 0.1: Secret scan

**Step 1:** Confirm the ignored secret files never entered history:

```bash
git log --all --oneline -- deploy/.env deploy/.first-token 'fixtures/real/*.lua'
```

Expected: no output.

**Step 2:** Scan all commits:

```bash
docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:latest git /repo --redact -v
```

Expected: `no leaks found`. Any finding → stop, show the user, do not publish.

**Step 3:** Grep for token material in history: `git log -p --all | grep -n 'flt_[A-Za-z0-9_-]\{20,\}'` → expect
none (test tokens are minted at runtime).

### Task 0.2: Create the public repo

```bash
gh repo create John-Willikers/forever-ledger --public \
  --description "Passive data collector for World of Warcraft: Forever (addon, uploader, ingest API)" \
  --source . --remote origin
git push -u origin master
```

Set `main` branch expectations: the repo's default branch is `master`.

### Task 0.3: CI + workflow docs

**Files:** Modify `.github/workflows/ci.yml:1` (drop the "Inactive until…" comment), `CLAUDE.md` Workflow section.

`CLAUDE.md` Workflow bullet becomes:

```markdown
- Public repo `John-Willikers/forever-ledger`. Work on a branch → PR → merge to `master` (alpha direct commits ended
  2026-09-23).
```

**Verify:** after pushing the branch, `gh run list --limit 3` shows the `ci` run green on `master`. If the runner
lacks something (e.g. the `lua-check` apt package name), fix `ci.yml` and push again.

Commit: `chore: go public — CI active, branch/PR workflow`.

---

## 📦 Phase 1 — Shared addon logic + uploader sync

### Task 1.1: Version helpers and manifest schema (contracts)

**Files:**

- Create: `packages/contracts/src/addon.ts`
- Modify: `packages/contracts/src/index.ts` (export `./addon.js`)
- Test: `packages/contracts/test/addon.test.ts`

**Step 1: failing test**

```ts
import { describe, expect, it } from 'vitest';
import {
  addonAssetName,
  addonTag,
  AddonManifest,
  compareVersions,
  isAddonVersion,
  tocVersion,
} from '../src/index.js';

describe('addon versions', () => {
  it('compares dotted numeric versions', () => {
    expect(compareVersions('0.2.10', '0.2.9')).toBe(1);
    expect(compareVersions('0.2.1', '0.2.1')).toBe(0);
    expect(compareVersions('0.2', '0.2.0')).toBe(0);
    expect(compareVersions('1.0.0', '0.9.9')).toBe(1);
    expect(compareVersions('0.1.0', '0.2.0')).toBe(-1);
  });

  it('accepts only x.y.z versions', () => {
    expect(isAddonVersion('0.2.1')).toBe(true);
    expect(isAddonVersion('0.2')).toBe(false);
    expect(isAddonVersion('0.2.1-beta')).toBe(false);
    expect(isAddonVersion('../0.2.1')).toBe(false);
  });

  it('reads ## Version from a .toc', () => {
    expect(tocVersion('## Interface: 16001\r\n## Title: X\r\n## Version: 0.2.1\r\n')).toBe('0.2.1');
    expect(tocVersion('## Interface: 16001\n')).toBeUndefined();
  });

  it('names tags and assets', () => {
    expect(addonTag('0.2.1')).toBe('addon-v0.2.1');
    expect(addonAssetName('0.2.1')).toBe('ForeverLedger-0.2.1.zip');
  });

  it('validates a manifest', () => {
    const ok = {
      addon: 'ForeverLedger',
      version: '0.2.1',
      url: 'https://github.com/John-Willikers/forever-ledger/releases/download/addon-v0.2.1/ForeverLedger-0.2.1.zip',
      sha256: 'a'.repeat(64),
      size: 1234,
    };
    expect(AddonManifest.parse(ok)).toEqual(ok);
    expect(AddonManifest.safeParse({ ...ok, sha256: 'xyz' }).success).toBe(false);
    expect(AddonManifest.safeParse({ ...ok, url: 'http://evil.example/x.zip' }).success).toBe(false);
  });
});
```

**Step 2:** `pnpm --filter @forever-ledger/contracts test -- addon` → FAIL (module has no such exports).

**Step 3: implementation** `packages/contracts/src/addon.ts`

```ts
import { z } from 'zod';

/** The addon the tray app and `addon-sync` manage. ForeverLedgerProbe is never auto-updated. */
export const ADDON_NAME = 'ForeverLedger';
export const ADDON_REPO = 'John-Willikers/forever-ledger';
/** Downloads must come from this repo's releases. */
export const ADDON_DOWNLOAD_PREFIX = `https://github.com/${ADDON_REPO}/releases/download/`;
export const MAX_ADDON_BYTES = 5 * 1024 * 1024;

const VERSION_RE = /^\d+\.\d+\.\d+$/;
export const isAddonVersion = (v: string) => VERSION_RE.test(v);
export const addonTag = (version: string) => `addon-v${version}`;
export const addonAssetName = (version: string) => `${ADDON_NAME}-${version}.zip`;

/** Compares dotted numeric versions ("0.2.10" > "0.2.9"); missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

/** Reads `## Version: x.y.z` from a .toc file's text. */
export function tocVersion(toc: string): string | undefined {
  return /^##\s*Version:\s*(\S+)\s*$/m.exec(toc)?.[1];
}

/** GET /v1/addon/manifest response: the addon version this client build should run. */
export const AddonManifest = z.object({
  addon: z.literal(ADDON_NAME),
  version: z.string().regex(VERSION_RE),
  url: z.string().startsWith(ADDON_DOWNLOAD_PREFIX),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.number().int().positive().max(MAX_ADDON_BYTES),
});
export type AddonManifest = z.infer<typeof AddonManifest>;
```

**Step 4:** test → PASS. **Step 5:** commit `feat(contracts): addon version helpers and manifest schema`.

### Task 1.2: `verifyAddonZip` (contracts)

**Files:** Create `packages/contracts/src/addonZip.ts`; export from index; test
`packages/contracts/test/addonZip.test.ts`. Add dependency: `pnpm --filter @forever-ledger/contracts add fflate`.

**Step 1: failing test** (build zips in memory with `fflate.zipSync`):

```ts
import { createHash } from 'node:crypto';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { AddonZipError, verifyAddonZip } from '../src/index.js';

const TOC = '## Interface: 16001\n## Title: Forever Ledger\n## Version: 0.2.2\nForeverLedger.lua\n';
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const zip = (entries: Record<string, string>) =>
  zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)])));
const good = () =>
  zip({ 'ForeverLedger/ForeverLedger.toc': TOC, 'ForeverLedger/ForeverLedger.lua': '-- lua' });

describe('verifyAddonZip', () => {
  it('returns files relative to the addon folder', () => {
    const z = good();
    const files = verifyAddonZip(z, { version: '0.2.2', sha256: sha(z) });
    expect([...files.keys()].sort()).toEqual(['ForeverLedger.lua', 'ForeverLedger.toc']);
  });

  it('rejects a sha256 mismatch', () => {
    expect(() => verifyAddonZip(good(), { version: '0.2.2', sha256: '0'.repeat(64) })).toThrow(
      /sha256/,
    );
  });

  it.each([
    ['../evil.lua'],
    ['ForeverLedger/../../evil.lua'],
    ['/etc/evil'],
    ['C:/evil.lua'],
    ['ForeverLedger\\..\\evil.lua'],
    ['OtherAddon/x.lua'],
    ['ForeverLedger.lua'],
  ])('rejects unsafe entry %s', (name) => {
    const z = zip({ 'ForeverLedger/ForeverLedger.toc': TOC, [name]: 'x' });
    expect(() => verifyAddonZip(z, { version: '0.2.2', sha256: sha(z) })).toThrow(AddonZipError);
  });

  it('rejects a .toc with another version', () => {
    const z = good();
    expect(() => verifyAddonZip(z, { version: '0.2.3', sha256: sha(z) })).toThrow(/version/);
  });

  it('rejects a zip without a .toc', () => {
    const z = zip({ 'ForeverLedger/ForeverLedger.lua': '-- lua' });
    expect(() => verifyAddonZip(z, { version: '0.2.2', sha256: sha(z) })).toThrow(/toc/);
  });

  it('rejects oversized contents', () => {
    const z = zip({
      'ForeverLedger/ForeverLedger.toc': TOC,
      'ForeverLedger/big.lua': 'x'.repeat(6 * 1024 * 1024),
    });
    expect(() => verifyAddonZip(z, { version: '0.2.2', sha256: sha(z) })).toThrow(/large/);
  });
});
```

**Step 2:** run → FAIL.

**Step 3: implementation** `packages/contracts/src/addonZip.ts`

```ts
import { createHash } from 'node:crypto';
import { strFromU8, unzipSync } from 'fflate';
import { ADDON_NAME, MAX_ADDON_BYTES, tocVersion } from './addon.js';

export class AddonZipError extends Error {
  override name = 'AddonZipError';
}

/**
 * Checks a downloaded addon zip before anything touches disk: sha256, entry paths (all under ForeverLedger/, no
 * traversal), unpacked size and the .toc version. Returns file contents keyed by path inside the addon folder.
 */
export function verifyAddonZip(
  zip: Uint8Array,
  expected: { version: string; sha256: string },
): Map<string, Uint8Array> {
  if (zip.byteLength > MAX_ADDON_BYTES) throw new AddonZipError('addon zip is too large');
  const actual = createHash('sha256').update(zip).digest('hex');
  if (actual !== expected.sha256) {
    throw new AddonZipError(`sha256 mismatch: expected ${expected.sha256}, got ${actual}`);
  }

  let total = 0;
  const entries = unzipSync(zip, {
    filter: (f) => {
      total += f.originalSize;
      if (total > MAX_ADDON_BYTES) throw new AddonZipError('addon is too large when unpacked');
      return true;
    },
  });

  const files = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith('/')) continue; // directory entry
    const parts = name.split('/');
    const unsafe =
      name.includes('\\') ||
      name.startsWith('/') ||
      /^[A-Za-z]:/.test(name) ||
      parts.some((p) => p === '' || p === '.' || p === '..');
    if (unsafe || parts[0] !== ADDON_NAME || parts.length < 2) {
      throw new AddonZipError(`unexpected entry in addon zip: ${name}`);
    }
    files.set(parts.slice(1).join('/'), data);
  }

  const toc = files.get(`${ADDON_NAME}.toc`);
  if (!toc) throw new AddonZipError(`addon zip has no ${ADDON_NAME}/${ADDON_NAME}.toc`);
  const v = tocVersion(strFromU8(toc));
  if (v !== expected.version) {
    throw new AddonZipError(`.toc version ${v ?? '(none)'} does not match ${expected.version}`);
  }
  return files;
}
```

**Step 4:** PASS. **Step 5:** commit `feat(contracts): verifyAddonZip`.

> 🔒 **Hardened after code review (2026-09-23):** the code above had holes: an unpacked-size bypass via overlapping
> stored entries, Windows path segments (`C:`, `:ads`, `CON`, trailing dots), case-colliding `.toc` names and a `../`
> manifest URL. The shipped version uses a per-segment allowlist, case-folded duplicate checks, stored/overlap size
> accounting, per-entry length checks, wrapped fflate errors, an exact manifest URL, a single-line `tocVersion` and a
> throwing `compareVersions`. See design rule 3 and commit `fix(contracts): harden verifyAddonZip and manifest url`.

### Task 1.3: Manifest client (uploader)

**Files:** Create `apps/uploader/src/addonManifest.ts`; test `apps/uploader/test/addonManifest.test.ts`. Read
`apps/uploader/src/client.ts` first and reuse its `FetchLike` type and URL-joining style.

Behaviour of `fetchManifest({ serverUrl, token, build?, fetchImpl? }): Promise<AddonManifest | null>`:

- `GET {serverUrl}/v1/addon/manifest[?build=N]` with `authorization: Bearer <token>`.
- 200 → `AddonManifest.parse(body)` (throws on a bad shape). 404 → `null`. 401 → throw `AddonSyncError('token
  rejected')`. Other statuses / network errors → throw `AddonSyncError` with the status text.
- Export `class AddonSyncError extends Error`.

Tests (use a `fetchImpl` stub returning `new Response(...)`): sends bearer + build param; omits build when
undefined; 404 → null; 401 → throws /token/; bad body → throws; 500 → throws.

Commit `feat(uploader): addon manifest client`.

### Task 1.4: Install, rollback, installed version (uploader)

**Files:** Create `apps/uploader/src/addonInstall.ts`; test `apps/uploader/test/addonInstall.test.ts`.

**Step 1: failing tests** (temp dir per test via `mkdtemp(join(tmpdir(), 'fl-addon-'))`):

```ts
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8 } from 'fflate';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addonsDirFor,
  installAddon,
  readInstalledVersion,
  rollbackAddon,
} from '../src/addonInstall.js';

const toc = (v: string) => `## Interface: 16001\n## Version: ${v}\n`;
const files = (v: string) =>
  new Map([
    ['ForeverLedger.toc', strToU8(toc(v))],
    ['ForeverLedger.lua', strToU8(`-- ${v}`)],
  ]);

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fl-addon-'));
});

describe('addon install', () => {
  it('derives Interface/AddOns from a WTF folder', () => {
    expect(addonsDirFor(join('C:', 'Games', 'Forever', '_classic_', 'WTF'))).toBe(
      join('C:', 'Games', 'Forever', '_classic_', 'Interface', 'AddOns'),
    );
  });

  it('installs into an empty AddOns folder', async () => {
    await installAddon(dir, files('0.2.1'));
    expect(await readInstalledVersion(dir)).toBe('0.2.1');
    expect(await readdir(dir)).toEqual(['ForeverLedger']);
  });

  it('keeps the previous version as ForeverLedger.bak', async () => {
    await installAddon(dir, files('0.2.1'));
    await installAddon(dir, files('0.2.2'));
    expect(await readInstalledVersion(dir)).toBe('0.2.2');
    expect(await readFile(join(dir, 'ForeverLedger.bak', 'ForeverLedger.lua'), 'utf8')).toBe(
      '-- 0.2.1',
    );
  });

  it('puts the old version back when the final rename fails', async () => {
    await installAddon(dir, files('0.2.1'));
    let calls = 0;
    const rename = async (from: string, to: string) => {
      calls++;
      if (calls === 2) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      const { rename: fsRename } = await import('node:fs/promises');
      await fsRename(from, to);
    };
    await expect(installAddon(dir, files('0.2.2'), { rename })).rejects.toThrow(/busy/);
    expect(await readInstalledVersion(dir)).toBe('0.2.1');
    expect((await readdir(dir)).sort()).toEqual(['ForeverLedger']);
  });

  it('rolls back to .bak', async () => {
    await installAddon(dir, files('0.2.1'));
    await installAddon(dir, files('0.2.2'));
    expect(await rollbackAddon(dir)).toBe('0.2.1');
    expect(await readInstalledVersion(dir)).toBe('0.2.1');
  });

  it('refuses to roll back without a .bak', async () => {
    await installAddon(dir, files('0.2.1'));
    await expect(rollbackAddon(dir)).rejects.toThrow(/no previous version/);
  });

  it('reports no version when the addon is missing', async () => {
    expect(await readInstalledVersion(dir)).toBeUndefined();
    await mkdir(join(dir, 'ForeverLedger'));
    await writeFile(join(dir, 'ForeverLedger', 'ForeverLedger.toc'), '## Title: x\n');
    expect(await readInstalledVersion(dir)).toBeUndefined();
  });
});
```

**Step 2:** run → FAIL.

**Step 3: implementation** `apps/uploader/src/addonInstall.ts`

```ts
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ADDON_NAME, tocVersion } from '@forever-ledger/contracts';
import { isNotFound, renameWithRetry } from './fsutil.js';

type Rename = (from: string, to: string) => Promise<void>;

/** `<flavor>/WTF` → `<flavor>/Interface/AddOns`. */
export const addonsDirFor = (wtfDir: string) => join(dirname(wtfDir), 'Interface', 'AddOns');

const exists = (p: string) =>
  stat(p).then(
    () => true,
    (err: unknown) => {
      if (isNotFound(err)) return false;
      throw err;
    },
  );

/** Version from AddOns/ForeverLedger/ForeverLedger.toc, or undefined when missing. */
export async function readInstalledVersion(
  addonsDir: string,
  folder = ADDON_NAME,
): Promise<string | undefined> {
  try {
    return tocVersion(await readFile(join(addonsDir, folder, `${ADDON_NAME}.toc`), 'utf8'));
  } catch (err) {
    if (isNotFound(err)) return undefined;
    throw err;
  }
}

/**
 * Writes the new files to AddOns/.ForeverLedger.new, moves the current folder to ForeverLedger.bak and the new one
 * into place. If the last rename fails the old folder is moved back. WoW ignores both side folders: a folder only
 * loads when it holds a .toc with its own name.
 */
export async function installAddon(
  addonsDir: string,
  files: Map<string, Uint8Array>,
  deps: { rename?: Rename } = {},
): Promise<void> {
  const rename = deps.rename ?? renameWithRetry;
  const target = join(addonsDir, ADDON_NAME);
  const staging = join(addonsDir, `.${ADDON_NAME}.new`);
  const bak = join(addonsDir, `${ADDON_NAME}.bak`);

  await mkdir(addonsDir, { recursive: true });
  await rm(staging, { recursive: true, force: true });
  for (const [rel, data] of files) {
    const path = join(staging, ...rel.split('/'));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  const hadOld = await exists(target);
  if (hadOld) {
    await rm(bak, { recursive: true, force: true });
    await rename(target, bak);
  }
  try {
    await rename(staging, target);
  } catch (err) {
    if (hadOld) await rename(bak, target);
    await rm(staging, { recursive: true, force: true });
    throw err;
  }
}

/** Swaps ForeverLedger.bak back in. Returns the restored version. */
export async function rollbackAddon(
  addonsDir: string,
  deps: { rename?: Rename } = {},
): Promise<string> {
  const rename = deps.rename ?? renameWithRetry;
  const target = join(addonsDir, ADDON_NAME);
  const bak = join(addonsDir, `${ADDON_NAME}.bak`);
  const old = join(addonsDir, `.${ADDON_NAME}.old`);
  const version = await readInstalledVersion(addonsDir, `${ADDON_NAME}.bak`);
  if (!version) throw new Error(`no previous version to roll back to in ${addonsDir}`);

  await rm(old, { recursive: true, force: true });
  if (await exists(target)) await rename(target, old);
  await rename(bak, target);
  await rm(old, { recursive: true, force: true });
  return version;
}
```

Add `fflate` to the uploader's devDependencies for the test (`pnpm --filter @forever-ledger/uploader add -D fflate`).

**Step 4:** PASS. **Step 5:** commit `feat(uploader): atomic addon install and rollback`.

### Task 1.5: `syncAddon` orchestrator (uploader)

**Files:** Create `apps/uploader/src/addonSync.ts`; export from `apps/uploader/src/index.ts` along with 1.3/1.4;
test `apps/uploader/test/addonSync.test.ts`.

**API**

```ts
export interface AddonSyncOptions {
  config: Config;
  fetchImpl?: FetchLike;
  logger?: Logger;
  /** Install even while paused after a manual rollback. */
  force?: boolean;
}
export type AddonSyncStatus = 'up-to-date' | 'installed' | 'paused' | 'no-release' | 'error';
export interface AddonSyncResult {
  status: AddonSyncStatus;
  recommended?: string; // manifest version
  installed?: string; // version on disk after this run (first AddOns dir)
  build?: number; // client build sent to the server
  addonsDirs: string[];
  checkedAt: number; // epoch seconds
  error?: string;
}
export async function syncAddon(opts: AddonSyncOptions): Promise<AddonSyncResult>;
export async function rollbackAddonEverywhere(opts: { config: Config }): Promise<string>;
export async function readAddonSyncState(config: Config): Promise<AddonSyncState>;
```

State file `join(config.stateDir, 'addon-sync.json')`, written with `writeJsonAtomic`:
`{ pausedWhileRecommended?: string; last?: AddonSyncResult }`.

**Algorithm**

1. `const { serverUrl, token } = requireServer(config)`; `discoverSavedVariables(config.wowPath, { accounts:
   config.accounts })` → `addonsDirs = unique(d.wtfDirs.map(addonsDirFor))`. None → status `error`, error
   `"no WTF folder found under <wowPath> — start the game once"`.
2. `build` = highest `meta.build` among `d.files` read with `readSavedVariable(file, { global: 'ForeverLedgerDB' })`
   (ignore files that fail to parse; `undefined` when none).
3. `manifest = await fetchManifest(...)`; `null` → `no-release`.
4. Pause: if `state.pausedWhileRecommended === manifest.version && !force` → `paused`. If it is set to a different
   version, clear it (the server changed its mind; resume).
5. For each dir whose `readInstalledVersion` ≠ `manifest.version`: download once (`fetchImpl(manifest.url)`; reject
   non-2xx and bodies over `MAX_ADDON_BYTES`), `verifyAddonZip(bytes, manifest)`, `installAddon(dir, files)`.
   Any install → `installed`, else `up-to-date`.
6. Any thrown error → `error` with the message (never throws for network/zip/fs problems; still throws for
   `ConfigError`). Save `last` to state; log `info` on install, `warn` on error.

`rollbackAddonEverywhere`: rolls back every AddOns dir that has a `.bak`, then sets `pausedWhileRecommended` to
`state.last?.recommended` (so the next sync doesn't reinstall) and returns the restored version.

**Tests** (temp WoW tree: `<tmp>/_classic_/WTF/Account/ACC1/SavedVariables/ForeverLedger.lua` containing
`ForeverLedgerDB = { ["meta"] = { ["build"] = 69913, ["schemaVersion"] = 1 } }`; fetch stub serves the manifest and
the zip built with `zipSync`; config via `resolveConfig({ wowPath, accounts: [], serverUrl: 'http://ledger.test',
token: 'flt_x', uploaderId: 'pc' }, join(tmp, 'config.json'))`):

- installs when missing → `installed`, version on disk, manifest request carried `build=69913`
- second run → `up-to-date`, zip not downloaded again
- server recommends an older version (pin) → installs it
- sha mismatch → `error` /sha256/, installed version unchanged
- 404 manifest → `no-release`
- rollback → restores `.bak`, next sync → `paused`; after the manifest changes to another version → installs again
- `force: true` installs while paused

Commit `feat(uploader): addon sync with pause-after-rollback`.

### Task 1.6: `addon-sync` CLI command

**Files:** Modify `apps/uploader/src/program.ts` (follow the `status` command's pattern: `resolveConfigPath` →
`loadConfig` → action → `out`), test in `apps/uploader/test/cli.test.ts` (follow the existing CLI test style).

```
forever-ledger addon-sync [--force] [--rollback]
```

Prints one line: `addon 0.2.2 installed in <dir>` / `addon up to date (0.2.2)` / `paused after rollback: server
still recommends 0.2.2 (use --force)` / `no addon release published` / `addon sync failed: <msg>` (exit 1). Takes
the uploader lock via `withLock(config.stateDir, …)`.

Commit `feat(uploader): addon-sync command`.

### Task 1.7: Watch events + manual trigger

**Files:** Modify `apps/uploader/src/watch.ts`; test `apps/uploader/test/watch.test.ts` (extend).

- `WatchOptions.onEvent?: (e: WatchEvent) => void` where
  `type WatchEvent = { type: 'pass-start' } | { type: 'pass-end'; result: PassResult } | { type: 'fatal'; error:
  FatalUploadError }`. Emit around each pass wherever `watch.ts` runs `runUploadPass`/`runFlush` (wrap in `try`
  so a throwing listener never breaks the loop).
- `WatchHandle.trigger(): void` marks every watched file pending (same as the initial `pendingAll = true`) and
  wakes the loop.

Tests: events arrive in order `pass-start`, `pass-end` for the initial pass; `trigger()` causes another pass
against the mock server; a listener that throws doesn't stop watching.

Commit `feat(uploader): watch events and trigger`. Run `pnpm check`, update progress checks.

---

## 🗄️ Phase 2 — Server

### Task 2.1: Tables + migration

**Files:** Modify `apps/server/src/db/schema.ts` (append), generate `apps/server/drizzle/0001_*.sql`.

```ts
export const addonReleases = pgTable('addon_releases', {
  version: text('version').primaryKey(),
  url: text('url').notNull(),
  sha256: text('sha256').notNull(),
  size: integer('size').notNull(),
  status: text('status', { enum: ['active', 'yanked'] })
    .notNull()
    .default('active'),
  publishedAt: tz('published_at').notNull().defaultNow(),
});

/** Client builds [buildMin, buildMax] (buildMax null = open-ended) that must run a given addon version. */
export const addonPins = pgTable('addon_pins', {
  id: serial('id').primaryKey(),
  buildMin: integer('build_min').notNull(),
  buildMax: integer('build_max'),
  version: text('version')
    .notNull()
    .references(() => addonReleases.version),
  createdAt: tz('created_at').notNull().defaultNow(),
});
```

Run `pnpm --filter @forever-ledger/server db:generate --name addon_releases` and inspect the SQL (two `CREATE TABLE`
and one FK, nothing else). Existing tests must still pass (`runMigrations` applies it). Commit
`feat(server): addon release and pin tables`.

### Task 2.2: Manifest resolution + route

**Files:** Create `apps/server/src/addon.ts`, `apps/server/src/routes/addon.ts`; modify `apps/server/src/app.ts`
(`registerAddonRoutes(app, db)` after export routes) and `apps/server/src/index.ts` (export addon functions); test
`apps/server/test/addon.test.ts` (uses `startServer()` from `test/helpers.ts`; insert rows with Drizzle directly).

`resolveManifest(db, build: number | null): Promise<AddonManifest | null>`:

```ts
const releases = await db.select().from(addonReleases).where(eq(addonReleases.status, 'active'));
const active = new Map(releases.map((r) => [r.version, r]));
if (build !== null) {
  const pins = await db
    .select()
    .from(addonPins)
    .where(
      and(
        lte(addonPins.buildMin, build),
        or(isNull(addonPins.buildMax), gte(addonPins.buildMax, build)),
      ),
    )
    .orderBy(desc(addonPins.id));
  for (const p of pins) {
    const r = active.get(p.version);
    if (r) return toManifest(r);
  }
}
const newest = [...active.values()].sort((a, b) => compareVersions(b.version, a.version))[0];
return newest ? toManifest(newest) : null;
```

`toManifest(r)` → `{ addon: ADDON_NAME, version, url, sha256, size }`.

Route: `GET /v1/addon/manifest` with `preHandler: requireToken(db)` (import from `routes/analysis.ts`); `build` query
→ positive integer or null (reuse the `buildFilter` idea); `null` result → 404 `{ error: NO_ADDON_RELEASE }` —
**import the constant from contracts**: the uploader treats a 404 as "no release" only when the body matches it.

Tests: 401 without token; 404 with no releases; newest active wins (`0.2.10` over `0.2.9`); yanked skipped; pin
covering the build wins; newer pin beats older overlapping pin; pin to a yanked version ignored; no `build` param
ignores pins; open-ended pin (`buildMax` null).

Commit `feat(server): addon manifest endpoint`.

### Task 2.3: Publish from GitHub + admin CLI

**Files:** Modify `apps/server/src/addon.ts` (add `publishRelease`, `pinVersion`, `unpin`, `yankVersion`,
`listAddon`), `apps/server/src/env.ts` (`githubRepo: env.GITHUB_REPO ?? ADDON_REPO`); create
`apps/server/src/addon-cli.ts` (mirror `tokens-cli.ts`); `apps/server/package.json` script
`"addon": "node dist/addon-cli.js"`; extend `apps/server/test/addon.test.ts`. The server already gets `fflate`
through contracts; no new dependency.

`publishRelease(db, version, { repo, fetchImpl = fetch })`:

1. `isAddonVersion(version)` or throw.
2. `GET https://api.github.com/repos/${repo}/releases/tags/${addonTag(version)}` with headers
   `accept: application/vnd.github+json`, `user-agent: forever-ledger-server`. 404 → throw "no GitHub release
   addon-vX".
3. Find asset named `addonAssetName(version)`; download `browser_download_url`.
4. `sha256` of the bytes; `verifyAddonZip(bytes, { version, sha256 })` (proves the zip is well-formed and its
   `.toc` matches).
5. Upsert `addon_releases` `{ version, url: browser_download_url, sha256, size, status: 'active' }`
   (`onConflictDoUpdate` on version). Return the manifest.

CLI:

```
node dist/addon-cli.js publish <version>
node dist/addon-cli.js pin <buildMin>-<buildMax|> <version>     # "69913-" = open-ended
node dist/addon-cli.js unpin <id>
node dist/addon-cli.js yank <version>
node dist/addon-cli.js list        # releases (status, published CDT) and pins
```

Tests: publish with a fake `fetchImpl` (release JSON + zip) stores the row with the computed sha; missing asset
throws; tampered zip (wrong `.toc` version) throws and stores nothing; pin/unpin/yank change what
`resolveManifest` returns.

Commit `feat(server): addon publish/pin/yank admin CLI`.

### Task 2.4: Deploy

```bash
pnpm build
pm2 restart forever-ledger-api --update-env
curl -s https://ledger.willikers.dev/v1/health
curl -s -H "authorization: Bearer $(cat deploy/.first-token)" https://ledger.willikers.dev/v1/addon/manifest
```

Expected: health ok (migration 0001 ran at startup), manifest `{"error":"no addon release published"}`. Run
`pm2 save` only after checking `pm2 jlist` still lists just `forever-ledger-api` (see memory note), and
`cp ~/.pm2/dump.pm2 ~/.pm2/dump.pm2.bak-$(date +%F)` first.

---

## 🏷️ Phase 3 — Addon release automation

### Task 3.1: Version consistency check

**Files:** Create `scripts/check-addon-version.ts`, `scripts/check-addon-version.test.ts`; modify
`vitest.config.ts` (add an inline project `{ test: { name: 'scripts', include: ['scripts/**/*.test.ts'] } }`) and
`tsconfig.scripts.json` if it doesn't already include `scripts/**`.

`checkAddonVersion(root: string, tagVersion: string): string[]` returns problems: tag not `x.y.z`; `.toc`
`## Version` ≠ tag; `local VERSION = "…"` in `addon/ForeverLedger/ForeverLedger.lua` ≠ tag. CLI entry (when run
directly): prints problems, exits 1 if any, else prints `ForeverLedger <v> ok`.

Tests against a temp copy of the two files: all match → `[]`; each mismatch reported; bad tag reported.

Commit `feat(scripts): check-addon-version`.

### Task 3.2: Addon release workflow

**Files:** Create `.github/workflows/addon-release.yml`:

```yaml
name: addon-release
on:
  push:
    tags: ['addon-v*']
permissions:
  contents: write
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: sudo apt-get update && sudo apt-get install -y lua-check lua5.1
      - run: pnpm install --frozen-lockfile
      - id: v
        run: echo "version=${GITHUB_REF_NAME#addon-v}" >> "$GITHUB_OUTPUT"
      - run: node --conditions=development --import tsx scripts/check-addon-version.ts "${{ steps.v.outputs.version }}"
      - run: pnpm run check
      - run: cd addon && zip -r "../ForeverLedger-${{ steps.v.outputs.version }}.zip" ForeverLedger -x '*/.luacheckrc'
      # --latest=false: electron-updater reads GitHub's "latest release", which must stay an app release.
      - run: >
          gh release create "$GITHUB_REF_NAME" "ForeverLedger-${{ steps.v.outputs.version }}.zip"
          --title "ForeverLedger addon ${{ steps.v.outputs.version }}" --generate-notes --latest=false
        env:
          GH_TOKEN: ${{ github.token }}
```

Commit `ci: addon release workflow`.

### Task 3.3: First addon release (0.2.1)

Release from `master`, so Phases 0–3 merge first in their own PR. Order:
push the branch, open the PR (Phase 5.2 draft), merge Phases 0–3 via PR, then on `master`:

```bash
git tag addon-v0.2.1 && git push origin addon-v0.2.1
gh run watch --exit-status $(gh run list --workflow addon-release --limit 1 --json databaseId -q '.[0].databaseId')
gh release view addon-v0.2.1 --json assets,isLatest
cd apps/server && node dist/addon-cli.js publish 0.2.1
curl -s -H "authorization: Bearer $(cat ../../deploy/.first-token)" \
  "https://ledger.willikers.dev/v1/addon/manifest?build=69913"
```

Expected: release has `ForeverLedger-0.2.1.zip`, `isLatest: false`; manifest returns version `0.2.1` with the
sha256. Then `forever-ledger addon-sync` against a temp WoW tree on the VPS installs it.

---

## 🖥️ Phase 4 — Desktop app

### Task 4.1: Scaffold `apps/desktop`

**Files:**

- `apps/desktop/package.json`: name `@forever-ledger/desktop`, `version` `0.1.0`, `private`, `main`
  `dist/main.mjs`, author as root, scripts `build` (`node build.mjs`), `typecheck`, `test` (`vitest run`),
  `test:smoke` (`playwright test`), `dist` (`pnpm build && electron-builder --win`). **Everything goes in
  `devDependencies`** (the bundle carries the code; electron-builder then packages no `node_modules`):
  `electron`, `electron-builder`, `electron-updater`, `esbuild`, `@playwright/test`,
  `@forever-ledger/uploader: workspace:*`, `@forever-ledger/contracts: workspace:*`.
- `pnpm-workspace.yaml` `allowBuilds`: add `electron: true` (downloads the Electron binary).
- `apps/desktop/build.mjs`:

```js
import { cp, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';

const node = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  conditions: ['development'], // bundle workspace packages from src/*.ts
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
};
await mkdir('dist', { recursive: true });
await build({
  ...node,
  entryPoints: ['src/main/main.ts'],
  outfile: 'dist/main.mjs',
  format: 'esm',
  // CommonJS dependencies inside an ESM bundle need a real require for node builtins.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
await build({ ...node, entryPoints: ['src/preload.ts'], outfile: 'dist/preload.cjs', format: 'cjs' });
await build({
  bundle: true,
  platform: 'browser',
  format: 'iife',
  entryPoints: ['src/renderer/renderer.ts'],
  outfile: 'dist/renderer.js',
  sourcemap: true,
  logLevel: 'info',
});
await cp('src/renderer/index.html', 'dist/index.html');
await cp('src/renderer/styles.css', 'dist/styles.css');
```

- `apps/desktop/electron-builder.yml`:

```yaml
appId: dev.willikers.forever-ledger
productName: Forever Ledger
directories:
  output: release
files:
  - dist/**
  - assets/**
  - package.json
npmRebuild: false
win:
  target: nsis
  icon: assets/icon.png
nsis:
  oneClick: true
  perMachine: false
publish:
  provider: github
  owner: John-Willikers
  repo: forever-ledger
  releaseType: release
```

- `apps/desktop/scripts/make-icons.mjs`: writes `assets/tray-{idle,uploading,queued,error}.png` (32×32 filled circles:
  green `#2e9d57`, blue `#2f6fd6`, amber `#d99a1e`, red `#cf3a3a` on transparent) and `assets/icon.png` (256×256,
  a gold "L" on a dark rounded square) using a tiny PNG encoder (`zlib.deflateSync` + CRC32 per chunk). Commit the
  generated PNGs.
- `apps/desktop/tsconfig.json` (extends base, `lib: ["ES2023", "DOM"]`, include `src`, `test`, `*.ts`),
  `apps/desktop/vitest.config.ts` (`name: 'desktop'`, include `test/**/*.test.ts`, exclude `test/smoke/**`),
  `.gitignore` += `apps/desktop/release/`.
- `eslint.config.js`: add `{ files: ['apps/desktop/src/renderer/**'], languageOptions: { globals: { ...globals.browser } } }`.

**Verify:** a placeholder `src/main/main.ts` (`import { app } from 'electron'; app.whenReady().then(() => app.quit())`),
`pnpm --filter @forever-ledger/desktop build` succeeds and `dist/main.mjs` exists. If the bundle pulls in
`program.ts`'s top-level `package.json` read and it breaks, add a `./lib` export to the uploader that omits
`buildProgram` and import from it.

Commit `feat(desktop): scaffold Electron app`.

### Task 4.2: Tray state

**Files:** `apps/desktop/src/main/state.ts`, `apps/desktop/test/state.test.ts`.

```ts
import type { AccountStatus, AddonSyncResult } from '@forever-ledger/uploader';

export type TrayState = 'idle' | 'uploading' | 'queued' | 'error';

/** Everything the window and tray show. Sent to the renderer as-is. */
export interface Snapshot {
  setupNeeded: boolean;
  paused: boolean;
  uploading: boolean;
  accounts: AccountStatus[];
  fatal?: string;
  addon?: AddonSyncResult;
  addonPausedFor?: string;
  appVersion: string;
  appUpdateReady?: string;
  settings: { wowPath?: string; tokenSet: boolean; startWithWindows: boolean; autoUpdateAddon: boolean };
}

export function deriveTrayState(s: Snapshot): TrayState {
  if (s.fatal || s.addon?.status === 'error') return 'error';
  if (s.uploading) return 'uploading';
  if (s.accounts.some((a) => a.queuedBatches > 0)) return 'queued';
  return 'idle';
}

export const TRAY_TOOLTIP: Record<TrayState, string> = {
  idle: 'Forever Ledger: up to date',
  uploading: 'Forever Ledger: uploading…',
  queued: 'Forever Ledger: waiting for the server (batches queued)',
  error: 'Forever Ledger: needs attention',
};
```

Tests: each state, priority error > uploading > queued > idle. Commit `feat(desktop): tray state`.

### Task 4.3: `LedgerController`

**Files:** `apps/desktop/src/main/controller.ts`, `apps/desktop/test/controller.test.ts`. **No `electron` import**
in this file; everything external is injected so tests use fakes.

```ts
export interface ControllerDeps {
  configPath: string;
  loadConfig: typeof loadConfig;
  saveConfig: typeof saveConfig;
  acquireLock: typeof acquireLock;
  startWatch: typeof startWatch;
  collectStatus: typeof collectStatus;
  syncAddon: typeof syncAddon;
  rollbackAddonEverywhere: typeof rollbackAddonEverywhere;
  logger: Logger;
  appVersion: string;
  prefs: { get(): Prefs; set(p: Prefs): void }; // startWithWindows, autoUpdateAddon
  now?: () => number;
  addonIntervalMs?: number; // default 30 min
}
export class LedgerController extends EventEmitter<{ change: [Snapshot]; toast: [string] }> {
  start(): Promise<void>; // load config; setupNeeded if no wowPath/token; else watch + first addon sync
  stop(): Promise<void>; // close watch, clear timers, release lock
  snapshot(): Snapshot;
  uploadNow(): void; // watch.trigger()
  setPaused(paused: boolean): Promise<void>; // close / restart watch
  addonUpdateNow(): Promise<void>; // syncAddon({ force: true })
  addonRollback(): Promise<void>;
  saveSettings(input: { wowPath?: string; token?: string; startWithWindows?: boolean; autoUpdateAddon?: boolean }): Promise<void>;
  setAppUpdateReady(version: string): void;
}
```

Rules: `onEvent` pass-start → `uploading = true`; pass-end → `uploading = false`, refresh `accounts` via
`collectStatus`; fatal → `fatal`. Addon sync runs at start and every `addonIntervalMs` when `autoUpdateAddon`;
`installed` (or a non-empty `recovered`) → toast `ForeverLedger <v> installed — type /reload in game to use it`.
The uploader already serializes `syncAddon`/`rollbackAddonEverywhere` with an in-process mutex; call only those
(the low-level install functions are no longer exported). **Locking:** the controller never holds the uploader lock for its lifetime — every watch pass already takes it
(`runUploadPass`), so a held lock would block all uploads. Addon sync/rollback run inside `withLock(stateDir, …)`;
on `LockedError` skip that cycle (log + retry next interval), and surface a warning only if it persists > 10 min. An `error` addon status
that has lasted over an hour → one toast. Every state change emits `change`.

Tests with fakes: setup-needed when config lacks token; start takes the lock and starts watch; events flip
`uploading`; interval sync (inject a short `addonIntervalMs`, use `vi.useFakeTimers()`); install toast; locked →
fatal; pause stops watch and resume restarts it; saveSettings writes config and restarts.

Commit `feat(desktop): controller`.

### Task 4.4: Electron main

**Files:** `apps/desktop/src/main/main.ts`, `apps/desktop/src/main/ipc.ts` (channel names shared with preload:
`ledger:state`, `ledger:changed`, `ledger:upload-now`, `ledger:pause`, `ledger:addon-update`, `ledger:addon-rollback`,
`ledger:save-settings`, `ledger:pick-wow-folder`, `ledger:restart-to-update`, `ledger:open-logs`).

- `app.requestSingleInstanceLock()`; second instance → show window.
- Logs: `createLogger({ write })` appending to `join(app.getPath('logs'), 'forever-ledger.log')`.
- Prefs in `join(app.getPath('userData'), 'prefs.json')` (defaults: startWithWindows true, autoUpdateAddon true).
- Config path: `resolveConfigPath()` (same file as the CLI; `FOREVER_LEDGER_CONFIG` overrides — used by the smoke
  test).
- `BrowserWindow` 480×680, `show: false`, `webPreferences: { preload: dist/preload.cjs, contextIsolation: true,
  nodeIntegration: false, sandbox: true }`, loads `dist/index.html`; close → hide (quit only from the tray menu).
  Shown at start unless launched with `--hidden` (the login item passes it) and setup is done.
- `Tray` with `nativeImage.createFromPath(assets/tray-<state>.png)`, tooltip `TRAY_TOOLTIP[state]`, context menu
  Open / Upload now / Check for updates / Pause uploads (checkbox) / Open logs folder / Quit; double-click opens.
- `app.setLoginItemSettings({ openAtLogin: prefs.startWithWindows, args: ['--hidden'] })` whenever prefs change.
- Updater (skip when `!app.isPackaged || process.env.FL_SMOKE`): `autoUpdater` from `electron-updater`,
  `autoDownload = true`, `checkForUpdates()` at start and every 6 h and from the menu; `update-downloaded` →
  `controller.setAppUpdateReady(version)` + toast; `ledger:restart-to-update` → `autoUpdater.quitAndInstall()`.
- Toasts: `new Notification({ title: 'Forever Ledger', body })`.
- `pick-wow-folder`: `dialog.showOpenDialog({ properties: ['openDirectory'] })` → `discoverSavedVariables` → return
  `{ path, accounts, notes }`.
- `before-quit` → `controller.stop()`.

No unit tests here (glue); covered by the smoke test. Commit `feat(desktop): Electron main process`.

### Task 4.5: Preload + renderer

**Files:** `apps/desktop/src/preload.ts`, `apps/desktop/src/renderer/{index.html,renderer.ts,styles.css}`,
`apps/desktop/src/renderer/format.ts` + `apps/desktop/test/format.test.ts`.

- Preload: `contextBridge.exposeInMainWorld('ledger', { getState, onChange, uploadNow, setPaused, addonUpdateNow,
  addonRollback, saveSettings, pickWowFolder, restartToUpdate, openLogs })`, each a thin `ipcRenderer.invoke`/`on`
  wrapper. Type it in `src/renderer/api.d.ts` so `renderer.ts` gets `window.ledger` types.
- `index.html`: strict CSP meta `default-src 'self'; style-src 'self'`; a `#setup` section (WoW folder picker
  showing found accounts, token field, server URL read-only `https://ledger.willikers.dev`, Save) and a `#main`
  section with four `<section class="card" data-card="uploads|addon|app|settings">`.
- `renderer.ts`: renders `Snapshot` into the cards with `textContent` only (never `innerHTML` with data); buttons
  call the API; re-render on `onChange`.
- `format.ts` (pure, tested): `chicagoTime(epochSecs)` via `Intl.DateTimeFormat('en-US', { timeZone:
  'America/Chicago', … })`, `addonLine(snapshot)` (e.g. `0.2.1 installed · server recommends 0.2.2 for build 69913`),
  `uploadsLine(snapshot)`.
- `styles.css`: system font, light/dark via `prefers-color-scheme`, cards stacked, 16px padding.

Commit `feat(desktop): window UI`.

### Task 4.6: Smoke test

**Files:** `apps/desktop/playwright.config.ts` (`testDir: 'test/smoke'`, one worker),
`apps/desktop/test/smoke/app.spec.ts`:

```ts
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

test('starts and shows the four cards', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fl-smoke-'));
  const config = join(dir, 'config.json');
  await writeFile(
    config,
    JSON.stringify({ wowPath: dir, accounts: [], serverUrl: 'http://127.0.0.1:9', token: 'flt_smoke', uploaderId: 'smoke' }),
  );
  const app = await electron.launch({
    args: ['dist/main.mjs'],
    env: { ...process.env, FOREVER_LEDGER_CONFIG: config, FL_SMOKE: '1' },
  });
  const win = await app.firstWindow();
  for (const card of ['uploads', 'addon', 'app', 'settings']) {
    await expect(win.locator(`[data-card="${card}"]`)).toBeVisible();
  }
  await app.close();
});
```

Run locally only if a display is available (`xvfb-run pnpm --filter @forever-ledger/desktop test:smoke`); it runs on
the Windows CI job regardless. Commit `test(desktop): Electron smoke test`.

### Task 4.7: App release workflow + CI job

**Files:** `.github/workflows/app-release.yml`, modify `.github/workflows/ci.yml` (add job `desktop-smoke` on
`windows-latest`: checkout, pnpm, node 22, `pnpm install --frozen-lockfile`,
`pnpm --filter @forever-ledger/desktop build`, `pnpm --filter @forever-ledger/desktop exec playwright install`
(not needed for Electron itself; skip if the test passes without it), `pnpm --filter @forever-ledger/desktop test:smoke`).

```yaml
name: app-release
on:
  push:
    tags: ['v*']
permissions:
  contents: write
jobs:
  release:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: tag matches apps/desktop version
        shell: bash
        run: test "${GITHUB_REF_NAME#v}" = "$(node -p "require('./apps/desktop/package.json').version")"
      - run: pnpm --filter @forever-ledger/desktop build
      - run: pnpm --filter @forever-ledger/desktop test:smoke
      - run: pnpm --filter @forever-ledger/desktop exec electron-builder --win --publish always
        env:
          GH_TOKEN: ${{ github.token }}
```

Commit `ci: desktop smoke job and app release workflow`.

### Task 4.8: First app release

After the PR merges: `git tag v0.1.0 && git push origin v0.1.0`, watch the run, then
`gh release view v0.1.0 --json assets,isLatest` → `Forever-Ledger-Setup-0.1.0.exe`, `latest.yml`, blockmap;
`isLatest: true`.

---

## 🎁 Phase 5 — Wrap up

### Task 5.1: Docs

- `README.md`: new "🖥️ Tray app" section (download the installer from Releases, SmartScreen "More info → Run
  anyway" for unsigned builds, first-run steps, tray colors, `/reload` after an addon update), and "🏷️ Releasing"
  (addon: bump `.toc` + Lua `VERSION` → tag `addon-vX` → `node apps/server/dist/addon-cli.js publish X`; app: bump
  `apps/desktop/package.json` → tag `vX`; pin/yank examples).
- `CLAUDE.md`: layout line for `apps/desktop`; rule "addon releases are `--latest=false`; app releases own
  latest"; "`addon publish` is the step that makes an addon version live".
- `pnpm check` green.

### Task 5.2: PR

```bash
git push -u origin feat/tray-app
gh pr create --base master --title "Tray app + addon auto-update" --body "<summary, test plan, 🤖 footer>"
gh pr checks --watch
gh pr merge --merge --delete-branch
```

(Phases 0–3 may merge earlier in their own PR so 3.3 can tag from `master`; then this PR carries Phase 4–5.)

### Task 5.3: Manual checklist (gaming PC, user)

- [ ] Install `Forever-Ledger-Setup-0.1.0.exe` (SmartScreen → Run anyway)
- [ ] Setup: pick the WoW: Forever folder, accounts listed, paste token, Save
- [ ] Addon card shows 0.2.1 installed / recommended for build 69913
- [ ] Play, `/reload` → tray turns blue then green; Uploads card shows the time in CDT
- [ ] Unplug network, `/reload` → yellow; reconnect → green
- [ ] We tag `addon-v0.2.2` + publish → within 30 min (or Update now) toast "/reload to use it"
- [ ] Roll back → 0.2.1, stays paused; we pin build 69913 to 0.2.1 → no reinstall
- [ ] We tag `v0.1.1` → "Restart to update" appears and works
