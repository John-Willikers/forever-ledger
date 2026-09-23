/**
 * Which classes/specs want which rewards. Applied at query time only; the addon never stores it.
 *
 * Starting point is Classic-era itemization (Forever's Interface is 11507). Edit this file as Forever's class
 * design is confirmed and bump RULES_VERSION so query results can say which rules they used.
 * Subtype strings are the enUS values GetItemInfo returns.
 */
export const RULES_VERSION = '2026-09-23.1';

export type ClassToken =
  'WARRIOR' | 'PALADIN' | 'HUNTER' | 'ROGUE' | 'PRIEST' | 'SHAMAN' | 'MAGE' | 'WARLOCK' | 'DRUID';

export type Stat = 'STR' | 'AGI' | 'INT' | 'SPI' | 'STA';
export type ArmorType = 'Cloth' | 'Leather' | 'Mail' | 'Plate';

export interface SpecRule {
  spec: string;
  role: 'tank' | 'healer' | 'melee' | 'ranged' | 'caster';
  /** Stats in priority order; the first is the primary stat. */
  stats: Stat[];
}

export interface ClassRule {
  /** Best armor type by minimum level, highest level first wins. */
  armor: { fromLevel: number; type: ArmorType }[];
  shields: boolean;
  weapons: string[];
  specs: SpecRule[];
}

const ALL_ARMOR_BELOW: Record<ArmorType, ArmorType[]> = {
  Cloth: ['Cloth'],
  Leather: ['Cloth', 'Leather'],
  Mail: ['Cloth', 'Leather', 'Mail'],
  Plate: ['Cloth', 'Leather', 'Mail', 'Plate'],
};

export const CLASS_RULES: Record<ClassToken, ClassRule> = {
  WARRIOR: {
    armor: [
      { fromLevel: 40, type: 'Plate' },
      { fromLevel: 1, type: 'Mail' },
    ],
    shields: true,
    weapons: [
      'One-Handed Axes',
      'Two-Handed Axes',
      'One-Handed Maces',
      'Two-Handed Maces',
      'One-Handed Swords',
      'Two-Handed Swords',
      'Polearms',
      'Staves',
      'Daggers',
      'Fist Weapons',
      'Bows',
      'Crossbows',
      'Guns',
      'Thrown',
    ],
    specs: [
      { spec: 'Arms', role: 'melee', stats: ['STR', 'AGI', 'STA'] },
      { spec: 'Fury', role: 'melee', stats: ['STR', 'AGI', 'STA'] },
      { spec: 'Protection', role: 'tank', stats: ['STA', 'STR', 'AGI'] },
    ],
  },
  PALADIN: {
    armor: [
      { fromLevel: 40, type: 'Plate' },
      { fromLevel: 1, type: 'Mail' },
    ],
    shields: true,
    weapons: [
      'One-Handed Axes',
      'Two-Handed Axes',
      'One-Handed Maces',
      'Two-Handed Maces',
      'One-Handed Swords',
      'Two-Handed Swords',
      'Polearms',
    ],
    specs: [
      { spec: 'Holy', role: 'healer', stats: ['INT', 'SPI', 'STA'] },
      { spec: 'Protection', role: 'tank', stats: ['STA', 'STR', 'INT'] },
      { spec: 'Retribution', role: 'melee', stats: ['STR', 'AGI', 'INT'] },
    ],
  },
  HUNTER: {
    armor: [
      { fromLevel: 40, type: 'Mail' },
      { fromLevel: 1, type: 'Leather' },
    ],
    shields: false,
    weapons: [
      'One-Handed Axes',
      'Two-Handed Axes',
      'One-Handed Swords',
      'Two-Handed Swords',
      'Polearms',
      'Staves',
      'Daggers',
      'Fist Weapons',
      'Bows',
      'Crossbows',
      'Guns',
      'Thrown',
    ],
    specs: [
      { spec: 'Beast Mastery', role: 'ranged', stats: ['AGI', 'INT', 'STA'] },
      { spec: 'Marksmanship', role: 'ranged', stats: ['AGI', 'INT', 'STA'] },
      { spec: 'Survival', role: 'ranged', stats: ['AGI', 'STA', 'INT'] },
    ],
  },
  ROGUE: {
    armor: [{ fromLevel: 1, type: 'Leather' }],
    shields: false,
    weapons: [
      'One-Handed Maces',
      'One-Handed Swords',
      'Daggers',
      'Fist Weapons',
      'Bows',
      'Crossbows',
      'Guns',
      'Thrown',
    ],
    specs: [
      { spec: 'Assassination', role: 'melee', stats: ['AGI', 'STR', 'STA'] },
      { spec: 'Combat', role: 'melee', stats: ['AGI', 'STR', 'STA'] },
      { spec: 'Subtlety', role: 'melee', stats: ['AGI', 'STR', 'STA'] },
    ],
  },
  PRIEST: {
    armor: [{ fromLevel: 1, type: 'Cloth' }],
    shields: false,
    weapons: ['One-Handed Maces', 'Staves', 'Daggers', 'Wands'],
    specs: [
      { spec: 'Discipline', role: 'healer', stats: ['INT', 'SPI', 'STA'] },
      { spec: 'Holy', role: 'healer', stats: ['INT', 'SPI', 'STA'] },
      { spec: 'Shadow', role: 'caster', stats: ['INT', 'SPI', 'STA'] },
    ],
  },
  SHAMAN: {
    armor: [
      { fromLevel: 40, type: 'Mail' },
      { fromLevel: 1, type: 'Leather' },
    ],
    shields: true,
    weapons: [
      'One-Handed Axes',
      'Two-Handed Axes',
      'One-Handed Maces',
      'Two-Handed Maces',
      'Staves',
      'Daggers',
      'Fist Weapons',
    ],
    specs: [
      { spec: 'Elemental', role: 'caster', stats: ['INT', 'SPI', 'STA'] },
      { spec: 'Enhancement', role: 'melee', stats: ['STR', 'AGI', 'INT'] },
      { spec: 'Restoration', role: 'healer', stats: ['INT', 'SPI', 'STA'] },
    ],
  },
  MAGE: {
    armor: [{ fromLevel: 1, type: 'Cloth' }],
    shields: false,
    weapons: ['One-Handed Swords', 'Staves', 'Daggers', 'Wands'],
    specs: [
      { spec: 'Arcane', role: 'caster', stats: ['INT', 'SPI', 'STA'] },
      { spec: 'Fire', role: 'caster', stats: ['INT', 'SPI', 'STA'] },
      { spec: 'Frost', role: 'caster', stats: ['INT', 'STA', 'SPI'] },
    ],
  },
  WARLOCK: {
    armor: [{ fromLevel: 1, type: 'Cloth' }],
    shields: false,
    weapons: ['One-Handed Swords', 'Staves', 'Daggers', 'Wands'],
    specs: [
      { spec: 'Affliction', role: 'caster', stats: ['INT', 'STA', 'SPI'] },
      { spec: 'Demonology', role: 'caster', stats: ['STA', 'INT', 'SPI'] },
      { spec: 'Destruction', role: 'caster', stats: ['INT', 'STA', 'SPI'] },
    ],
  },
  DRUID: {
    armor: [{ fromLevel: 1, type: 'Leather' }],
    shields: false,
    weapons: [
      'One-Handed Maces',
      'Two-Handed Maces',
      'Polearms',
      'Staves',
      'Daggers',
      'Fist Weapons',
    ],
    specs: [
      { spec: 'Balance', role: 'caster', stats: ['INT', 'SPI', 'STA'] },
      { spec: 'Feral', role: 'melee', stats: ['AGI', 'STR', 'STA'] },
      { spec: 'Restoration', role: 'healer', stats: ['INT', 'SPI', 'STA'] },
    ],
  },
};

