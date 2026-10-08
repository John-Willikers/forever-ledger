import { describe, expect, it } from 'vitest';
import {
  ATLAS_LIST_PRIORITY,
  ATLAS_QUEST_PRIORITY,
  ATLAS_STARTER_QUEST_PRIORITY,
  atlasListUrl,
  atlasListUrls,
  isWowheadQuestList,
  questPageUrl,
} from '../src/knowledge/atlas.js';
import { enqueueAtlas } from '../src/knowledge/enqueue.js';
import { parseSnapshot } from '../src/knowledge/parsers/index.js';
import { classesOf, racesOf } from '../src/knowledge/parsers/wowhead-quest.js';
import { webFixture } from './helpers.js';

const QUEST_URL = 'https://www.wowhead.com/forever/quest=91743/rascally-rodents';
const LIST_URL = 'https://www.wowhead.com/forever/quests/eastern-kingdoms/elwynn-forest';

describe('wowhead@5 quest pages', () => {
  const r = parseSnapshot(webFixture('wowhead-quest.html'), QUEST_URL);
  const value = (attribute: string) =>
    r.claims.find((c) => c.entityId === 91743 && c.attribute === attribute)?.value;

  it('is parser v5 and reads the page without problems', () => {
    expect(r.parser).toBe('wowhead@5');
    expect(r.problems).toEqual([]);
  });

  it('reads starts_at / ends_at from the mapper: an object start, an NPC end with reactions', () => {
    expect(value('starts_at')).toEqual([
      {
        kind: 'object',
        id: 900001,
        name: 'Wanted Poster',
        wowheadZone: 12,
        zoneName: 'Elwynn Forest',
        coords: [[49.6, 41]],
      },
    ]);
    expect(value('ends_at')).toEqual([
      {
        kind: 'npc',
        id: 951,
        name: 'Brother Paxton',
        wowheadZone: 12,
        zoneName: 'Elwynn Forest',
        coords: [
          [49.4, 40.4],
          [49.6, 40.4],
        ],
        react: { alliance: 1, horde: 0 },
      },
    ]);
  });

  it('reads objective spots: drop sources with item and index, targets, objects, unmapped spawns', () => {
    expect(value('objective_spots')).toEqual([
      {
        kind: 'npc',
        id: 6,
        name: 'Kobold Vermin',
        wowheadZone: 12,
        zoneName: 'Elwynn Forest',
        coords: [
          [47.4, 35],
          [47.4, 36.2],
        ],
        react: { alliance: -1, horde: 0 },
        role: 'source',
        item: 'Stolen Book',
        objective: 1,
      },
      {
        kind: 'npc',
        id: 476,
        name: 'Kobold Geomancer',
        wowheadZone: 12,
        zoneName: 'Elwynn Forest',
        coords: [[60.6, 50.8]],
        react: { alliance: -1, horde: 0 },
        role: 'target',
      },
      {
        kind: 'object',
        id: 563442,
        name: 'Kobold Tracks',
        wowheadZone: 12,
        zoneName: 'Elwynn Forest',
        coords: [[45.4, 50.7]],
        role: 'target',
        objective: 0,
      },
      {
        kind: 'npc',
        id: 250657,
        name: "Rath'mael",
        wowheadZone: 16611,
        zoneName: 'Ruins of Lordaeron',
        coords: [],
        react: { alliance: 0, horde: 0 },
        role: 'target',
      },
    ]);
  });

  it('reads the series in order with the current (bold) quest at its place and faction-split steps', () => {
    expect(value('series')).toEqual([
      [{ id: 91741, name: 'Nibbled-On Book' }],
      [{ id: 91743, name: 'Rascally Rodents' }],
      [
        { id: 91745, name: 'Mining Consultant', side: 'Alliance' },
        { id: 97246, name: 'Meal Appeal', side: 'Horde' },
      ],
    ]);
  });

  it('reads class and race restrictions from reqclass / reqrace, Forever race 95 included', () => {
    expect(value('classes')).toEqual(['Priest', 'Druid']);
    expect(value('races')).toEqual(['Dwarf', 'Night Elf', 'Gnome', 'High Order Skyborne']);
    // v4 facts are still there.
    expect(value('level')).toBe(2);
    expect(value('req_level')).toBe(1);
    expect(value('side')).toBe('Alliance');
  });

  it("keeps the page's label on a Forever quest's spots", () => {
    expect(r.claims.filter((c) => c.label !== undefined)).toEqual([]);
  });

  it('labels the spots of a Classic-era quest CLASSIC (player-collected spawns)', () => {
    const p = parseSnapshot(
      webFixture('wowhead-quest.html').replaceAll('91743', '1638'),
      'https://www.wowhead.com/forever/quest=1638/x',
    );
    const labels = Object.fromEntries(
      p.claims.filter((c) => c.entityId === 1638).map((c) => [c.attribute, c.label]),
    );
    expect(labels).toMatchObject({
      starts_at: 'CLASSIC',
      ends_at: 'CLASSIC',
      objective_spots: 'CLASSIC',
      series: undefined,
      level: undefined,
      classes: undefined,
    });
  });

  it('follows the other quests of its series', () => {
    expect(r.follow).toEqual(
      [91741, 91745, 97246].map((id) => ({
        url: questPageUrl(id),
        entityType: 'quest',
        entityId: id,
        priority: ATLAS_QUEST_PRIORITY,
      })),
    );
  });

  it('falls back to the infobox Start / End links when the mapper has no such point', () => {
    const page = `<html><head><title>Nibbled-On Book - Quest</title></head><body><script>
      WH.markup.printHtml("[ul][li][icon name=quest-start]Start: [url=\\/forever\\/item=900002\\/nibbled-on-book]Nibbled-On Book[\\/url][\\/icon][\\/li][li][icon name=quest-end]End: [url=\\/forever\\/npc=951\\/brother-paxton]Brother Paxton[\\/url][\\/icon][\\/li][\\/ul]", "infobox-contents-0", {});
      var myMapper = new Mapper({"objectives":{"12":{"zone":"Elwynn Forest","mappable":1,"levels":[[{"type":1,"point":"end","name":"Brother Paxton","coord":[49.4,40.4],"coords":[[49.4,40.4]],"id":951}]]}},"zones":[[12,1]],"missing":1});
    </script></body></html>`;
    const p = parseSnapshot(page, 'https://www.wowhead.com/forever/quest=91741/nibbled-on-book');
    const of = (a: string) => p.claims.find((c) => c.attribute === a)?.value;
    expect(of('starts_at')).toEqual([
      {
        kind: 'item',
        id: 900002,
        name: 'Nibbled-On Book',
        wowheadZone: null,
        zoneName: null,
        coords: [],
      },
    ]);
    expect(of('ends_at')).toMatchObject([{ kind: 'npc', id: 951, coords: [[49.4, 40.4]] }]);
    expect(of('series')).toBeUndefined();
  });

  it('reports a mapper that is not JSON', () => {
    const p = parseSnapshot(
      `<html><body><script>var m = new Mapper({objectives: bare});</script></body></html>`,
      QUEST_URL,
    );
    expect(p.problems).toContain('mapper is not JSON');
  });
});

