import { describe, expect, it } from 'vitest';
import { looksLikeChallenge } from '../src/knowledge/challenge.js';
import { containsQuote, pageText, parseHtml } from '../src/knowledge/html.js';
import { parseSnapshot, statedBuild } from '../src/knowledge/parsers/index.js';
import { matchBracket } from '../src/knowledge/parsers/scan.js';
import { nameAndLevels, parseMobalyticsMap } from '../src/knowledge/parsers/mobalytics.js';
import { levelRange } from '../src/knowledge/parsers/tables.js';
import { wowheadEntity } from '../src/knowledge/parsers/wowhead.js';
import { webFixture } from './helpers.js';

const ITEM_URL = 'https://www.wowhead.com/forever/item=7973/big-mouth-clam';

describe('wowhead parser', () => {
  const r = parseSnapshot(webFixture('wowhead-item.html'), ITEM_URL);

  it('reads the page entity from the URL', () => {
    expect(wowheadEntity(ITEM_URL)).toEqual({ type: 'item', id: 7973 });
    expect(wowheadEntity('https://www.wowhead.com/forever/guide/fishing')).toBeNull();
  });

  it('reads Gatherer names for every entity on the page', () => {
    const names = r.claims.filter((c) => c.attribute === 'name');
    expect(names).toEqual(
      expect.arrayContaining([
        { entityType: 'item', entityId: 7973, attribute: 'name', value: 'Big-mouth Clam' },
        { entityType: 'item', entityId: 7971, attribute: 'name', value: 'Black Pearl' },
        {
          entityType: 'npc',
          entityId: 4344,
          attribute: 'name',
          value: 'Mottled Drywallow Crocolisk',
        },
      ]),
    );
  });

  it('turns Listview rows into relation claims on the page entity', () => {
    const dropped = r.claims.filter((c) => c.attribute === 'dropped_by');
    expect(dropped).toHaveLength(2);
    expect(dropped[0]).toEqual({
      entityType: 'item',
      entityId: 7973,
      attribute: 'dropped_by',
      label: 'CLASSIC',
      value: {
        id: 5431,
        type: 'npc',
        name: 'Surf Glider',
        count: 120,
        outOf: 240,
        minLevel: 44,
        maxLevel: 45,
        zones: [440],
      },
    });
    expect(r.claims.find((c) => c.attribute === 'fished_in')?.value).toMatchObject({
      id: 440,
      name: 'Tanaris',
      count: 15,
      outOf: 3000,
    });
    // Item rows lose their quality-digit prefix.
    expect(r.claims.find((c) => c.attribute === 'lv_contains')?.value).toMatchObject({
      name: 'Black Pearl',
    });
  });

  it('keeps comments apart and reports Listviews it could not read', () => {
    expect(r.comments).toEqual([
      {
        commentId: 101,
        entityType: 'item',
        entityId: 7973,
        postedAt: new Date('2019-09-04T18:39:34Z'),
        rating: 12,
        body: '2 pearls in 30 min off the Steamwheedle dock',
        dataTree: null,
        gameVersion: 'unknown',
      },
    ]);
    expect(r.problems).toEqual(['listview broken: data is not JSON']);
    expect(r.parser).toBe('wowhead@4');
    expect(r.title).toBe('Big-mouth Clam - Item - World of Warcraft Forever');
    expect(r.pageUpdatedAt).toEqual(new Date('2026-10-01T12:00:00Z'));
  });
});

