import type { EntityType } from '@forever-ledger/contracts';
import { bracketedAfter, tryJson } from './scan.js';
import type { ClaimDraft, CommentDraft, ParseResult } from './types.js';

/**
 * Wowhead entity pages (item=, npc=, quest=, object=, spell=, zone=). The facts are in inline scripts:
 * `WH.Gatherer.addData(type, env, {...})` (names, quality) and `new Listview({id: 'dropped-by', data: [...]})` (who
 * drops it, where it is fished, what contains it). Their JSON is cut out by bracket matching and JSON.parse'd; nothing
 * is evaluated. Written before the first real Forever page was fetched: check it against `fixtures/real/web/` and bump
 * the version when the output changes.
 */
export const WOWHEAD_PARSER = 'wowhead@1';

const PAGE_TYPES: Record<string, EntityType> = {
  item: 'item',
  npc: 'npc',
  quest: 'quest',
  object: 'object',
  spell: 'spell',
  zone: 'zone',
};

/** Gatherer type ids. */
const GATHERER_TYPES: Record<number, EntityType> = {
  1: 'npc',
  2: 'object',
  3: 'item',
  5: 'quest',
  6: 'spell',
  7: 'zone',
};

/** Listview ids we know, to claim attributes; others become `lv_<id>`. */
const RELATIONS: Record<string, string> = {
  'dropped-by': 'dropped_by',
  'contained-in-object': 'contained_in_object',
  'contained-in-item': 'contained_in_item',
  'fished-in': 'fished_in',
  'gathered-from-object': 'gathered_from_object',
  'mined-from-object': 'mined_from_object',
  'herbed-from-object': 'herbed_from_object',
  'skinned-from': 'skinned_from',
  'pickpocketed-from': 'pickpocketed_from',
  'sold-by': 'sold_by',
  'reward-from-q': 'reward_from_quest',
  'objective-of-q': 'objective_of_quest',
  'created-by-spell': 'created_by_spell',
  'reagent-for': 'reagent_for',
  drops: 'drops',
  sells: 'sells',
  starts: 'starts_quest',
  ends: 'ends_quest',
};

export const MAX_ROWS_PER_LIST = 500;

/** The entity a Wowhead URL is about: `/forever/item=4655/big-mouth-clam` → item 4655. */
export function wowheadEntity(url: string): { type: EntityType; id: number } | null {
  const m = /\/(item|npc|quest|object|spell|zone)=(\d+)/.exec(new URL(url).pathname);
  if (!m) return null;
  return { type: PAGE_TYPES[m[1]!]!, id: Number(m[2]) };
}

const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : undefined);
const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : undefined);

/** The position just past each `marker` in `src`. */
function* calls(src: string, marker: string) {
  let at = src.indexOf(marker);
  while (at !== -1) {
    yield at + marker.length;
    at = src.indexOf(marker, at + marker.length);
  }
}

