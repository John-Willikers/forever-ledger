import { describe, expect, it } from 'vitest';
import { formatLocation, listPath, npcMapPoint, skillReq, stockLabel, unitPrice } from './lib';

describe('vendors & trainers helpers', () => {
  it('formats a location as zone · subzone (x, y)', () => {
    expect(
      formatLocation({
        zone: 'Elwynn Forest',
        subzone: 'Goldshire',
        mapId: 1429,
        x: 42.1,
        y: 65.9,
      }),
    ).toBe('Elwynn Forest · Goldshire (42.1, 65.9)');
    expect(formatLocation({ zone: 'Durotar', subzone: null, mapId: 1, x: 50, y: 70 })).toBe(
      'Durotar (50.0, 70.0)',
    );
    expect(formatLocation({ zone: null, subzone: null, mapId: 7, x: null, y: null })).toBe('Map 7');
    expect(formatLocation(null)).toBe('—');
  });

  it('names a skill requirement and stock', () => {
    expect(skillReq('Tailoring', 10)).toBe('Tailoring 10');
    expect(skillReq(null, 10)).toBe('Rank 10');
    expect(skillReq('Tailoring', 0)).toBe('Tailoring');
    expect(skillReq(null, null)).toBe('—');
    expect(stockLabel(-1)).toBe('unlimited');
    expect(stockLabel(3)).toBe('3');
    expect(stockLabel(null)).toBe('—');
  });

  it('prices one item of a stack', () => {
    expect(unitPrice(10, 5)).toBe(2);
    expect(unitPrice(10, 0)).toBe(10);
    expect(unitPrice(10, null)).toBe(10);
    expect(unitPrice(null, 5)).toBeNull();
  });

  it('builds the list query from the filters, leaving defaults out', () => {
    expect(listPath('vendors', { search: '', title: '', foreverOnly: false })).toBe(
      '/admin/api/vendors?limit=500',
    );
    expect(
      listPath('trainers', { search: ' bolero & co ', title: 'Tailoring', foreverOnly: true }),
    ).toBe('/admin/api/trainers?limit=500&search=bolero+%26+co&title=Tailoring&foreverOnly=true');
  });
});

describe('npcMapPoint', () => {
  it('places an NPC on its uiMapID, or nothing without a map id and coordinates', () => {
    const loc = { zone: 'Durotar', subzone: null, mapId: 1411, x: 43.2, y: 68.5 };
    expect(npcMapPoint(loc, 'vendor', 'Duokna')).toEqual({
      uiMapId: 1411,
      point: { x: 43.2, y: 68.5, kind: 'vendor', label: 'Duokna' },
    });
    expect(npcMapPoint({ ...loc, mapId: null }, 'trainer', 'T')).toBeNull();
    expect(npcMapPoint({ ...loc, x: null }, 'trainer', 'T')).toBeNull();
    expect(npcMapPoint(null, 'trainer', 'T')).toBeNull();
  });
});
