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
    // By id, not a `#…` selector: keys can be run ids or other strings that are not valid in a selector.
    document.getElementById(`${id}-tab-${key}`)?.focus();
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
      <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKey}>
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
