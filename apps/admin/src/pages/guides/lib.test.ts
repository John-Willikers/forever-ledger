import { describe, expect, it } from 'vitest';
import { charName, guideRequest, stepPlace } from './lib';

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
    expect(guideRequest({ ...form, start: '' })).toMatchObject({ ok: false });
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
});
