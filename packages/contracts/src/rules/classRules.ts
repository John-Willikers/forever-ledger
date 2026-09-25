/**
 * Which classes and roles want which rewards. Applied at query time only; the addon never stores it.
 *
 * Forever (Interface 16001, probe of build 70009) has no usable spec data: every class exposes one placeholder spec
 * (role DAMAGER, primaryStat 4 for all), `C_Item.GetItemSpecInfo` is nil or empty for every item and
 * `C_Item.DoesItemContainSpec` answers true for every class on every equippable item. So the fit is estimated from
 * the item's stats, subtype and slot (`rolesFromStats`) and the class list from Classic proficiency (`canEquip`).
 * Edit this file as Forever's class design is confirmed and bump RULES_VERSION so query results say which rules
 * they used. Subtype strings are the enUS values GetItemInfo returns.
 */
export const RULES_VERSION = '2026-09-25.2';

export type ClassToken =
  'WARRIOR' | 'PALADIN' | 'HUNTER' | 'ROGUE' | 'PRIEST' | 'SHAMAN' | 'MAGE' | 'WARLOCK' | 'DRUID';

export type Stat = 'STR' | 'AGI' | 'INT' | 'SPI' | 'STA';
export type ArmorType = 'Cloth' | 'Leather' | 'Mail' | 'Plate';

export interface ClassRule {
  /** Best armor type by minimum level, highest level first; the last entry is the tier worn from level 1. */
  armor: { fromLevel: number; type: ArmorType }[];
  shields: boolean;
  weapons: string[];
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
  },
  PRIEST: {
    armor: [{ fromLevel: 1, type: 'Cloth' }],
    shields: false,
    weapons: ['One-Handed Maces', 'Staves', 'Daggers', 'Wands'],
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
  },
  MAGE: {
    armor: [{ fromLevel: 1, type: 'Cloth' }],
    shields: false,
    weapons: ['One-Handed Swords', 'Staves', 'Daggers', 'Wands'],
  },
  WARLOCK: {
    armor: [{ fromLevel: 1, type: 'Cloth' }],
    shields: false,
    weapons: ['One-Handed Swords', 'Staves', 'Daggers', 'Wands'],
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
  },
};

/** GetItemStats keys → primary stat. */
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

/** Weapon subtypes every class can hold. */
const WEAPONS_ANY_CLASS = new Set(['Fishing Pole', 'Miscellaneous']);

/** Relic slots are one class each. */
const RELIC_CLASS: Record<string, ClassToken> = {
  Idols: 'DRUID',
  Librams: 'PALADIN',
  Totems: 'SHAMAN',
};

/** The best armor type a class can wear at a level; below every `fromLevel` it is the class's lowest tier. */
function bestArmorAt(rule: ClassRule, level: number): ArmorType {
  return (rule.armor.find((a) => level >= a.fromLevel) ?? rule.armor[rule.armor.length - 1]!).type;
}

function armorAllowed(rule: ClassRule, level: number): ArmorType[] {
  return ALL_ARMOR_BELOW[bestArmorAt(rule, level)];
}

/** Whether a class can equip the item at a level (proficiency only, not required level). */
export function canEquip(cls: ClassToken, item: ItemForRules, level = 1): boolean {
  const rule = CLASS_RULES[cls];
  const subtype = item.subtype ?? '';
  if (item.type === 'Weapon')
    return WEAPONS_ANY_CLASS.has(subtype) || rule.weapons.includes(subtype);
  if (item.type === 'Armor') {
    if (item.equipLoc && ARMOR_SLOTS_ANY_CLASS.has(item.equipLoc)) return true;
    if (subtype === 'Shields') return rule.shields;
    if (subtype === 'Miscellaneous') return true;
    if (RELIC_CLASS[subtype]) return RELIC_CLASS[subtype] === cls;
    return (armorAllowed(rule, level) as string[]).includes(subtype);
  }
  return false;
}

