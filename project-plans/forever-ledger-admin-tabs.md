# 🗂️ Forever Ledger — Admin panel: tabs, accordions and paging

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
>
> Owner: John-Willikers <harlanbmiltonjr@gmail.com> · Approved 2026-09-25 (America/Chicago) · Branch
> `feat/admin-tabs-accordions` → PR → green → merge to `master`.

**Goal:** Make the tall admin pages readable without endless scrolling by splitting them into tabs, collapsing
secondary cards, and paging the unbounded tables.

**Architecture:** Two shared components, `Tabs` (URL-backed with `?tab=`, arrow keys, only the active panel mounts) and
`Collapsible` (a `Card` inside `<details>`), plus an optional `pageSize` on `DataTable` that reuses `Pager`. The three
hand-rolled tab bars (Run, Vendors, Builds) move onto `Tabs`, the tab CSS moves from `professions.css` into the global
stylesheet, and then each tall page is re-laid out. Pure logic (which tab is active, arrow-key stepping, page slicing)
lives in small `*Lib.ts` modules with vitest tests, because the admin vitest project is node-only (no DOM).

**Tech stack:** React 19, react-router 8 (`useSearchParams`), TanStack Table v9, vitest (node env), plain CSS with
`:root` variables and `prefers-color-scheme` dark mode.

---

## 📌 Context

Inventory of the pages (2026-09-25) found the scroll hogs, worst first:

| Page | Why it is tall |
| --- | --- |
| Vendors | `DataTable` of up to 500 rows, unpaged; the vendor you click renders **below** it. |
| Professions | Picker grid → skill chart → every recipe → every craft → Gathering card (zone map + two node tables). |
| Quests | 340px scatter chart over a 200-row, 12-column table. |
| Item | Nine stacked cards: stats, tooltip, drops, gathering, contents, came from, vendors, quests, recipes, who wants it. |
| Character | Three charts, then an unbounded "Quests turned in" table. |
| Dungeons | Wide per-instance table, two charts, then the paged runs table. |
| Health | Unbounded diagnostics feed above the API samples pane. |

Facts that shape the work:

- `DataTable` (`apps/admin/src/components/DataTable.tsx`) renders every row it gets; only tables fed by `Pager`
  (Dungeons runs, Loot) and Quests (server-paged at 200) are bounded.
- Tab CSS (`.tabs`, `.tab`, `.tab.active`, `.tab-panel`) lives in `apps/admin/src/pages/professions/professions.css`
  lines 225–250; `RunPage`, `VendorsPage` and `BuildsPage` import that file to get it. The file also held shared rules
  those pages use (`.chip`, `.npc-cell`, `.quality` dots, `.pill.svc-*`, `.visually-hidden`, `button.linkish`,
  `.teaches`, `.filters label.checkbox`); routes are lazy-loaded, so dropping the import would unstyle them on a cold
  load. Those rules moved to `styles.css` in Task 2 (duplicates of `table.data tr.selected td` and `.pill.forever`
  were simply deleted), and `professions.css` now holds Professions-only rules.
- Three hand-rolled tab bars share the same markup: `div.tabs[role=tablist]` > `button.tab[role=tab]` + `div.tab-panel`.
  Run keeps its tab in `?view=` (`pickTab` in `runLib.ts`), Builds in `?tab=`, Vendors in local state.
- `apps/admin/vitest.config.ts` is `environment: 'node'`, `include: ['src/**/*.test.ts']`: tests are pure functions only.
- Existing `<details>` usage: Health feed rows, Loot "Table (N items)", Vendors "Show on the map".

Design decisions (approved 2026-09-25):

- Tab state lives in the URL so refresh and shared links land on the same tab. The first tab is the default and writes
  no param; other tabs write `?<param>=<key>` with `replace: true`.
- Only the active tab's panel mounts, so a hidden tab's queries don't run until opened.
- `Collapsible` has no `actions` slot (interactive controls inside `<summary>` toggle it). Cards that need actions stay
  `Card`.
- `Collapsible` mounts its body only while open (controlled `open` + `onToggle`). `Chart` (echarts-for-react) only
  listens for window resize, so a chart mounted inside a closed `<details>` would stay a 0-width canvas; lazy mounting
  also keeps a folded card's queries from running until someone opens it.
- Vendors: after paging at 50, a "Selected" tab is overkill. The picked NPC's card renders **above** the list instead,
  with a Close action, and the pick lives in `?npc=` so it is linkable. (Small change from the design sketch; noted.)
- Quests page size drops from 200 to 50 (`QUESTS_PAGE_SIZE`); the server already pages by `limit`/`offset`.

## ✅ Progress checks

Legend: ⬜ todo · 🟡 in progress · ✅ done · ⛔ blocked. Times America/Chicago.

