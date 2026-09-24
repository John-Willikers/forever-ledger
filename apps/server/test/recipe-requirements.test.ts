// Pure helpers behind the recipe detail route: tooltip cleaning, the embedded output block of a recipe item's tooltip,
// requirement parsing and the source precedence.
import { describe, expect, it } from 'vitest';
import {
  cleanTooltip,
  cleanTooltipLine,
  embeddedRange,
  learnRequirements,
  parseCharLevel,
  parseSkillRank,
  recipeNameOf,
  useLevel,
} from '../src/routes/recipeRequirements.js';

// Real Forever tooltips (build 69977): a recipe item embeds the output item's tooltip after a "\n<name>" line, up to
// its "Use: Teaches…" line; the recipe's own requirements come after.
const BOMBS = [
  'Schematic: Satchel of Iron Bombs',
  'Binds when picked up',
  '\nSatchel of Iron Bombs',
  'Binds when picked up',
  'Unique',
  'Thrown\tThrown',
  '2 - 32 Damage\tSpeed 2.00',
  '(8.3 damage per second)',
  '+6 Stamina',
  'Requires Level 41',
  'Requires Engineering (230)',
  'Use: Teaches you how to craft Satchel of Iron Bombs.',
  'Big Iron Bomb (20), Thick Leather (6), Gyrochronatom',
  'Requires Engineering (235)',
  'Sell Price: 10|A:coin-silver:14:14:2:0|a',
];
const SAGEFISH = [
  'Recipe: Smoked Sagefish',
  '\nSmoked Sagefish',
  'Use:  If you spend at least 10 seconds eating you will become well fed. (1 Sec Cooldown)',
  'Requires Level 10',
  'Use: Teaches you how to cook Smoked Sagefish.',
  'Raw Sagefish, Mild Spices',
  'Requires Cooking (80)',
  'Sell Price: 1|A:coin-silver:14:14:2:0|a 25|A:coin-copper:14:14:2:0|a',
];
const INSIGHT = [
  'Formula: Enchant Weapon - Insight',
  'Binds when picked up',
  'Use: Teaches you how to permanently enchant a weapon.',
  'Requires Enchanting (140)',
  'Sell Price: 7|A:coin-silver:14:14:2:0|a',
];

describe('cleanTooltipLine', () => {
  it('turns coin atlases and icons into g/s/c and drops the other escape codes', () => {
    expect(cleanTooltipLine('Sell Price: 17|A:coin-copper:14:14:2:0|a')).toBe('Sell Price: 17c');
    expect(
      cleanTooltipLine(
        'Sell Price: 2|A:coin-gold:14:14:2:0|a 1|A:coin-silver:14:14:2:0|a 25|A:coin-copper:14:14:2:0|a',
      ),
    ).toBe('Sell Price: 2g 1s 25c');
    expect(cleanTooltipLine('5|TInterface\\MoneyFrame\\UI-GoldIcon:0:0:2:0|t')).toBe('5g');
    expect(cleanTooltipLine('|cff1eff00Equip: +7 Strength.|r')).toBe('Equip: +7 Strength.');
    expect(cleanTooltipLine('|cnGREEN_FONT_COLOR:Use: heal|r')).toBe('Use: heal');
    expect(cleanTooltipLine('|Hitem:872::|h[Rockslicer]|h')).toBe('[Rockslicer]');
    expect(cleanTooltipLine('|TInterface\\Icons\\foo:0|t Gold')).toBe('Gold');
    expect(cleanTooltipLine('|A:some-atlas:0:0|a Marked')).toBe('Marked');
    expect(cleanTooltipLine('a || b')).toBe('a | b');
    expect(cleanTooltipLine('one|ntwo')).toBe('one two');
  });

  it('keeps a tab (the left and right columns), trims, leaves markup-looking text alone', () => {
    expect(cleanTooltipLine('Wrist\tMail')).toBe('Wrist\tMail');
    expect(cleanTooltipLine('\nSmoked Sagefish ')).toBe('Smoked Sagefish');
    expect(cleanTooltipLine('<b>not html</b>')).toBe('<b>not html</b>');
  });
});