export type Role = 'tank' | 'healer' | 'caster' | 'melee' | 'ranged';
const ROLES: Role[] = ['tank', 'healer', 'caster', 'melee', 'ranged'];

export interface RoleFit {
  role: Role;
  /** Share of the item's role signal (0..1, two decimals); the roles sum to about 1. */
  confidence: number;
}

export interface ClassFit {
  cls: ClassToken;
  /** Proficiency at `atLevel`. */
  canEquip: boolean;
  /** One of the class's roles is a role the item scored (always true when the item has no role signal). */
  wants: boolean;
  /** When `canEquip` is false: the level the class gains the proficiency (Hunter/Shaman Mail at 40). */
  fromLevel?: number;
  /** True when the item is the class's best armor type at `atLevel` (Mail for a level-20 Warrior). */
  bestArmor: boolean;
}

export interface ItemFit {
  rulesVersion: string;
  /** The level the class list was evaluated at: the item's required level, or 1 when it has none. */
  atLevel: number;
  roles: RoleFit[];
  /** Classes that can equip the item now or later, in class order. */
  classes: ClassFit[];
}

/** The roles each Classic class can play; a class wants an item when one of them is a role the item scored. */
export const CLASS_ROLES: Record<ClassToken, Role[]> = {
  WARRIOR: ['melee', 'tank'],
  PALADIN: ['tank', 'healer', 'melee'],
  HUNTER: ['ranged'],
  ROGUE: ['melee'],
  PRIEST: ['healer', 'caster'],
  SHAMAN: ['healer', 'caster', 'melee'],
  MAGE: ['caster'],
  WARLOCK: ['caster'],
  DRUID: ['tank', 'healer', 'caster', 'melee'],
};

type Weights = Partial<Record<Role, number>>;

/** Primary stats: weight per point share of STR+AGI+INT+SPI. Stamina says nothing about who wants an item. */
const PRIMARY: Partial<Record<Stat, Weights>> = {
  STR: { melee: 1, tank: 0.6 },
  AGI: { ranged: 1, melee: 0.8, tank: 0.3 },
  INT: { caster: 1, healer: 1 },
  SPI: { healer: 1, caster: 0.5 },
};

/** Secondary stats by presence (`ITEM_MOD_` and `_SHORT` stripped); one unit each. */
const SECONDARY: Record<string, Weights> = {
  SPELL_POWER: { caster: 1, healer: 0.7 },
  SPELL_PENETRATION: { caster: 1 },
  SPELL_HEALING_DONE: { healer: 1 },
  MANA_REGENERATION: { healer: 1 },
  ATTACK_POWER: { melee: 1, ranged: 0.7, tank: 0.3 },
  PHYSICAL_DAMAGE_DONE: { melee: 1, ranged: 0.7, tank: 0.3 },
  EXPERTISE_RATING: { melee: 1, ranged: 0.7, tank: 0.3 },
  RANGED_ATTACK_POWER: { ranged: 1 },
  // generic crit and hit fit every damage role: they amplify roles the item already has (see AMBIGUOUS)
  CRIT_RATING: { melee: 0.5, ranged: 0.5, caster: 0.5 },
  HIT_RATING: { melee: 0.5, ranged: 0.5, caster: 0.5 },
  DEFENSE_SKILL_RATING: { tank: 1 },
  DODGE_RATING: { tank: 1 },
  PARRY_RATING: { tank: 1 },
  BLOCK_RATING: { tank: 1 },
  BLOCK_VALUE: { tank: 1 },
};

/** Secondary stats that don't say which role: they never keep the weapon subtype from deciding. */
const AMBIGUOUS = new Set(['CRIT_RATING', 'HIT_RATING']);

/** A wearer wants an item only for roles with at least this share; a stray point of Strength is not a melee item. */
const WANT_MIN_SHARE = 0.15;

/** Shields are tank items unless their stats say healer or caster; physical stats only pick the tank flavour. */
const SHIELD_TANK = 1.5;