- ✅ 1 🧩 `tabsLib` + `Tabs` component + global tab CSS — 2026-09-25 16:20 — `a2a4e04`, review fixes `43f55ae`
- ✅ 2 🔁 Run, Builds, Vendors onto `Tabs`; drop the borrowed `professions.css` imports — 2026-09-25 16:20 — `b774b60`,
  shared CSS rescued in `59a9e43` (review caught a cold-load styling regression, see Context).
  Vendors/Trainers choice now lives in `?tab=trainers` (was local state); Builds category counts render as
  `.tab-count`.
- ✅ 3 📂 `Collapsible` component — 2026-09-25 16:20 — `5b12fa1` (+ `43f55ae`: `defaultOpen`; body mounts on open)
- ✅ 4 📄 `DataTable` `pageSize` (with `tableLib.pageSlice`) — 2026-09-25 16:20 — `d0ef9a6` (+ `43f55ae`: offset resets
  on sort and on `resetKey` change)
- 🟡 5 🛒 Vendors: page at 50, picked NPC above the list in `?npc=` — implementing
- ⬜ 6 ⚒️ Professions: Recipes / Crafts / Skill history / Gathering tabs
- ⬜ 7 🎒 Item: Stats / Sources / Trade / Who wants it tabs
- ⬜ 8 🧙 Character: Overview / Quests / Professions tabs, quests paged
- ⬜ 9 🏰 Dungeons: Instances / Runs tabs
- ⬜ 10 🩺 Health: Diagnostics / API samples tabs
- ⬜ 11 📜 Quests: scatter collapsed, page size 50
- ⬜ 12 🏠 Overview: Builds and Versions collapsed
- ⬜ 13 🚀 `pnpm check`, PR, merge, deploy, ntfy

---

## Task 1: 🧩 `tabsLib` + `Tabs` component + global tab CSS

**Files:**

- Create: `apps/admin/src/components/tabsLib.ts`
- Create: `apps/admin/src/components/tabsLib.test.ts`
- Create: `apps/admin/src/components/Tabs.tsx`
- Modify: `apps/admin/src/styles.css` (append after the `.pager` block, line ~907)

**Step 1: Write the failing tests**

```ts
// apps/admin/src/components/tabsLib.test.ts
import { describe, expect, it } from 'vitest';
import { pickTab, stepTab, tabParamValue } from './tabsLib';

const tabs = [
  { key: 'stats', label: 'Stats' },
  { key: 'sources', label: 'Sources' },
  { key: 'trade', label: 'Trade' },
];

describe('pickTab', () => {
  it('returns the wanted key when it is a tab', () => {
    expect(pickTab(tabs, 'trade')).toBe('trade');
  });
  it('falls back to the first tab for null or an unknown key', () => {
    expect(pickTab(tabs, null)).toBe('stats');
    expect(pickTab(tabs, 'nope')).toBe('stats');
  });
  it('returns an empty string when there are no tabs', () => {
    expect(pickTab([], 'x')).toBe('');
  });
});

describe('tabParamValue', () => {
  it('is null for the first (default) tab and the key otherwise', () => {
    expect(tabParamValue(tabs, 'stats')).toBeNull();
    expect(tabParamValue(tabs, 'trade')).toBe('trade');
  });
});

describe('stepTab', () => {
  it('moves by delta and wraps at both ends', () => {
    expect(stepTab(tabs, 'stats', 1)).toBe('sources');
    expect(stepTab(tabs, 'trade', 1)).toBe('stats');
    expect(stepTab(tabs, 'stats', -1)).toBe('trade');
  });
  it('starts from the first tab when current is unknown', () => {
    expect(stepTab(tabs, 'nope', 1)).toBe('sources');
  });
});
```

**Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @forever-ledger/admin test -- tabsLib`
Expected: FAIL, "Cannot find module './tabsLib'".

**Step 3: Write the implementation**

```ts
// apps/admin/src/components/tabsLib.ts
/** One tab of a `Tabs` bar. `count` shows in parentheses after the label. */
export interface TabDef {
  key: string;
  label: string;
  count?: number | null;
}

/** The tab to show: `wanted` when it is one of `tabs`, else the first tab ('' when there are none). */
export function pickTab(tabs: readonly TabDef[], wanted: string | null): string {
  if (tabs.some((t) => t.key === wanted)) return wanted!;
  return tabs[0]?.key ?? '';
}

/** What to store in the URL for `key`: nothing for the first (default) tab. */
export function tabParamValue(tabs: readonly TabDef[], key: string): string | null {
  return tabs[0]?.key === key ? null : key;
}

