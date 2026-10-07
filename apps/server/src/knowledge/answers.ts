// Answers for the MCP server (project-plans/forever-ledger-mcp-server.md): every answer comes only from the ledger.
// Each one carries what our own uploads saw (`firstParty`, tier 1), the claims about it ranked by source tier with
// their label, source and build (`facts`), and what the ledger does not know (`gaps`). FALSE claims are never facts:
// only checkClaim lists them, as refuted. Pages are never republished: a fact carries a URL and a short quote.
import type { ClaimLabel, EntityType } from '@forever-ledger/contracts';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { iso, rows } from '../routes/adminData.js';
import { fishingYield, whereCaught } from '../routes/fishing.js';
import type { FishingFilters } from '../routes/fishing.js';
import { containsPattern } from '../routes/shared.js';
import { UI_MAP_NAMES } from '../uiMapNames.js';
import { findDisputes } from './disputes.js';
import type { Dispute } from './disputes.js';

/** Longest quote an answer carries (enough to check the claim, never a page). */
export const QUOTE_MAX = 240;
/** Most facts in one answer, and per attribute (a Classic drop list runs to hundreds); the rest are counted in `gaps`. */
export const FACTS_MAX = 120;
export const FACTS_PER_ATTRIBUTE = 12;
const SEARCH_LIMIT = 25;

export interface Fact {
  claimId: number;
  entity: { type: string; id: number | null; name: string | null };
  attribute: string;
  value: unknown;
  label: ClaimLabel;
  /** 1 is our own observation, 7 the least trusted. */
  tier: number;
  source: { kind: string; site: string; url: string | null; title: string | null };
  /** The client build the fact applies to, when the source says. */
  build: number | null;
  gameVersion: string;
  quote: string | null;
}

export interface EntityRef {
  type: EntityType;
  id: number | null;
  name: string | null;
}

export interface Answer<F = unknown> {
  query: string;
  entity: EntityRef | null;
  firstParty: F;
  facts: Fact[];
  gaps: string[];
}

const clip = (s: string | null) =>
  s === null ? null : s.length > QUOTE_MAX ? `${s.slice(0, QUOTE_MAX - 1)}…` : s;

/** Claim keys for an entity: its id as text and its lowercased name (seed claims are keyed by name). */
const keysOf = (e: EntityRef) =>
  [e.id === null ? null : String(e.id), e.name?.trim().toLowerCase() || null].filter(
    (k): k is string => k !== null,
  );

/** Claims about entities, best first (tier, then label, then newest build). FALSE ones only when asked. */
export async function claimsAbout(
  db: Db,
  entities: { type: string; keys: string[] }[],
  opts: {
    attributes?: readonly string[];
    includeFalse?: boolean;
    where?: SQL;
    perAttribute?: number;
    /** Internal: the FALSE-only pass. */
    labels?: 'false';
  } = {},
): Promise<{ facts: Fact[]; more: number }> {
  const targets = entities.filter((e) => e.keys.length > 0);
  if (targets.length === 0 && !opts.where) return { facts: [], more: 0 };
  const parts: SQL[] = [];
  if (targets.length > 0) {
    parts.push(
      sql`(${sql.join(
        targets.map(
          (e) =>
            sql`(c.entity_type = ${e.type} and c.entity_key in (${sql.join(
              e.keys.map((k) => sql`${k}`),
              sql`, `,
            )}))`,
        ),
        sql` or `,
      )})`,
    );
  }
  if (opts.where) parts.push(opts.where);
  if (opts.attributes?.length) {
    parts.push(
      sql`c.attribute in (${sql.join(
        opts.attributes.map((a) => sql`${a}`),
        sql`, `,
      )})`,
    );
  }
  // FALSE claims never compete with the others for the caps: check_claim lists every one (up to FACTS_MAX).
  const falseOnly = opts.labels === 'false';
  parts.push(falseOnly ? sql`c.label = 'FALSE'` : sql`c.label <> 'FALSE'`);
  const res = await rows<{
    id: number;
    entity_type: string;
    entity_id: number | null;
    entity_name: string | null;
    attribute: string;
    value: unknown;
    label: ClaimLabel;
    observed_build: number | null;
    quote: string | null;
    kind: string;
    site: string;
    url: string | null;
    title: string | null;
    tier: number;
    game_version: string;
    total: number;
  }>(
    db,
    // Best first within each attribute: most trusted source, best label, then the biggest count (top droppers).
    sql`select * from (
          select c.id, c.entity_type, c.entity_id, c.entity_name, c.attribute, c.value, c.label, c.observed_build,
                 c.quote, s.kind, s.site, s.url, s.title, s.tier, s.game_version, count(*) over ()::int as total,
                 row_number() over (
                   partition by c.attribute
                   order by s.tier,
                            array_position(array['VERIFIED','CLASSIC','ANECDOTE','UNVERIFIED','FALSE'], c.label),
                            case when jsonb_typeof(c.value) = 'object' and jsonb_typeof(c.value->'count') = 'number'
                                 then (c.value->>'count')::numeric end desc nulls last,
                            c.observed_build desc nulls last, c.id) as rank
            from claims c join sources s on s.id = c.source_id
           where ${sql.join(parts, sql` and `)}) ranked
         where rank <= ${falseOnly ? FACTS_MAX : (opts.perAttribute ?? FACTS_PER_ATTRIBUTE)}
         order by tier, array_position(array['VERIFIED','CLASSIC','ANECDOTE','UNVERIFIED','FALSE'], label),
                  attribute, rank
         limit ${FACTS_MAX}`,
  );
  const facts = res.map((r) => ({
    claimId: r.id,
    entity: { type: r.entity_type, id: r.entity_id, name: r.entity_name },
    attribute: r.attribute,
    value: r.value,
    label: r.label,
    tier: r.tier,
    source: { kind: r.kind, site: r.site, url: r.url, title: r.title },
    build: r.observed_build,
    gameVersion: r.game_version,
    quote: clip(r.quote),
  }));
  const found = { facts, more: Math.max(0, (res[0]?.total ?? 0) - res.length) };
  if (!opts.includeFalse || falseOnly) return found;
  const refuted = await claimsAbout(db, entities, { ...opts, labels: 'false' });
  return { facts: [...found.facts, ...refuted.facts], more: found.more + refuted.more };
}

