import type { EntityType } from '@forever-ledger/contracts';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { FOREVER_ID_THRESHOLDS } from '../routes/shared.js';
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