/** The tab `delta` steps from `current`, wrapping around; an unknown `current` counts as the first tab. */
export function stepTab(tabs: readonly TabDef[], current: string, delta: number): string {
  if (tabs.length === 0) return '';
  const at = Math.max(0, tabs.findIndex((t) => t.key === current));
  return tabs[(at + delta + tabs.length) % tabs.length]!.key;
}
```

```tsx
// apps/admin/src/components/Tabs.tsx
import { useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { formatNumber } from '../lib/format';
import { pickTab, stepTab, tabParamValue } from './tabsLib';
import type { TabDef } from './tabsLib';

/**
 * A tab bar whose active tab lives in the URL (`?<param>=<key>`; the first tab writes nothing). Only the active
 * panel renders. Left/Right/Home/End move between tabs.
 */
export function Tabs({
  id,
  tabs,
  label,
  param = 'tab',
  children,
}: {
  /** Prefix for the tab and panel element ids (unique per page). */
  id: string;
  tabs: readonly TabDef[];
  /** `aria-label` of the tab list. */
  label: string;
  /** URL search param that holds the active tab. */
  param?: string;
  /** Renders the panel of the active tab. */
  children: (key: string) => ReactNode;
}) {
  const [params, setParams] = useSearchParams();
  const active = pickTab(tabs, params.get(param));
  const list = useRef<HTMLDivElement>(null);
  if (tabs.length === 0) return null;

  const select = (key: string) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        const value = tabParamValue(tabs, key);
        if (value === null) next.delete(param);
        else next.set(param, value);
        return next;
      },
      { replace: true },
    );
    list.current?.querySelector<HTMLButtonElement>(`#${id}-tab-${key}`)?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const to =
      e.key === 'ArrowRight'
        ? stepTab(tabs, active, 1)
        : e.key === 'ArrowLeft'
          ? stepTab(tabs, active, -1)
          : e.key === 'Home'
            ? tabs[0]!.key
            : e.key === 'End'
              ? tabs[tabs.length - 1]!.key
              : null;
    if (to === null) return;
    e.preventDefault();
    select(to);
  };
  return (
    <>
      <div className="tabs" role="tablist" aria-label={label} ref={list} onKeyDown={onKey}>
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`${id}-tab-${t.key}`}
            aria-selected={active === t.key}
            aria-controls={`${id}-panel`}
            tabIndex={active === t.key ? 0 : -1}
            className={active === t.key ? 'tab active' : 'tab'}
            onClick={() => select(t.key)}
          >
            {t.label}
            {t.count !== undefined && t.count !== null && (
              <span className="tab-count">{formatNumber(t.count)}</span>
            )}
          </button>
        ))}
      </div>
      <div
        className="tab-panel"
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-tab-${active}`}
      >
        {children(active)}
      </div>
    </>
  );
}
```

Append to `apps/admin/src/styles.css` (after `.pager`), moving the four rules out of `professions.css` and adding
`.tab-count`:

```css
/* ---- tabs (components/Tabs.tsx) ---- */

.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  border-bottom: 1px solid var(--border);
}

.tab {
  background: none;
  color: var(--muted);
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  padding: 0.4rem 0.9rem;
}

.tab.active {
  color: var(--text);
  border-bottom-color: var(--accent);
  font-weight: 600;
}

.tab-count {
  margin-left: 0.35rem;
  font-size: 0.85em;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.tab-panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
```

Delete the `.tabs`, `.tab`, `.tab-panel`, `.tab.active` rules from `professions.css` (keep the
`/* ---- vendors & trainers ---- */` comment and `.filters label.checkbox` below them).

**Step 4: Run the tests, typecheck and lint**

Run: `pnpm --filter @forever-ledger/admin test -- tabsLib && pnpm --filter @forever-ledger/admin typecheck && pnpm eslint apps/admin/src/components`
Expected: 7 tests pass, no type or lint errors.

**Step 5: Commit**

```bash
git add apps/admin/src/components/tabsLib.ts apps/admin/src/components/tabsLib.test.ts apps/admin/src/components/Tabs.tsx apps/admin/src/styles.css apps/admin/src/pages/professions/professions.css
git commit -m "feat(admin): shared Tabs component, URL-backed with arrow keys"
```

---

## Task 2: 🔁 Run, Builds, Vendors onto `Tabs`

**Files:**

- Modify: `apps/admin/src/pages/dungeons/RunPage.tsx` (drop line 2 import; `RunGroup` lines ~50–90)
- Modify: `apps/admin/src/pages/dungeons/runLib.ts` (delete `pickTab`, lines ~73–75; keep `runTabs`)
- Modify: `apps/admin/src/pages/dungeons/runLib.test.ts` (delete the `pickTab` tests if any)
- Modify: `apps/admin/src/pages/builds/BuildsPage.tsx` (drop line 13 import; `Compare` tab block lines ~202–230)
- Modify: `apps/admin/src/pages/vendors/VendorsPage.tsx` (drop line 15 import; `VendorsPage` lines 33–69)

**Step 1: RunPage.** Replace the hand-rolled bar in `RunGroup` with:

```tsx
<Tabs id="run" tabs={tabs} param="view" label="Group or member view">
  {(key) => {
    const member = g.perspectives.find((p) => p.id === key);
    return member ? <Run r={member} /> : <Group g={g} />;
  }}
</Tabs>
```