/** Weapon subtypes say who swings them; applied only when the stats say nothing (every weapon has DPS). */
const WEAPON_TYPE: Record<string, Weights> = {
  Bows: { ranged: 1 },
  Crossbows: { ranged: 1 },
  Guns: { ranged: 1 },
  Thrown: { ranged: 1 },
  Wands: { caster: 1 },
  Staves: { caster: 0.6, melee: 0.4 },
  Polearms: { melee: 1 },
  'Two-Handed Axes': { melee: 1 },
  'Two-Handed Maces': { melee: 1 },
  'Two-Handed Swords': { melee: 1 },
  'One-Handed Axes': { melee: 1, tank: 0.5 },
  'One-Handed Maces': { melee: 1, tank: 0.5 },
  'One-Handed Swords': { melee: 1, tank: 0.5 },
  Daggers: { melee: 1, tank: 0.5 },
  'Fist Weapons': { melee: 1, tank: 0.5 },
};

function add(total: Weights, w: Weights, scale = 1) {
  for (const [role, v] of Object.entries(w) as [Role, number][])
    total[role] = (total[role] ?? 0) + v * scale;
}

/**
 * Which roles an item serves, from its primary stats (by share), secondary stats (by presence) and subtype.
 * Empty when nothing on the item says anything (plain armor, resistances, profession mods).
 */
export function rolesFromStats(item: ItemForRules): RoleFit[] {
  return analyzeStats(item).roles;
}

/** `roles`, plus whether any came from the item's stats (a subtype alone says nothing about class preference). */
function analyzeStats(item: ItemForRules): { roles: RoleFit[]; fromStats: boolean } {
  const stats = item.stats ?? {};
  const total: Weights = {};
  const primary: Partial<Record<Stat, number>> = {};
  let primarySum = 0;
  for (const [key, value] of Object.entries(stats)) {
    const stat = STAT_KEYS[key];
    if (stat && PRIMARY[stat] && value > 0) {
      primary[stat] = (primary[stat] ?? 0) + value;
      primarySum += value;
    }
  }
  for (const [stat, value] of Object.entries(primary) as [Stat, number][])
    add(total, PRIMARY[stat]!, value / primarySum);

  const healing = stats.ITEM_MOD_SPELL_HEALING_DONE_SHORT ?? 0;
  let secondarySignal = false;
  const nudges: Weights[] = [];
  for (const [key, value] of Object.entries(stats)) {
    if (!(value > 0)) continue;
    const name = key.replace(/^ITEM_MOD_/, '').replace(/_SHORT$/, '');
    let w: Weights | undefined = SECONDARY[name];
    const school = /^(SPELL|FIRE|FROST|NATURE|SHADOW|ARCANE|HOLY)_DAMAGE_DONE$/.exec(name)?.[1];
    const rating = /^(CRIT|HIT)_(MELEE|RANGED|SPELL)_RATING$/.exec(name)?.[2];
    if (school) {
      // "+N damage and healing" items list both; when healing is the larger, damage is the side effect.
      w = { caster: healing > value ? 0.5 : 1 };
      if (school === 'HOLY' || school === 'NATURE') w.healer = 0.5;
    } else if (rating) {
      w =
        rating === 'SPELL'
          ? { caster: 1, healer: 0.5 }
          : rating === 'RANGED'
            ? { ranged: 1 }
            : { melee: 1 };
    } else if (name.startsWith('ATTACK_POWER_VS_')) w = SECONDARY.ATTACK_POWER;
    if (!w) continue;
    if (AMBIGUOUS.has(name)) nudges.push(w);
    else {
      add(total, w);
      secondarySignal = true;
    }
  }

  const subtype = item.subtype ?? '';
  const silent = primarySum === 0 && !secondarySignal;
  if (item.type === 'Weapon' && WEAPON_TYPE[subtype] && silent) add(total, WEAPON_TYPE[subtype]);
  if (item.type === 'Armor' && subtype === 'Shields' && !total.healer && !total.caster)
    add(total, { tank: SHIELD_TANK });

  // Generic crit/hit amplify the roles the item already has; only on an otherwise silent item do they add roles,
  // and only then do they count as the item's stats saying something about who wants it.
  const present = new Set(Object.keys(total) as Role[]);
  for (const w of nudges) {
    if (present.size === 0) add(total, w);
    else for (const role of present) if (w[role]) total[role] = (total[role] ?? 0) + w[role]!;
  }
  const nudgesAddedRoles = nudges.length > 0 && present.size === 0;

  return { roles: shares(total), fromStats: primarySum > 0 || secondarySignal || nudgesAddedRoles };
}

