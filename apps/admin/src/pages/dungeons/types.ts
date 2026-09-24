// Shapes of the run routes (apps/server/src/routes/adminLoot.ts) and /v1/runs/summary (routes/analysis.ts).
// Every string here is uploaded data: render it as text.
import type { Paged } from '../loot/types';
import type { BossLike } from './runLib';

export interface RunRow {
  id: string;
  build: number;
  char: string;
  charClass: string | null;
  charLevel: number | null;
  instance: string | null;
  instanceId: number;
  difficulty: number | null;
  maxPlayers: number | null;
  startedAt: string;
  finishedAt: string | null;
  endReason: string | null;
  activeSecs: number | null;
  awaySecs: number;
  xpTotal: number;
  questXp: number;
  mobXp: number;
  deaths: number;
  lootMethod: string | null;
  bosses: { killed: number; total: number };
  loot: number;
  party: number;
}

export interface RunsPage extends Paged<RunRow> {
  instances: { instanceId: number; instance: string | null; runs: number }[];
}

interface NamedItem {
  itemId: number | null;
  name: string | null;
  quality: number | null;
}

export interface RunDetail extends Omit<RunRow, 'bosses' | 'loot' | 'party'> {
  bosses: BossLike[];
  loot: (NamedItem & { npcId: number | null; npcName: string | null })[];
  bossLoot: (NamedItem & {
    encounterId: number | null;
    bossName: string | null;
    qty: number | null;
    winnerClass: string | null;
    winnerIsSelf: boolean | null;
    allPassed: boolean | null;
    rolls: { class: string | null; roll: number | null; state: string | null }[];
  })[];
  groupLoot: (NamedItem & {
    qty: number | null;
    by: string | null;
    class: string | null;
    won: boolean | null;
  })[];
  party: { slot: number; class: string | null; level: number | null }[];
}

/** GET /v1/runs/summary */
export interface RunSummary {
  instanceId: number;
  instance: string | null;
  build: number;
  runs: number;
  finishedRuns: number;
  medianActiveSecs: number | null;
  bestActiveSecs: number | null;
  avgDeaths: number | null;
  avgCharLevel: number | null;
  xpPerMinute: number | null;
  mobXpPerMinute: number | null;
  questXpPerMinute: number | null;
  bosses: { name: string | null; kills: number; medianAtSecs: number }[];
}
