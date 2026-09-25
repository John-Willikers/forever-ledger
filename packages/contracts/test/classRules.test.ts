import { describe, expect, it } from 'vitest';
import { RULES_VERSION, canEquip, itemFit, rolesFromStats } from '../src/index.js';
import type { ItemFit } from '../src/index.js';

const mailAgi = {
  type: 'Armor',
  subtype: 'Mail',
  equipLoc: 'INVTYPE_CHEST',
  stats: { ITEM_MOD_AGILITY_SHORT: 6, ITEM_MOD_STAMINA_SHORT: 2 },
};

const roleMap = (fit: ItemFit) => Object.fromEntries(fit.roles.map((r) => [r.role, r.confidence]));
const equippable = (fit: ItemFit) => fit.classes.filter((c) => c.canEquip).map((c) => c.cls);
const later = (fit: ItemFit) =>
  Object.fromEntries(fit.classes.filter((c) => !c.canEquip).map((c) => [c.cls, c.fromLevel]));

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
    expect(canEquip('PRIEST', { type: 'Weapon', subtype: 'Fishing Pole' })).toBe(true);
  });

  it('relics belong to one class', () => {
    expect(canEquip('DRUID', { type: 'Armor', subtype: 'Idols' })).toBe(true);
    expect(canEquip('PALADIN', { type: 'Armor', subtype: 'Idols' })).toBe(false);
    expect(canEquip('PALADIN', { type: 'Armor', subtype: 'Librams' })).toBe(true);
    expect(canEquip('SHAMAN', { type: 'Armor', subtype: 'Totems' })).toBe(true);
  });
});