describe('cleanTooltip', () => {
  it('cleans every string line and drops empty lines and non-strings', () => {
    expect(cleanTooltip(['Copper Bracers', '|cff00ff00|r', 7, null, 'Wrist\tMail'])).toEqual([
      'Copper Bracers',
      'Wrist\tMail',
    ]);
  });
  it('reads anything but an array as no lines', () => {
    expect(cleanTooltip({ 0: 'x' })).toEqual([]);
    expect(cleanTooltip('Requires Level 5')).toEqual([]);
    expect(cleanTooltip(null)).toEqual([]);
  });
});

describe('embeddedRange', () => {
  it('spans the output block: from the "\\n<name>" line to the last "Use:" line', () => {
    expect(embeddedRange(BOMBS)).toEqual([2, 11]);
    // The food's own "Use:" line stays inside; the teach line is the last one.
    expect(embeddedRange(SAGEFISH)).toEqual([1, 4]);
  });
  it('is null without an embedded block; without a closing "Use:" it runs to the end', () => {
    expect(embeddedRange(INSIGHT)).toBeNull();
    expect(
      embeddedRange(['Recipe: X', '\nX', 'Requires Level 5', 'Requires Cooking (50)']),
    ).toEqual([1, 4]);
  });
});

describe('parseSkillRank', () => {
  it("takes the recipe's own line naming the profession, not the output item's", () => {
    expect(parseSkillRank(BOMBS, 'Engineering')).toBe(235);
    expect(parseSkillRank(SAGEFISH, 'Cooking')).toBe(80);
    expect(parseSkillRank(INSIGHT, 'enchanting')).toBe(140);
  });
  it('takes the last "(N)" of the line, and needs the profession named', () => {
    expect(parseSkillRank(['Requires Leatherworking (Tribal) (225)'], 'Leatherworking')).toBe(225);
    expect(parseSkillRank(['Requires Cooking (80)'], 'Tailoring')).toBeNull();
    expect(parseSkillRank(['Requires Cooking (80)'], null)).toBeNull();
    expect(parseSkillRank(['Requires Cooking'], 'Cooking')).toBeNull();
    // A reagent line does not name the profession.
    expect(parseSkillRank(['Linen Cloth (2)'], 'Tailoring')).toBeNull();
  });
  it('reads junk as nothing', () => {
    expect(parseSkillRank('Requires Cooking (80)' as unknown as string[], 'Cooking')).toBeNull();
    expect(parseSkillRank([42, { x: 1 }] as unknown as string[], 'Cooking')).toBeNull();
    expect(parseSkillRank(['Requires Cooking (99999)'], 'Cooking')).toBeNull();
  });
});

describe('parseCharLevel', () => {
  it("ignores the output item's level inside the embedded block", () => {
    expect(parseCharLevel(BOMBS)).toBeNull();
    expect(parseCharLevel(SAGEFISH)).toBeNull();
  });
  it("reads the recipe item's own level line", () => {
    expect(parseCharLevel(['Pattern: X', 'Requires Level 35', 'Use: Teaches you X.'])).toBe(35);
    expect(
      parseCharLevel(['Pattern: X', 'Requires Level 20', '\nX', 'Requires Level 40', 'Use: Teach']),
    ).toBe(20);
    expect(parseCharLevel(['Requires Level'])).toBeNull();
    expect(parseCharLevel(null)).toBeNull();
  });
});

describe('useLevel', () => {
  it('is the snapshot req_level above 1, else the tooltip line, else null', () => {
    expect(useLevel(2, ['Copper Bracers', 'Requires Level 5'])).toEqual({
      level: 2,
      source: 'reqLevel',
    });
    expect(useLevel(0, ['Copper Bracers', 'Requires Level 5'])).toEqual({
      level: 5,
      source: 'tooltip',
    });
    expect(useLevel(1, ['Copper Bracers'])).toBeNull();
    expect(useLevel(null, null)).toBeNull();
  });
});