describe('wowhead parser on real-page shapes', () => {
  it('labels player-collected lists CLASSIC, drops unknown counts, reads ISO comment dates', () => {
    const r = parseSnapshot(
      `<html><head><title>Big-mouth Clam - Item - Forever</title></head><body><script>
        WH.Gatherer.addData(3, 21, {"7973":{"name_enus":"Big-mouth Clam"}});
        new Listview({template: 'npc', id: 'dropped-by', data: [{"id":1492,"name":"Gorlash","count":-1,"outof":4469}]});
        var lv_comments0 = [{"id":5,"body":"75 clams, 5 black pearls","date":"2007-05-04T16:59:25-05:00","rating":1,"dataTree":1},
          {"id":6,"body":"0 clams in 40 min at Steamwheedle","date":"2026-10-06T21:00:00-05:00","rating":0,"dataTree":16},
          {"id":7,"body":"pearl macro","date":"2019-12-04T08:28:31-06:00","rating":0,"dataTree":4}];
        new Listview({template: 'comment', id: 'comments', data: lv_comments0});
      </script></body></html>`,
      ITEM_URL,
    );
    expect(r.claims).toEqual([
      { entityType: 'item', entityId: 7973, attribute: 'name', value: 'Big-mouth Clam' },
      {
        entityType: 'item',
        entityId: 7973,
        attribute: 'dropped_by',
        label: 'CLASSIC',
        value: { id: 1492, type: 'npc', name: 'Gorlash', outOf: 4469 },
      },
    ]);
    expect(r.comments[0]!.postedAt).toEqual(new Date('2007-05-04T21:59:25Z'));
    // Wowhead's comment toggle: tree 16 is Forever, 4 Classic Era, 1 retail / original WoW.
    expect(r.comments.map((c) => [c.dataTree, c.gameVersion])).toEqual([
      [1, 'unknown'],
      [16, 'forever'],
      [4, 'classic'],
    ]);
  });
});

describe('wowhead parser: quest and NPC pages (v3)', () => {
  const page = (title: string, script: string) =>
    `<html><head><title>${title}</title></head><body><script>${script}</script></body></html>`;

  it('reads quest facts from g_quests and skips media tabs', () => {
    const r = parseSnapshot(
      page(
        'Downstream - Quest - Forever',
        `WH.Gatherer.addData(5, 16, {"91733":{"name_enus":"Downstream"}});
         $.extend(g_quests[91733], {"level":10,"money":250,"reprewards":[[72,75]],"reqlevel":7,"side":1,"xp":630});
         new Listview({data: lv_screenshots, id: 'screenshots', template: 'screenshot'});
         var lv_screenshots = [{"id":1}];`,
      ),
      'https://www.wowhead.com/forever/quest=91733/downstream',
    );
    expect(
      r.claims.filter((c) => c.attribute !== 'name').map((c) => [c.attribute, c.value]),
    ).toEqual([
      ['level', 10],
      ['req_level', 7],
      ['xp_reward', 630],
      ['money_reward', 250],
      ['side', 'Alliance'],
      ['rep_rewards', [{ faction: 72, amount: 75 }]],
    ]);
    expect(r.problems).toEqual([]);
  });

  it("claims an NPC's drops on each item too, labeled CLASSIC", () => {
    const r = parseSnapshot(
      page(
        'Surf Glider - NPC - Forever',
        `WH.Gatherer.addData(1, 16, {"5431":{"name_enus":"Surf Glider"}});
         $.extend(g_npcs[5431], {"minlevel":48,"maxlevel":50,"location":[440],"classification":0});
         new Listview({template: 'item', id: 'drops', data: [{"id":7973,"name":"6Big-mouth Clam","count":13464,"outof":38361,"quality":1}]});`,
      ),
      'https://www.wowhead.com/forever/npc=5431/surf-glider',
    );
    const npc = r.claims.filter((c) => c.entityType === 'npc' && c.attribute !== 'name');
    expect(npc.map((c) => c.attribute)).toEqual([
      'level_range',
      'zones',
      'classification',
      'drops',
    ]);
    expect(r.claims.find((c) => c.entityType === 'item')).toEqual({
      entityType: 'item',
      entityId: 7973,
      attribute: 'dropped_by',
      value: { id: 5431, type: 'npc', name: 'Surf Glider', count: 13464, outOf: 38361 },
      label: 'CLASSIC',
    });
  });
});

