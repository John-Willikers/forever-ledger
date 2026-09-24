// Pure merges behind /admin/api/runs/:id (no database): one run group's bosses and boss loot from every member.
import { describe, expect, it } from 'vitest';
import { medianOf, mergeBosses, mergeBossLoot } from '../src/routes/adminRuns.js';

const boss = (
  ord: number,
  encounterId: number | null,
  name: string | null,
  atSecs: number,
  killed = true,
) => ({
  ord,
  encounterId,
  name,
  killed,
  atSecs,
});

describe('mergeBosses', () => {
  it('dedupes by encounter id, keeps the earliest time, killed by anyone, renumbered in time order', () => {
    expect(
      mergeBosses([
        [boss(1, 580, 'Anacondra', 301), boss(2, 581, 'Cobrahn', 600, false)],
        [boss(1, 580, 'Anacondra', 300), boss(2, 581, 'Cobrahn', 605), boss(3, 582, 'Kresh', 500)],
      ]),
    ).toEqual([
      boss(1, 580, 'Anacondra', 300),
      boss(2, 582, 'Kresh', 500),
      boss(3, 581, 'Cobrahn', 600),
    ]);
  });

  it('falls back to the name without an encounter id', () => {
    expect(
      mergeBosses([[boss(1, null, 'X', 10)], [boss(1, null, 'X', 12), boss(2, null, 'Y', 20)]]),
    ).toEqual([boss(1, null, 'X', 10), boss(2, null, 'Y', 20)]);
  });
});

describe('mergeBossLoot', () => {
  const drop = (over: Record<string, unknown> = {}) => ({
    encounterId: 580,
    lootListKey: 1,
    itemId: 6400,
    winnerClass: 'DRUID',
    winnerIsSelf: false,
    rolls: [] as unknown[],
    ...over,
  });

  it('dedupes identical drops across members by encounter, item, winner class and loot list key', () => {
    const merged = mergeBossLoot([
      {
        char: 'Sam',
        bossLoot: [drop({ winnerIsSelf: true }), drop({ lootListKey: 2, itemId: 6401 })],
      },
      {
        char: 'Vic',
        bossLoot: [drop(), drop({ lootListKey: 2, itemId: 6401, winnerIsSelf: true })],
      },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.map((m) => [m.itemId, m.winnerChar])).toEqual([
      [6400, 'Sam'],
      [6401, 'Vic'],
    ]);
    expect(merged[0]).not.toHaveProperty('winnerIsSelf');
  });

  it('keeps repeated drops one member saw (max count per member), and the entry with the most rolls', () => {
    const noKey = { lootListKey: null, winnerClass: 'HUNTER' };
    const merged = mergeBossLoot([
      { char: 'Sam', bossLoot: [drop(noKey), drop(noKey)] },
      { char: 'Vic', bossLoot: [drop({ ...noKey, rolls: [{ class: 'HUNTER' }] })] },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.rolls).toHaveLength(1);
    expect(merged[1]!.rolls).toHaveLength(0);
    expect(merged.every((m) => m.winnerChar === null)).toBe(true);
  });

  it('keeps drops that differ in winner class apart', () => {
    expect(
      mergeBossLoot([
        { char: 'Sam', bossLoot: [drop()] },
        { char: 'Vic', bossLoot: [drop({ winnerClass: 'WARRIOR' })] },
      ]),
    ).toHaveLength(2);
  });
});

describe('medianOf', () => {
  it('rounds the median of the known values', () => {
    expect(medianOf([2400, 2459])).toBe(2430);
    expect(medianOf([null, 5, 1, 3])).toBe(3);
    expect(medianOf([null])).toBeNull();
  });
});
