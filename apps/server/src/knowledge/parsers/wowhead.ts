import type { EntityType, GameVersion } from '@forever-ledger/contracts';
import type { HTMLElement } from 'node-html-parser';
import { bracketedAfter, codeMarkers, topLevel, tryJson } from './scan.js';
import type { ClaimDraft, CommentDraft, ParseResult } from './types.js';

/**
 * Wowhead entity pages (item=, npc=, quest=, object=, spell=, zone=). The facts are in inline scripts:
 * `WH.Gatherer.addData(type, env, {...})` (names, quality) and `new Listview({id: 'dropped-by', data: [...]})` (who
 * drops it, where it is fished, what contains it). Their JSON is cut out by bracket matching and JSON.parse'd; nothing
 * is evaluated. Written before the first real Forever page was fetched: check it against `fixtures/real/web/` and bump
 * the version when the output changes.
 */
export const WOWHEAD_PARSER = 'wowhead@4';

/**
 * Loot and fishing lists (who drops it, where it is fished, what a container holds) are not client data: Wowhead
 * collects them from players. On its /forever/ pages they are Classic-era numbers (comments from 2005, a million
 * catches in Azshara: checked on item 7973, 2026-10-06), so those claims are CLASSIC. Names are datamined from the
 * client and keep the source's label. v2: this label, `count: -1` (unknown) dropped, ISO comment dates. v3: quest and
 * NPC facts from `$.extend(g_quests[id], {...})` / `g_npcs`, an NPC's drops also claimed on each item (`dropped_by`,
 * so NPC pages stand in for item pages), media tabs (screenshots, videos) skipped. v4: a spell row's profession
 * (`skill: [197]`, an array, so it used to be dropped) is kept as `skills`: `created_by_spell` names the profession.
 */
/** Listviews that are page media, not facts. */
const MEDIA_LISTS = new Set(['screenshots', 'videos', 'videos-english', 'see-also']);

/** Facts from `$.extend(g_quests[id], {...})`: Wowhead's own quest record. */
function questFacts(f: Record<string, unknown>) {
  const out: [string, unknown][] = [];
  const n = (k: string) => int(f[k]);
  if (n('level') !== undefined) out.push(['level', n('level')]);
  if (n('reqlevel') !== undefined) out.push(['req_level', n('reqlevel')]);
  if (n('xp') !== undefined) out.push(['xp_reward', n('xp')]);
  if (n('money') !== undefined) out.push(['money_reward', n('money')]);
  if (n('side') !== undefined)
    out.push([
      'side',
      ({ 1: 'Alliance', 2: 'Horde', 3: 'both' } as Record<number, string>)[n('side')!] ?? n('side'),
    ]);
  if (Array.isArray(f.reprewards) && f.reprewards.length > 0) {
    out.push([
      'rep_rewards',
      (f.reprewards as unknown[])
        .filter(Array.isArray)
        .map((r) => ({ faction: (r as number[])[0], amount: (r as number[])[1] })),
    ]);
  }
  return out;
}

/** Facts from `$.extend(g_npcs[id], {...})`. */
function npcFacts(f: Record<string, unknown>) {
  const out: [string, unknown][] = [];
  const min = int(f.minlevel);
  const max = int(f.maxlevel);
  if (min !== undefined && max !== undefined) out.push(['level_range', { min, max }]);
  if (Array.isArray(f.location) && f.location.length > 0) {
    out.push(['zones', (f.location as unknown[]).filter((z) => int(z) !== undefined)]);
  }
  if (int(f.classification) !== undefined) out.push(['classification', int(f.classification)]);
  return out;
}
const OBSERVED_LISTS =
  /^(dropped_by|fished_in|contained_in_|lv_contains|gathered_|mined_|herbed_|skinned_|pickpocketed_|drops$)/;

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

/**
 * Wowhead's data trees, as its comment toggle uses them: 16 is Forever (the page's `dataEnv` names version 1.60.1,
 * the Forever client), 4 and 14 Classic Era. 1 is retail, which on old items means comments from original WoW.
 */
export function treeVersion(tree: number | null): GameVersion {
  if (tree === 16) return 'forever';
  if (tree === 4 || tree === 14) return 'classic';
  return 'unknown';
}

const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : undefined);
const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : undefined);

/** `key:` or `"key":` at the top level of an object literal's text (see `topLevel`). */
const keyRe = (key: string) => new RegExp(`(?<![\\w$])["']?${key}["']?\\s*:\\s*`);

const stringKey = (head: string, key: string) =>
  new RegExp(`${keyRe(key).source}['"]([\\w-]+)['"]`).exec(head)?.[1];

/**
 * The JSON array a Listview's `data:` refers to: inline, or a variable (`data: lv_comments0`) declared before the
 * Listview at `callAt`; the nearest such declaration wins when a page reuses a name.
 */
