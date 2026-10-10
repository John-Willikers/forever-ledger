// Planner availability (planner/available.ts): which quests a character can take at a level.
import { describe, expect, it } from 'vitest';
import { canTake, isClassQuest, type Taker } from '../src/planner/available.js';
import { START_AREAS, startAreaOf } from '../src/planner/start-areas.js';
import type { Atlas, AtlasQuest, MapSpot, QuestPoint } from '../src/planner/types.js';

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
/** No other quests known: no prerequisite is the other faction's. */
const NONE: Atlas = { quests: new Map() };
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
    expect(canTake(quest(), ch(), 5, NONE)).toBe(true);
  });

  it('checks the side', () => {
    expect(canTake(quest({ side: 'Horde' }), ch(), 5, NONE)).toBe(true);
    expect(canTake(quest({ side: 'Alliance' }), ch(), 5, NONE)).toBe(false);
  });

  it('takes a class quest for the right class only', () => {
    const q = quest({ classes: ['WARLOCK'] });
    expect(canTake(q, ch(), 5, NONE)).toBe(true);
    expect(canTake(q, ch({ className: 'MAGE' }), 5, NONE)).toBe(false);
  });

  it('checks the race', () => {
    const q = quest({ races: ['Scourge'] });
    expect(canTake(q, ch(), 5, NONE)).toBe(true);
    expect(canTake(q, ch({ race: 'Orc' }), 5, NONE)).toBe(false);
  });

  it('skips completed quests and quests in the log', () => {
    expect(canTake(quest(), ch({ completed: new Set([100]) }), 5, NONE)).toBe(false);
    expect(canTake(quest(), ch({ log: new Map([[100, [0]]]) }), 5, NONE)).toBe(false);
  });

  it('needs every prerequisite turned in (a chain: B needs A)', () => {
    const b = quest({ id: 101, prereqs: [100, 99] });
    expect(canTake(b, ch(), 5, NONE)).toBe(false);
    expect(canTake(b, ch({ completed: new Set([100]) }), 5, NONE)).toBe(false);
    expect(canTake(b, ch({ completed: new Set([100, 99]) }), 5, NONE)).toBe(true);
  });

  it("ignores a prerequisite that is the other faction's quest (a both-side step after a split step)", () => {
    const alliance = quest({ id: 60, side: 'Alliance' });
    const horde = quest({ id: 61, side: 'Horde' });
    const next = quest({ id: 62, prereqs: [60, 61] });
    const atlas = { quests: new Map([alliance, horde, next].map((q) => [q.id, q])) };
    expect(canTake(next, ch(), 5, atlas)).toBe(false);
    expect(canTake(next, ch({ completed: new Set([61]) }), 5, atlas)).toBe(true);
    expect(canTake(next, ch({ faction: 'Alliance', completed: new Set([61]) }), 5, atlas)).toBe(
      false,
    );
    // A prerequisite the atlas doesn't know counts.
    expect(canTake(next, ch({ completed: new Set([61]) }), 5, NONE)).toBe(false);
  });

  it('needs the required level', () => {
    expect(canTake(quest({ reqLevel: 6 }), ch(), 5, NONE)).toBe(false);
    expect(canTake(quest({ reqLevel: 6 }), ch(), 6, NONE)).toBe(true);
  });

  it('waits for a quest more than 3 levels up', () => {
    const q = quest({ level: 9, reqLevel: 1 });
    expect(canTake(q, ch(), 5, NONE)).toBe(false);
    expect(canTake(q, ch(), 6, NONE)).toBe(true);
  });

  it('skips grey quests', () => {
    // Level 12: the grey gap is 6, so a level 5 quest is grey and a level 6 quest is not.
    expect(canTake(quest({ level: 5, reqLevel: 1 }), ch(), 12, NONE)).toBe(false);
    expect(canTake(quest({ level: 6, reqLevel: 1 }), ch(), 12, NONE)).toBe(true);
  });

  it('takes class quests at any level from their required level (never grey, never too high)', () => {
    // Harlan: class quests always.
    const q = quest({ classes: ['WARLOCK'], level: 10, reqLevel: 10 });
    expect(canTake(q, ch(), 20, NONE)).toBe(true);
    expect(canTake(q, ch(), 9, NONE)).toBe(false);
    expect(canTake(quest({ classes: ['WARLOCK'], level: 14, reqLevel: 10 }), ch(), 10, NONE)).toBe(
      true,
    );
    // A quest for all nine classes is no class quest: grey still applies.
    expect(canTake(quest({ classes: ALL_CLASSES, level: 10, reqLevel: 10 }), ch(), 20, NONE)).toBe(
      false,
    );
  });

  it('tells class quests apart', () => {
    expect(isClassQuest(quest())).toBe(false);
    expect(isClassQuest(quest({ classes: ['WARLOCK'] }))).toBe(true);
    expect(isClassQuest(quest({ classes: ALL_CLASSES }))).toBe(false);
  });

  describe("class quests in another race's start area (Harlan, 2026-10-09)", () => {
    const at = (spot: MapSpot): QuestPoint => ({ id: 1, name: 'Trainer', spots: [spot] });
    // Live atlas givers: Venya Marthand (Deathknell), Ruzan (Valley of Trials), Gornek, Rorian (Zephras Isle).
    const VENYA: MapSpot = { mapId: 1420, x: 31.0, y: 66.3 };
    const RUZAN: MapSpot = { mapId: 1411, x: 42.4, y: 69.0 };
    const ORGRIMMAR: MapSpot = { mapId: 1454, x: 48.2, y: 45.6 };
    const TELF_JOOLAM: MapSpot = { mapId: 1411, x: 38.4, y: 58.8 };
    const RORIAN: MapSpot = { mapId: 2521, x: 42.0, y: 23.4 };
    // Wowhead lists the races that can be the class, not where to go.
    const piercing = quest({
      id: 1470,
      classes: ['WARLOCK'],
      races: ['Orc', 'Scourge'],
      giver: at(VENYA),
    });
    const vile = quest({
      id: 1485,
      classes: ['WARLOCK'],
      races: ['Orc', 'Scourge', 'Troll'],
      giver: at(RUZAN),
    });

    it('an Undead warlock takes the Deathknell imp quest, not the Valley of Trials one', () => {
      expect(canTake(piercing, ch(), 5, NONE)).toBe(true);
      expect(canTake(vile, ch({ completed: new Set([1470]) }), 5, NONE)).toBe(false);
    });

    it('an Orc or Troll warlock takes the Valley of Trials one, not the Deathknell one', () => {
      expect(canTake(vile, ch({ race: 'Orc' }), 5, NONE)).toBe(true);
      expect(canTake(vile, ch({ race: 'Troll' }), 5, NONE)).toBe(true);
      expect(canTake(piercing, ch({ race: 'Orc' }), 5, NONE)).toBe(false);
    });

    it('a class quest in a city or outside the start area is anyone’s', () => {
      const city = quest({ classes: ['WARLOCK'], races: ['Orc', 'Scourge'], giver: at(ORGRIMMAR) });
      expect(canTake(city, ch(), 5, NONE)).toBe(true);
      // Telf Joolam, north of the Valley: Tauren shamans' Call of Fire goes there.
      const fire = quest({
        classes: ['SHAMAN'],
        races: ['Orc', 'Tauren', 'Troll'],
        giver: at(TELF_JOOLAM),
      });
      expect(canTake(fire, ch({ className: 'SHAMAN', race: 'Tauren' }), 5, NONE)).toBe(true);
    });

    it('Zephras Isle is the Skyborne start area', () => {
      const rogue = quest({
        classes: ['ROGUE'],
        races: ['Scourge', 'Skyborne'],
        giver: at(RORIAN),
      });
      expect(canTake(rogue, ch({ className: 'ROGUE', race: 'Skyborne' }), 5, NONE)).toBe(true);
      expect(canTake(rogue, ch({ className: 'ROGUE' }), 5, NONE)).toBe(false);
    });

    it('leaves quests for any class alone', () => {
      expect(canTake(quest({ giver: at(RUZAN) }), ch(), 5, NONE)).toBe(true);
      expect(canTake(quest({ classes: ALL_CLASSES, giver: at(RUZAN) }), ch(), 5, NONE)).toBe(true);
    });

    it('knows the start areas', () => {
      expect(startAreaOf(VENYA)?.name).toBe('Deathknell');
      expect(startAreaOf(RUZAN)?.name).toBe('Valley of Trials');
      expect(startAreaOf(RORIAN)?.name).toBe('Zephras Isle');
      expect(startAreaOf({ mapId: 2665, x: 50, y: 50 })?.name).toBe('Zephras Isle');
      expect(startAreaOf(ORGRIMMAR)).toBeNull();
      expect(startAreaOf(TELF_JOOLAM)).toBeNull();
      // Brill, Razor Hill, Goldshire, Kharanos, Dolanaar, Bloodhoof Village: outside.
      for (const s of [
        { mapId: 1420, x: 61, y: 52 },
        { mapId: 1411, x: 52, y: 43 },
        { mapId: 1429, x: 43.4, y: 65.6 },
        { mapId: 1426, x: 30.2, y: 46.6 },
        { mapId: 1438, x: 55.4, y: 56.8 },
        { mapId: 1412, x: 47.4, y: 62.8 },
      ])
        expect(startAreaOf(s)).toBeNull();
      // Every playable race has a start area of its own.
      const races = START_AREAS.flatMap((a) => a.races).sort();
      expect(races).toEqual([
        'Dwarf',
        'Gnome',
        'Human',
        'NightElf',
        'Orc',
        'Scourge',
        'Skyborne',
        'Tauren',
        'Troll',
      ]);
    });
  });
});
