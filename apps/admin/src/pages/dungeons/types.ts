// Shapes of the run routes (apps/server/src/routes/adminRuns.ts) and /v1/runs/summary (routes/analysis.ts).
// Every string here is uploaded data: render it as text.
import type { Paged } from '../loot/types';
import type { BossLike } from './runLib';

export interface RunMember {
  id: string;
  char: string;
  charClass: string | null;
  charLevel: number | null;
}

/**
 * A run group (one shared dungeon run uploaded by several party members) as the runs list shows it: `id` is the
 * group's earliest run, `activeSecs` its clear time (median member active time), XP per member (average), deaths and
 * loot summed over members, bosses merged.
 */
export interface RunGroupRow {
  id: string;
  build: number;
  instance: string | null;
  instanceId: number;
  difficulty: number | null;
  maxPlayers: number | null;
  startedAt: string;
  finishedAt: string | null;
  activeSecs: number | null;
  awaySecs: number | null;
  xpTotal: number;
  questXp: number;
  mobXp: number;
  deaths: number;
  lootMethod: string | null;
  bosses: { killed: number; total: number };
  loot: number;
  party: number;
  members: RunMember[];
}

export interface RunsPage extends Paged<RunGroupRow> {
  instances: { instanceId: number; instance: string | null; runs: number }[];
}

interface NamedItem {
  itemId: number | null;
  name: string | null;
  quality: number | null;
}

interface BossDrop extends NamedItem {
  encounterId: number | null;
  bossName: string | null;
  lootListKey: number | null;
  qty: number | null;
  winnerClass: string | null;
  allPassed: boolean | null;
  rolls: { class: string | null; roll: number | null; state: string | null }[];
}

type OwnLoot = NamedItem & { npcId: number | null; npcName: string | null };

/** One member's own run, as its addon recorded it. */
export interface RunPerspective {
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
  bosses: BossLike[];
  loot: OwnLoot[];
  bossLoot: (BossDrop & { winnerIsSelf: boolean | null })[];
  groupLoot: (NamedItem & {
    qty: number | null;
    by: string | null;
    class: string | null;
    won: boolean | null;
  })[];
  party: { slot: number; class: string | null; level: number | null }[];
}

/** GET /admin/api/runs/:id: the run group of any member's run id, merged, with every member's perspective. */
export interface RunGroupDetail {
  id: string;
  build: number;
  instance: string | null;
  instanceId: number;
  difficulty: number | null;
  maxPlayers: number | null;
  lootMethod: string | null;
  startedAt: string;
  finishedAt: string | null;
  /** Clear time: the median active time of the members. */
  activeSecs: number | null;
  /** Earliest start to latest finish. */
  spanSecs: number | null;
  deaths: number;
  members: number;
  bosses: BossLike[];
  /** Boss drops deduped across members; `winnerChar` is the member who won it (null: someone without the addon). */
  bossLoot: (BossDrop & { winnerChar: string | null })[];
  loot: (OwnLoot & { char: string })[];
  perspectives: RunPerspective[];
}

/** GET /v1/runs/summary */
export interface RunSummary {
  instanceId: number;
  instance: string | null;
  build: number;
  /** Run groups: a shared run uploaded by several members counts once. */
  runs: number;
  finishedRuns: number;
  /** The members' own runs in those groups. */
  members: number;
  medianActiveSecs: number | null;
  bestActiveSecs: number | null;
  avgDeaths: number | null;
  avgCharLevel: number | null;
  xpPerMinute: number | null;
  mobXpPerMinute: number | null;
  questXpPerMinute: number | null;
  bosses: { name: string | null; kills: number; medianAtSecs: number }[];
}
