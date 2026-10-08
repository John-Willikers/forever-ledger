import { describe, expect, it } from 'vitest';
import { charName, guideRequest, stepDo, stepPlace } from './lib';

const form = {
  character: 'Sam Willikers',
  start: 'undead',
  basedOn: '',
  toLevel: '13',
  fromLevel: '',
};

describe('guides page helpers', () => {
  it('builds the request, or says what is missing', () => {
    expect(guideRequest(form)).toEqual({
      ok: true,
      body: { character: 'Sam Willikers', start: 'undead', toLevel: 13 },
    });
    expect(guideRequest({ ...form, character: ' ' })).toMatchObject({ ok: false });
    // A character with stored state gets a planned guide: no start needed (the server says when one is).
    expect(guideRequest({ ...form, start: '' })).toEqual({
      ok: true,
      body: { character: 'Sam Willikers', toLevel: 13 },
    });
    expect(guideRequest({ ...form, start: '', basedOn: 'Timbo' })).toMatchObject({
      ok: true,
      body: { basedOn: 'Timbo' },
    });
    expect(guideRequest({ ...form, toLevel: '1' })).toMatchObject({ ok: false });
    expect(guideRequest({ ...form, fromLevel: '20' })).toMatchObject({ ok: false });
    expect(guideRequest({ ...form, fromLevel: '5' })).toMatchObject({
      ok: true,
      body: { fromLevel: 5 },
    });
  });

  it('describes a step place and a character', () => {
    expect(
      stepPlace({
        action: 'accept',
        npc: 'Undertaker Mordo',
        zone: 'Tirisfal Glades',
        subzone: 'Deathknell',
        mapId: 1420,
        x: 30.2,
        y: 71.6,
        quests: [],
      }),
    ).toBe('Undertaker Mordo · Deathknell · Tirisfal Glades (30.2, 71.6)');
    expect(charName('Sam Willikers-Classic Beta PvE')).toBe('Sam Willikers');
  });

  it('says what a step does, travel included', () => {
    const base = {
      npc: null,
      zone: null,
      subzone: null,
      mapId: null,
      x: null,
      y: null,
      quests: [],
    };
    expect(stepDo({ ...base, action: 'turn_in', levelAfter: 12 })).toBe('Turn in → 12');
    expect(stepDo({ ...base, action: 'travel', how: 'fly', note: 'Orgrimmar → Crossroads' })).toBe(
      'Fly (Orgrimmar → Crossroads)',
    );
    expect(stepDo({ ...base, action: 'travel', how: 'boat' })).toBe('Take the boat');
    expect(stepDo({ ...base, action: 'travel', how: 'hearth' })).toBe('Hearth');
    expect(stepDo({ ...base, action: 'travel' })).toBe('Travel');
    expect(stepDo({ ...base, action: 'accept', note: 'class quest' })).toBe('Accept (class quest)');
  });
});