/** GetItemStats keys → stat. */
export const STAT_KEYS: Record<string, Stat> = {
  ITEM_MOD_STRENGTH_SHORT: 'STR',
  ITEM_MOD_AGILITY_SHORT: 'AGI',
  ITEM_MOD_INTELLECT_SHORT: 'INT',
  ITEM_MOD_SPIRIT_SHORT: 'SPI',
  ITEM_MOD_STAMINA_SHORT: 'STA',
};

export interface ItemForRules {
  type?: string | undefined;
  subtype?: string | undefined;
  equipLoc?: string | undefined;
  stats?: Record<string, number> | undefined;
}

const ARMOR_SLOTS_ANY_CLASS = new Set([
  'INVTYPE_CLOAK',
  'INVTYPE_FINGER',
  'INVTYPE_NECK',
  'INVTYPE_TRINKET',
]);

function armorAllowed(rule: ClassRule, level: number): ArmorType[] {
  const best = rule.armor.find((a) => level >= a.fromLevel)?.type ?? 'Cloth';
  return ALL_ARMOR_BELOW[best];
}

/** Whether a class can equip the item at a level (proficiency only, not required level). */
export function canEquip(cls: ClassToken, item: ItemForRules, level = 1): boolean {
  const rule = CLASS_RULES[cls];
  if (item.type === 'Weapon') return rule.weapons.includes(item.subtype ?? '');
  if (item.type === 'Armor') {
    if (item.equipLoc && ARMOR_SLOTS_ANY_CLASS.has(item.equipLoc)) return true;
    if (item.subtype === 'Shields') return rule.shields;
    if (item.subtype === 'Miscellaneous') return true;
    return (armorAllowed(rule, level) as string[]).includes(item.subtype ?? '');
  }
  return false;
}

export interface SpecFit {
  cls: ClassToken;
  spec: string;
  role: SpecRule['role'];
  /** 0..1: how much of the item's stat budget is in stats this spec wants, weighted by priority. */
  score: number;
  /** True when the item is the class's best armor type (e.g. mail for a level-20 warrior). */
  bestArmor: boolean;
}

/**
 * Scores every class/spec that can equip the item. Items with no primary stats get score 0 but are still
 * listed as usable.
 */
export function specsWanting(item: ItemForRules, level = 1): SpecFit[] {
  const statTotals = new Map<Stat, number>();
  for (const [k, v] of Object.entries(item.stats ?? {})) {
    const stat = STAT_KEYS[k];
    if (stat) statTotals.set(stat, (statTotals.get(stat) ?? 0) + v);
  }
  const budget = [...statTotals.values()].reduce((a, b) => a + b, 0);
  const out: SpecFit[] = [];
  for (const cls of Object.keys(CLASS_RULES) as ClassToken[]) {
    if (!canEquip(cls, item, level)) continue;
    const rule = CLASS_RULES[cls];
    const best = rule.armor.find((a) => level >= a.fromLevel)?.type;
    for (const s of rule.specs) {
      let score = 0;
      if (budget > 0) {
        s.stats.forEach((stat, i) => {
          score += ((statTotals.get(stat) ?? 0) / budget) * (1 - i * 0.25);
        });
      }
      out.push({
        cls,
        spec: s.spec,
        role: s.role,
        score: Math.round(score * 1000) / 1000,
        bestArmor: item.type === 'Armor' && item.subtype === best,
      });
    }
  }
  return out.sort((a, b) => b.score - a.score || Number(b.bestArmor) - Number(a.bestArmor));
}
