import { describe, expect, it } from 'vitest';
import {
  classGroups,
  classNote,
  containerLabel,
  contentsByBuild,
  formatAvgQuantity,
  mergeDropSources,
  roleLabel,
  statLabel,
  statMatrix,
  tooltipText,
} from './itemLib';
import type { SnapshotLike } from './itemLib';

describe('statLabel', () => {
  it('reads WoW stat keys', () => {
    expect(statLabel('ITEM_MOD_STRENGTH_SHORT')).toBe('Strength');
    expect(statLabel('ITEM_MOD_CRIT_RATING_SHORT')).toBe('Crit Rating');
    expect(statLabel('RESISTANCE0_NAME')).toBe('Armor');
    expect(statLabel('RESISTANCE2_NAME')).toBe('Fire Resistance');
    expect(statLabel('ilvl')).toBe('Item level');
    expect(statLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });
});

describe('statMatrix', () => {
  const snaps: SnapshotLike[] = [
    {
      build: 61600,
      ilvl: 22,
      reqLevel: 17,
      sellPrice: 500,
      stats: { ITEM_MOD_STRENGTH_SHORT: 8, ITEM_MOD_STAMINA_SHORT: 2 },
    },
    { build: 61582, ilvl: 22, reqLevel: 17, sellPrice: 450, stats: { ITEM_MOD_STRENGTH_SHORT: 7 } },
  ];

  it('lays out one column per build (oldest first) and flags values that changed from the previous build', () => {
    const m = statMatrix(snaps);
    expect(m.builds).toEqual([61582, 61600]);
    const row = (key: string) => m.rows.find((r) => r.key === key)!;
    expect(row('ITEM_MOD_STRENGTH_SHORT').cells).toEqual([
      { value: 7, changed: false },
      { value: 8, changed: true },
    ]);
    expect(row('ITEM_MOD_STAMINA_SHORT').cells).toEqual([
      { value: null, changed: false },
      { value: 2, changed: true },
    ]);
    expect(row('ilvl').cells.map((c) => c.changed)).toEqual([false, false]);
    expect(row('sellPrice').cells[1]).toEqual({ value: 500, changed: true });
    expect(m.changedBuilds).toEqual([61600]);
    // Fields first, then stats by label.
    expect(m.rows.map((r) => r.key)).toEqual([
      'ilvl',
      'reqLevel',
      'sellPrice',
      'ITEM_MOD_STAMINA_SHORT',
      'ITEM_MOD_STRENGTH_SHORT',
    ]);
  });

  it('handles no snapshots', () => {
    expect(statMatrix([])).toEqual({ builds: [], rows: [], changedBuilds: [] });
  });
});

describe('mergeDropSources', () => {
  it('joins drop counts with rates and names by build and npc', () => {
    const merged = mergeDropSources(
      [
        { build: 61582, npcId: 644, count: 3, contributors: 2 },
        { build: 61600, npcId: 644, count: 1, contributors: 1 },
      ],
      [
        {
          build: 61582,
          npcId: 644,
          npcName: 'Defias Miner',
          corpses: 4,
          dropped: 2,
          quantity: 2,
          rate: 0.5,
        },
      ],
    );
    expect(merged).toEqual([
      {
        build: 61582,
        npcId: 644,
        npcName: 'Defias Miner',
        count: 3,
        contributors: 2,
        corpses: 4,
        rate: 0.5,
      },
      {
        build: 61600,
        npcId: 644,
        npcName: null,
        count: 1,
        contributors: 1,
        corpses: null,
        rate: null,
      },
    ]);
  });
});

describe('tooltipText', () => {
  it('strips WoW escape codes, keeping the text', () => {
    expect(tooltipText('|cff1eff00Equip: +7 Strength.|r')).toBe('Equip: +7 Strength.');
    expect(tooltipText('Two-Hand\tAxe')).toBe('Two-Hand Axe');
    expect(tooltipText('|Hitem:872::|h[Rockslicer]|h')).toBe('[Rockslicer]');
    expect(tooltipText('|TInterface\\Icons\\foo:0|t Gold')).toBe('Gold');
    expect(tooltipText('<b>not html</b>')).toBe('<b>not html</b>');
    expect(tooltipText('a || b')).toBe('a | b');
  });

  it('turns coin atlases into g/s/c and drops other atlases', () => {
    expect(tooltipText('Sell Price: 17|A:coin-copper:14:14:2:0|a')).toBe('Sell Price: 17c');
    expect(
      tooltipText('Sell Price: 1|A:coin-silver:14:14:2:0|a 25|A:coin-copper:14:14:2:0|a'),
    ).toBe('Sell Price: 1s 25c');
    expect(tooltipText('3|A:coin-gold:14:14:2:0|a')).toBe('3g');
    expect(tooltipText('|A:quest-icon:0:0|a Quest Item')).toBe('Quest Item');
  });
});

describe('container loot', () => {
  it('names containers: the item name, Unknown container for 0, else the id', () => {
    expect(containerLabel(6307, 'Message in a Bottle')).toBe('Message in a Bottle');
    expect(containerLabel(0, null)).toBe('Unknown container');
    expect(containerLabel(5523, null)).toBe('Item 5523');
    expect(containerLabel(5523, '')).toBe('Item 5523');
  });

  it('groups contents per build, newest first, items by chance then id', () => {
    const item = (build: number, itemId: number, chance: number | null) => ({
      build,
      itemId,
      name: null,
      quality: null,
      count: 1,
      quantity: 1,
      chance,
      avgQuantity: 1,
    });
    const groups = contentsByBuild({
      opens: [
        { build: 61582, opened: 4, copper: 50, avgCopper: 12.5 },
        { build: 69977, opened: 1, copper: 0, avgCopper: 0 },
      ],
      items: [
        item(61582, 5498, 0.25),
        item(61582, 5503, 0.75),
        item(69977, 5503, 1),
        item(61582, 4409, 0.75),
        item(61582, 1, null),
      ],
    });
    expect(groups.map((g) => [g.build, g.opened])).toEqual([
      [69977, 1],
      [61582, 4],
    ]);
    expect(groups[0]!.items.map((i) => i.itemId)).toEqual([5503]);
    expect(groups[1]!.items.map((i) => i.itemId)).toEqual([4409, 5503, 5498, 1]);
    expect(groups[1]!.avgCopper).toBe(12.5);
    expect(contentsByBuild({ opens: [], items: [] })).toEqual([]);
  });

  it('treats a response without contents (an older server) as empty', () => {
    expect(contentsByBuild(undefined)).toEqual([]);
    expect(contentsByBuild(null)).toEqual([]);
    expect(contentsByBuild({})).toEqual([]);
    expect(contentsByBuild({ items: [] })).toEqual([]);
    const opens = [{ build: 69913, opened: 2, copper: 0, avgCopper: 0 }];
    expect(contentsByBuild({ opens })).toEqual([{ ...opens[0], items: [] }]);
    expect(contentsByBuild({ opens, items: null })).toEqual([{ ...opens[0], items: [] }]);
  });

  it('formats average quantities with up to 2 decimals', () => {
    expect(formatAvgQuantity(1)).toBe('1');
    expect(formatAvgQuantity(1.3333)).toBe('1.33');
    expect(formatAvgQuantity(1250.5)).toBe('1,250.5');
    expect(formatAvgQuantity(null)).toBe('—');
    expect(formatAvgQuantity(Number.NaN)).toBe('—');
  });
});

describe('who wants it', () => {
  it('labels roles for the card', () => {
    expect(roleLabel('tank')).toBe('Tank');
    expect(roleLabel('healer')).toBe('Healer');
    expect(roleLabel('caster')).toBe('Caster DPS');
    expect(roleLabel('melee')).toBe('Melee DPS');
    expect(roleLabel('ranged')).toBe('Ranged DPS');
  });

  it('splits classes into the ones that want the item and the ones that can merely hold it', () => {
    const classes = [
      { cls: 'WARRIOR', canEquip: true, bestArmor: false, wants: false },
      { cls: 'PRIEST', canEquip: true, bestArmor: false, wants: true },
      { cls: 'HUNTER', canEquip: false, fromLevel: 40, bestArmor: false, wants: false },
      { cls: 'DRUID', canEquip: true, bestArmor: false, wants: true },
    ];
    const g = classGroups(classes);
    expect(g.wanting.map((c) => c.cls)).toEqual(['PRIEST', 'DRUID']);
    expect(g.holders).toEqual(['Warrior', 'Hunter (at 40)']);
  });

  it('notes whether a class can wear it now, later, and if it is their best armor', () => {
    expect(classNote({ cls: 'WARRIOR', canEquip: true, bestArmor: true, wants: true })).toBe(
      'best armor',
    );
    expect(classNote({ cls: 'ROGUE', canEquip: true, bestArmor: false, wants: true })).toBe('');
    expect(
      classNote({ cls: 'HUNTER', canEquip: false, fromLevel: 40, bestArmor: false, wants: true }),
    ).toBe('at 40');
    expect(classNote({ cls: 'MAGE', canEquip: false, bestArmor: false, wants: true })).toBe(
      'later',
    );
  });
});
