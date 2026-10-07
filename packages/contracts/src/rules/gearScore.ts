/**
 * Gear scores for upgrade suggestions (schema 8). An **estimate**: Forever has no spec data (see classRules.ts), so
 * an item's worth to a role is its stats weighted by a Classic-era rule of thumb, plus armor and weapon damage.
 * Answers built on it must say so. Edit the weights as Forever's class design is confirmed and bump
 * GEAR_SCORE_VERSION so answers say which weights they used.
 */
import { CLASS_ROLES, rolesFromStats } from './classRules.js';
import type { ClassToken, Role } from './classRules.js';

export const GEAR_SCORE_VERSION = '2026-10-07.1';

/** Stat key (GetItemStats, `ITEM_MOD_` and `_SHORT` stripped) → points per role. Unlisted stats count 0. */
export const ROLE_WEIGHTS: Record<Role, Record<string, number>> = {
  tank: {
    STAMINA: 1,
    STRENGTH: 0.5,
    AGILITY: 0.6,
    DEFENSE_SKILL_RATING: 1.5,
    DODGE_RATING: 1.5,
    PARRY_RATING: 1.2,
    BLOCK_RATING: 1,
    BLOCK_VALUE: 0.3,
    HIT_RATING: 0.5,
    ATTACK_POWER: 0.2,
    RESISTANCE0_NAME: 0.05,
    DAMAGE_PER_SECOND: 1,
  },
  healer: {
    INTELLECT: 1,
    SPIRIT: 0.8,
    SPELL_HEALING_DONE: 0.6,
    SPELL_POWER: 0.6,
    MANA_REGENERATION: 2,
    SPELL_CRIT_RATING: 0.6,
    STAMINA: 0.3,
    RESISTANCE0_NAME: 0.01,
  },
  caster: {
    INTELLECT: 0.8,
    SPIRIT: 0.3,
    SPELL_POWER: 1,
    SPELL_DAMAGE_DONE: 1,
    SPELL_CRIT_RATING: 0.9,
    SPELL_HIT_RATING: 1,
    CRIT_RATING: 0.8,
    HIT_RATING: 1,
    SPELL_PENETRATION: 0.3,
    STAMINA: 0.3,
    RESISTANCE0_NAME: 0.01,
  },
  melee: {
    STRENGTH: 1,
    AGILITY: 1,
    ATTACK_POWER: 0.5,
    CRIT_RATING: 1,
    CRIT_MELEE_RATING: 1,
    HIT_RATING: 1,
    HIT_MELEE_RATING: 1,
    EXPERTISE_RATING: 1,
    STAMINA: 0.3,
    RESISTANCE0_NAME: 0.02,
    DAMAGE_PER_SECOND: 3,
  },
  ranged: {
    AGILITY: 1,
    RANGED_ATTACK_POWER: 0.5,
    ATTACK_POWER: 0.4,
    CRIT_RATING: 1,
    CRIT_RANGED_RATING: 1,
    HIT_RATING: 1,
    HIT_RANGED_RATING: 1,
    INTELLECT: 0.2,
    STAMINA: 0.3,
    RESISTANCE0_NAME: 0.02,
    DAMAGE_PER_SECOND: 3,
  },
};

const statName = (key: string) => key.replace(/^ITEM_MOD_/, '').replace(/_SHORT$/, '');

/** An item's points for a role (one decimal). Elemental "damage done" counts as spell damage. */
export function gearScore(stats: Record<string, number> | undefined, role: Role): number {
  const weights = ROLE_WEIGHTS[role];
  let total = 0;
  for (const [key, value] of Object.entries(stats ?? {})) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    let name = statName(key);
    if (/^(FIRE|FROST|NATURE|SHADOW|ARCANE|HOLY)_DAMAGE_DONE$/.test(name))
      name = 'SPELL_DAMAGE_DONE';
    total += (weights[name] ?? 0) * value;
  }
  return Math.round(total * 10) / 10;
}

/**
 * The role a character most likely plays, from the stats on everything it wears: the class's role the worn stats
 * point to most, else the class's first role. `guessed` is always true: answers must say so.
 */
export function guessRole(
  cls: ClassToken,
  worn: (Record<string, number> | undefined)[],
): { role: Role; guessed: true; basis: 'gear' | 'class default' } {
  const sum: Record<string, number> = {};
  for (const stats of worn) {
    for (const [k, v] of Object.entries(stats ?? {})) {
      if (typeof v === 'number' && Number.isFinite(v)) sum[k] = (sum[k] ?? 0) + v;
    }
  }
  const classRoles = CLASS_ROLES[cls];
  const fit = rolesFromStats({ stats: sum })
    .filter((r) => classRoles.includes(r.role))
    .sort((a, b) => b.confidence - a.confidence)[0];
  return fit
    ? { role: fit.role, guessed: true, basis: 'gear' }
    : { role: classRoles[0]!, guessed: true, basis: 'class default' };
}

/** Inventory slots per equip location (INVTYPE_*): the slots an item of that kind can go in. */
export const SLOTS_FOR_EQUIP_LOC: Record<string, number[]> = {
  INVTYPE_HEAD: [1],
  INVTYPE_NECK: [2],
  INVTYPE_SHOULDER: [3],
  INVTYPE_BODY: [4],
  INVTYPE_CHEST: [5],
  INVTYPE_ROBE: [5],
  INVTYPE_WAIST: [6],
  INVTYPE_LEGS: [7],
  INVTYPE_FEET: [8],
  INVTYPE_WRIST: [9],
  INVTYPE_HAND: [10],
  INVTYPE_FINGER: [11, 12],
  INVTYPE_TRINKET: [13, 14],
  INVTYPE_CLOAK: [15],
  INVTYPE_WEAPON: [16, 17],
  INVTYPE_2HWEAPON: [16],
  INVTYPE_WEAPONMAINHAND: [16],
  INVTYPE_WEAPONOFFHAND: [17],
  INVTYPE_SHIELD: [17],
  INVTYPE_HOLDABLE: [17],
  INVTYPE_RANGED: [18],
  INVTYPE_RANGEDRIGHT: [18],
  INVTYPE_THROWN: [18],
  INVTYPE_RELIC: [18],
  INVTYPE_TABARD: [19],
};

export const SLOT_NAMES: Record<number, string> = {
  1: 'Head',
  2: 'Neck',
  3: 'Shoulder',
  4: 'Shirt',
  5: 'Chest',
  6: 'Waist',
  7: 'Legs',
  8: 'Feet',
  9: 'Wrist',
  10: 'Hands',
  11: 'Finger 1',
  12: 'Finger 2',
  13: 'Trinket 1',
  14: 'Trinket 2',
  15: 'Back',
  16: 'Main Hand',
  17: 'Off Hand',
  18: 'Ranged / Relic',
  19: 'Tabard',
};

/** Classic dual wield: the level each class learns it (rogues from the start; shamans only from TBC, so never). */
export const DUAL_WIELD_FROM: Partial<Record<ClassToken, number>> = {
  ROGUE: 1,
  WARRIOR: 20,
  HUNTER: 20,
};

/** Whether a class can hold a weapon in the off hand at a level. */
export const canDualWield = (cls: ClassToken, level: number) =>
  level >= (DUAL_WIELD_FROM[cls] ?? Number.POSITIVE_INFINITY);
