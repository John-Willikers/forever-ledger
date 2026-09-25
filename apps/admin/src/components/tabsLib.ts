/** One tab of a `Tabs` bar. `count` shows after the label. */
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
  const n = tabs.length;
  if (n === 0) return '';
  const at = Math.max(
    0,
    tabs.findIndex((t) => t.key === current),
  );
  return tabs[(((at + delta) % n) + n) % n]!.key;
}