/** Gaps every answer shares: truncation, and when all it has is Classic-era or unconfirmed data. */
function commonGaps(facts: Fact[], more: number, hasFirstParty: boolean): string[] {
  const gaps: string[] = [];
  if (more > 0) {
    gaps.push(
      `${more} more facts not shown (the best ${facts.length}, at most ${FACTS_PER_ATTRIBUTE} per attribute)`,
    );
  }
  if (facts.length === 0 && !hasFirstParty) {
    gaps.push('the ledger knows nothing about it yet: no observations and no claims');
  } else if (!hasFirstParty) {
    gaps.push('no first-party observations in the ledger yet (none of our uploads saw it)');
  }
  if (facts.length > 0 && facts.every((f) => f.label !== 'VERIFIED')) {
    gaps.push(
      'no VERIFIED Forever fact: everything here is Classic-era or unconfirmed and Forever may differ',
    );
  }
  return gaps;
}

/** Whether the entity's Wowhead page is fetched, queued or skipped: says why facts may be missing. */
async function pageGap(db: Db, type: string, id: number | null): Promise<string | null> {
  if (id === null) return null;
  const [t] = await rows<{ state: string }>(
    db,
    sql`select state from fetch_targets
         where (entity_type = ${type} and entity_id = ${id})
            or (site = 'wowhead.com' and url ~ ${`/${type}=${id}([/?#]|$)`})
         order by (state = 'done') desc limit 1`,
  );
  if (!t) return `its Wowhead page is not in the fetch queue`;
  if (t.state === 'done') return null;
  if (t.state === 'skipped') return `its Wowhead page was skipped as junk`;
  return `its Wowhead page is not fetched yet (${t.state})`;
}

export interface SearchHit {
  type: EntityType;
  id: number | null;
  name: string;
  matchedBy: string;
}

/** Entities whose name contains `text` (or whose id it is), from our own tables and from claim names. */
export async function searchEntities(
  db: Db,
  text: string,
  type?: EntityType,
): Promise<SearchHit[]> {
  const q = text.trim();
  if (!q) return [];
  const id = /^\d{1,9}$/.test(q) ? Number(q) : null;
  const like = containsPattern(q);
  const want = (t: EntityType) => type === undefined || type === t;
  const parts: SQL[] = [];
  if (want('item')) {
    parts.push(sql`select 'item' as type, item_id as id, name, 'items' as matched_by from items
                    where ${id === null ? sql`name ilike ${like} escape '\\'` : sql`item_id = ${id}`}`);
  }
  if (want('quest')) {
    parts.push(sql`select 'quest', quest_id, title, 'quests' from quests
                    where ${id === null ? sql`title ilike ${like} escape '\\'` : sql`quest_id = ${id}`}`);
  }
  if (want('npc')) {
    for (const [table, col] of [
      ['vendors', 'npc_id'],
      ['trainers', 'npc_id'],
    ] as const) {
      parts.push(sql`select distinct 'npc', ${sql.raw(col)}, name, ${table} from ${sql.raw(table)}
                      where ${id === null ? sql`name ilike ${like} escape '\\'` : sql`${sql.raw(col)} = ${id}`}`);
    }
    parts.push(sql`select distinct 'npc', (value->>'id')::int, value->>'name', 'source lists' from claims
                    where jsonb_typeof(value) = 'object' and value->>'type' = 'npc'
                      and value->>'id' ~ '^[0-9]{1,9}$' and label <> 'FALSE' and ${
                        id === null
                          ? sql`value->>'name' ilike ${like} escape '\'`
                          : sql`value->>'id' = ${String(id)}`
                      }`);
    parts.push(sql`select distinct 'npc', npc_id, npc_name, 'quest givers' from quest_observations
                    where npc_name is not null and ${
                      id === null ? sql`npc_name ilike ${like} escape '\\'` : sql`npc_id = ${id}`
                    }`);
  }
  if (want('zone')) {
    parts.push(sql`select distinct 'zone', ui_map_id, name, 'maps' from zone_maps
                    where ${id === null ? sql`name ilike ${like} escape '\\'` : sql`ui_map_id = ${id}`}`);
    if (id === null) {
      parts.push(sql`select distinct 'zone', null::int, zone, 'fishing casts' from fishing_casts
                      where zone ilike ${like} escape '\\'`);
    }
  }
  // Claims name entities nothing of ours has seen (NPCs, zones, dungeons from guides).
  // Named only by the claim's entity name or a `name` claim's value (never another attribute's value).
  parts.push(sql`select distinct c.entity_type, c.entity_id,
                         coalesce(c.entity_name, case when c.attribute = 'name' then c.value #>> '{}' end), 'claims'
                  from claims c
                 where c.label <> 'FALSE' and ${type === undefined ? sql`true` : sql`c.entity_type = ${type}`}
                   and ${
                     id === null
                       ? sql`(c.entity_name ilike ${like} escape '\\'
                              or (c.attribute = 'name' and c.value #>> '{}' ilike ${like} escape '\\'))`
                       : sql`c.entity_id = ${id}`
                   }`);
  const res = await rows<{
    type: EntityType;
    id: number | null;
    name: string | null;
    matched_by: string;
  }>(
    db,
    sql`select * from (${sql.join(parts, sql` union all `)}) hits(type, id, name, matched_by)
         where name is not null
         order by (lower(name) = ${q.toLowerCase()}) desc, length(name), (id is null)
         limit 500`,
  );
  // Zones by the game's own map names (the addon records map ids).
  if (want('zone')) {
    for (const [mapId, name] of Object.entries(UI_MAP_NAMES)) {
      if (id === null ? name.toLowerCase().includes(q.toLowerCase()) : Number(mapId) === id) {
        res.push({ type: 'zone', id: Number(mapId), name, matched_by: 'map names' });
      }
    }
  }
  // One hit per entity: by id (two items may share a name), a name-only hit folds into an id hit of that name, and a
  // zone is one hit however many map ids it has.
  const seen = new Map<string, SearchHit>();
  const named = (t: string, name: string) => `${t}:name:${name.toLowerCase()}`;
  for (const r of [...res].sort((a, b) => Number(a.id === null) - Number(b.id === null))) {
    const zoneLike = r.type === 'zone' || r.type === 'dungeon';
    const key = r.id === null || zoneLike ? named(r.type, r.name!) : `${r.type}:${r.id}`;
    if (seen.has(key) || (r.id === null && seen.has(named(r.type, r.name!)))) continue;
    const hit = { type: r.type, id: r.id, name: r.name!, matchedBy: r.matched_by };
    seen.set(key, hit);
    if (!zoneLike && r.id !== null && !seen.has(named(r.type, r.name!))) {
      seen.set(named(r.type, r.name!), hit);
    }
  }
  const lower = q.toLowerCase();
  return [...new Set(seen.values())]
    .sort(
      (a, b) =>
        Number(b.name.toLowerCase() === lower) - Number(a.name.toLowerCase() === lower) ||
        a.name.length - b.name.length ||
        a.name.localeCompare(b.name),
    )
    .slice(0, SEARCH_LIMIT);
}

/** An id or a name → one entity of that type (the best search hit), or null. */
export async function resolveEntity(
  db: Db,
  type: EntityType,
  ref: string | number,
): Promise<EntityRef | null> {
  const [hit] = await searchEntities(db, String(ref), type);
  // An id nothing names yet (an NPC only seen in kills, say) is still worth looking up by id.
  if (!hit) {
    if (!/^\d{1,9}$/.test(String(ref).trim())) return null;
    const id = Number(ref);
    const name = type === 'npc' ? ((await npcNames(db, [id])).get(id) ?? null) : null;
    return { type, id, name };
  }
  // A hit from claims may lack an id (a seed claim by name) or a name (an id-only claim): fill in what we can.
  const { name } = hit;
  let { id } = hit;
  if (id === null) {
    const [withId] = await rows<{ entity_id: number }>(
      db,
      sql`select entity_id from claims where entity_type = ${type} and entity_id is not null
            and lower(entity_name) = ${name.toLowerCase()} limit 1`,
    );
    id = withId?.entity_id ?? null;
  }
  return { type, id, name };
}

const notFound = (query: string, what: string): Answer<null> => ({
  query,
  entity: null,
  firstParty: null,
  facts: [],
  gaps: [`the ledger has no ${what} matching "${query}"`],
});

// ─── Items ────────────────────────────────────────────────────────────────────────────────────────────────────────

const idList = (ids: number[]) =>
  sql.join(
    ids.map((i) => sql`${i}`),
    sql`, `,
  );

/**
 * NPC names by id, from everywhere the ledger has one: an NPC page's `name` claim first, then NPCs named in other
 * pages' lists (an item's "dropped by", a vendor list), then our own vendors, trainers and quest givers. The addon
 * records only the id of a looted NPC, so this is how "NPC #4275" becomes "Archmage Arugal".
 */
export async function npcNames(db: Db, ids: number[]): Promise<Map<number, string>> {
  const want = [...new Set(ids.filter((i) => Number.isInteger(i) && i > 0))];
  if (want.length === 0) return new Map();
  const list = idList(want);
  const res = await rows<{ id: number; name: string }>(
    db,
    sql`select distinct on (id) id, name from (
          select entity_id as id, coalesce(entity_name, value #>> '{}') as name, 0 as pri from claims
           where entity_type = 'npc' and attribute = 'name' and entity_id in (${list}) and label <> 'FALSE'
          union all
          select (value->>'id')::int, value->>'name', 1 from claims
           where jsonb_typeof(value) = 'object' and value->>'type' = 'npc' and value->>'id' ~ '^[0-9]{1,9}$'
             and (value->>'id')::int in (${list}) and label <> 'FALSE'
          union all
          select npc_id, name, 2 from vendors where npc_id in (${list})
          union all
          select npc_id, name, 2 from trainers where npc_id in (${list})
          union all
          select npc_id, npc_name, 3 from quest_observations where npc_id in (${list})
        ) named
        where name is not null and name <> ''
        order by id, pri`,
  );
  return new Map(res.map((r) => [r.id, r.name]));
}

/** Attributes that say where an item comes from (what where_to_get ranks). */
export const SOURCE_ATTRIBUTES = [
  'dropped_by',
  'fished_in',
  'fished_in_zones',
  'fishing_yield',
  'farm_rate_report',
  'comes_from',
  'contained_in_object',
  'contained_in_item',
  'gathered_from_object',
  'mined_from_object',
  'herbed_from_object',
  'skinned_from',
  'pickpocketed_from',
  'lv_pick_pocketed_from',
  'sold_by',
  'reward_from_quest',
  'created_by_spell',
  'turtle_drop_rate',
  'wreckage_pools',
  'fishing_rate_change',
] as const;

/** What our own uploads saw of an item: drop rates per NPC, node, container and fishing yields, rewards, vendors. */
export async function itemFirstParty(db: Db, itemId: number) {
  const drops = await rows<{
    build: number;
    npc_id: number;
    npc_name: string | null;
    dropped: number;
    kills: number;
  }>(
    db,
    sql`with d as (select build, npc_id, sum(count)::int as dropped from drops where item_id = ${itemId}
                    group by build, npc_id),
             k as (select build, npc_id, sum(count)::int as kills from corpses
                    where (build, npc_id) in (select build, npc_id from d) group by build, npc_id)
        select d.build, d.npc_id, d.dropped, coalesce(k.kills, 0) as kills, null as npc_name
          from d left join k using (build, npc_id)
         order by d.build desc, d.dropped desc limit 50`,
  );
  const nodes = await rows<{
    build: number;
    object_id: number;
    name: string | null;
    opens: number;
    looted: number;
  }>(
    db,
    sql`with l as (select build, object_id, sum(count)::int as looted from node_loot where item_id = ${itemId}
                    group by build, object_id)
        select l.build, l.object_id, l.looted,
               (select mode() within group (order by n.name) from nodes n
                 where n.build = l.build and n.object_id = l.object_id) as name,
               (select coalesce(sum(n.opened), 0)::int from nodes n
                 where n.build = l.build and n.object_id = l.object_id) as opens
          from l order by l.build desc, l.looted desc limit 50`,
  );
  const containers = await rows<{
    build: number;
    container_id: number;
    name: string | null;
    opens: number;
    looted: number;
  }>(
    db,
    sql`with l as (select build, container_id, sum(count)::int as looted from container_loot
                    where item_id = ${itemId} group by build, container_id)
        select l.build, l.container_id, l.looted, i.name,
               (select coalesce(sum(o.opened), 0)::int from container_opens o
                 where o.build = l.build and o.container_id = l.container_id) as opens
          from l left join items i on i.item_id = l.container_id
         order by l.build desc, l.looted desc limit 50`,
  );
  const questRewards = await rows<{
    quest_id: number;
    title: string | null;
    build: number;
    kind: string;
  }>(
    db,
    sql`select o.quest_id, q.title, o.build, o.kind from quest_reward_options o
          left join quests q on q.quest_id = o.quest_id
         where o.item_id = ${itemId} order by o.build desc, o.quest_id limit 50`,
  );
  const vendors = await rows<{
    npc_id: number;
    name: string | null;
    build: number;
    price: number | null;
    loc: unknown;
  }>(
    db,
    sql`select v.npc_id, v.name, v.build, (e->>'price')::int as price, v.loc
          from vendors v cross join lateral jsonb_array_elements(v.items) e
         where (e->>'itemId')::int = ${itemId} order by v.build desc limit 50`,
  );
  const fishing = await whereCaught(db, NO_FISHING_FILTER, [itemId]);
  const names = await npcNames(db, drops.map((d) => d.npc_id).concat(vendors.map((v) => v.npc_id)));
  const rate = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 10000) / 10000 : null);
  return {
    drops: drops.map((d) => ({
      build: d.build,
      npcId: d.npc_id,
      // null: the ledger has no name for it yet (its Wowhead page isn't fetched).
      npcName: names.get(d.npc_id) ?? null,
      dropped: d.dropped,
      kills: d.kills,
      perKill: rate(d.dropped, d.kills),
    })),
    nodes: nodes.map((n) => ({
      build: n.build,
      objectId: n.object_id,
      name: n.object_id === 0 ? 'Fishing' : n.name,
      opens: n.opens,
      looted: n.looted,
      perOpen: rate(n.looted, n.opens),
    })),
    containers: containers.map((c) => ({
      build: c.build,
      containerId: c.container_id,
      name: c.name,
      opens: c.opens,
      looted: c.looted,
      perOpen: rate(c.looted, c.opens),
    })),
    fishing: fishing.filter((f) => f.times > 0),
    questRewards: questRewards.map((q) => ({
      questId: q.quest_id,
      title: q.title,
      build: q.build,
      kind: q.kind,
    })),
    vendors: vendors.map((v) => ({
      npcId: v.npc_id,
      name: v.name ?? names.get(v.npc_id) ?? null,
      build: v.build,
      priceCopper: v.price,
      loc: v.loc,
    })),
  };
}

const NO_FISHING_FILTER: FishingFilters = {
  zone: null,
  subzone: null,
  build: null,
  char: null,
  lure: null,
  minSkill: null,
};

/** Field observations whose result mentions the item (the Steamwheedle "0 clams" kind of evidence). */
async function observationsMentioning(db: Db, name: string | null) {
  // A name this short would match half the ledger.
  if (!name || name.trim().length < 4) return [];
  const res = await rows<{
    key: string;
    build: number | null;
    observed_at: Date;
    duration_mins: number | null;
    location: unknown;
    method: string;
    setup: unknown;
    result: unknown;
    notes: string | null;
  }>(
    db,
    sql`select key, build, observed_at, duration_mins, location, method, setup, result, notes
          from field_observations
         where result::text ilike ${containsPattern(name)} escape '\\'
            or result::text ilike ${containsPattern(name.replace(/[^A-Za-z]/g, ''))} escape '\\'
            or notes ilike ${containsPattern(name)} escape '\\'
         order by observed_at desc limit 20`,
  );
  return res.map((o) => ({
    key: o.key,
    build: o.build,
    observedAt: iso(o.observed_at),
    durationMins: o.duration_mins,
    location: o.location,
    method: o.method,
    setup: o.setup,
    result: o.result,
    notes: clip(o.notes),
  }));
}

async function itemRow(db: Db, entity: EntityRef) {
  if (entity.id === null) return null;
  const [item] = await rows<{
    item_id: number;
    name: string;
    quality: number | null;
    type: string | null;
    subtype: string | null;
    equip_loc: string | null;
    req_level: number | null;
    ilvl: number | null;
    build: number | null;
  }>(
    db,
    sql`select i.item_id, i.name, i.quality, i.type, i.subtype, i.equip_loc, s.req_level, s.ilvl, s.build
          from items i left join lateral (select * from item_snapshots s where s.item_id = i.item_id
                                           order by build desc limit 1) s on true
         where i.item_id = ${entity.id}`,
  );
  return item
    ? {
        itemId: item.item_id,
        name: item.name,
        quality: item.quality,
        type: item.type,
        subtype: item.subtype,
        equipLoc: item.equip_loc,
        reqLevel: item.req_level,
        itemLevel: item.ilvl,
        build: item.build,
      }
    : null;
}

const hasAny = (o: Record<string, unknown[]>) => Object.values(o).some((v) => v.length > 0);

/** Everything the ledger knows about an item. */
export async function lookupItem(db: Db, ref: string | number) {
  const query = String(ref);
  const entity = await resolveEntity(db, 'item', ref);
  if (!entity) return notFound(query, 'item');
  const item = await itemRow(db, entity);
  const seen = entity.id === null ? null : await itemFirstParty(db, entity.id);
  const observations = await observationsMentioning(db, entity.name);
  const { facts, more } = await claimsAbout(db, [{ type: 'item', keys: keysOf(entity) }]);
  const firstPartyFound = (seen !== null && hasAny(seen)) || observations.length > 0;
  const gaps = commonGaps(facts, more, firstPartyFound);
  const page = await pageGap(db, 'item', entity.id);
  if (page) gaps.push(page);
  return {
    query,
    entity,
    firstParty: { item, ...seen, observations },
    facts,
    gaps,
  } satisfies Answer;
}

/** Where to get an item: our own rates first, then source claims by tier. */
export async function whereToGet(db: Db, ref: string | number) {
  const query = String(ref);
  const entity = await resolveEntity(db, 'item', ref);
  if (!entity) return notFound(query, 'item');
  const seen = entity.id === null ? null : await itemFirstParty(db, entity.id);
  const observations = await observationsMentioning(db, entity.name);
  const { facts, more } = await claimsAbout(db, [{ type: 'item', keys: keysOf(entity) }], {
    attributes: SOURCE_ATTRIBUTES,
  });
  const firstPartyFound = (seen !== null && hasAny(seen)) || observations.length > 0;
  const gaps = commonGaps(facts, more, firstPartyFound);
  if (facts.length === 0 && !firstPartyFound) gaps.push('no source for this item is known yet');
  const page = await pageGap(db, 'item', entity.id);
  if (page) gaps.push(page);
  return { query, entity, firstParty: { ...seen, observations }, facts, gaps } satisfies Answer;
}

// ─── Quests, NPCs, zones ──────────────────────────────────────────────────────────────────────────────────────────

export async function lookupQuest(db: Db, ref: string | number) {
  const query = String(ref);
  const entity = await resolveEntity(db, 'quest', ref);
  if (!entity) return notFound(query, 'quest');
  const quest =
    entity.id === null
      ? null
      : ((
          await rows<Record<string, unknown>>(
            db,
            sql`select quest_id as "questId", title, level, category, suggested_group as "suggestedGroup", objectives
                  from quests where quest_id = ${entity.id}`,
          )
        )[0] ?? null);
  const seen =
    entity.id === null
      ? []
      : await rows<Record<string, unknown>>(
          db,
          sql`select build, stage, npc_id as "npcId", npc_name as "npcName", npc_loc as "npcLoc", loc,
                     xp, money, rewards, choices
                from quest_observations where quest_id = ${entity.id}
               order by build desc, stage limit 20`,
        );
  const turnIns =
    entity.id === null
      ? []
      : await rows<Record<string, unknown>>(
          db,
          sql`select build, count(*)::int as "turnIns", min(level) as "minLevel", max(level) as "maxLevel",
                     max(xp) as "maxXp", max(money) as "maxMoney"
                from turn_ins where quest_id = ${entity.id} group by build order by build desc`,
        );
  const { facts, more } = await claimsAbout(db, [{ type: 'quest', keys: keysOf(entity) }]);
  const gaps = commonGaps(facts, more, quest !== null || seen.length > 0 || turnIns.length > 0);
  const page = await pageGap(db, 'quest', entity.id);
  if (page) gaps.push(page);
  return { query, entity, firstParty: { quest, seen, turnIns }, facts, gaps } satisfies Answer;
}

export async function lookupNpc(db: Db, ref: string | number) {
  const query = String(ref);
  const entity = await resolveEntity(db, 'npc', ref);
  if (!entity) return notFound(query, 'NPC');
  const id = entity.id;
  const vendor =
    id === null
      ? []
      : await rows<Record<string, unknown>>(
          db,
          sql`select build, name, title, loc, jsonb_array_length(items) as "itemsSold" from vendors
               where npc_id = ${id} order by build desc limit 5`,
        );
  const trainer =
    id === null
      ? []
      : await rows<Record<string, unknown>>(
          db,
          sql`select build, name, title, loc, skill_line_id as "skillLineId",
                     jsonb_array_length(services) as services from trainers
               where npc_id = ${id} order by build desc limit 5`,
        );
  const questsGiven =
    id === null
      ? []
      : await rows<Record<string, unknown>>(
          db,
          sql`select distinct o.quest_id as "questId", q.title, o.stage from quest_observations o
                left join quests q on q.quest_id = o.quest_id
               where o.npc_id = ${id} order by 1 limit 50`,
        );
  const drops =
    id === null
      ? []
      : await rows<Record<string, unknown>>(
          db,
          sql`with d as (select build, item_id, sum(count)::int as dropped from drops where npc_id = ${id}
                          group by build, item_id),
                   k as (select build, sum(count)::int as kills from corpses where npc_id = ${id} group by build)
              select d.build, d.item_id as "itemId", i.name, d.dropped, coalesce(k.kills, 0) as kills,
                     case when coalesce(k.kills, 0) > 0 then round(d.dropped::numeric / k.kills, 4) end as "perKill"
                from d left join k using (build) left join items i on i.item_id = d.item_id
               order by d.build desc, d.dropped desc limit 50`,
        );
  const { facts, more } = await claimsAbout(db, [{ type: 'npc', keys: keysOf(entity) }]);
  const firstParty = { vendor, trainer, questsGiven, drops };
  const gaps = commonGaps(facts, more, hasAny(firstParty));
  const page = await pageGap(db, 'npc', id);
  if (page) gaps.push(page);
  return { query, entity, firstParty, facts, gaps } satisfies Answer;
}

/** A zone: level range and other claims (zones and dungeons by name), and what was fished there. */
export async function lookupZone(db: Db, ref: string) {
  const query = ref;
  const name = ref.trim();
  const [hit] = (await searchEntities(db, name, 'zone')).concat(
    await searchEntities(db, name, 'dungeon'),
  );
  const entity: EntityRef | null = hit ? { type: hit.type, id: hit.id, name: hit.name } : null;
  if (!entity?.name) return notFound(query, 'zone or dungeon');
  const fishing = await fishingYield(db, { ...NO_FISHING_FILTER, zone: entity.name });
  // Nodes record their spots by map id: the zone's ids come from the game's map names and uploaded maps.
  const mapIds = Object.entries(UI_MAP_NAMES)
    .filter(([, n]) => n.toLowerCase() === entity.name!.toLowerCase())
    .map(([id]) => Number(id));
  if (entity.id !== null && !mapIds.includes(entity.id)) mapIds.push(entity.id);
  const nodesSeen =
    mapIds.length === 0
      ? []
      : await rows<Record<string, unknown>>(
          db,
          sql`select n.object_id as "objectId", mode() within group (order by n.name) as name,
                     sum(n.opened)::int as opens, max(n.build) as build
                from nodes n
               where n.object_id <> 0 and jsonb_typeof(n.spots) = 'array'
                 and exists (select 1 from jsonb_array_elements(n.spots) s
                              where (s->>'mapId')::int in (${sql.join(
                                mapIds.map((m) => sql`${m}`),
                                sql`, `,
                              )}))
               group by n.object_id order by opens desc limit 30`,
        );
  const { facts, more } = await claimsAbout(db, [
    { type: 'zone', keys: keysOf({ ...entity, id: null }) },
    { type: 'dungeon', keys: keysOf({ ...entity, id: null }) },
  ]);
  const firstParty = { fishing, nodesSeen };
  const gaps = commonGaps(facts, more, hasAny(firstParty));
  return { query, entity, firstParty, facts, gaps } satisfies Answer;
}

// ─── Fishing ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Fishing yield per zone and subzone from our own casts, optionally for one item. */
export async function fishingAnswer(
  db: Db,
  f: Partial<FishingFilters> & { item?: string | number },
) {
  const filters = { ...NO_FISHING_FILTER, ...f };
  const query = JSON.stringify(f);
  if (f.item !== undefined) {
    const item = await resolveEntity(db, 'item', f.item);
    if (!item?.id) return notFound(String(f.item), 'item');
    const zones = await whereCaught(db, filters, [item.id]);
    const { facts, more } = await claimsAbout(db, [{ type: 'item', keys: keysOf(item) }], {
      attributes: [
        'fished_in',
        'fished_in_zones',
        'fishing_yield',
        'farm_rate_report',
        'fishing_rate_change',
      ],
    });
    const gaps = commonGaps(
      facts,
      more,
      zones.some((z) => z.times > 0),
    );
    if (zones.length === 0) gaps.push('no fishing casts match these filters');
    return { query, entity: item, firstParty: { zones }, facts, gaps } satisfies Answer;
  }
  const groups = await fishingYield(db, filters);
  const gaps = groups.length === 0 ? ['no fishing casts match these filters'] : [];
  return { query, entity: null, firstParty: { groups }, facts: [], gaps } satisfies Answer;
}

// ─── Checking a claim ─────────────────────────────────────────────────────────────────────────────────────────────

const STOP = new Set(
  'the and for with from that this you your can are was were has have get got into onto out per what where when which who how does'.split(
    ' ',
  ),
);

/**
 * Evidence for or against a statement: claims about the entity (or whose name, value or quote share the statement's
 * words), FALSE ones included and marked refuted, plus the disputes among them. The caller weighs them.
 */
export async function checkClaim(
  db: Db,
  text: string,
  about?: { type: EntityType; ref: string | number },
) {
  const entity = about ? await resolveEntity(db, about.type, about.ref) : null;
  if (about && !entity)
    return { ...notFound(String(about.ref), about.type), refuted: [], disputes: [] };
  const words = [...new Set(text.toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g) ?? [])]
    .filter((w) => !STOP.has(w))
    .slice(0, 8);
  let found: { facts: Fact[]; more: number };
  if (entity) {
    found = await claimsAbout(db, [{ type: entity.type, keys: keysOf(entity) }], {
      includeFalse: true,
    });
  } else if (words.length === 0) {
    found = { facts: [], more: 0 };
  } else {
    // Claims matching at least half the statement's words in their entity name, attribute, value or quote.
    const hay = sql`lower(coalesce(c.entity_name, '') || ' ' || c.attribute || ' ' || c.value::text || ' ' ||
                          coalesce(c.quote, ''))`;
    const score = sql.join(
      words.map(
        (w) => sql`(case when ${hay} like ${containsPattern(w)} escape '\\' then 1 else 0 end)`,
      ),
      sql` + `,
    );
    found = await claimsAbout(db, [], {
      includeFalse: true,
      where: sql`(${score}) >= ${Math.max(1, Math.ceil(words.length / 2))}`,
    });
  }
  const refuted = found.facts.filter((f) => f.label === 'FALSE');
  const facts = found.facts.filter((f) => f.label !== 'FALSE');
  let disputes: Dispute[] = [];
  if (entity) {
    for (const key of keysOf(entity)) {
      disputes = disputes.concat(
        await findDisputes(db, { entityType: entity.type, entityKey: key, limit: 50 }),
      );
    }
  } else {
    const ids = new Set(found.facts.map((f) => f.claimId));
    const keys = new Set(
      found.facts.map((f) => `${f.entity.type}|${f.entity.id ?? f.entity.name?.toLowerCase()}`),
    );
    for (const k of [...keys].slice(0, 10)) {
      const [type, key] = k.split('|') as [string, string];
      disputes = disputes.concat(
        (await findDisputes(db, { entityType: type, entityKey: key, limit: 50 })).filter(
          (d) => ids.has(d.claimId) || (d.byClaimId !== null && ids.has(d.byClaimId)),
        ),
      );
    }
  }
  const gaps = commonGaps(facts, found.more, true);
  if (found.facts.length === 0)
    gaps.push('the ledger has nothing on this: it can neither confirm nor refute it');
  return {
    query: text,
    entity,
    firstParty: null,
    facts,
    refuted,
    disputes: disputes.map((d) => ({ ...d })),
    gaps,
  };
}