`runTabs` already puts `group` first, so the Group tab writes no `?view=` exactly as before. Remove `pickTab` and
`useSearchParams` from the file and `pickTab` from `runLib.ts` (grep first: `grep -rn pickTab apps/admin/src`).

**Step 2: BuildsPage.** In `Compare`, replace the `div.tabs` + `div.tab-panel` block with:

```tsx
<Tabs
  id="build"
  tabs={CATEGORIES.map((c) => ({ key: c.key, label: c.label, count: d[c.key].total }))}
  label="Change category"
>
  {(key) => {
    const category = isCategory(key) ? key : 'items';
    return (
      <CategoryPanel
        diff={d}
        category={category}
        overlap={overlapCount(fromRow, d, category)}
        minCorpses={minCorpses}
        onMinCorpses={onMinCorpses}
      />
    );
  }}
</Tabs>
```

`Compare` still reads `tab` from `?tab=` for anything else that uses it (check `onTab`; delete it if it is now unused,
and delete the `tab` variable if nothing else reads it). Keep `isCategory`.

**Step 3: VendorsPage.** Replace local `useState<Tab>` with:

```tsx
<Tabs
  id="npc"
  tabs={[
    { key: 'vendors', label: 'Vendors' },
    { key: 'trainers', label: 'Trainers' },
  ]}
  label="Vendors or trainers"
>
  {(key) => (key === 'trainers' ? <NpcBrowser kind="trainers" key="t" /> : <NpcBrowser kind="vendors" key="v" />)}
</Tabs>
```

Remove the now-unused `useState` import only if nothing else in the file uses it (`NpcBrowser` does).

**Step 4: Verify**

Run: `grep -rn "professions.css" apps/admin/src` → only `ProfessionsPage.tsx` (and `GatheringCard`/`RecipesCard` if
they import it) remain. Then `pnpm --filter @forever-ledger/admin typecheck && pnpm --filter @forever-ledger/admin test`
Expected: pass.

Manual: `pnpm --filter @forever-ledger/admin dev` (needs the API; `LEDGER_API=https://ledger.willikers.dev` works with
a logged-in cookie only on the same origin, so use the VPS build instead: `pnpm --filter @forever-ledger/admin build`
and open `https://ledger.willikers.dev/admin/builds`). Tabs look the same as before; `?tab=quests` still opens Quests;
arrow keys move between tabs.

**Step 5: Commit**

```bash
git add -A apps/admin/src/pages
git commit -m "refactor(admin): Run, Builds and Vendors use the shared Tabs"
```

---

## Task 3: 📂 `Collapsible` component

**Files:**

- Create: `apps/admin/src/components/Collapsible.tsx`
- Modify: `apps/admin/src/styles.css` (append after the tabs block)

**Step 1: Write the component**

```tsx
// apps/admin/src/components/Collapsible.tsx
import type { ReactNode } from 'react';
import { formatNumber } from '../lib/format';

/**
 * A panel that folds: the title is the `<summary>`. Closed by default so secondary cards stay out of the way; pass
 * `open` for the ones that should start expanded. No actions slot on purpose: controls inside a summary toggle it.
 */
export function Collapsible({
  title,
  count,
  open = false,
  className = '',
  children,
}: {
  title: ReactNode;
  /** Shown after the title so the reader knows what is inside without opening it. */
  count?: number | null;
  open?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <details className={`panel collapsible ${className}`} open={open}>
      <summary className="panel-head">
        <h2>
          {title}
          {count !== undefined && count !== null && (
            <span className="tab-count">{formatNumber(count)}</span>
          )}
        </h2>
      </summary>
      <div className="collapsible-body">{children}</div>
    </details>
  );
}
```

CSS:

```css
/* ---- collapsible panels (components/Collapsible.tsx) ---- */

.collapsible > summary {
  cursor: pointer;
  list-style: none;
  margin-bottom: 0;
}

.collapsible > summary::-webkit-details-marker {
  display: none;
}

.collapsible > summary h2::before {
  content: '▸';
  display: inline-block;
  width: 1.1em;
  color: var(--muted);
  transition: transform 0.15s;
}

.collapsible[open] > summary h2::before {
  transform: rotate(90deg);
}

.collapsible[open] > summary {
  margin-bottom: 0.6rem;
}

.collapsible > summary:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: var(--radius);
}
```

**Step 2: Verify**

Run: `pnpm --filter @forever-ledger/admin typecheck && pnpm eslint apps/admin/src/components`
Expected: clean. (Used for the first time in Task 11.)

**Step 3: Commit**

```bash
git add apps/admin/src/components/Collapsible.tsx apps/admin/src/styles.css
git commit -m "feat(admin): Collapsible panel (details/summary Card)"
```

---

## Task 4: 📄 `DataTable` `pageSize`

**Files:**

- Create: `apps/admin/src/components/tableLib.ts`
- Create: `apps/admin/src/components/tableLib.test.ts`
- Modify: `apps/admin/src/components/DataTable.tsx`

**Step 1: Write the failing test**