describe('class and race masks', () => {
  it('maps Classic class bits and leaves unknown ones visible', () => {
    expect(classesOf(1)).toEqual(['Warrior']);
    expect(classesOf(32)).toEqual(['class6']);
    expect(classesOf(0)).toBeNull();
    expect(classesOf(undefined)).toBeNull();
  });

  it('maps race bits, bit 32 being High Order Skyborne', () => {
    expect(racesOf(16)).toEqual(['Undead']);
    expect(racesOf(18)).toEqual(['Orc', 'Undead']);
    expect(racesOf(2 ** 32 + 72)).toEqual(['Night Elf', 'Gnome', 'High Order Skyborne']);
    expect(racesOf(2 ** 20)).toEqual(['raceBit20']);
  });

  it('reads a mask allowing every Forever class or race as no restriction', () => {
    expect(classesOf(1 + 2 + 4 + 8 + 16 + 64 + 128 + 256 + 1024)).toBeNull();
    expect(classesOf(2 ** 31 - 1)).toBeNull();
    expect(racesOf(255 + 2 ** 32)).toBeNull();
    // All Classic races but not Skyborne is a restriction.
    expect(racesOf(255)).toHaveLength(8);
  });
});

describe('wowhead@5 quest list pages', () => {
  const r = parseSnapshot(webFixture('wowhead-quest-list.html'), LIST_URL);

  it('recognises list URLs, not quest pages', () => {
    expect(isWowheadQuestList(LIST_URL)).toBe(true);
    expect(isWowheadQuestList('https://www.wowhead.com/forever/quests/classes/warrior')).toBe(true);
    expect(isWowheadQuestList('https://www.wowhead.com/forever/quests=0.12')).toBe(true);
    expect(isWowheadQuestList(QUEST_URL)).toBe(false);
    expect(r.problems).toEqual(['quest lists: skipped 1 rows with ids outside 1..INT4_MAX']);
  });

  it('claims each row on its own quest', () => {
    const of = (id: number) =>
      Object.fromEntries(
        r.claims
          .filter((c) => c.entityId === id && c.entityType === 'quest')
          .map((c) => [c.attribute, c.value]),
      );
    expect(of(91743)).toEqual({
      name: 'Rascally Rodents',
      level: 2,
      req_level: 1,
      xp_reward: 170,
      side: 'Alliance',
      races: ['Dwarf', 'Night Elf', 'Gnome', 'High Order Skyborne'],
      zone_category: { category: 12, category2: 0 },
    });
    expect(of(1638)).toMatchObject({
      name: "A Warrior's Training",
      classes: ['Warrior'],
      side: 'both',
      zone_category: { category: -81, category2: 4 },
    });
    expect(of(91724)).toMatchObject({ money_reward: 350 });
    expect(r.claims.some((c) => c.entityId === 3_000_000_000)).toBe(false);
  });

  it('follows every quest to its page, starter quests first, below the lists', () => {
    expect(r.follow).toEqual([
      {
        url: 'https://www.wowhead.com/forever/quest=91743',
        entityType: 'quest',
        entityId: 91743,
        priority: ATLAS_STARTER_QUEST_PRIORITY,
      },
      {
        url: 'https://www.wowhead.com/forever/quest=91724',
        entityType: 'quest',
        entityId: 91724,
        priority: ATLAS_STARTER_QUEST_PRIORITY,
      },
      {
        url: 'https://www.wowhead.com/forever/quest=1638',
        entityType: 'quest',
        entityId: 1638,
        priority: ATLAS_STARTER_QUEST_PRIORITY,
      },
    ]);
    expect(ATLAS_QUEST_PRIORITY).toBeLessThan(ATLAS_STARTER_QUEST_PRIORITY);
    expect(ATLAS_STARTER_QUEST_PRIORITY).toBeLessThan(ATLAS_LIST_PRIORITY);
  });

  it('reads an inline-data Listview and says when a list page has none', () => {
    const inline = parseSnapshot(
      `<html><body><script>new Listview({template: 'quest', id: 'quests', data: [{"id":5,"level":25,"name":"X"}]});</script></body></html>`,
      'https://www.wowhead.com/forever/quests/classes/mage',
    );
    expect(inline.follow).toEqual([
      expect.objectContaining({ entityId: 5, priority: ATLAS_QUEST_PRIORITY }),
    ]);
    const empty = parseSnapshot(
      '<html><body></body></html>',
      'https://www.wowhead.com/forever/quests/kalimdor/durotar',
    );
    expect(empty.problems).toEqual(['quest list page without a quest Listview']);
  });
});

