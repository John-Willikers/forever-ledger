import type { EntityType } from '@forever-ledger/contracts';
import type { HTMLElement } from 'node-html-parser';
import { collapse } from '../html.js';
import { levelRange } from './tables.js';
import type { ClaimDraft } from './types.js';

/**
 * Mobalytics interactive maps (zone-map-level-ranges, dungeon-raid-map). The sidebar lists every map layer as a
 * checkbox: `<section aria-label="Zone Name + Levels">` holds rows whose `aria-label` is `Durotar 1–10` or
 * `Excavation Site (24-29)`. Rows with a level range become `level_range` claims; the section says whether it is a
 * zone, a dungeon or a raid, and whether Mobalytics files it under WoW Classic. Read from real pages fetched
 * 2026-10-06 (snapshots 1 and 2).
 */
export const MOBALYTICS_PARSER = 'mobalytics@1';

/** `Durotar 1–10`, `Hall of Thanes (13-18)`: the name and the range text, else null. */
export function nameAndLevels(label: string): { name: string; levels: string } | null {
  const m = /^(.+?)\s*\(?\s*(\d{1,2}\s*[-–—]\s*\d{1,2})\s*\)?$/.exec(collapse(label));
  return m ? { name: m[1]!.trim(), levels: m[2]! } : null;
}

function groupType(group: string): EntityType | null {
  if (/raid|dungeon|instance/i.test(group)) return 'dungeon';
  if (/zone/i.test(group)) return 'zone';
  return null;
}

/** The `aria-label` of the nearest enclosing `<section aria-label>`: the row's own group, not an outer wrapper. */
function groupOf(el: HTMLElement): string | null {
  for (let p = el.parentNode; p; p = p.parentNode) {
    if (p.tagName === 'SECTION' && p.getAttribute('aria-label')) {
      return collapse(p.getAttribute('aria-label')!);
    }
  }
  return null;
}

export function parseMobalyticsMap(root: HTMLElement): ClaimDraft[] {
  const out: ClaimDraft[] = [];
  const seen = new Set<string>();
  for (const row of root.querySelectorAll('button[id^="map-category-"]')) {
    const group = groupOf(row);
    const entityType = group ? groupType(group) : null;
    const label = row.getAttribute('aria-label');
    const parsed = label ? nameAndLevels(label) : null;
    const range = parsed ? levelRange(parsed.levels) : null;
    if (!group || !entityType || !parsed || !range) continue;
    const classic = /classic/i.test(group) && !/forever/i.test(group);
    const raid = /raid/i.test(group);
    const key = `${entityType}|${parsed.name.toLowerCase()}|${classic}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const quote = `${group} › ${collapse(label!)}`;
    out.push({
      entityType,
      entityName: parsed.name,
      attribute: 'level_range',
      value: range,
      quote,
      // Mobalytics files these under WoW Classic on its Forever page: Classic-era data until checked in game.
      ...(classic ? { label: 'CLASSIC' as const } : {}),
    });
    if (raid)
      out.push({ entityType, entityName: parsed.name, attribute: 'kind', value: 'raid', quote });
  }
  return out;
}
