import { describe, expect, it } from 'vitest';
import {
  charLevelText,
  descriptionLines,
  itemHref,
  makerRank,
  qtyText,
  recipeHref,
  recipeParam,
  skillRankText,
  sourceHint,
  tooltipColumns,
  useLevelText,
} from './recipeLib';

describe('links', () => {
  it('points recipes at the Professions page and items at the Item page', () => {
    expect(recipeHref(3000)).toBe('/professions?recipe=3000');
    expect(itemHref(9001)).toBe('/items/9001');
  });

  it('reads ?recipe= as a positive int4 id, else null', () => {
    const p = (q: string) => recipeParam(new URLSearchParams(q));
    expect(p('recipe=3000')).toBe(3000);
    expect(p('recipe=2147483647')).toBe(2147483647);
    for (const bad of ['', 'recipe=', 'recipe=0', 'recipe=-1', 'recipe=1.5', 'recipe=abc'])
      expect(p(bad), bad).toBeNull();
    expect(p('recipe=2147483648')).toBeNull();
  });
});

describe('tooltip lines', () => {
  it('splits a line at its tab into the left and right columns', () => {
    expect(tooltipColumns('Wrist\tMail')).toEqual(['Wrist', 'Mail']);
    expect(tooltipColumns('2 - 32 Damage\tSpeed 2.00')).toEqual(['2 - 32 Damage', 'Speed 2.00']);
    expect(tooltipColumns('35 Armor')).toEqual(['35 Armor', null]);
    expect(tooltipColumns('a\tb\tc')).toEqual(['a', 'b c']);
  });

  it("describes a recipe by its output's tooltip (name line dropped), else its recipe item's", () => {
    expect(
      descriptionLines(
        { name: 'Copper Bracers', tooltip: ['Copper Bracers', 'Wrist\tMail', '35 Armor'] },
        [],
      ),
    ).toEqual({ from: 'output', lines: ['Wrist\tMail', '35 Armor'] });
    expect(
      descriptionLines({ name: 'Runecloth Bag', tooltip: [] }, [
        { name: 'Pattern: X', tooltip: [] },
        {
          name: 'Formula: Enchant Weapon - Insight',
          tooltip: [
            'Formula: Enchant Weapon - Insight',
            'Use: Teaches you how to enchant a weapon.',
            'Requires Enchanting (140)',
          ],
        },
      ]),
    ).toEqual({
      from: 'recipeItem',
      lines: ['Use: Teaches you how to enchant a weapon.', 'Requires Enchanting (140)'],
    });
    expect(descriptionLines(null, [])).toEqual({ from: null, lines: [] });
  });
});

describe('requirement texts', () => {
  const trainer = { source: 'trainer' as const, npcId: 5001, npcName: 'Gnome Engineer' };
  const item = { source: 'recipeItem' as const, itemId: 1, itemName: 'Schematic: Bombs' };

  it('says the skill rank to learn it and where that came from', () => {
    expect(skillRankText({ rank: 230, ...trainer }, 'Engineering')).toBe(
      'Learn at Engineering 230',
    );
    expect(skillRankText({ rank: 0, ...trainer }, 'Cooking')).toBe('Learn at any Cooking rank');
    expect(skillRankText({ rank: 80, ...item }, null)).toBe('Learn at skill rank 80');
    expect(skillRankText(null, 'Cooking')).toBe('Skill rank to learn it not seen yet');
    expect(sourceHint(trainer)).toBe('trainer Gnome Engineer');
    expect(sourceHint({ ...trainer, npcName: null })).toBe('trainer NPC 5001');
    expect(sourceHint(item)).toBe('recipe item Schematic: Bombs');
    expect(sourceHint({ ...item, itemName: null })).toBe('recipe item Item 1');
  });

  it('says the character level and the level to use the output', () => {
    expect(charLevelText({ level: 45, ...item })).toBe('Character level 45');
    expect(charLevelText(null)).toBe('No character level required (none seen)');
    expect(useLevelText({ level: 41, source: 'reqLevel' })).toBe('Requires Level 41 to use');
    expect(useLevelText(null)).toBeNull();
  });

  it('quantities and maker ranks', () => {
    expect(qtyText(1, 1)).toBe('');
    expect(qtyText(null, null)).toBe('');
    expect(qtyText(2, 2)).toBe('×2');
    expect(qtyText(1, 3)).toBe('×1–3');
    expect(qtyText(5, null)).toBe('×5');
    expect(
      makerRank({ profession: { skillLineId: 202, name: 'Engineering' }, skillRank: 230 }),
    ).toBe('Engineering 230');
    expect(
      makerRank({ profession: { skillLineId: 202, name: 'Engineering' }, skillRank: null }),
    ).toBe('Engineering');
    expect(makerRank({ profession: null, skillRank: 50 })).toBe('rank 50');
    expect(makerRank({ profession: null, skillRank: null })).toBe('');
  });
});