```ts
// apps/admin/src/components/tableLib.test.ts
import { describe, expect, it } from 'vitest';
import { pageSlice } from './tableLib';

const rows = ['a', 'b', 'c', 'd', 'e'];

describe('pageSlice', () => {
  it('returns everything when there is no page size', () => {
    expect(pageSlice(rows, 0, undefined)).toEqual({ rows, offset: 0 });
  });
  it('slices one page', () => {
    expect(pageSlice(rows, 2, 2)).toEqual({ rows: ['c', 'd'], offset: 2 });
  });
  it('snaps an offset past the end back to the first page', () => {
    expect(pageSlice(rows, 10, 2)).toEqual({ rows: ['a', 'b'], offset: 0 });
  });
  it('keeps the last partial page', () => {
    expect(pageSlice(rows, 4, 2)).toEqual({ rows: ['e'], offset: 4 });
  });
});
```

**Step 2: Run it to verify it fails**

Run: `pnpm --filter @forever-ledger/admin test -- tableLib`
Expected: FAIL, "Cannot find module './tableLib'".

**Step 3: Implement**

```ts
// apps/admin/src/components/tableLib.ts
/**
 * The rows of one page. An offset past the end (the data shrank under a filter) snaps back to the first page so the
 * table is never blank.
 */
export function pageSlice<T>(
  rows: readonly T[],
  offset: number,
  pageSize: number | undefined,
): { rows: readonly T[]; offset: number } {
  if (pageSize === undefined) return { rows, offset: 0 };
  const at = offset >= rows.length ? 0 : offset;
  return { rows: rows.slice(at, at + pageSize), offset: at };
}
```

In `DataTable.tsx`:

- Add `pageSize?: number` to the props (doc: "Client-side paging: show this many rows with a Pager under the table.").
- Add `const [offset, setOffset] = useState(0);` and, after `table`, compute
  `const page = pageSlice(table.getRowModel().rows, offset, pageSize);`.
- Map `page.rows` instead of `table.getRowModel().rows` in `<tbody>`; the empty check uses
  `table.getRowModel().rows.length === 0`.
- After `</table>` (inside `.table-wrap`? no, after it: wrap the return in a fragment) render
  `{pageSize !== undefined && (<Pager total={table.getRowModel().rows.length} limit={pageSize} offset={page.offset} onOffset={setOffset} />)}`.
- Import `Pager` from `./Pager` and `pageSlice` from `./tableLib`.

`Pager` already returns `null` when everything fits on one page.

**Step 4: Run the tests, typecheck and lint**

Run: `pnpm --filter @forever-ledger/admin test && pnpm --filter @forever-ledger/admin typecheck && pnpm eslint apps/admin/src/components`
Expected: pass. Existing callers (no `pageSize`) are unchanged.

**Step 5: Commit**

```bash
git add apps/admin/src/components/tableLib.ts apps/admin/src/components/tableLib.test.ts apps/admin/src/components/DataTable.tsx
git commit -m "feat(admin): DataTable pageSize with client-side Pager"
```

---

## Task 5: 🛒 Vendors: page at 50, picked NPC above the list in `?npc=`

**Files:**

- Modify: `apps/admin/src/pages/vendors/VendorsPage.tsx` (`NpcBrowser` lines 71–160, `VendorCard` / `TrainerCard`
  lines 403–517)
- Modify: `apps/admin/src/pages/vendors/lib.ts` and `lib.test.ts` (add `npcParam`)

**Step 1: Failing test for the URL param**

Add to `apps/admin/src/pages/vendors/lib.test.ts`:

```ts
describe('npcParam', () => {
  it('reads a positive integer npc id, else null', () => {
    expect(npcParam(new URLSearchParams('npc=1234'))).toBe(1234);
    expect(npcParam(new URLSearchParams(''))).toBeNull();
    expect(npcParam(new URLSearchParams('npc=abc'))).toBeNull();
    expect(npcParam(new URLSearchParams('npc=0'))).toBeNull();
  });
});
```

Run: `pnpm --filter @forever-ledger/admin test -- vendors/lib` → FAIL (not exported).

**Step 2: Implement in `lib.ts`**

```ts
/** `?npc=<id>`: the NPC whose card is open, or null. */
export function npcParam(params: URLSearchParams): number | null {
  const n = Number(params.get('npc'));
  return Number.isInteger(n) && n > 0 ? n : null;
}
```

**Step 3: Re-lay out `NpcBrowser`**

- Replace `const [selected, setSelected] = useState<number | null>(null);` with
  `useSearchParams` + `const selected = npcParam(params);` and
  `const setSelected = (id: number | null) => setParams((p) => { const next = new URLSearchParams(p); if (id === null) next.delete('npc'); else next.set('npc', String(id)); return next; }, { replace: true });`.
- Render order becomes: **detail card first**, then the list card:

