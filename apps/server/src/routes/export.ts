import { getTableColumns } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client.js';
import {
  apiSamples,
  builds,
  characters,
  corpses,
  crafts,
  drops,
  items,
  itemSnapshots,
  nodeLoot,
  nodes,
  questObservations,
  questRewardOptions,
  quests,
  recipeDifficulty,
  recipes,
  recipeSnapshots,
  recipesLearned,
  recipeStatus,
  runBosses,
  runParty,
  runs,
  skills,
  skillUps,
  trainers,
  turnIns,
  vendors,
} from '../db/schema.js';
import { chicagoIso } from '../time.js';
import { requireToken } from './analysis.js';

/** Tables offered for export (tokens and raw payloads are never exported). */
export const EXPORT_TABLES = {
  builds,
  characters,
  quests,
  quest_observations: questObservations,
  quest_reward_options: questRewardOptions,
  turn_ins: turnIns,
  items,
  item_snapshots: itemSnapshots,
  drops,
  corpses,
  skills,
  skill_ups: skillUps,
  recipes,
  recipe_snapshots: recipeSnapshots,
  recipe_status: recipeStatus,
  recipe_difficulty: recipeDifficulty,
  recipes_learned: recipesLearned,
  crafts,
  nodes,
  node_loot: nodeLoot,
  trainers,
  vendors,
  api_samples: apiSamples,
  runs,
  run_bosses: runBosses,
  run_party: runParty,
} as const;
type ExportTable = keyof typeof EXPORT_TABLES;

/** Dates become America/Chicago ISO strings; everything else is left as-is. */
function presentRow(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? chicagoIso(v) : v;
  return out;
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, unknown>[], columns: string[]) {
  const lines = [columns.join(',')];
  for (const r of rows) lines.push(columns.map((c) => csvCell(r[c])).join(','));
  return lines.join('\n') + '\n';
}

export function registerExportRoutes(app: FastifyInstance, db: Db) {
  app.get<{ Querystring: { format?: string; table?: string } }>(
    '/v1/export',
    { preHandler: requireToken(db) },
    async (req, reply) => {
      const format = req.query.format ?? 'json';
      const table = req.query.table as ExportTable | undefined;
      if (table !== undefined && !(table in EXPORT_TABLES)) {
        return reply
          .status(400)
          .send({ error: `unknown table; one of ${Object.keys(EXPORT_TABLES).join(', ')}` });
      }
      const exportedAt = chicagoIso();

      if (format === 'csv') {
        if (!table) return reply.status(400).send({ error: 'csv export needs ?table=' });
        const t = EXPORT_TABLES[table];
        const data = (await db.select().from(t)).map((r) => presentRow(r));
        const columns = Object.keys(getTableColumns(t));
        return reply
          .header('content-type', 'text/csv; charset=utf-8')
          .header('content-disposition', `attachment; filename="forever-ledger-${table}.csv"`)
          .send(toCsv(data, columns));
      }
      if (format !== 'json') return reply.status(400).send({ error: 'format must be json or csv' });

      const names = table ? [table] : (Object.keys(EXPORT_TABLES) as ExportTable[]);
      const tables: Record<string, Record<string, unknown>[]> = {};
      for (const name of names) {
        tables[name] = (await db.select().from(EXPORT_TABLES[name])).map((r) => presentRow(r));
      }
      return { exportedAt, timeZone: 'America/Chicago', tables };
    },
  );
}
