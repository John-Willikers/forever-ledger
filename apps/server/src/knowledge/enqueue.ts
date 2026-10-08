import type { EntityType } from '@forever-ledger/contracts';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { FOREVER_ID_THRESHOLDS } from '../routes/shared.js';
import { ATLAS_LIST_PRIORITY, atlasListUrls } from './atlas.js';
import { enqueueUrl } from './store.js';

/**
 * Entity pages for ids the addon has seen (items, quests, NPCs that dropped loot or gave quests), for the on-demand
 * Wowhead scope. `template` is the page URL with `{type}` and `{id}`, e.g.
 * `https://www.wowhead.com/forever/{type}={id}`: there is no default, because the Forever URL scheme has to be
 * confirmed from a real fetch first. Forever's own ids (above FOREVER_ID_THRESHOLDS) go first.
 */
export async function enqueueSeen(db: Db, template: string, opts: { limit?: number } = {}) {
  if (!template.includes('{type}') || !template.includes('{id}')) {
    throw new Error('template needs {type} and {id}');
  }
  const res = await db.execute<{ type: EntityType; id: number }>(sql`
    select * from (
      select 'item' as type, item_id as id from items
      union select 'quest', quest_id from quests
      union select 'npc', npc_id from drops
      union select 'npc', npc_id from quest_observations where npc_id is not null
    ) seen
    where id > 0 -- npc 0 is "source unknown" in drops
    order by 1, 2`);
  const own = ({ type, id }: { type: EntityType; id: number }) =>
    id >= (FOREVER_ID_THRESHOLDS[type as keyof typeof FOREVER_ID_THRESHOLDS] ?? Infinity);
  const rows = [...res.rows].sort((a, b) => Number(own(b)) - Number(own(a)));
  let queued = 0;
  let seen = 0;
  for (const { type, id } of rows) {
    if (opts.limit !== undefined && queued >= opts.limit) break;
    seen++;
    const url = template.replace('{type}', type).replace('{id}', String(id));
    const added = await enqueueUrl(db, {
      url,
      addedBy: 'ingest',
      entityType: type,
      entityId: id,
      priority: own({ type, id }) ? 10 : 0,
    });
    if (added) queued++;
  }
  return { seen, queued };
}

/** Priority for item pages whose known sources are all covered by fetched NPC pages: after everything uncovered. */
export const COVERED_PRIORITY = 5;

/**
 * Item pages NPC pages already stand in for: every NPC the addon saw drop the item has a fetched page whose Drops list
 * names it (a `dropped_by` claim from that NPC). The item page would still add sources we never saw, so nothing is
 * skipped: with `apply`, covered pages only move behind uncovered ones (COVERED_PRIORITY). Items the addon never saw
 * drop (gathered, from containers, quest rewards) are never counted as covered.
 */
export async function itemCoverage(db: Db, opts: { apply?: boolean } = {}) {
  const res = await db.execute<{ item_id: number; sources: number; covered: number }>(sql`
    with queued as (
      select entity_id as item_id from fetch_targets
       where state = 'queued' and entity_type = 'item' and entity_id is not null),
    sources as (
      select distinct d.item_id, d.npc_id from drops d join queued q on q.item_id = d.item_id where d.npc_id > 0),
    covered as (
      select s.item_id, s.npc_id from sources s
       where exists (select 1 from claims c
                      where c.entity_type = 'item' and c.entity_key = s.item_id::text
                        and c.attribute = 'dropped_by' and c.value->>'type' = 'npc'
                        and (c.value->>'id')::int = s.npc_id))
    select s.item_id, count(*)::int as sources, count(c.npc_id)::int as covered
      from sources s left join covered c on c.item_id = s.item_id and c.npc_id = s.npc_id
     group by s.item_id`);
  const full = res.rows.filter((r) => r.covered === r.sources).map((r) => r.item_id);
  let moved = 0;
  if (opts.apply && full.length > 0) {
    const updated = await db.execute(sql`
      update fetch_targets set priority = ${COVERED_PRIORITY}, updated_at = now()
       where state = 'queued' and entity_type = 'item' and priority > ${COVERED_PRIORITY}
         and entity_id in (${sql.join(
           full.map((i) => sql`${i}`),
           sql`, `,
         )})`);
    moved = updated.rowCount ?? 0;
  }
  return {
    withDropSources: res.rows.length,
    fullyCovered: full.length,
    partlyCovered: res.rows.filter((r) => r.covered > 0 && r.covered < r.sources).length,
    moved,
  };
}

/**
 * Queues the quest atlas's list pages (9 class lists, the 1–30 zone lists) above everything else. Each fetched list
 * then queues its quests' pages (`follow`, below the lists). A list already on the queue only gains priority (and is
 * made due again with `refresh`). `dryRun` returns the URLs without touching the queue.
 */
export async function enqueueAtlas(
  db: Db | null,
  opts: { dryRun?: boolean; refresh?: boolean } = {},
): Promise<{ urls: string[]; queued: number }> {
  const urls = atlasListUrls();
  if (opts.dryRun || !db) return { urls, queued: 0 };
  let queued = 0;
  for (const url of urls) {
    const added = await enqueueUrl(db, {
      url,
      addedBy: 'cli',
      priority: ATLAS_LIST_PRIORITY,
      refresh: opts.refresh,
    });
    if (added) queued++;
    else
      await db.execute(
        sql`update fetch_targets set priority = greatest(priority, ${ATLAS_LIST_PRIORITY}), updated_at = now() where url = ${url}`,
      );
  }
  return { urls, queued };
}