```tsx
return (
  <>
    {selected !== null &&
      (kind === 'vendors' ? (
        <VendorCard npcId={selected} key={`v${selected}`} onClose={() => setSelected(null)} />
      ) : (
        <TrainerCard npcId={selected} key={`t${selected}`} onClose={() => setSelected(null)} />
      ))}
    <Card title=…>…</Card>
  </>
);
```

- Both `DataTable`s in the list card get `pageSize={50}` and `resetKey={JSON.stringify(deferred)}` (the deferred
  filter state; the search string alone would do), so paging goes back to the first page when the filters change.
- `VendorCard` and `TrainerCard` take `onClose: () => void` and add a close button to their `actions`, next to the
  `BuildPicker`:

```tsx
actions={
  <>
    <BuildPicker … />
    <button type="button" className="secondary small" onClick={onClose}>
      Close
    </button>
  </>
}
```

- Switching the Vendors/Trainers tab keeps `?npc=` in the URL; a vendor id opened under Trainers would 404 its detail.
  So in the `Tabs` children of `VendorsPage`, nothing changes, but in `NpcBrowser` add: if `kind` changed the id is
  meaningless — simplest is to clear `npc` when the tab changes: in `VendorsPage` wrap `Tabs`'s child with the same
  `key` as today (`key="v"` / `key="t"`) **and** have `NpcBrowser` ignore a selected id whose kind mismatches. Do it
  by storing the kind in the param value instead: `npc=v1234` / `npc=t1234`. Update `npcParam` to
  `npcParam(params, kind)` returning the id only when the prefix matches (`^([vt])(\d+)$`), and `setSelected` to write
  `${kind[0]}${id}`. Update the test accordingly:

```ts
expect(npcParam(new URLSearchParams('npc=v1234'), 'vendors')).toBe(1234);
expect(npcParam(new URLSearchParams('npc=v1234'), 'trainers')).toBeNull();
expect(npcParam(new URLSearchParams('npc=t7'), 'trainers')).toBe(7);
expect(npcParam(new URLSearchParams(''), 'vendors')).toBeNull();
expect(npcParam(new URLSearchParams('npc=1234'), 'vendors')).toBeNull();
```

**Step 4: Verify**

Run: `pnpm --filter @forever-ledger/admin test && pnpm --filter @forever-ledger/admin typecheck`
Manual on the VPS build: `/admin/vendors` shows 50 rows with a Pager; clicking a name opens the card **above** the list
and puts `?npc=v<id>` in the URL; Close clears it; Trainers tab ignores a `v` id.

**Step 5: Commit**

```bash
git add apps/admin/src/pages/vendors
git commit -m "feat(admin): Vendors pages at 50; picked NPC opens above the list via ?npc="
```

---

## Task 6: ⚒️ Professions: Recipes / Crafts / Skill history / Gathering tabs

**Files:**

- Modify: `apps/admin/src/pages/professions/ProfessionsPage.tsx` (lines 39–127)

**Step 1: Re-lay out.** Inside the `QueryState` callback, after the `prof-grid` and the orphan/error cards, replace
`<SkillRankCard/> <RecipesCard/> <CraftsCard/>` and the trailing `<GatheringCard />` with:

```tsx
<Tabs
  id="prof"
  tabs={[
    { key: 'recipes', label: 'Recipes' },
    { key: 'crafts', label: 'Crafts' },
    { key: 'skill', label: 'Skill history' },
    { key: 'gathering', label: 'Gathering' },
  ]}
  label={`${professionName(current)} sections`}
>
  {(key) =>
    key === 'crafts' ? (
      <CraftsCard prof={current} />
    ) : key === 'skill' ? (
      <SkillRankCard prof={current} />
    ) : key === 'gathering' ? (
      <GatheringCard />
    ) : (
      <RecipesCard
        key={current.skillLineId}
        skillLineId={current.skillLineId}
        name={professionName(current)}
        selected={recipeId}
        onSelect={setRecipe}
      />
    )
  }
</Tabs>
```

When `professions.length === 0`, return `<><Empty>No professions seen yet.</Empty><GatheringCard /></>` so gathering
data is still reachable.

Recipes is the first tab, so a `?recipe=` deep link (which writes no `?tab=`) lands on the recipe as before. If a user
is on Crafts and clicks a recipe link elsewhere that navigates to `/professions?recipe=N`, the URL has no `tab`, so it
shows Recipes. Good.

The `RecipesCard` `DataTable` (in `RecipesCard.tsx` ~line 176) gets `pageSize={50}` **only if** it uses `DataTable`
and a selected recipe still expands inline under the table (it does: check that the selected row stays visible; if the
selected recipe can be on another page, leave it unpaged and note it in the progress check).

**Step 2: Verify**

Run: `pnpm --filter @forever-ledger/admin typecheck && pnpm --filter @forever-ledger/admin test`
Manual: `/admin/professions` shows the picker grid then four tabs; `?tab=gathering` opens the map; `?recipe=<id>` opens
on Recipes with the recipe expanded.

**Step 3: Commit**

