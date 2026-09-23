import { contentHash, RECORD_KINDS, recordKey } from '@forever-ledger/contracts';
import type { Acknowledged, Records, RecordKind, UploadBatch } from '@forever-ledger/contracts';
import { getTableColumns, inArray, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Db } from './db/client.js';
import {
  builds,
  characters,
  corpses,
  drops,
  items,
  itemSnapshots,
  questObservations,
  questRewardOptions,
  quests,
  rawUploads,
  runBosses,
  runParty,
  runs,
  turnIns,
} from './db/schema.js';
import { fromEpoch } from './time.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const CHUNK = 500;

/**
 * `SET col = excluded.col` for every column except the conflict target; bumps updated_at when present. With `keepKnown`
 * a null in the new row keeps the stored value (`coalesce(excluded.col, col)`).
 */
function excludedSet(table: PgTable, target: PgColumn[], keepKnown = false): Record<string, SQL> {
  const skip = new Set(target.map((c) => c.name));
  const set: Record<string, SQL> = {};
  for (const [prop, col] of Object.entries(getTableColumns(table))) {
    if (skip.has(col.name)) continue;
    const incoming = sql.raw(`excluded."${col.name}"`);
    set[prop] =
      col.name === 'updated_at'
        ? sql`now()`
        : keepKnown
          ? sql`coalesce(${incoming}, ${col})`
          : incoming;
  }
  return set;
}

async function upsert<T extends PgTable>(
  tx: Tx,
  table: T,
  rows: T['$inferInsert'][],
  target: PgColumn[],
  opts: { keepKnown?: boolean } = {},
) {
  if (rows.length === 0) return;
  const set = excludedSet(table, target, opts.keepKnown);
  for (let i = 0; i < rows.length; i += CHUNK) {
    await tx
      .insert(table)
      .values(rows.slice(i, i + CHUNK))
      .onConflictDoUpdate({ target, set });
  }
}

async function insertChunked<T extends PgTable>(tx: Tx, table: T, rows: T['$inferInsert'][]) {
  for (let i = 0; i < rows.length; i += CHUNK)
    await tx.insert(table).values(rows.slice(i, i + CHUNK));
}

/** One record per natural key (last wins). Postgres rejects an upsert touching the same row twice. */
function dedupe(records: Records): Records {
  const out = {} as Records;
  for (const kind of RECORD_KINDS) {
    const byKey = new Map<string, unknown>();
    for (const r of records[kind]) byKey.set(recordKey(kind, r as never), r);
    (out as Record<RecordKind, unknown[]>)[kind] = [...byKey.values()];
  }
  return out;
}

export interface IngestContext {
  tokenId: number;
}

