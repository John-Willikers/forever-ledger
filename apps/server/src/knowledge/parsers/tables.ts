import type { EntityType } from '@forever-ledger/contracts';
import type { HTMLElement } from 'node-html-parser';
import { collapse } from '../html.js';
import type { ClaimDraft } from './types.js';

/**
 * Guide pages (Mobalytics and the like): HTML tables whose headers name a zone or dungeon and a level column become
 * `level_range` claims, each quoting its table row. Prose is not turned into claims automatically; those are added by
 * hand (`knowledge-cli claim`), with a quote checked against the stored page. The headings above a table say what it
 * lists: under a "WoW Classic" heading (and no "WoW Forever" one after it) its rows are labeled CLASSIC, under "Raids"
 * its dungeons are raids. v2: heading context (Mobalytics' dungeon-raid-map has Forever and Classic tables).
 */
export const TABLE_PARSER = 'table@2';

/** `40-50`, `40 – 50`, `Lv. 24-29`, `43 to 55` → {min, max}; a single level gives min = max. */
export function levelRange(text: string): { min: number; max: number } | null {
  const range = /(\d{1,2})\s*(?:-|–|—|to)\s*(\d{1,2})/.exec(text);
  if (range) {
    const min = Number(range[1]);
    const max = Number(range[2]);
    return min >= 1 && max >= min && max <= 80 ? { min, max } : null;
  }
  const one = /^\D*(\d{1,2})\D*$/.exec(text);
  if (one) {
    const n = Number(one[1]);
    return n >= 1 && n <= 80 ? { min: n, max: n } : null;
  }
  return null;
}

const SUBJECTS: [RegExp, EntityType][] = [
  [/dungeon|instance|raid/i, 'dungeon'],
  [/zone|area|region|location/i, 'zone'],
];

function cells(row: HTMLElement) {
  return row.querySelectorAll('th, td').map((c) => collapse(c.textContent));
}

/** Each table with the headings that came before it in the document (nearest last). */
function tablesWithHeadings(root: HTMLElement) {
  const out: { table: HTMLElement; headings: string[] }[] = [];
  const headings: string[] = [];
  for (const el of root.querySelectorAll('h1, h2, h3, h4, h5, h6, table')) {
    if (el.tagName === 'TABLE') out.push({ table: el, headings: headings.slice(-4) });
    else headings.push(collapse(el.textContent));
  }
  return out;
}

export function parseTables(root: HTMLElement): ClaimDraft[] {
  const out: ClaimDraft[] = [];
  for (const { table, headings } of tablesWithHeadings(root)) {
    const version = [...headings].reverse().find((h) => /\b(classic|forever)\b/i.test(h));
    const classic = version !== undefined && /classic/i.test(version) && !/forever/i.test(version);
    const raid = /\braids?\b/i.test(
      [...headings].reverse().find((h) => /dungeon|raid/i.test(h)) ?? '',
    );
    const context = headings.slice(-2).join(' › ');
    const rows = table.querySelectorAll('tr');
    if (rows.length < 2) continue;
    const headers = cells(rows[0]!);
    const levelCol = headers.findIndex((h) => /level|lvl/i.test(h));
    if (levelCol === -1) continue;
    let subjectCol = -1;
    let entityType: EntityType | null = null;
    for (const [re, type] of SUBJECTS) {
      subjectCol = headers.findIndex((h, i) => i !== levelCol && re.test(h));
      if (subjectCol !== -1) {
        entityType = type;
        break;
      }
    }
    if (!entityType) continue;
    // A "Zone" column beside a "Dungeon" column says where the dungeon is.
    const zoneCol =
      entityType === 'dungeon'
        ? headers.findIndex(
            (h, i) => i !== subjectCol && i !== levelCol && /zone|location/i.test(h),
          )
        : -1;
    for (const row of rows.slice(1)) {
      const c = cells(row);
      const name = c[subjectCol];
      const range = c[levelCol] ? levelRange(c[levelCol]) : null;
      if (!name || !range) continue;
      const line = c.filter(Boolean).join(' | ');
      const quote = context ? `${context} › ${line}` : line;
      const label = classic ? { label: 'CLASSIC' as const } : {};
      out.push({
        entityType,
        entityName: name,
        attribute: 'level_range',
        value: range,
        quote,
        ...label,
      });
      const zone = zoneCol === -1 ? undefined : c[zoneCol];
      if (zone)
        out.push({ entityType, entityName: name, attribute: 'zone', value: zone, quote, ...label });
      if (raid && entityType === 'dungeon') {
        out.push({ entityType, entityName: name, attribute: 'kind', value: 'raid', quote });
      }
    }
  }
  return out;
}
