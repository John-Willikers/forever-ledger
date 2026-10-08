// The quest atlas from Postgres: Wowhead's quest claims (with their source tier) and our own players' quest
// observations, objective progress, turn-ins and quest-log rows, handed to the pure builder (planner/atlas-build.ts).
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { buildAtlas } from '../planner/atlas-build.js';
import type {
  AtlasBuild,
  ClaimRow,
  ProgressRow,
  QuestRow,
  SeenRow,
  TakerRow,
  TickRow,
  TurnInRow,
} from '../planner/atlas-build.js';
import { rows } from '../routes/adminData.js';

/** The claim attributes the builder reads. */
export const ATLAS_ATTRIBUTES = [
  'name',
  'level',
  'req_level',
  'xp_reward',
  'side',
  'classes',
  'races',
  'starts_at',
  'ends_at',
  'objective_spots',
  'series',
];

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** `npc_loc` / `loc` jsonb (`{ mapID, x, y, zone, subzone }`), untrusted: only finite numbers kept. */
function where(loc: unknown): { mapId: number | null; x: number | null; y: number | null } {
  const l =
    loc && typeof loc === 'object' && !Array.isArray(loc) ? (loc as Record<string, unknown>) : {};
  const mapId = num(l.mapID);
  return {
    mapId: mapId !== null && Number.isInteger(mapId) ? mapId : null,
    x: num(l.x),
    y: num(l.y),
  };
}

export async function loadAtlas(db: Db): Promise<AtlasBuild> {
  const claims = await rows<ClaimRow>(
    db,
    sql`select c.entity_id as "questId", c.attribute, c.value, c.label, s.tier, c.observed_build as build
          from claims c join sources s on s.id = c.source_id
         where c.entity_type = 'quest' and c.entity_id is not null and c.label <> 'FALSE'
           and c.attribute in (${sql.join(
             ATLAS_ATTRIBUTES.map((a) => sql`${a}`),
             sql`, `,
           )})
         order by c.id`,
  );
  const seen = (
    await rows<{
      questId: number;
      stage: string;
      npcId: number | null;
      npcName: string | null;
      loc: unknown;
    }>(
      db,
      sql`select quest_id as "questId", stage, npc_id as "npcId", npc_name as "npcName",
                 coalesce(npc_loc, loc) as loc
            from quest_observations where stage in ('detail', 'complete')`,
    )
  ).map(({ loc, ...r }): SeenRow => ({ ...r, ...where(loc) }));
  // Progress per whole-percent cell: where the increments happened and how many.
  const progress = await rows<ProgressRow>(
    db,
    sql`select quest_id as "questId", idx, map_id as "mapId",
               round(x::numeric)::float8 as x, round(y::numeric)::float8 as y, count(*)::int as n,
               max(need) as need, (array_agg(text order by at desc))[1] as text
          from quest_objective_progress
         where x is not null and y is not null
         group by quest_id, idx, map_id, round(x::numeric), round(y::numeric)`,
  );
  const turnIns = await rows<TurnInRow>(
    db,
    sql`select quest_id as "questId", level, max(xp) as xp from turn_ins
         where xp is not null group by quest_id, level`,
  );
  const quests = await rows<QuestRow>(
    db,
    sql`select quest_id as "questId", title, level, objectives, category from quests`,
  );
  const ticks = await rows<TickRow>(
    db,
    sql`select quest_id as "questId", idx, char, extract(epoch from at)::float8 as at, have
          from quest_objective_progress`,
  );
  // The faction and race of each character that took or saw a quest, for quests Wowhead gives no side (or a class
  // quest no races).
  const takers = await rows<TakerRow>(
    db,
    sql`select distinct o.quest_id as "questId", c.faction, c.race
          from quest_observations o left join characters c on c.key = o.char`,
  );
  return buildAtlas({ claims, ticks, takers, seen, progress, turnIns, quests });
}
