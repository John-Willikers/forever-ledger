import { describe, expect, it } from 'vitest';
import { mergeDropSources, statLabel, statMatrix, tooltipText } from './itemLib';
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
});
