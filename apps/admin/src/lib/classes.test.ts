import { describe, expect, it } from 'vitest';
import { classColor, classLabel, textOn } from './classes';

describe('class colors', () => {
  it('maps class file names, case-insensitively', () => {
    expect(classColor('HUNTER')).toBe('#AAD372');
    expect(classColor('druid')).toBe('#FF7C0A');
    expect(classColor('Death Knight')).toBe('#C41E3A');
  });

  it('falls back to a neutral gray', () => {
    expect(classColor(null)).toBe('#9AA4B2');
    expect(classColor('BARD')).toBe('#9AA4B2');
  });

  it('labels classes for humans', () => {
    expect(classLabel('HUNTER')).toBe('Hunter');
    expect(classLabel('DEATHKNIGHT')).toBe('Death Knight');
    expect(classLabel('DEMONHUNTER')).toBe('Demon Hunter');
    expect(classLabel(undefined)).toBe('Unknown class');
  });

  it('picks readable text on each class color', () => {
    expect(textOn('#FFFFFF')).toBe('#000000'); // priest
    expect(textOn('#FFF468')).toBe('#000000'); // rogue
    expect(textOn('#0070DD')).toBe('#FFFFFF'); // shaman
    expect(textOn('#C41E3A')).toBe('#FFFFFF'); // death knight
    expect(textOn('nonsense')).toBe('#000000');
  });
});
