// Planner XP (planner/xp.ts): Classic 1.12 numbers, level cap 30 on the beta.
import { describe, expect, it } from 'vitest';
import { gain, isGrey, mobXp, questXp, xpToNext } from '../src/planner/xp.js';

describe('planner XP', () => {
  it('knows the XP to the next level, and none at the cap', () => {
    expect(xpToNext(1)).toBe(400);
    expect(xpToNext(10)).toBe(7600);
    expect(xpToNext(29)).toBe(44300);
    expect(xpToNext(30)).toBe(0);
  });

  it('uses the recorded XP curve of the build where it has the level', () => {
    const curve = new Map([[10, 7000]]);
    expect(xpToNext(10, 30, curve)).toBe(7000);
    expect(xpToNext(11, 30, curve)).toBe(8800);
    expect(xpToNext(30, 30, new Map([[30, 1]]))).toBe(0);
    expect(gain({ level: 10, xp: 0 }, 7100, 30, curve)).toEqual({ level: 11, xp: 100 });
  });

  it('scales quest XP by how far above the quest the player is', () => {
    expect(questXp(1000, 10, 15)).toBe(1000);
    expect(questXp(1000, 10, 16)).toBe(800);
    expect(questXp(1000, 10, 17)).toBe(600);
    expect(questXp(1000, 10, 18)).toBe(400);
    expect(questXp(1000, 10, 19)).toBe(200);
    expect(questXp(1000, 10, 25)).toBe(100);
    expect(questXp(1000, 12, 8)).toBe(1000);
    // Rounded down to 5 XP.
    expect(questXp(333, 10, 16)).toBe(265);
  });

  it('greys out quests far below the player', () => {
    expect(isGrey(5, 12)).toBe(true);
    expect(isGrey(8, 12)).toBe(false);
    expect(isGrey(6, 12)).toBe(false);
    expect(isGrey(1, 5)).toBe(false);
    expect(isGrey(1, 7)).toBe(true);
  });

  it('estimates kill XP for a same-level mob', () => {
    expect(mobXp(10)).toBe(95);
    expect(mobXp(1)).toBe(50);
  });

  it('gains XP and levels up', () => {
    expect(gain({ level: 1, xp: 300 }, 250)).toEqual({ level: 2, xp: 150 });
    // 400 (1→2) + 900 (2→3) = 1300, 200 left over.
    expect(gain({ level: 1, xp: 0 }, 1500)).toEqual({ level: 3, xp: 200 });
    const state = { level: 5, xp: 10 };
    expect(gain(state, 5)).toEqual({ level: 5, xp: 15 });
    expect(state).toEqual({ level: 5, xp: 10 });
  });

  it('stops at the level cap with 0 XP', () => {
    expect(gain({ level: 29, xp: 44000 }, 1000)).toEqual({ level: 30, xp: 0 });
    expect(gain({ level: 30, xp: 0 }, 5000)).toEqual({ level: 30, xp: 0 });
    expect(gain({ level: 19, xp: 0 }, 100_000, 20)).toEqual({ level: 20, xp: 0 });
  });
});