describe('rolesFromStats', () => {
  it('ignores Stamina and reads spell power as caster first, healer second', () => {
    // Hillman's Cloak (3719): the old score ranked Prot Warrior 100% on this
    const fit = itemFit({
      type: 'Armor',
      subtype: 'Cloth',
      equipLoc: 'INVTYPE_CLOAK',
      stats: { RESISTANCE0_NAME: 21, ITEM_MOD_STAMINA_SHORT: 4, ITEM_MOD_SPELL_POWER_SHORT: 5 },
      reqLevel: 25,
    });
    expect(fit.roles.map((r) => r.role)).toEqual(['caster', 'healer']);
    expect(roleMap(fit)).toEqual({ caster: 0.59, healer: 0.41 });
    expect(equippable(fit)).toHaveLength(9);
    // a cloak is not anyone's "best armor"
    expect(fit.classes.some((c) => c.bestArmor)).toBe(false);
  });

  it('puts healing above damage when both are on the item', () => {
    // Truefaith Gloves (7049)
    const roles = rolesFromStats({
      type: 'Armor',
      subtype: 'Cloth',
      stats: {
        RESISTANCE0_NAME: 27,
        ITEM_MOD_INTELLECT_SHORT: 3,
        ITEM_MOD_SPELL_DAMAGE_DONE_SHORT: 5,
        ITEM_MOD_SPELL_HEALING_DONE_SHORT: 15,
      },
    });
    expect(roles[0]?.role).toBe('healer');
    expect(roles[1]?.role).toBe('caster');
    expect(roles.find((r) => r.role === 'tank')).toBeUndefined();
  });

  it('gives a DPS-only one-hander a melee role instead of 0 for everyone', () => {
    // Cutlass (851)
    const fit = itemFit({
      type: 'Weapon',
      subtype: 'One-Handed Swords',
      equipLoc: 'INVTYPE_WEAPON',
      stats: { ITEM_MOD_DAMAGE_PER_SECOND_SHORT: 6.8 },
      reqLevel: 10,
    });
    expect(roleMap(fit)).toEqual({ melee: 0.67, tank: 0.33 });
    expect(equippable(fit)).toEqual(['WARRIOR', 'PALADIN', 'HUNTER', 'ROGUE', 'MAGE', 'WARLOCK']);
  });

  it('reads ranged weapons, wands and shields from the subtype', () => {
    const bow = rolesFromStats({
      type: 'Weapon',
      subtype: 'Bows',
      stats: { ITEM_MOD_DAMAGE_PER_SECOND_SHORT: 5 },
    });
    expect(bow).toEqual([{ role: 'ranged', confidence: 1 }]);
    const wand = rolesFromStats({ type: 'Weapon', subtype: 'Wands', stats: {} });
    expect(wand).toEqual([{ role: 'caster', confidence: 1 }]);
    const shield = rolesFromStats({
      type: 'Armor',
      subtype: 'Shields',
      stats: { RESISTANCE0_NAME: 300, ITEM_MOD_INTELLECT_SHORT: 5 },
    });
    expect(shield[0]?.role).toBe('tank');
    expect(shield.map((r) => r.role)).toContain('healer');
  });

  it('weights primary stats by their share and adds tank signals', () => {
    // Steel Plate Helm (7922)
    const plate = rolesFromStats({
      type: 'Armor',
      subtype: 'Plate',
      stats: { RESISTANCE0_NAME: 310, ITEM_MOD_STAMINA_SHORT: 12, ITEM_MOD_STRENGTH_SHORT: 12 },
    });
    expect(plate).toEqual([
      { role: 'melee', confidence: 0.63 },
      { role: 'tank', confidence: 0.38 },
    ]);
    const defense = rolesFromStats({
      type: 'Armor',
      subtype: 'Plate',
      stats: { ITEM_MOD_STRENGTH_SHORT: 10, ITEM_MOD_DEFENSE_SKILL_RATING_SHORT: 5 },
    });
    expect(defense[0]?.role).toBe('tank');
    // Fine Leather Boots (2307): Agility is ranged first, melee second
    const agi = rolesFromStats({
      type: 'Armor',
      subtype: 'Leather',
      stats: { RESISTANCE0_NAME: 51, ITEM_MOD_AGILITY_SHORT: 3, ITEM_MOD_STAMINA_SHORT: 2 },
    });
    expect(agi.map((r) => r.role)).toEqual(['ranged', 'melee', 'tank']);
  });

  it('uses the weapon subtype only when the stats say nothing', () => {
    // every weapon carries DPS, so a caster dagger must not read as melee
    const dagger = rolesFromStats({
      type: 'Weapon',
      subtype: 'Daggers',
      stats: {
        ITEM_MOD_DAMAGE_PER_SECOND_SHORT: 10,
        ITEM_MOD_INTELLECT_SHORT: 5,
        ITEM_MOD_SPIRIT_SHORT: 5,
      },
    });
    expect(dagger.map((r) => r.role)).toEqual(['healer', 'caster']);
    const healingMace = rolesFromStats({
      type: 'Weapon',
      subtype: 'One-Handed Maces',
      stats: { ITEM_MOD_DAMAGE_PER_SECOND_SHORT: 20, ITEM_MOD_SPELL_HEALING_DONE_SHORT: 30 },
    });
    expect(healingMace).toEqual([{ role: 'healer', confidence: 1 }]);
    // generic crit and hit fit every role, so the subtype still decides
    const sword = rolesFromStats({
      type: 'Weapon',
      subtype: 'Two-Handed Swords',
      stats: { ITEM_MOD_CRIT_RATING_SHORT: 14, ITEM_MOD_DAMAGE_PER_SECOND_SHORT: 28.8 },
    });
    expect(sword[0]).toEqual({ role: 'melee', confidence: 0.6 });
    const rifle = rolesFromStats({
      type: 'Weapon',
      subtype: 'Guns',
      stats: { ITEM_MOD_HIT_RATING_SHORT: 3, ITEM_MOD_DAMAGE_PER_SECOND_SHORT: 11.8 },
    });
    expect(rifle[0]).toEqual({ role: 'ranged', confidence: 0.6 });
    // a plain staff is a caster weapon first
    const staff = rolesFromStats({
      type: 'Weapon',
      subtype: 'Staves',
      stats: { ITEM_MOD_DAMAGE_PER_SECOND_SHORT: 12 },
    });
    expect(staff[0]?.role).toBe('caster');
  });

  it('keeps physical damage on the physical side and reads per-school crit and hit', () => {
    const physical = rolesFromStats({
      type: 'Armor',
      subtype: 'Leather',
      stats: { ITEM_MOD_PHYSICAL_DAMAGE_DONE_SHORT: 5 },
    });
    expect(physical[0]?.role).toBe('melee');
    expect(physical.find((r) => r.role === 'caster')).toBeUndefined();
    expect(
      rolesFromStats({
        type: 'Armor',
        subtype: 'Cloth',
        stats: { ITEM_MOD_CRIT_SPELL_RATING_SHORT: 14 },
      })[0]?.role,
    ).toBe('caster');
    expect(
      rolesFromStats({
        type: 'Armor',
        subtype: 'Mail',
        stats: { ITEM_MOD_HIT_RANGED_RATING_SHORT: 10 },
      }),
    ).toEqual([{ role: 'ranged', confidence: 1 }]);
    expect(
      rolesFromStats({
        type: 'Armor',
        subtype: 'Plate',
        stats: { ITEM_MOD_CRIT_MELEE_RATING_SHORT: 10 },
      }),
    ).toEqual([{ role: 'melee', confidence: 1 }]);
  });

  it('gives no role to armor with no signal, resistances or profession mods', () => {
    expect(
      rolesFromStats({ type: 'Armor', subtype: 'Cloth', stats: { RESISTANCE0_NAME: 10 } }),
    ).toEqual([]);
    expect(
      rolesFromStats({
        type: 'Armor',
        subtype: 'Leather',
        stats: { ITEM_MOD_FIRE_RESISTANCE_SHORT: 10, ITEM_MOD_MINING_SHORT: 5 },
      }),
    ).toEqual([]);
  });
});