```bash
git add apps/admin/src/pages/professions
git commit -m "feat(admin): Professions splits into Recipes / Crafts / Skill history / Gathering tabs"
```

---

## Task 7: 🎒 Item: Stats / Sources / Trade / Who wants it tabs

**Files:**

- Modify: `apps/admin/src/pages/items/ItemPage.tsx` (lines 43–86)

**Step 1: Re-lay out.** Inside `QueryState query={item}`, keep the `page-head`, then:

```tsx
<Tabs
  id="item"
  tabs={[
    { key: 'stats', label: 'Stats & tooltip' },
    { key: 'sources', label: 'Sources' },
    { key: 'trade', label: 'Trade' },
    ...(i.specs.roles.length > 0 || i.specs.classes.length > 0
      ? [{ key: 'wants', label: 'Who wants it' }]
      : []),
  ]}
  label="Item sections"
>
  {(key) =>
    key === 'sources' ? (
      <QueryState query={extra}>
        {(x) => (
          <>
            <div className="grid-2">
              <DropsCard item={i} extra={x} />
              <NodesCard item={i} />
            </div>
            <ContentsCard extra={x} />
            <OpenedFromCard extra={x} />
          </>
        )}
      </QueryState>
    ) : key === 'trade' ? (
      <QueryState query={extra}>
        {(x) => (
          <>
            <VendorsCard extra={x} />
            <div className="grid-2">
              <QuestsCard item={i} />
              <RecipesCard extra={x} />
            </div>
          </>
        )}
      </QueryState>
    ) : key === 'wants' ? (
      <SpecsCard item={i} />
    ) : (
      <div className="grid-2">
        <StatsCard item={i} extra={extra.data} />
        <TooltipCard item={i} />
      </div>
    )
  }
</Tabs>
```

`SpecsCard` keeps its own `return null` guard (harmless). Counts on the Sources/Trade tabs would need `extra` before it
loads; skip them (YAGNI).

**Step 2: Verify**

Run: `pnpm --filter @forever-ledger/admin typecheck`
Manual: `/admin/items/<id>` (pick one from `/admin/loot`) shows the header then tabs; a plain grey item has no "Who
wants it" tab.

**Step 3: Commit**

```bash
git add apps/admin/src/pages/items
git commit -m "feat(admin): Item page splits into Stats / Sources / Trade / Who wants it"
```

---

## Task 8: 🧙 Character: Overview / Quests / Professions tabs, quests paged

**Files:**

- Modify: `apps/admin/src/pages/characters/CharacterDetailPage.tsx` (`Timeline` lines 41–98)

**Step 1: Re-lay out.** Keep the header and `.kpis`; replace everything after the KPIs with:

```tsx
<Tabs
  id="char"
  tabs={[
    { key: 'overview', label: 'Overview' },
    { key: 'quests', label: 'Quests turned in', count: t.totals.turnIns },
    { key: 'professions', label: 'Professions' },
  ]}
  label="Character sections"
>
  {(key) =>
    key === 'quests' ? (
      <Card title="Quests turned in">
        <DataTable
          data={[...t.turnIns].reverse()}
          columns={turnInColumns}
          rowKey={(r) => `${r.questId}:${r.turnedInAt}`}
          initialSorting={[{ id: 'turnedInAt', desc: true }]}
          pageSize={50}
          empty="No quests turned in yet."
        />
      </Card>
    ) : key === 'professions' ? (
      <Professions charKey={charKey} />
    ) : (
      <>
        <div className="grid-2">
          <LevelCard t={t} />
          <XpCard t={t} />
        </div>
        <PerDayCard t={t} />
      </>
    )
  }
</Tabs>
```

**Step 2: Verify**

Run: `pnpm --filter @forever-ledger/admin typecheck`
Manual: `/admin/characters/<key>`; the Quests tab shows the count in the tab and pages at 50.

**Step 3: Commit**

```bash
git add apps/admin/src/pages/characters
git commit -m "feat(admin): Character page splits into Overview / Quests / Professions"
```

---

## Task 9: 🏰 Dungeons: Instances / Runs tabs

**Files:**

- Modify: `apps/admin/src/pages/dungeons/DungeonsPage.tsx` (lines 43–73)

**Step 1: Re-lay out.** Keep the header and the build `filters` row, then:

```tsx
<Tabs
  id="dungeons"
  tabs={[
    { key: 'instances', label: 'Per instance' },
    { key: 'runs', label: 'Runs' },
  ]}
  label="Dungeon sections"
>
  {(key) =>
    key === 'runs' ? (
      <RunsCard key={build ?? 'all'} build={build} />
    ) : (
      <>
        <QueryState query={summary}>{(s) => <SummaryCard rows={s} />}</QueryState>
        <div className="grid-2">
          <ClearTimesCard query={clear} />
          <QueryState query={summary}>{(s) => <XpRateCard rows={s} />}</QueryState>
        </div>
      </>
    )
  }
</Tabs>
```

