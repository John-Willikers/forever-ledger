import { describe, expect, it } from 'vitest';
import { canEquip, specsWanting } from '../src/index.js';

const mailAgi = {
  type: 'Armor',
  subtype: 'Mail',
  equipLoc: 'INVTYPE_CHEST',
  stats: { ITEM_MOD_AGILITY_SHORT: 6, ITEM_MOD_STAMINA_SHORT: 2 },
};

describe('class rules', () => {
  it('applies armor proficiency by level', () => {
    expect(canEquip('WARRIOR', mailAgi, 20)).toBe(true);
    expect(canEquip('HUNTER', mailAgi, 20)).toBe(false);
    expect(canEquip('HUNTER', mailAgi, 40)).toBe(true);
    expect(canEquip('MAGE', { type: 'Armor', subtype: 'Cloth' })).toBe(true);
    expect(
      canEquip('MAGE', { type: 'Armor', equipLoc: 'INVTYPE_FINGER', subtype: 'Miscellaneous' }),
    ).toBe(true);
  });

  it('applies weapon proficiency', () => {
    expect(canEquip('ROGUE', { type: 'Weapon', subtype: 'Daggers' })).toBe(true);
    expect(canEquip('ROGUE', { type: 'Weapon', subtype: 'Two-Handed Axes' })).toBe(false);
  });

  it('ranks specs by how well the stats fit', () => {
    const fits = specsWanting(
      { type: 'Weapon', subtype: 'Staves', stats: { ITEM_MOD_INTELLECT_SHORT: 5 } },
      20,
    );
    expect(fits[0]?.score).toBe(1);
    expect(['MAGE', 'PRIEST', 'DRUID', 'WARLOCK', 'SHAMAN']).toContain(fits[0]?.cls);
    const staffWarrior = fits.find((f) => f.cls === 'WARRIOR');
    expect(staffWarrior?.score).toBe(0);
  });
});