/** Normalises role weights to two-decimal shares, highest first; empty when nothing scored. */
function shares(total: Weights): RoleFit[] {
  const sum = Object.values(total).reduce((a, b) => a + b, 0);
  if (sum <= 0) return [];
  return ROLES.map((role) => ({
    role,
    confidence: Math.round(((total[role] ?? 0) / sum) * 100 + 1e-9) / 100,
  }))
    .filter((r) => r.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence || ROLES.indexOf(a.role) - ROLES.indexOf(b.role));
}

/** Cloth/Leather/Mail/Plate in a class-restricted slot: cloaks, trinkets, shields and relics have no "best" tier. */
const tieredArmor = (item: ItemForRules) =>
  item.type === 'Armor' &&
  !(item.equipLoc && ARMOR_SLOTS_ANY_CLASS.has(item.equipLoc)) &&
  (Object.keys(ALL_ARMOR_BELOW) as string[]).includes(item.subtype ?? '');

/** Highest level any Classic proficiency unlocks at. */
const MAX_LEVEL = 60;

/**
 * Every class that can equip the item at `level` or later, with the level it becomes wearable and whether one of
 * the class's roles is in `wantedRoles`. Pass no roles when the item's stats say nothing: every wearer wants it.
 */
export function classFits(item: ItemForRules, level: number, wantedRoles: Role[]): ClassFit[] {
  const wanted = new Set(wantedRoles);
  const out: ClassFit[] = [];
  for (const cls of Object.keys(CLASS_RULES) as ClassToken[]) {
    const rule = CLASS_RULES[cls];
    const now = canEquip(cls, item, level);
    if (!now && !canEquip(cls, item, MAX_LEVEL)) continue;
    const fit: ClassFit = {
      cls,
      canEquip: now,
      bestArmor: tieredArmor(item) && item.subtype === bestArmorAt(rule, level),
      wants: wanted.size === 0 || CLASS_ROLES[cls].some((role) => wanted.has(role)),
    };
    if (!now) {
      const unlock = rule.armor
        .filter(
          (a) =>
            a.fromLevel > level &&
            (ALL_ARMOR_BELOW[a.type] as string[]).includes(item.subtype ?? ''),
        )
        .map((a) => a.fromLevel);
      if (unlock.length) fit.fromLevel = Math.min(...unlock);
    }
    out.push(fit);
  }
  // Nobody else can use it (relics, class-locked gear): the one class wants it whatever the stats say.
  if (out.length === 1) out[0]!.wants = true;
  return out;
}

/**
 * Role fit plus the class list for one item snapshot. A required level of 0 or null means the item has no level
 * gate, so the class list is evaluated at level 1 and `fromLevel` says when the others catch up.
 */
export function itemFit(item: ItemForRules & { reqLevel?: number | null | undefined }): ItemFit {
  const atLevel = item.reqLevel && item.reqLevel > 0 ? item.reqLevel : 1;
  const { roles, fromStats } = analyzeStats(item);
  const wanted = fromStats
    ? roles.filter((r) => r.confidence >= WANT_MIN_SHARE).map((r) => r.role)
    : [];
  return { rulesVersion: RULES_VERSION, atLevel, roles, classes: classFits(item, atLevel, wanted) };
}
