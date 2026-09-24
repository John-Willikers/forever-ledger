// Two builds of the same records for the build-diff tests: the synthetic v5 session as build 61582 and a hand-built
// "patch" of it as build 70100 with known differences.
import type { UploadBatch } from '@forever-ledger/contracts';
import { batchFromFixture } from './helpers.js';

export const OLD = 61582;
export const NEW = 70100;
const CHAR = 'Thibodeaux-Bayou';
export const STR7 = '|cff1eff00Equip: +7 Strength.|r';
export const STR9 = '|cff1eff00Equip: +9 Strength.|r';
/** Items only the patch has: one named relic and 51 fillers (past the 50-entry sample). */
export const FILLERS = Array.from({ length: 51 }, (_, i) => 260_000 + i);

/**
 * Build 61582: the v5 session plus a quest only this build saw (4321) and more loot: Defias Miner (644) 10 corpses,
 * Rockslicer 2×, Linen Cloth 5×; npc 700 3 corpses (under the threshold); npc 702 6 corpses (only here).
 */
export function oldBatch(): UploadBatch {
  const b = batchFromFixture('session-v5.lua');
  const session = b.meta.session!;
  return {
    ...b,
    records: {
      ...b.records,
      quests: [...b.records.quests, { questId: 4321, title: 'Old Errand', level: 5 }],
      questObservations: [
        ...b.records.questObservations,
        { questId: 4321, build: OLD, stage: 'detail', char: CHAR, xp: 100, time: 1790000100 },
      ],
      corpses: [
        { npcId: 644, build: OLD, session, count: 10, copper: 1000 },
        { npcId: 700, build: OLD, session, count: 3, copper: 0 },
        { npcId: 702, build: OLD, session, count: 6, copper: 0 },
      ],
      drops: [
        { itemId: 872, build: OLD, npcId: 644, session, count: 2, quantity: 2 },
        { itemId: 2589, build: OLD, npcId: 644, session, count: 5, quantity: 5 },
        { itemId: 2589, build: OLD, npcId: 700, session, count: 1, quantity: 1 },
      ],
    },
  };
}

/** Build 70100: the same records re-observed on another PC, with the differences the diff must find. */
export function patchBatch(): UploadBatch {
  const b = batchFromFixture('session-v5.lua', 'ACCOUNT2', 'pc-2');
  const session = '1790300000-f00d';
  const r = b.records;
  const at = <T extends { build: number }>(xs: T[]) => xs.map((x) => ({ ...x, build: NEW }));
  return {
    ...b,
    meta: { ...b.meta, build: NEW, version: '1.60.2', interface: 16002, session },
    records: {
      ...r,
      items: [
        ...r.items,
        { itemId: 250777, name: 'Bayou Relic', quality: 4 },
        ...FILLERS.map((itemId) => ({ itemId, name: `Filler ${itemId}` })),
      ],
      itemSnapshots: [
        ...at(r.itemSnapshots)
          .filter((s) => s.itemId !== 2770)
          .map((s) =>
            s.itemId === 872
              ? {
                  ...s,
                  ilvl: 23,
                  sellPrice: 2800,
                  stats: { ITEM_MOD_STRENGTH_SHORT: 9, ITEM_MOD_STAMINA_SHORT: 3 },
                  tooltip: ['Rockslicer', 'Two-Hand\tAxe', STR9],
                }
              : s.itemId === 2320
                ? { ...s, reqLevel: 5 }
                : s,
          ),
        ...[250777, ...FILLERS].map((itemId) => ({
          itemId,
          build: NEW,
          stats: {},
          tooltip: [`Item ${itemId}`],
        })),
      ],
      quests: [...r.quests, { questId: 90001, title: 'Bayou Bounty', level: 12 }],
      questObservations: [
        ...at(r.questObservations).map((o) =>
          o.xp === undefined
            ? o
            : {
                ...o,
                xp: 890,
                money: 450,
                choices: [
                  { itemID: 5555, count: 2 },
                  { itemID: 5557, count: 1 },
                ],
              },
        ),
        { questId: 90001, build: NEW, stage: 'detail', char: CHAR, xp: 1200, time: 1790300100 },
      ],
      // Keyed without the build: re-sending them would move the 61582 rows.
      turnIns: [],
      runs: [],
      skillUps: [],
      recipesLearned: [],
      recipeSnapshots: at(r.recipeSnapshots)
        .filter((s) => s.recipeId !== 2393)
        .map((s) =>
          s.recipeId === 2389
            ? {
                ...s,
                maxTrivial: 95,
                reagents: [
                  { itemId: 2996, qty: 4 },
                  { itemId: 2589, qty: 1 },
                ],
              }
            : s.recipeId === 2963
              ? { ...s, qtyMax: 2 }
              : s,
        )
        .concat({
          recipeId: 7629,
          build: NEW,
          outputItemId: 6240,
          qtyMin: 1,
          qtyMax: 1,
          reagents: [{ itemId: 2996, qty: 3 }],
        }),
      recipes: [...r.recipes, { recipeId: 7629, name: 'Blue Linen Vest', skillLineId: 197 }],
      recipeStatus: at(r.recipeStatus),
      recipeDifficulty: at(r.recipeDifficulty),
      vendors: [
        ...at(r.vendors).map((v) =>
          v.npcId === 1347
            ? {
                ...v,
                items: [
                  { itemId: 2320, price: 11, stack: 5, numAvailable: -1 },
                  v.items.find((i) => i.itemId === 2996)!,
                  { itemId: 6270, price: 200, stack: 1, numAvailable: 1 },
                ],
              }
            : v,
        ),
        { npcId: 250500, build: NEW, name: 'Swamp Peddler', seenAt: 1790300200, items: [] },
      ],
      trainers: at(r.trainers).map((t) => ({
        ...t,
        services: [
          { ...t.services[0]!, cost: 120 },
          { ...t.services[1]!, skillRank: 45 },
          { name: 'Blue Linen Vest', type: 'available', cost: 300, skillRank: 70 },
        ],
      })),
      crafts: at(r.crafts).map((c) => ({ ...c, session })),
      nodes: at(r.nodes).map((n) => ({ ...n, session })),
      nodeLoot: at(r.nodeLoot).map((l) => ({ ...l, session })),
      apiSamples: at(r.apiSamples),
      corpses: [
        { npcId: 644, build: NEW, session, count: 20, copper: 2000 },
        { npcId: 700, build: NEW, session, count: 30, copper: 0 },
        { npcId: 701, build: NEW, session, count: 8, copper: 0 },
      ],
      drops: [
        { itemId: 872, build: NEW, npcId: 644, session, count: 2, quantity: 2 },
        { itemId: 2589, build: NEW, npcId: 644, session, count: 10, quantity: 10 },
        { itemId: 2770, build: NEW, npcId: 644, session, count: 4, quantity: 4 },
      ],
    },
  };
}