describe('itemFit', () => {
  it('evaluates required level 0 at level 1 and still lists Mail wearers', () => {
    // Battleworn Chain Leggings (4917): the old code fell back to Cloth and listed nobody
    const fit = itemFit({
      type: 'Armor',
      subtype: 'Mail',
      equipLoc: 'INVTYPE_LEGS',
      stats: { RESISTANCE0_NAME: 58 },
      reqLevel: 0,
    });
    expect(fit.atLevel).toBe(1);
    expect(fit.roles).toEqual([]);
    expect(equippable(fit)).toEqual(['WARRIOR', 'PALADIN']);
    expect(later(fit)).toEqual({ HUNTER: 40, SHAMAN: 40 });
    expect(fit.classes.find((c) => c.cls === 'WARRIOR')?.bestArmor).toBe(true);
    expect(fit.classes.find((c) => c.cls === 'HUNTER')?.bestArmor).toBe(false);
    expect(itemFit({ type: 'Armor', subtype: 'Plate', reqLevel: null }).atLevel).toBe(1);
  });

  it('marks the best armor type per class at the item level', () => {
    // Fine Leather Boots at 13: leather is the best a hunter or shaman can wear until 40
    const fit = itemFit({
      type: 'Armor',
      subtype: 'Leather',
      equipLoc: 'INVTYPE_FEET',
      reqLevel: 13,
    });
    const best = fit.classes.filter((c) => c.bestArmor).map((c) => c.cls);
    expect(best).toEqual(['HUNTER', 'ROGUE', 'SHAMAN', 'DRUID']);
    expect(equippable(fit)).toEqual(['WARRIOR', 'PALADIN', 'HUNTER', 'ROGUE', 'SHAMAN', 'DRUID']);
    const at45 = itemFit({
      type: 'Armor',
      subtype: 'Leather',
      equipLoc: 'INVTYPE_FEET',
      reqLevel: 45,
    });
    expect(at45.classes.filter((c) => c.bestArmor).map((c) => c.cls)).toEqual(['ROGUE', 'DRUID']);
  });

  it('lists only the relic class for Idols, Librams and Totems', () => {
    const idol = itemFit({
      type: 'Armor',
      subtype: 'Idols',
      equipLoc: 'INVTYPE_RELIC',
      reqLevel: 55,
    });
    expect(idol.classes).toEqual([{ cls: 'DRUID', canEquip: true, bestArmor: false }]);
    const trinket = itemFit({
      type: 'Armor',
      subtype: 'Miscellaneous',
      equipLoc: 'INVTYPE_TRINKET',
    });
    expect(trinket.classes.some((c) => c.bestArmor)).toBe(false);
    const shield = itemFit({ type: 'Armor', subtype: 'Shields', equipLoc: 'INVTYPE_SHIELD' });
    expect(shield.classes.map((c) => c.cls)).toEqual(['WARRIOR', 'PALADIN', 'SHAMAN']);
    expect(shield.classes.some((c) => c.bestArmor)).toBe(false);
    expect(idol.roles).toEqual([]);
    expect(itemFit({ type: 'Armor', subtype: 'Librams' }).classes[0]?.cls).toBe('PALADIN');
    expect(itemFit({ type: 'Armor', subtype: 'Totems' }).classes[0]?.cls).toBe('SHAMAN');
  });

  it('carries the rules version and lists nobody for a non-equippable item', () => {
    const fit = itemFit({ type: 'Trade Goods', subtype: 'Trade Goods', stats: {} });
    expect(fit.rulesVersion).toBe(RULES_VERSION);
    expect(typeof fit.rulesVersion).toBe('string');
    expect(fit.classes).toEqual([]);
    expect(fit.roles).toEqual([]);
  });
});