/** The JSON array a Listview's `data:` refers to, inline or through `var lv_x = [...]`. */
function listData(script: string, obj: string): unknown[] | undefined {
  const m = /\bdata\s*:\s*([[A-Za-z_$])/.exec(obj);
  if (!m) return undefined;
  if (m[1] === '[') {
    const text = bracketedAfter(obj, m.index);
    const v = text ? tryJson(text) : undefined;
    return Array.isArray(v) ? v : undefined;
  }
  const ident = /\bdata\s*:\s*([A-Za-z_$][\w$]*)/.exec(obj)?.[1];
  if (!ident) return undefined;
  const decl = new RegExp(`\\b${ident.replace(/\$/g, '\\$')}\\s*=\\s*\\[`).exec(script);
  if (!decl) return undefined;
  const text = bracketedAfter(script, decl.index);
  const v = text ? tryJson(text) : undefined;
  return Array.isArray(v) ? v : undefined;
}

/** `2019/09/04 18:39:34` (Wowhead's comment dates) as a Date, else null. Wowhead does not say the zone; read as UTC. */
function commentDate(v: unknown): Date | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(v);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The fields of a Listview row worth keeping in a claim. */
function rowValue(row: Record<string, unknown>, template: string | undefined) {
  const v: Record<string, unknown> = {};
  const id = int(row.id);
  if (id !== undefined) v.id = id;
  if (template) v.type = template;
  const name = str(row.name) ?? str(row.name_enus);
  // Item rows prefix the name with the quality digit (`6Big-mouth Clam`).
  if (name) v.name = template === 'item' ? name.replace(/^\d/, '') : name;
  for (const [from, to] of [
    ['count', 'count'],
    ['outof', 'outOf'],
    ['minlevel', 'minLevel'],
    ['maxlevel', 'maxLevel'],
    ['level', 'level'],
    ['reqlevel', 'reqLevel'],
    ['quality', 'quality'],
    ['skill', 'skill'],
  ] as const) {
    const n = int(row[from]);
    if (n !== undefined) v[to] = n;
  }
  if (Array.isArray(row.location)) v.zones = row.location.filter((z) => int(z) !== undefined);
  if (typeof row.percent === 'number') v.percent = row.percent;
  return v;
}

export function parseWowhead(html: string, url: string, title: string | null): ParseResult {
  const entity = wowheadEntity(url);
  const claims: ClaimDraft[] = [];
  const comments: CommentDraft[] = [];
  const problems: string[] = [];
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]!);
  const script = scripts.join('\n;\n');

  // Names from the Gatherer: the page's own entity, plus everything the page links to.
  for (const at of calls(script, 'WH.Gatherer.addData(')) {
    const args = /^\s*(\d+)\s*,\s*\d+\s*,\s*/.exec(script.slice(at));
    const type = args ? GATHERER_TYPES[Number(args[1])] : undefined;
    const text = args ? bracketedAfter(script, at + args[0].length) : null;
    const data = text ? tryJson(text) : undefined;
    if (!type || !data || typeof data !== 'object') continue;
    for (const [idText, row] of Object.entries(data as Record<string, unknown>)) {
      const id = Number(idText);
      const name = str((row as Record<string, unknown>)?.name_enus);
      if (!Number.isInteger(id) || !name) continue;
      claims.push({ entityType: type, entityId: id, attribute: 'name', value: name });
    }
  }

  if (entity) {
    for (const at of calls(script, 'new Listview(')) {
      const obj = bracketedAfter(script, at);
      if (!obj) continue;
      const head = obj.replace(/\bdata\s*:\s*\[[\s\S]*$/, '');
      const id = /\bid\s*:\s*['"]([\w-]+)['"]/.exec(head)?.[1];
      const template = /\btemplate\s*:\s*['"]([\w-]+)['"]/.exec(head)?.[1];
      if (!id) continue;
      const rows = listData(script, obj);
      if (!rows) {
        problems.push(`listview ${id}: data is not JSON`);
        continue;
      }
      if (template === 'comment') {
        for (const r of rows.slice(0, MAX_ROWS_PER_LIST) as Record<string, unknown>[]) {
          const commentId = int(r.id);
          const body = str(r.body);
          if (commentId === undefined || !body) continue;
          comments.push({
            commentId,
            entityType: entity.type,
            entityId: entity.id,
            postedAt: commentDate(r.date),
            rating: int(r.rating) ?? null,
            body,
          });
        }
        continue;
      }
      const attribute = RELATIONS[id] ?? `lv_${id.replace(/-/g, '_')}`;
      if (rows.length > MAX_ROWS_PER_LIST)
        problems.push(`listview ${id}: kept ${MAX_ROWS_PER_LIST} of ${rows.length}`);
      for (const r of rows.slice(0, MAX_ROWS_PER_LIST)) {
        if (!r || typeof r !== 'object') continue;
        claims.push({
          entityType: entity.type,
          entityId: entity.id,
          attribute,
          value: rowValue(r as Record<string, unknown>, template),
        });
      }
    }
    if (!claims.some((c) => c.attribute === 'name' && c.entityId === entity.id) && title) {
      const name = title.split(' - ')[0]?.trim();
      if (name)
        claims.push({
          entityType: entity.type,
          entityId: entity.id,
          attribute: 'name',
          value: name,
        });
    }
  } else {
    problems.push('not a Wowhead entity page; only names were read');
  }

  return {
    parser: WOWHEAD_PARSER,
    title,
    pageUpdatedAt: null,
    build: null,
    claims,
    comments,
    problems,
  };
}