/** Stores one batch idempotently and returns the acknowledged record keys and hashes. */
export async function ingestBatch(db: Db, batch: UploadBatch, ctx: IngestContext) {
  const r = dedupe(batch.records);
  const recordCount = RECORD_KINDS.reduce((n, k) => n + r[k].length, 0);

  const batchId = await db.transaction(async (tx) => {
    const [raw] = await tx
      .insert(rawUploads)
      .values({
        tokenId: ctx.tokenId,
        uploaderId: batch.uploaderId,
        account: batch.account,
        schemaVersion: batch.schemaVersion,
        clientBuild: batch.meta.build,
        recordCount,
        payload: batch,
      })
      .returning({ id: rawUploads.id });

    // Builds: the batch's own build carries version info; other builds come from older records.
    const buildIds = new Set<number>([batch.meta.build]);
    for (const kind of [
      'questObservations',
      'turnIns',
      'itemSnapshots',
      'drops',
      'corpses',
      'runs',
    ] as const) {
      for (const rec of r[kind]) buildIds.add(rec.build);
    }
    await tx
      .insert(builds)
      .values(
        [...buildIds].map((b) =>
          b === batch.meta.build
            ? { build: b, version: batch.meta.version, interface: batch.meta.interface }
            : { build: b },
        ),
      )
      .onConflictDoUpdate({
        target: builds.build,
        set: {
          lastSeen: sql`now()`,
          version: sql`coalesce(excluded.version, ${builds.version})`,
          interface: sql`coalesce(excluded.interface, ${builds.interface})`,
        },
      });

    await upsert(
      tx,
      characters,
      r.characters.map((c) => ({ ...c, lastSeen: fromEpoch(c.lastSeen) })),
      [characters.key],
    );

    // Static facts: Forever doesn't load SavedVariables back, so a quest rebuilt after /reload from the turn-in window
    // alone has no level/category. Keep what an earlier upload knew.
    await upsert(tx, quests, r.quests, [quests.questId], { keepKnown: true });

    await upsert(
      tx,
      questObservations,
      r.questObservations.map((o) => ({
        questId: o.questId,
        build: o.build,
        stage: o.stage,
        char: o.char,
        level: o.level,
        observedAt: fromEpoch(o.time),
        xp: o.xp,
        money: o.money,
        npcId: o.npc?.id,
        npcName: o.npc?.name,
        npcLoc: o.npc?.loc,
        loc: o.loc,
        choices: o.choices,
        rewards: o.rewards,
      })),
      [
        questObservations.questId,
        questObservations.build,
        questObservations.stage,
        questObservations.char,
      ],
    );

    const options = new Map<string, typeof questRewardOptions.$inferInsert>();
    for (const o of r.questObservations) {
      for (const [kind, list] of [
        ['choice', o.choices],
        ['reward', o.rewards],
      ] as const) {
        for (const it of list ?? []) {
          if (!it.itemID) continue;
          const row = {
            questId: o.questId,
            build: o.build,
            itemId: it.itemID,
            kind,
            count: it.count ?? 1,
          };
          options.set(`${row.questId}:${row.build}:${row.itemId}:${kind}`, row);
        }
      }
    }
    await upsert(
      tx,
      questRewardOptions,
      [...options.values()],
      [
        questRewardOptions.questId,
        questRewardOptions.build,
        questRewardOptions.itemId,
        questRewardOptions.kind,
      ],
    );

    await upsert(
      tx,
      turnIns,
      r.turnIns.map(({ choice, ...t }) => ({
        ...t,
        turnedInAt: fromEpoch(t.time)!,
        choiceIndex: choice?.index,
        choiceItemId: choice?.itemId,
      })),
      [turnIns.id],
    );

    await upsert(tx, items, r.items, [items.itemId], { keepKnown: true });
    await upsert(
      tx,
      itemSnapshots,
      r.itemSnapshots.map((s) => ({ ...s, firstSeen: fromEpoch(s.firstSeen) })),
      [itemSnapshots.itemId, itemSnapshots.build],
    );

    await upsert(
      tx,
      drops,
      r.drops.map((d) => ({ ...d, uploaderId: batch.uploaderId, account: batch.account })),
      [drops.itemId, drops.build, drops.npcId, drops.uploaderId, drops.account, drops.session],
    );
    // Per-session totals: setting them is safe, a later upload of the same session only grows them.
    await upsert(
      tx,
      corpses,
      r.corpses.map((c) => ({ ...c, uploaderId: batch.uploaderId, account: batch.account })),
      [corpses.npcId, corpses.build, corpses.uploaderId, corpses.account, corpses.session],
    );

    await upsert(
      tx,
      runs,
      r.runs.map((run) => ({
        id: run.id,
        build: run.build,
        char: run.char,
        charLevel: run.charLevel,
        instance: run.instance,
        instanceId: run.instanceID,
        difficulty: run.difficulty,
        maxPlayers: run.maxPlayers,
        startedAt: fromEpoch(run.start)!,
        finishedAt: fromEpoch(run.finish),
        endReason: run.endReason,
        awaySecs: run.awaySecs,
        activeSecs: run.activeSecs,
        xpTotal: run.xpTotal,
        questXp: run.questXP,
        mobXp: run.mobXP,
        deaths: run.deaths,
        loot: run.loot,
        lootMethod: run.lootMethod,
        bossLoot: run.bossLoot,
        groupLoot: run.groupLoot,
      })),
      [runs.id],
    );
    // A run's boss and party lists are replaced wholesale: a resumed run can gain bosses after upload.
    const runIds = r.runs.map((run) => run.id);
    if (runIds.length > 0) {
      await tx.delete(runBosses).where(inArray(runBosses.runId, runIds));
      await tx.delete(runParty).where(inArray(runParty.runId, runIds));
      await insertChunked(
        tx,
        runBosses,
        r.runs.flatMap((run) =>
          run.bosses.map((b, i) => ({
            runId: run.id,
            ord: i + 1,
            encounterId: b.id,
            name: b.name,
            killed: b.killed,
            atSecs: b.atSecs,
          })),
        ),
      );
      await insertChunked(
        tx,
        runParty,
        r.runs.flatMap((run) =>
          run.party.map((p, i) => ({ runId: run.id, slot: i + 1, class: p.class, level: p.level })),
        ),
      );
    }

    return raw!.id;
  });

  const acknowledged: Acknowledged[] = [];
  for (const kind of RECORD_KINDS) {
    for (const rec of r[kind]) {
      acknowledged.push({ key: recordKey(kind, rec as never), hash: contentHash(rec) });
    }
  }
  return { batchId, acknowledged };
}
