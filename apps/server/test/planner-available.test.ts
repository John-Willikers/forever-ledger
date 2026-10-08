// Planner availability (planner/available.ts): which quests a character can take at a level.
import { describe, expect, it } from 'vitest';
import { canTake, isClassQuest, type Taker } from '../src/planner/available.js';
import type { AtlasQuest } from '../src/planner/types.js';

const quest = (over: Partial<AtlasQuest> = {}): AtlasQuest => ({
  id: 100,
  title: 'Test Quest',
  level: 5,
  reqLevel: 3,
  side: 'both',
  classes: null,
  races: null,
  giver: null,
  ender: null,
  prereqs: [],
  objectives: [],
  xp: 300,
  ...over,
});
const ch = (over: Partial<Taker> = {}): Taker => ({
  level: 5,
  className: 'WARLOCK',
  race: 'Scourge',
  faction: 'Horde',
  completed: new Set(),
  log: new Map(),
  ...over,
});
const ALL_CLASSES = [
  'WARRIOR',
  'PALADIN',
  'HUNTER',
  'ROGUE',
  'PRIEST',
  'SHAMAN',
  'MAGE',
  'WARLOCK',
  'DRUID',
];

describe('planner availability', () => {
  it('takes a plain quest at its level', () => {
    expect(canTake(quest(), ch(), 5)).toBe(true);
  });

  it('checks the side', () => {
    expect(canTake(quest({ side: 'Horde' }), ch(), 5)).toBe(true);
    expect(canTake(quest({ side: 'Alliance' }), ch(), 5)).toBe(false);
  });

  it('takes a class quest for the right class only', () => {
    const q = quest({ classes: ['WARLOCK'] });
    expect(canTake(q, ch(), 5)).toBe(true);
    expect(canTake(q, ch({ className: 'MAGE' }), 5)).toBe(false);
  });

  it('checks the race', () => {
    const q = quest({ races: ['Scourge'] });
    expect(canTake(q, ch(), 5)).toBe(true);
    expect(canTake(q, ch({ race: 'Orc' }), 5)).toBe(false);
  });

  it('skips completed quests and quests in the log', () => {
    expect(canTake(quest(), ch({ completed: new Set([100]) }), 5)).toBe(false);
    expect(canTake(quest(), ch({ log: new Map([[100, [0]]]) }), 5)).toBe(false);
  });

  it('needs every prerequisite turned in (a chain: B needs A)', () => {
    const b = quest({ id: 101, prereqs: [100, 99] });
    expect(canTake(b, ch(), 5)).toBe(false);
    expect(canTake(b, ch({ completed: new Set([100]) }), 5)).toBe(false);
    expect(canTake(b, ch({ completed: new Set([100, 99]) }), 5)).toBe(true);
  });

  it('needs the required level', () => {
    expect(canTake(quest({ reqLevel: 6 }), ch(), 5)).toBe(false);
    expect(canTake(quest({ reqLevel: 6 }), ch(), 6)).toBe(true);
  });

  it('waits for a quest more than 3 levels up', () => {
    const q = quest({ level: 9, reqLevel: 1 });
    expect(canTake(q, ch(), 5)).toBe(false);
    expect(canTake(q, ch(), 6)).toBe(true);
  });

  it('skips grey quests', () => {
    // Level 12: the grey gap is 6, so a level 5 quest is grey and a level 6 quest is not.
    expect(canTake(quest({ level: 5, reqLevel: 1 }), ch(), 12)).toBe(false);
    expect(canTake(quest({ level: 6, reqLevel: 1 }), ch(), 12)).toBe(true);
  });

  it('tells class quests apart', () => {
    expect(isClassQuest(quest())).toBe(false);
    expect(isClassQuest(quest({ classes: ['WARLOCK'] }))).toBe(true);
    expect(isClassQuest(quest({ classes: ALL_CLASSES }))).toBe(false);
  });
});
