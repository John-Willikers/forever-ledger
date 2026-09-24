import { describe, expect, it } from 'vitest';
import { UI_MAP_NAMES, uiMapName } from '../src/uiMapNames.js';

describe('uiMapName', () => {
  it('names Classic and Forever beta maps from the build 69977 UiMap table', () => {
    expect(uiMapName(1411)).toBe('Durotar');
    expect(uiMapName(1412)).toBe('Mulgore');
    expect(uiMapName(1414)).toBe('Kalimdor');
    expect(uiMapName(1449)).toBe("Un'Goro Crater");
    expect(uiMapName(2652)).toBe("Shen'dralas");
    expect(Object.keys(UI_MAP_NAMES)).toHaveLength(60);
  });

  it('answers null for maps the table lacks, including prototype keys', () => {
    expect(uiMapName(99999)).toBeNull();
    expect(uiMapName(0)).toBeNull();
    expect(uiMapName(Number('toString'))).toBeNull();
  });
});