describe('learnRequirements', () => {
  const trainer = { npcId: 1241, npcName: 'Brombar', skillRank: 25, level: 0 };
  const item = { itemId: 250100, itemName: 'Schematic: Satchel of Iron Bombs', reqLevel: 1 };

  it("prefers the trainer's skill rank to the recipe item's tooltip", () => {
    const r = learnRequirements({
      profession: 'Engineering',
      trainers: [trainer],
      recipeItems: [{ ...item, tooltip: BOMBS }],
    });
    expect(r.skillRank).toEqual({ rank: 25, source: 'trainer', npcId: 1241, npcName: 'Brombar' });
  });

  it('falls back to the recipe item tooltip, then to nothing', () => {
    expect(
      learnRequirements({
        profession: 'Engineering',
        trainers: [{ ...trainer, skillRank: null }],
        recipeItems: [
          { itemId: 1, itemName: null, reqLevel: null, tooltip: [] },
          { ...item, tooltip: BOMBS },
        ],
      }).skillRank,
    ).toEqual({
      rank: 235,
      source: 'recipeItem',
      itemId: 250100,
      itemName: 'Schematic: Satchel of Iron Bombs',
    });
    expect(learnRequirements({ profession: 'Engineering', trainers: [], recipeItems: [] })).toEqual(
      { skillRank: null, charLevel: null },
    );
  });

  it('keeps a trainer rank of 0 (no minimum) as a trainer answer', () => {
    expect(
      learnRequirements({
        profession: 'Cooking',
        trainers: [{ ...trainer, skillRank: 0 }],
        recipeItems: [{ ...item, tooltip: SAGEFISH }],
      }).skillRank,
    ).toMatchObject({ rank: 0, source: 'trainer' });
  });

  it("character level: the recipe item's own line, its req_level above 1, then the trainer's level", () => {
    const own = ['Pattern: X', 'Requires Level 35', 'Use: Teaches you X.'];
    expect(
      learnRequirements({
        profession: 'Tailoring',
        trainers: [{ ...trainer, level: 10 }],
        recipeItems: [{ ...item, tooltip: own }],
      }).charLevel,
    ).toEqual({ level: 35, source: 'recipeItem', itemId: 250100, itemName: item.itemName });
    expect(
      learnRequirements({
        profession: 'Tailoring',
        trainers: [],
        recipeItems: [{ ...item, reqLevel: 30, tooltip: BOMBS }],
      }).charLevel,
    ).toMatchObject({ level: 30, source: 'recipeItem' });
    expect(
      learnRequirements({
        profession: 'Engineering',
        trainers: [{ ...trainer, level: 10 }],
        recipeItems: [{ ...item, tooltip: BOMBS }],
      }).charLevel,
    ).toEqual({ level: 10, source: 'trainer', npcId: 1241, npcName: 'Brombar' });
    // Level 0 at a trainer means no requirement.
    expect(
      learnRequirements({ profession: 'Engineering', trainers: [trainer], recipeItems: [] })
        .charLevel,
    ).toBeNull();
  });
});

describe('recipeNameOf', () => {
  it('strips the "<Prefix>: " of a recipe item name', () => {
    expect(recipeNameOf('Plans: Rough Weightstone')).toBe('Rough Weightstone');
    expect(recipeNameOf('Schematic: Tinker: Teleport')).toBe('Tinker: Teleport');
    expect(recipeNameOf('Formula: Enchant Weapon - Insight')).toBe('Enchant Weapon - Insight');
    expect(recipeNameOf('Rough Stone')).toBeNull();
    expect(recipeNameOf(': x')).toBeNull();
    expect(recipeNameOf(null)).toBeNull();
  });
});
