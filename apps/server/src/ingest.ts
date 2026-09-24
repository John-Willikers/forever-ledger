import { contentHash, RECORD_KINDS, recordKey } from '@forever-ledger/contracts';
import type { Acknowledged, Records, RecordKind, UploadBatch } from '@forever-ledger/contracts';
import { getTableColumns, inArray, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Db } from './db/client.js';
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
  rawUploads,
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

interface UpsertOptions {
  keepKnown?: boolean;
  /** Per-column overrides of the generated SET. */
  set?: Record<string, SQL>;
  /** Only update a stored row when this holds (e.g. the incoming row is newer). */
  setWhere?: SQL;
}

async function upsert<T extends PgTable>(
  tx: Tx,
  table: T,
  rows: T['$inferInsert'][],
  target: PgColumn[],
  opts: UpsertOptions = {},
) {
  if (rows.length === 0) return;
  const set: Record<string, SQL> = { ...excludedSet(table, target, opts.keepKnown), ...opts.set };
  for (let i = 0; i < rows.length; i += CHUNK) {
    await tx
      .insert(table)
      .values(rows.slice(i, i + CHUNK))
      .onConflictDoUpdate({ target, set, setWhere: opts.setWhere });
  }
}

/** `excluded.<col> >= <table>.<col>`: the incoming row is at least as new as the stored one. */
const notOlder = (col: PgColumn) => sql`${sql.raw(`excluded."${col.name}"`)} >= ${col}`;

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
      'skillUps',
      'recipeSnapshots',
      'recipeStatus',
      'recipeDifficulty',
      'recipesLearned',
      'crafts',
      'nodes',
      'nodeLoot',
      'trainers',
      'vendors',
      'apiSamples',
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

    // Schema 4: professions.
    const perSession = { uploaderId: batch.uploaderId, account: batch.account };

    // Latest state per character: an older SavedVariables session uploaded late must not roll a rank back.
    await upsert(
      tx,
      skills,
      r.skills.map((s) => ({ ...s, lastSeen: fromEpoch(s.lastSeen)! })),
      [skills.char, skills.skillLineId],
      { setWhere: notOlder(skills.lastSeen) },
    );
    await upsert(
      tx,
      skillUps,
      r.skillUps.map((u) => ({
        char: u.char,
        skillLineId: u.skillLineId,
        fromRank: u.from,
        toRank: u.to,
        build: u.build,
        observedAt: fromEpoch(u.time)!,
        recipeId: u.recipeId,
      })),
      [skillUps.char, skillUps.skillLineId, skillUps.observedAt, skillUps.toRank],
    );

    await upsert(tx, recipes, r.recipes, [recipes.recipeId], { keepKnown: true });
    await upsert(tx, recipeSnapshots, r.recipeSnapshots, [
      recipeSnapshots.recipeId,
      recipeSnapshots.build,
    ]);
    await upsert(
      tx,
      recipeStatus,
      r.recipeStatus.map((s) => ({ ...s, seenAt: fromEpoch(s.seenAt)! })),
      [recipeStatus.recipeId, recipeStatus.build, recipeStatus.char],
      { setWhere: notOlder(recipeStatus.seenAt) },
    );
    // Each session only knows the ranks it saw, so widen the stored range instead of replacing it.
    await upsert(
      tx,
      recipeDifficulty,
      r.recipeDifficulty,
      [
        recipeDifficulty.recipeId,
        recipeDifficulty.build,
        recipeDifficulty.char,
        recipeDifficulty.difficulty,
      ],
      {
        set: {
          minRank: sql`least(${recipeDifficulty.minRank}, excluded.min_rank)`,
          maxRank: sql`greatest(${recipeDifficulty.maxRank}, excluded.max_rank)`,
        },
      },
    );
    await upsert(
      tx,
      recipesLearned,
      r.recipesLearned.map((l) => ({
        char: l.char,
        recipeId: l.recipeId,
        build: l.build,
        learnedAt: fromEpoch(l.time)!,
        via: l.via,
      })),
      [recipesLearned.char, recipesLearned.recipeId, recipesLearned.learnedAt],
    );

    // Per-session totals, keyed like drops/corpses: set, never added.
    await upsert(
      tx,
      crafts,
      r.crafts.map((c) => ({ ...c, ...perSession })),
      [crafts.recipeId, crafts.build, crafts.uploaderId, crafts.account, crafts.session],
    );
    await upsert(
      tx,
      nodes,
      r.nodes.map((n) => ({ ...n, ...perSession })),
      [nodes.objectId, nodes.build, nodes.uploaderId, nodes.account, nodes.session],
    );
    await upsert(
      tx,
      nodeLoot,
      r.nodeLoot.map((l) => ({ ...l, ...perSession })),
      [
        nodeLoot.itemId,
        nodeLoot.objectId,
        nodeLoot.build,
        nodeLoot.uploaderId,
        nodeLoot.account,
        nodeLoot.session,
      ],
    );

    // Trainer and vendor lists: a newer scan wins, an older SavedVariables session uploaded late changes nothing. A
    // trainer scan that saw only part of the list (a type filter off, a collapsed header) merges its services into the
    // stored list by name: known names are updated in place, new ones appended. The NPC's title (schema 5) is kept
    // when a newer scan has none (an older addon, or a tooltip that was not ready).
    const mergedServices = sql`(
      select coalesce(jsonb_agg(coalesce(n.svc, o.svc) order by o.ord), '[]'::jsonb)
      from jsonb_array_elements(${trainers.services}) with ordinality as o(svc, ord)
      left join lateral (
        select x as svc from jsonb_array_elements(excluded.services) as x
        where x->>'name' = o.svc->>'name' limit 1
      ) n on true
    ) || coalesce((
      select jsonb_agg(x order by ord)
      from jsonb_array_elements(excluded.services) with ordinality as e(x, ord)
      where not exists (
        select 1 from jsonb_array_elements(${trainers.services}) as y where y->>'name' = x->>'name')
    ), '[]'::jsonb)`;
    await upsert(
      tx,
      trainers,
      r.trainers.map((t) => ({
        ...t,
        complete: t.complete ?? false,
        seenAt: fromEpoch(t.seenAt)!,
      })),
      [trainers.npcId, trainers.build],
      {
        setWhere: notOlder(trainers.seenAt),
        set: {
          services: sql`case when excluded.complete then excluded.services else ${mergedServices} end`,
          complete: sql`excluded.complete or ${trainers.complete}`,
          skillLineId: sql`coalesce(excluded.skill_line_id, ${trainers.skillLineId})`,
          title: sql`coalesce(excluded.title, ${trainers.title})`,
        },
      },
    );
    await upsert(
      tx,
      vendors,
      r.vendors.map((v) => ({ ...v, seenAt: fromEpoch(v.seenAt)! })),
      [vendors.npcId, vendors.build],
      {
        setWhere: notOlder(vendors.seenAt),
        set: { title: sql`coalesce(excluded.title, ${vendors.title})` },
      },
    );
    await upsert(
      tx,
      apiSamples,
      r.apiSamples.map((a) => ({
        api: a.api,
        build: a.build,
        observedAt: fromEpoch(a.time)!,
        sample: a.sample,
      })),
      [apiSamples.api, apiSamples.build],
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
