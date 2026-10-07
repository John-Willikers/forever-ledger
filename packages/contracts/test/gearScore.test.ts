// Gear scores are an estimate; these pin the rule of thumb so a change to it is deliberate.
import { describe, expect, it } from 'vitest';
import { canDualWield, gearScore, guessRole, SLOTS_FOR_EQUIP_LOC } from '../src/index.js';

describe('gear scores', () => {
  it('weights stats by role, armor and weapon damage included', () => {
    const bearBoots = {
      ITEM_MOD_STAMINA_SHORT: 8,
      ITEM_MOD_AGILITY_SHORT: 5,
      RESISTANCE0_NAME: 120,
    };
    expect(gearScore(bearBoots, 'tank')).toBe(17); // 8 + 3 + 6
    expect(gearScore(bearBoots, 'healer')).toBe(3.6); // 2.4 + 1.2
    const axe = { ITEM_MOD_STRENGTH_SHORT: 7, ITEM_MOD_DAMAGE_PER_SECOND_SHORT: 12.5 };
    expect(gearScore(axe, 'melee')).toBe(44.5);
    expect(gearScore({ ITEM_MOD_FIRE_DAMAGE_DONE_SHORT: 6 }, 'caster')).toBe(6);
    expect(gearScore(undefined, 'melee')).toBe(0);
  });

  it("guesses a role from what's worn, else the class's first role, and always says it guessed", () => {
    expect(
      guessRole('DRUID', [{ ITEM_MOD_INTELLECT_SHORT: 10, ITEM_MOD_SPIRIT_SHORT: 8 }, undefined]),
    ).toMatchObject({ role: 'healer', guessed: true, basis: 'gear' });
    expect(guessRole('WARRIOR', [])).toEqual({
      role: 'melee',
      guessed: true,
      basis: 'class default',
    });
    // A rogue in caster gear is still a rogue: only the class's own roles count.
    expect(guessRole('ROGUE', [{ ITEM_MOD_INTELLECT_SHORT: 10 }]).role).toBe('melee');
  });

  it('maps equip locations to inventory slots', () => {
    expect(SLOTS_FOR_EQUIP_LOC.INVTYPE_FINGER).toEqual([11, 12]);
    expect(SLOTS_FOR_EQUIP_LOC.INVTYPE_ROBE).toEqual([5]);
    expect(SLOTS_FOR_EQUIP_LOC.INVTYPE_2HWEAPON).toEqual([16]);
  });

  it('dual wield follows Classic: rogues always, warriors and hunters from 20, never shamans', () => {
    expect(canDualWield('ROGUE', 1)).toBe(true);
    expect(canDualWield('WARRIOR', 19)).toBe(false);
    expect(canDualWield('WARRIOR', 20)).toBe(true);
    expect(canDualWield('HUNTER', 20)).toBe(true);
    expect(canDualWield('SHAMAN', 60)).toBe(false);
  });
});