describe('wowhead parser on awkward pages', () => {
  const page = (script: string) =>
    `<html><head><title>X - Item - World of Warcraft</title></head><body><script>${script}</script></body></html>`;

  it('reads JSON-style keys and data declared before the call, nearest first', () => {
    const r = parseSnapshot(
      page(`var lv = [{"id":1,"name":"Old"}];
            new Listview({"id": "dropped-by", "template": "npc", "data": lv});
            var lv = [{"id":2,"name":"New"}];
            new Listview({data: lv, template: 'npc', id: 'sold-by'});`),
      ITEM_URL,
    );
    expect(
      r.claims.filter((c) => c.attribute !== 'name').map((c) => [c.attribute, c.value]),
    ).toEqual([
      ['dropped_by', { id: 1, type: 'npc', name: 'Old' }],
      ['sold_by', { id: 2, type: 'npc', name: 'New' }],
    ]);
  });

  it("keeps a created-by spell's profession (Wowhead writes it as an array)", () => {
    const r = parseSnapshot(
      page(
        `new Listview({template: 'spell', id: 'created-by-spell', data: [{"id":3914,"name":"Brown Linen Pants","skill":[197],"reqlevel":1}]});`,
      ),
      ITEM_URL,
    );
    expect(r.claims.find((c) => c.attribute === 'created_by_spell')?.value).toEqual({
      id: 3914,
      type: 'spell',
      name: 'Brown Linen Pants',
      reqLevel: 1,
      skills: [197],
    });
  });

  it('ignores markers inside strings and comments, and reports Listviews without an id', () => {
    const r = parseSnapshot(
      page(`var lv_comments0 = [{"id":7,"body":"see new Listview({id:'sold-by',data:[{\\"id\\":9}]})"}];
            // new Listview({id: 'commented-out', data: [{"id": 3}]});
            new Listview({template: 'comment', id: 'comments', data: lv_comments0});
            new Listview({template: 'npc', data: [{"id": 4}]});`),
      ITEM_URL,
    );
    expect(r.claims.filter((c) => c.attribute !== 'name')).toEqual([]);
    expect(r.comments.map((c) => c.commentId)).toEqual([7]);
    expect(r.problems).toEqual(['a listview has no id']);
  });
});

describe('table parser', () => {
  const r = parseSnapshot(
    webFixture('guide-zones.html'),
    'https://mobalytics.gg/wow-forever/guides/zone-map-level-ranges',
  );

  it('claims level ranges from zone and dungeon tables, quoting the row', () => {
    expect(r.parser).toBe('mobalytics@1+table@2');
    expect(r.claims).toEqual([
      {
        entityType: 'zone',
        entityName: 'Tanaris',
        attribute: 'level_range',
        value: { min: 40, max: 50 },
        quote: 'Zones › Tanaris | 40 – 50 | Contested',
      },
      {
        entityType: 'zone',
        entityName: 'Searing Gorge',
        attribute: 'level_range',
        value: { min: 43, max: 55 },
        quote: 'Zones › Searing Gorge | 43-55 | Contested',
      },
      {
        entityType: 'dungeon',
        entityName: 'Excavation Site',
        attribute: 'level_range',
        value: { min: 24, max: 29 },
        quote: 'Zones › Excavation Site | Wetlands | 24-29',
      },
      {
        entityType: 'dungeon',
        entityName: 'Excavation Site',
        attribute: 'zone',
        value: 'Wetlands',
        quote: 'Zones › Excavation Site | Wetlands | 24-29',
      },
    ]);
    expect(r.build).toBe(70009);
    expect(r.pageUpdatedAt).toEqual(new Date('2026-09-30T13:00:00Z'));
  });

  it('reads level ranges', () => {
    expect(levelRange('40-50')).toEqual({ min: 40, max: 50 });
    expect(levelRange('Lv. 24 to 29')).toEqual({ min: 24, max: 29 });
    expect(levelRange('60')).toEqual({ min: 60, max: 60 });
    expect(levelRange('50-40')).toBeNull();
    expect(levelRange('varies')).toBeNull();
  });

  it('only takes a build when the page states exactly one', () => {
    expect(statedBuild('on build 70009 and Build: 70009')).toBe(70009);
    expect(statedBuild('build 69977 then build 70009')).toBeNull();
    expect(statedBuild('built 12345 things')).toBeNull();
  });
});