function listData(
  script: string,
  obj: string,
  head: string,
  callAt: number,
): unknown[] | undefined {
  const m = keyRe('data').exec(head);
  if (!m) return undefined;
  const at = m.index + m[0].length;
  if (obj[at] === '[') {
    const text = bracketedAfter(obj, at);
    const v = text ? tryJson(text) : undefined;
    return Array.isArray(v) ? v : undefined;
  }
  const ident = /^[A-Za-z_$][\w$]*/.exec(obj.slice(at))?.[0];
  if (!ident) return undefined;
  const escaped = ident.replace(/\$/g, '\\$');
  const decls = [
    ...script.slice(0, callAt).matchAll(new RegExp(`(?<![\\w$.])${escaped}\\s*=\\s*\\[`, 'g')),
  ];
  const decl = decls.at(-1);
  if (decl?.index === undefined) return undefined;
  const text = bracketedAfter(script, decl.index);
  const v = text ? tryJson(text) : undefined;
  return Array.isArray(v) ? v : undefined;
}

/**
 * A comment's date: ISO 8601 with an offset (`2007-05-04T16:59:25-05:00`, what the real pages carry), or the older
 * `2019/09/04 18:39:34` read as UTC. Else null.
 */
function commentDate(v: unknown): Date | null {
  if (typeof v !== 'string') return null;
  if (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
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
  // Wowhead writes -1 when it has no count.
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
    if (n !== undefined && !(n < 0 && (from === 'count' || from === 'outof'))) v[to] = n;
  }
  // Spell rows name their profession as an array of skill lines (`skill: [197]` is Tailoring).
  if (Array.isArray(row.skill)) {
    const skills = row.skill.filter((x) => int(x) !== undefined);
    if (skills.length > 0) v.skills = skills;
  }
  if (Array.isArray(row.location)) v.zones = row.location.filter((z) => int(z) !== undefined);
  if (typeof row.percent === 'number') v.percent = row.percent;
  return v;
}

export function parseWowhead(root: HTMLElement, url: string, title: string | null): ParseResult {
  const entity = wowheadEntity(url);
  const claims: ClaimDraft[] = [];
  const comments: CommentDraft[] = [];
  const problems: string[] = [];
  const script = root
    .querySelectorAll('script')
    .filter((el) => !el.getAttribute('src'))
    .map((el) => el.rawText)
    .join('\n;\n');

  // Names from the Gatherer: the page's own entity, plus everything the page links to.
  for (const at of codeMarkers(script, 'WH.Gatherer.addData(')) {
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
    const table = entity.type === 'quest' ? 'g_quests' : entity.type === 'npc' ? 'g_npcs' : null;
    if (table) {
      for (const at of codeMarkers(script, `$.extend(${table}[${entity.id}],`)) {
        const text = bracketedAfter(script, at);
        const facts = text ? tryJson(text) : undefined;
        if (!facts || typeof facts !== 'object') {
          problems.push(`${table}[${entity.id}] is not JSON`);
          continue;
        }
        const list =
          entity.type === 'quest'
            ? questFacts(facts as Record<string, unknown>)
            : npcFacts(facts as Record<string, unknown>);
        for (const [attribute, value] of list) {
          claims.push({ entityType: entity.type, entityId: entity.id, attribute, value });
        }
      }
    }
    const npcName =
      entity.type === 'npc'
        ? ((claims.find(
            (c) => c.attribute === 'name' && c.entityType === 'npc' && c.entityId === entity.id,
          )?.value as string | undefined) ?? title?.split(' - ')[0]?.trim())
        : undefined;
    for (const at of codeMarkers(script, 'new Listview(')) {
      const obj = bracketedAfter(script, at);
      if (!obj) {
        problems.push('a listview is not a balanced object');
        continue;
      }
      const head = topLevel(obj);
      const id = stringKey(head, 'id');
      const template = stringKey(head, 'template');
      if (!id) {
        problems.push('a listview has no id');
        continue;
      }
      if (MEDIA_LISTS.has(id)) continue;
      const rows = listData(script, obj, head, at);
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
            dataTree: int(r.dataTree) ?? null,
            gameVersion: treeVersion(int(r.dataTree) ?? null),
          });
        }
        continue;
      }
      const attribute = RELATIONS[id] ?? `lv_${id.replace(/-/g, '_')}`;
      if (rows.length > MAX_ROWS_PER_LIST)
        problems.push(`listview ${id}: kept ${MAX_ROWS_PER_LIST} of ${rows.length}`);
      for (const r of rows.slice(0, MAX_ROWS_PER_LIST)) {
        if (!r || typeof r !== 'object') continue;
        const value = rowValue(r as Record<string, unknown>, template);
        claims.push({
          entityType: entity.type,
          entityId: entity.id,
          attribute,
          value,
          ...(OBSERVED_LISTS.test(attribute) ? { label: 'CLASSIC' as const } : {}),
        });
        // An NPC's drops are each item's sources too: the item gets the same row, seen from its side.
        const itemId = int((r as Record<string, unknown>).id);
        if (entity.type === 'npc' && attribute === 'drops' && itemId !== undefined) {
          const {
            id: _item,
            type: _t,
            name: _n,
            quality: _q,
            level: _l,
            reqLevel: _r,
            ...counts
          } = value as Record<string, unknown>;
          claims.push({
            entityType: 'item',
            entityId: itemId,
            attribute: 'dropped_by',
            value: { id: entity.id, type: 'npc', ...(npcName ? { name: npcName } : {}), ...counts },
            label: 'CLASSIC',
          });
        }
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