describe('enqueue-atlas', () => {
  it('dry run lists the 9 class lists and the 1-30 zone lists without a database', async () => {
    const { urls, queued } = await enqueueAtlas(null, { dryRun: true });
    expect(queued).toBe(0);
    expect(urls).toEqual(atlasListUrls());
    expect(urls.slice(0, 9)).toEqual(
      ['warrior', 'paladin', 'hunter', 'rogue', 'priest', 'shaman', 'mage', 'warlock', 'druid'].map(
        (c) => `https://www.wowhead.com/forever/quests/classes/${c}`,
      ),
    );
    expect(urls).toContain(LIST_URL);
    expect(urls).toContain(
      'https://www.wowhead.com/forever/quests/eastern-kingdoms/tirisfal-glades',
    );
    expect(urls).toContain('https://www.wowhead.com/forever/quests/kalimdor/the-barrens');
    expect(urls).toContain('https://www.wowhead.com/forever/quests/kalimdor/thunder-bluff');
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.every(isWowheadQuestList)).toBe(true);
    // Forever's own zones by id, under each category they may be filed in (the fetch shows which exists).
    expect(urls.slice(-7)).toEqual(
      ['0.16593', '1.16593', '7.16593', '0.16591', '1.16651', '1.16606', '6.16606'].map(
        (c) => `https://www.wowhead.com/forever/quests=${c}`,
      ),
    );
    expect(urls).toHaveLength(9 + 28 + 7);
  });

  it('builds list URLs in one place', () => {
    expect(atlasListUrl({ kind: 'zone', continent: 'kalimdor', zone: 'durotar' })).toBe(
      'https://www.wowhead.com/forever/quests/kalimdor/durotar',
    );
  });
});