`RunPage`'s back link is `/dungeons`; a run opened from the Runs tab returns to the Instances tab. Change the link in
`RunPage.tsx` to `/dungeons?tab=runs`.

**Step 2: Verify**

Run: `pnpm --filter @forever-ledger/admin typecheck`
Manual: `/admin/dungeons`, both tabs; open a run, the back link returns to Runs.

**Step 3: Commit**

```bash
git add apps/admin/src/pages/dungeons
git commit -m "feat(admin): Dungeons splits into Per instance / Runs"
```

---

## Task 10: 🩺 Health: Diagnostics / API samples tabs

**Files:**

- Modify: `apps/admin/src/pages/HealthPage.tsx` (lines 22–36)

**Step 1: Re-lay out.**

```tsx
<Tabs
  id="health"
  tabs={[
    { key: 'diagnostics', label: 'Diagnostics' },
    { key: 'samples', label: 'API samples' },
  ]}
  label="Health sections"
>
  {(key) => (key === 'samples' ? <Samples /> : <Feed />)}
</Tabs>
```

**Step 2: Verify**

Run: `pnpm --filter @forever-ledger/admin typecheck`
Manual: `/admin/health?tab=samples` opens samples.

**Step 3: Commit**

```bash
git add apps/admin/src/pages/HealthPage.tsx
git commit -m "feat(admin): Health splits into Diagnostics / API samples"
```

---

## Task 11: 📜 Quests: scatter collapsed, page size 50

**Files:**

- Modify: `apps/admin/src/pages/quests/QuestsPage.tsx` (`ScatterCard` line 372–398)
- Modify: `apps/admin/src/pages/quests/questLib.ts` line 11
- Modify: `apps/admin/src/pages/quests/questLib.test.ts` (any literal `200` that means the page size)

**Step 1: Test first.** In `questLib.test.ts`, the path test at line ~80 uses `offset=200` as an input value (fine,
keep it). If any assertion hard-codes `limit=200`, change it to use `QUESTS_PAGE_SIZE`. Run
`pnpm --filter @forever-ledger/admin test -- questLib` → pass before the change.

**Step 2: Change** `export const QUESTS_PAGE_SIZE = 50;` and in `ScatterCard` replace
`<Card title="XP offered vs quest level (this page)">` with
`<Collapsible title="XP offered vs quest level (this page)">` (and the closing tag). `Collapsible` mounts its body
on open (see Context), so the scatter chart gets its real width. Confirm in the browser: open the card and the scatter
has width.

**Step 3: Verify**

Run: `pnpm --filter @forever-ledger/admin test && pnpm --filter @forever-ledger/admin typecheck`
Manual: `/admin/quests` shows 50 rows per page and a folded scatter card that renders correctly when opened.

**Step 4: Commit**

```bash
git add apps/admin/src/pages/quests
git commit -m "feat(admin): Quests page at 50 rows, scatter chart folded by default"
```

---

## Task 12: 🏠 Overview: Builds and Versions collapsed

**Files:**

- Modify: `apps/admin/src/pages/OverviewPage.tsx` (`BuildsCard` line 240, `VersionsCard` line 305)

**Step 1:** `BuildsCard` → `<Collapsible title="Builds" count={builds.length}>`; `VersionsCard` →
`<Collapsible title="Versions in use">`. Both closed by default; the KPIs, charts and live feed stay `Card`.

**Step 2: Verify** `pnpm --filter @forever-ledger/admin typecheck`; manual: `/admin/` folds the bottom row.

**Step 3: Commit**

```bash
git add apps/admin/src/pages/OverviewPage.tsx
git commit -m "feat(admin): Overview folds the Builds and Versions cards"
```

---

## Task 13: 🚀 Check, PR, merge, deploy, notify

**Step 1:** `pnpm check` from the repo root. Expected: eslint, prettier, luacheck, typecheck, Lua harness and vitest
all pass. Fix anything it flags (prettier may reformat the new files: `pnpm prettier --write apps/admin/src`).

**Step 2:** Update the progress checks in this file with commit hashes and times (America/Chicago), commit as
`docs(plan): admin tabs and accordions shipped`.

**Step 3:** Push and open the PR with `gh pr create --base master --title "feat(admin): tabs, accordions and paging on the tall pages"`; body lists the per-page changes, the Vendors `?npc=` deviation, and ends with the required
attribution line. Merge when CI is green (`gh pr merge --squash --delete-branch`).

**Step 4: Deploy** on the VPS: `git checkout master && git pull && pnpm install --frozen-lockfile && pnpm build && pm2 restart forever-ledger-api` (the API serves `apps/admin/dist` at `/admin/`). Smoke: open
`https://ledger.willikers.dev/admin/vendors`, `/admin/professions?tab=gathering`, `/admin/items/<id>`.

**Step 5:** `curl -d "Forever Ledger: admin tabs/accordions merged and deployed" ntfy.sh/m0kuNjxWbhNSGY4c`.
