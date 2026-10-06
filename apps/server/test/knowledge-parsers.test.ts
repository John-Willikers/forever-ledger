import { describe, expect, it } from 'vitest';
import { looksLikeChallenge } from '../src/knowledge/challenge.js';
import { containsQuote, pageText, parseHtml } from '../src/knowledge/html.js';
import { parseSnapshot, statedBuild } from '../src/knowledge/parsers/index.js';
import { matchBracket } from '../src/knowledge/parsers/scan.js';
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
      },
    ]);
    expect(r.problems).toEqual(['listview broken: data is not JSON']);
    expect(r.parser).toBe('wowhead@1');
    expect(r.title).toBe('Big-mouth Clam - Item - World of Warcraft Forever');
    expect(r.pageUpdatedAt).toEqual(new Date('2026-10-01T12:00:00Z'));
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
    expect(r.parser).toBe('table@1');
    expect(r.claims).toEqual([
      {
        entityType: 'zone',
        entityName: 'Tanaris',
        attribute: 'level_range',
        value: { min: 40, max: 50 },
        quote: 'Tanaris | 40 – 50 | Contested',
      },
      {
        entityType: 'zone',
        entityName: 'Searing Gorge',
        attribute: 'level_range',
        value: { min: 43, max: 55 },
        quote: 'Searing Gorge | 43-55 | Contested',
      },
      {
        entityType: 'dungeon',
        entityName: 'Excavation Site',
        attribute: 'level_range',
        value: { min: 24, max: 29 },
        quote: 'Excavation Site | Wetlands | 24-29',
      },
      {
        entityType: 'dungeon',
        entityName: 'Excavation Site',
        attribute: 'zone',
        value: 'Wetlands',
        quote: 'Excavation Site | Wetlands | 24-29',
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
