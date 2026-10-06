import type { EntityType } from '@forever-ledger/contracts';
import type { HTMLElement } from 'node-html-parser';
import { collapse } from '../html.js';
import type { ClaimDraft } from './types.js';

/**
 * Guide pages (Mobalytics and the like): HTML tables whose headers name a zone or dungeon and a level column become
 * `level_range` claims, each quoting its table row. Prose is not turned into claims automatically; those are added by
 * hand (`knowledge-cli claim add`), with a quote checked against the stored page.
 */
export const TABLE_PARSER = 'table@1';

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

export function parseTables(root: HTMLElement): ClaimDraft[] {
  const out: ClaimDraft[] = [];
  for (const table of root.querySelectorAll('table')) {
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
      const quote = c.filter(Boolean).join(' | ');
      out.push({ entityType, entityName: name, attribute: 'level_range', value: range, quote });
      const zone = zoneCol === -1 ? undefined : c[zoneCol];
      if (zone) out.push({ entityType, entityName: name, attribute: 'zone', value: zone, quote });
    }
  }
  return out;
}
