import { contentHash, RECORD_KINDS, recordKey } from '@forever-ledger/contracts';
import type { Acknowledged, Records, RecordKind, UploadBatch } from '@forever-ledger/contracts';
import { and, eq, getTableColumns, inArray, ne, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Db } from './db/client.js';
import {
  apiSamples,
  builds,
  characters,
  containerLoot,
  containerOpens,
  corpses,
  crafts,
  fishingCasts,
  characterGear,
  characterState,
  questObjectiveProgress,
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
  trips,
  turnIns,
  vendors,
  xpCurve,
} from './db/schema.js';
import {
  accountsOf,
  canonicalize,
  hasSurname,
  loadAliases,
  mergeCharacter,
  stateSections,
} from './characters.js';
import { lockRunGroups, regroupRuns } from './runGroups.js';
import type { RegroupLog } from './runGroups.js';
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
  /** Where run grouping reports a search that hit its round cap (defaults to the console). */
  log?: RegroupLog;
}

/** Stores one batch idempotently and returns the acknowledged record keys and hashes. */
export async function ingestBatch(db: Db, batch: UploadBatch, ctx: IngestContext) {
  const r = dedupe(batch.records);
  const recordCount = RECORD_KINDS.reduce((n, k) => n + r[k].length, 0);

  const batchId = await db.transaction(async (tx) => {
    // Character identity, read before any write: a character this account uploaded under another key with the same
    // GUID is one character (a rename). Its old key merges into the batch's key, never from a full name into a key
    // without a surname, and never across accounts (a GUID is visible to anyone in game). A GUID that can't be merged
    // is dropped from the batch's record (the column is unique).
    const known = await loadAliases(tx, batch.account);
    const merges: { from: string; into: string; accounts: string[] }[] = [];
    const keepGuid = new Map<string, boolean>();
    // One GUID under two keys in the same file (a rename keeps its old record): a key with a surname beats one
    // without, then the most recently seen key keeps the GUID.
    type Char = (typeof r.characters)[number];
    const better = (a: Char, b: Char) => {
      const sa = hasSurname(a.key, a.realm);
      const sb = hasSurname(b.key, b.realm);
      if (sa !== sb) return sa;
      return (a.lastSeen ?? 0) >= (b.lastSeen ?? 0);
    };
    const byGuid = new Map<string, Char>();
    for (const c of r.characters) {
      if (!c.guid) continue;
      const held = byGuid.get(c.guid);
      if (held === undefined || better(c, held)) {
        if (held !== undefined) keepGuid.set(held.key, false);
        byGuid.set(c.guid, c);
      } else {
        keepGuid.set(c.key, false);
      }
    }
    for (const c of r.characters) {
      if (!c.guid || keepGuid.get(c.key) === false) continue;
      const key = known.get(c.key) ?? c.key;
      const [other] = await tx
        .select({ key: characters.key })
        .from(characters)
        .where(and(eq(characters.guid, c.guid), ne(characters.key, key)));
      if (!other) continue;
      // Only this account ever uploaded the old key: a merge moves every row of that key, so a key another account
      // also used (a shared 0.3.4 short name, or a spoofed record) is never merged.
      const accounts = await accountsOf(tx, other.key);
      const onlyMine = accounts.length === 1 && accounts[0] === batch.account;
      if (onlyMine && (hasSurname(key, c.realm) || !hasSurname(other.key))) {
        merges.push({ from: other.key, into: key, accounts });
      } else {
        keepGuid.set(c.key, false);
        ctx.log?.warn(
          { key: c.key, other: other.key, account: batch.account },
          'GUID already belongs to another character; not merged',
        );
      }
    }

    // Run grouping's lock comes first, before this transaction writes (and row-locks) any run: see lockRunGroups.
    // A merge moves runs too.
    if (r.runs.length > 0 || merges.length > 0) await lockRunGroups(tx);
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
      'containerOpens',
      'containerLoot',
      'fishingCasts',
      'gear',
      'objectiveProgress',
      'charState',
      'xpCurve',
      'trips',
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

    for (const m of merges) await mergeCharacter(tx, m.from, m.into, 'guid', m.accounts);
    // Every record's key goes through this account's aliases (0.3.4 short names -> full names). Mapping can make two
    // records one (a short key and its full name): dedupe again.
    const aliases = await loadAliases(tx, batch.account);
    const mapped = canonicalize(
      {
        ...r,
        characters: r.characters.map((c) =>
          keepGuid.get(c.key) === false ? { ...c, guid: undefined } : c,
        ),
      },
      aliases,
    );
    const w = dedupe(mapped);

    await upsert(
      tx,
      characters,
      w.characters.map((c) => ({ ...c, lastSeen: fromEpoch(c.lastSeen) })),
      [characters.key],
      // A 0.3.4 upload has no GUID or first name: keep what a 0.4.0 one told us.
      { keepKnown: true },
    );

    // Static facts: Forever doesn't load SavedVariables back, so a quest rebuilt after /reload from the turn-in window
    // alone has no level/category. Keep what an earlier upload knew.
    await upsert(tx, quests, w.quests, [quests.questId], { keepKnown: true });

    await upsert(
      tx,
      questObservations,
      w.questObservations.map((o) => ({
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
    for (const o of w.questObservations) {
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
      w.turnIns.map(({ choice, ...t }) => ({
        ...t,
        turnedInAt: fromEpoch(t.time)!,
        choiceIndex: choice?.index,
        choiceItemId: choice?.itemId,
      })),
      [turnIns.id],
    );

    await upsert(tx, items, w.items, [items.itemId], { keepKnown: true });
    await upsert(
      tx,
      itemSnapshots,
      w.itemSnapshots.map((s) => ({ ...s, firstSeen: fromEpoch(s.firstSeen) })),
      [itemSnapshots.itemId, itemSnapshots.build],
    );

    await upsert(
      tx,
      drops,
      w.drops.map((d) => ({ ...d, uploaderId: batch.uploaderId, account: batch.account })),
      [drops.itemId, drops.build, drops.npcId, drops.uploaderId, drops.account, drops.session],
    );
    // Per-session totals: setting them is safe, a later upload of the same session only grows them.
    await upsert(
      tx,
      corpses,
      w.corpses.map((c) => ({ ...c, uploaderId: batch.uploaderId, account: batch.account })),
      [corpses.npcId, corpses.build, corpses.uploaderId, corpses.account, corpses.session],
    );

    // Schema 4: professions.
    const perSession = { uploaderId: batch.uploaderId, account: batch.account };

    // Latest state per character: an older SavedVariables session uploaded late must not roll a rank back.
    await upsert(
      tx,
      skills,
      w.skills.map((s) => ({ ...s, lastSeen: fromEpoch(s.lastSeen)! })),
      [skills.char, skills.skillLineId],
      { setWhere: notOlder(skills.lastSeen) },
    );
    await upsert(
      tx,
      skillUps,
      w.skillUps.map((u) => ({
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

    await upsert(tx, recipes, w.recipes, [recipes.recipeId], { keepKnown: true });
    await upsert(tx, recipeSnapshots, w.recipeSnapshots, [
      recipeSnapshots.recipeId,
      recipeSnapshots.build,
    ]);
    await upsert(
      tx,
      recipeStatus,
      w.recipeStatus.map((s) => ({ ...s, seenAt: fromEpoch(s.seenAt)! })),
      [recipeStatus.recipeId, recipeStatus.build, recipeStatus.char],
      { setWhere: notOlder(recipeStatus.seenAt) },
    );
    // Each session only knows the ranks it saw, so widen the stored range instead of replacing it.
    await upsert(
      tx,
      recipeDifficulty,
      w.recipeDifficulty,
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
      w.recipesLearned.map((l) => ({
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
      w.crafts.map((c) => ({ ...c, ...perSession })),
      [crafts.recipeId, crafts.build, crafts.uploaderId, crafts.account, crafts.session],
    );
    await upsert(
      tx,
      nodes,
      w.nodes.map((n) => ({ ...n, ...perSession })),
      [nodes.objectId, nodes.build, nodes.uploaderId, nodes.account, nodes.session],
    );
    await upsert(
      tx,
      nodeLoot,
      w.nodeLoot.map((l) => ({ ...l, ...perSession })),
      [
        nodeLoot.itemId,
        nodeLoot.objectId,
        nodeLoot.build,
        nodeLoot.uploaderId,
        nodeLoot.account,
        nodeLoot.session,
      ],
    );

    // Schema 6: opened items. Per-session totals like drops/corpses: set, never added.
    await upsert(
      tx,
      containerOpens,
      w.containerOpens.map((c) => ({ ...c, ...perSession })),
      [
        containerOpens.containerId,
        containerOpens.build,
        containerOpens.uploaderId,
        containerOpens.account,
        containerOpens.session,
      ],
    );
    await upsert(
      tx,
      containerLoot,
      w.containerLoot.map((l) => ({ ...l, ...perSession })),
      [
        containerLoot.itemId,
        containerLoot.build,
        containerLoot.containerId,
        containerLoot.uploaderId,
        containerLoot.account,
        containerLoot.session,
      ],
    );
    // Schema 7: one row per fishing cast; a re-upload of the same cast id replaces it.
    await upsert(
      tx,
      fishingCasts,
      w.fishingCasts.map(({ time, ...c }) => ({
        ...c,
        castAt: fromEpoch(time)!,
        uploaderId: batch.uploaderId,
        account: batch.account,
      })),
      [fishingCasts.id],
    );

    // Schema 8: what each character wears, per build; only a newer read replaces the stored one.
    await upsert(
      tx,
      characterGear,
      w.gear.map(({ at, ...g }) => ({
        ...g,
        seenAt: fromEpoch(at)!,
        uploaderId: batch.uploaderId,
        account: batch.account,
      })),
      [characterGear.char, characterGear.build],
      { setWhere: sql`excluded.seen_at >= ${characterGear.seenAt}` },
    );

    // Schema 9: where quest objectives went up; one row per increment.
    await upsert(
      tx,
      questObjectiveProgress,
      w.objectiveProgress.map(({ time, index, ...p }) => ({
        ...p,
        idx: index,
        at: fromEpoch(time)!,
        uploaderId: batch.uploaderId,
        account: batch.account,
      })),
      [
        questObjectiveProgress.char,
        questObjectiveProgress.questId,
        questObjectiveProgress.idx,
        questObjectiveProgress.have,
        questObjectiveProgress.at,
      ],
    );

    // Schema 10: where each character stands. One row per character: the newest observedAt wins, so an older queued
    // batch never rolls state back; sections merge with the stored ones (stateSections: each session uploads only what
    // it saw). Two
    // records of one character (an alias and its full name) keep the newer.
    const states = new Map<string, (typeof w.charState)[number]>();
    for (const c of w.charState) {
      const held = states.get(c.char);
      if (!held || (c.observedAt ?? 0) >= (held.observedAt ?? 0)) states.set(c.char, c);
    }
    await upsert(
      tx,
      characterState,
      [...states.values()].map((c) => ({
        char: c.char,
        build: c.build,
        level: c.level,
        xp: c.xp,
        xpMax: c.xpMax,
        completed: c.completed,
        completedAt: fromEpoch(c.completedAt),
        completedTruncated: c.completedTruncated,
        log: c.log,
        pos: c.pos,
        bind: c.bind,
        hearthReadyAt: fromEpoch(c.hearthReadyAt),
        taxi: c.taxi,
        mount: c.mount,
        observedAt: fromEpoch(c.observedAt),
      })),
      [characterState.char],
      {
        keepKnown: true,
        set: Object.fromEntries(
          Object.entries(getTableColumns(characterState)).flatMap(([prop, col]) => {
            const merged = stateSections('excluded', '"character_state"')[col.name];
            return merged ? [[prop, sql.raw(merged)]] : [];
          }),
        ),
        setWhere: sql`coalesce(excluded.observed_at, '-infinity') >= coalesce(${characterState.observedAt}, '-infinity')`,
      },
    );
    await upsert(tx, xpCurve, w.xpCurve, [xpCurve.build, xpCurve.level]);
    // Trips are facts: the first upload of one stands.
    const tripRows = w.trips.map(({ startedAt, ...t }) => ({
      ...t,
      startedAt: fromEpoch(startedAt)!,
    }));
    for (let i = 0; i < tripRows.length; i += CHUNK) {
      await tx
        .insert(trips)
        .values(tripRows.slice(i, i + CHUNK))
        .onConflictDoNothing({ target: [trips.char, trips.kind, trips.startedAt] });
    }

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
      w.trainers.map((t) => ({
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
      w.vendors.map((v) => ({ ...v, seenAt: fromEpoch(v.seenAt)! })),
      [vendors.npcId, vendors.build],
      {
        setWhere: notOlder(vendors.seenAt),
        set: { title: sql`coalesce(excluded.title, ${vendors.title})` },
      },
    );
    await upsert(
      tx,
      apiSamples,
      w.apiSamples.map((a) => ({
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
      w.runs.map((run) => ({
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
      // The group is ingest's own column, assigned below: an upload never resets it.
      { set: { groupId: sql`${runs.groupId}` } },
    );
    // A run's boss and party lists are replaced wholesale: a resumed run can gain bosses after upload.
    const runIds = w.runs.map((run) => run.id);
    if (runIds.length > 0) {
      await tx.delete(runBosses).where(inArray(runBosses.runId, runIds));
      await tx.delete(runParty).where(inArray(runParty.runId, runIds));
      await insertChunked(
        tx,
        runBosses,
        w.runs.flatMap((run) =>
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
        w.runs.flatMap((run) =>
          run.party.map((p, i) => ({ runId: run.id, slot: i + 1, class: p.class, level: p.level })),
        ),
      );
      // One dungeon run uploaded by several party members is one group (after characters and parties are stored).
      await regroupRuns(tx, runIds, { log: ctx.log });
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