describe('mobalytics map parser', () => {
  const r = parseSnapshot(
    webFixture('mobalytics-map.html'),
    'https://mobalytics.gg/wow-forever/guides/zone-map-level-ranges',
  );

  it('reads level ranges from the map sidebar, by the nearest group', () => {
    expect(parseMobalyticsMap(parseHtml(webFixture('mobalytics-map.html')))).toEqual([
      {
        entityType: 'zone',
        entityName: 'Durotar',
        attribute: 'level_range',
        value: { min: 1, max: 10 },
        quote: 'Zone Name + Levels › Durotar 1–10',
      },
      {
        entityType: 'zone',
        entityName: 'Searing Gorge',
        attribute: 'level_range',
        value: { min: 43, max: 50 },
        quote: 'Zone Name + Levels › Searing Gorge 43–50',
      },
      {
        entityType: 'dungeon',
        entityName: 'Excavation Site',
        attribute: 'level_range',
        value: { min: 24, max: 29 },
        quote: 'Dungeons (Wow Forever) › Excavation Site (24-29)',
      },
      {
        entityType: 'dungeon',
        entityName: 'Ragefire Chasm',
        attribute: 'level_range',
        value: { min: 13, max: 18 },
        quote: 'Dungeons (WoW Classic) › Ragefire Chasm (13-18)',
        label: 'CLASSIC',
      },
      {
        entityType: 'dungeon',
        entityName: 'Molten Core',
        attribute: 'level_range',
        value: { min: 60, max: 60 },
        quote: 'Raids (Wow Classic) › Molten Core (60-60)',
        label: 'CLASSIC',
      },
      {
        entityType: 'dungeon',
        entityName: 'Molten Core',
        attribute: 'kind',
        value: 'raid',
        quote: 'Raids (Wow Classic) › Molten Core (60-60)',
      },
    ]);
  });

  it('labels a table under a WoW Classic heading CLASSIC', () => {
    expect(r.parser).toBe('mobalytics@1+table@2');
    const table = r.claims.filter((c) => c.quote?.startsWith('Dungeons › WoW Classic'));
    expect(table.map((c) => [c.attribute, c.value, c.label])).toEqual([
      ['level_range', { min: 13, max: 18 }, 'CLASSIC'],
      ['zone', 'Orgrimmar', 'CLASSIC'],
    ]);
  });

  it('splits names from level ranges', () => {
    expect(nameAndLevels('Durotar 1–10')).toEqual({ name: 'Durotar', levels: '1–10' });
    expect(nameAndLevels("Shaper's Terrace (58-60)")).toEqual({
      name: "Shaper's Terrace",
      levels: '58-60',
    });
    expect(nameAndLevels('Auction House')).toBeNull();
  });
});

describe('challenge pages and text', () => {
  it('spots interstitials but not normal pages that load Cloudflare scripts', () => {
    expect(looksLikeChallenge(webFixture('cloudflare-challenge.html'))).toBe(true);
    expect(looksLikeChallenge(webFixture('wowhead-item.html'))).toBe(false);
    expect(
      looksLikeChallenge('<html><title>Just a Moment - Quest - World of Warcraft</title></html>'),
    ).toBe(false);
    expect(looksLikeChallenge('<html><title>\n  Just a moment...\n</title></html>')).toBe(true);
    expect(
      looksLikeChallenge(
        '<html><head><title>Tanaris</title><script src="/cdn-cgi/challenge-platform/h/b/scripts/x.js"></script></head></html>',
      ),
    ).toBe(false);
  });

  it('finds quotes in visible text only', () => {
    const text = pageText(parseHtml(webFixture('guide-zones.html')));
    expect(containsQuote(text, 'Tanaris, Feralas and   The Hinterlands are 40–50')).toBe(true);
    expect(containsQuote(text, 'dateModified')).toBe(false);
    expect(containsQuote(text, '   ')).toBe(false);
  });

  it('matches brackets past strings', () => {
    const src = `x({"a": "}", "b": [1, ')']}) tail`;
    expect(src.slice(1, matchBracket(src, 1))).toBe(`({"a": "}", "b": [1, ')']})`);
    expect(matchBracket('{[}', 0)).toBe(-1);
  });
});
