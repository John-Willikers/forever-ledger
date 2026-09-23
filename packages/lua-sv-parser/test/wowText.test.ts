import { describe, expect, it } from 'vitest';
import { parseItemLink, stripColorCodes } from '../src/index.js';

describe('stripColorCodes', () => {
  it('removes colors, links, textures and unescapes pipes', () => {
    expect(stripColorCodes('|cffffd100Requires Level 12|r')).toBe('Requires Level 12');
    expect(stripColorCodes('|cff1eff00|Hitem:5555::::|h[Boots]|h|r')).toBe('[Boots]');
    expect(stripColorCodes('|cnIQ3:|Hitem:1:::|h[Blue]|h|r')).toBe('[Blue]');
    expect(stripColorCodes('|TInterface\\Icons\\INV_Misc_Coin_01:0|t 5 gold')).toBe(' 5 gold');
    expect(stripColorCodes('Feet || Leather')).toBe('Feet | Leather');
  });
});

describe('parseItemLink', () => {
  it('parses a classic hex-colored link', () => {
    expect(
      parseItemLink("|cff1eff00|Hitem:5555::::::::14:::::::|h[Swampwalker's Boots]|h|r"),
    ).toEqual({
      itemId: 5555,
      name: "Swampwalker's Boots",
      color: 'ff1eff00',
      fields: ['', '', '', '', '', '', '', '14', '', '', '', '', '', '', ''],
    });
  });

  it('parses a named-quality-color link and a bare link', () => {
    expect(parseItemLink('|cnIQ4:|Hitem:19019:0:0|h[Thunderfury]|h|r')).toMatchObject({
      itemId: 19019,
      color: 'IQ4',
      fields: ['0', '0'],
    });
    expect(parseItemLink('|Hitem:42|h[Thing]|h')).toMatchObject({ itemId: 42, color: null });
  });

  it('returns null for text without an item link', () => {
    expect(parseItemLink('|Hquest:123:14|h[A Quest]|h')).toBeNull();
    expect(parseItemLink('plain')).toBeNull();
  });
});
