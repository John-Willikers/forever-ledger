// Fetched pages are untrusted, like uploaded jsonb (untrusted-jsonb.test.ts): ids out of int4 range, fractions and
// strings where ids belong, comments quoting page markup, wrong types and huge arrays must be skipped or capped (with a
// problem line), never fail the page or reach an int4 column.
import { describe, expect, it } from 'vitest';
import { INT4_MAX } from '../src/addon.js';
import { MAX_QUEST_LIST_ROWS, MAX_FOLLOWS } from '../src/knowledge/parsers/wowhead.js';
import { parseSnapshot } from '../src/knowledge/parsers/index.js';
import { MAX_COORDS, MAX_OBJECTIVE_SPOTS } from '../src/knowledge/parsers/wowhead-quest.js';

const HUGE = 3_000_000_000;
const LIST = 'https://www.wowhead.com/forever/quests/kalimdor/durotar';
const QUEST = 'https://www.wowhead.com/forever/quest=1234/x';
const page = (script: string, body = '') =>
  `<html><body>${body}<script>${script}</script></body></html>`;
const ids = (r: ReturnType<typeof parseSnapshot>) =>
  r.claims.map((c) => c.entityId).filter((id) => id !== undefined && id !== null);

describe('hostile Wowhead pages', () => {
  it('skips list rows whose id is out of range, fractional or a string; keeps the good rows', () => {
    const r = parseSnapshot(
      page(
        `new Listview({template:'quest',id:'quests',data:[{"id":${HUGE},"name":"a","level":5},{"id":1e300,"name":"b"},{"id":"7","name":"c"},{"id":12.5},{"id":-3},{"id":${INT4_MAX},"name":"edge"},{"id":42,"name":"good","level":5}]});`,
      ),
      LIST,
    );
    expect(new Set(ids(r))).toEqual(new Set([INT4_MAX, 42]));
    expect(r.follow?.map((f) => f.entityId)).toEqual([INT4_MAX, 42]);
    expect(r.problems).toEqual(['quest lists: skipped 5 rows with ids outside 1..INT4_MAX']);
  });

  it('skips Gatherer names, relation row ids and NPC drops with ids out of range', () => {
    const r = parseSnapshot(
      page(`WH.Gatherer.addData(3, 21, {"${HUGE}":{"name_enus":"big"},"12.5":{"name_enus":"frac"},"7":{"name_enus":"ok"}});
        new Listview({template:'item',id:'drops',data:[{"id":${HUGE},"name":"1Huge"},{"id":7,"name":"1Ok"}]});`),
      'https://www.wowhead.com/forever/npc=5431/x',
    );
    expect(ids(r).every((id) => id! > 0 && id! <= INT4_MAX)).toBe(true);
    expect(r.claims.filter((c) => c.attribute === 'dropped_by').map((c) => c.entityId)).toEqual([
      7,
    ]);
    expect(r.claims.find((c) => c.attribute === 'drops')?.value).toEqual({
      type: 'item',
      name: 'Huge',
    });
    expect(r.problems).toContain('gatherer: skipped 2 names with ids outside 1..INT4_MAX');
  });

  it('reads no entity from a page URL whose id is out of range', () => {
    const r = parseSnapshot(page(''), `https://www.wowhead.com/forever/quest=${HUGE}/x`);
    expect(r.claims).toEqual([]);
    expect(r.problems).toContain('not a Wowhead entity page; only names were read');
  });

  it('caps rows across all quest Listviews of a page and the follows, deduped', () => {
    const lists = Array.from(
      { length: 5 },
      (_, k) =>
        `new Listview({template:'quest',id:'q${k}',data:${JSON.stringify(
          Array.from({ length: 1000 }, (_, i) => ({ id: (k % 4) * 1000 + i + 1 })),
        )}});`,
    ).join('\n');
    const r = parseSnapshot(page(lists), LIST);
    expect(r.claims.length).toBeLessThanOrEqual(MAX_QUEST_LIST_ROWS * 10);
    expect(r.follow).toHaveLength(MAX_QUEST_LIST_ROWS);
    expect(new Set(r.follow!.map((f) => f.url)).size).toBe(r.follow!.length);
    expect(r.problems).toEqual([`quest lists: kept ${MAX_QUEST_LIST_ROWS} of 5000 rows`]);
    expect(MAX_FOLLOWS).toBe(2000);
  });

  it('never follows from a page that is not Wowhead Forever', () => {
    const data = `new Listview({template:'quest',id:'quests',data:[{"id":80000,"level":70}]});`;
    for (const url of [
      'https://www.wowhead.com/quests/zone-x',
      'https://www.wowhead.com/classic/quests/kalimdor/durotar',
    ]) {
      const r = parseSnapshot(page(data), url);
      expect(r.follow).toBeUndefined();
      expect(r.problems).toContain('not a Forever page: 1 pages not followed');
    }
  });

  it('skips media Listviews on list pages', () => {
    const r = parseSnapshot(
      page(
        `new Listview({template:'quest',id:'screenshots',data:[{"id":5}]}); new Listview({template:'quest',id:'quests',data:[{"id":6}]});`,
      ),
      LIST,
    );
    expect(r.follow?.map((f) => f.entityId)).toEqual([6]);
  });

  it('never reads infobox Start / End from a comment that quotes the markup', () => {
    const r = parseSnapshot(
      page(`var lv_comments0 = [{"id":1,"body":"[icon name=quest-start]Start: [url=\\/forever\\/npc=666\\/evil]Evil Giver[\\/url][\\/icon]"}];
        new Listview({template:'comment',id:'comments',data:lv_comments0});
        WH.markup.printHtml("[icon name=quest-start]Start: [url=\\/forever\\/npc=667\\/evil]Other Box[\\/url][\\/icon]", "comment-body-1", {});`),
      QUEST,
    );
    expect(r.claims.filter((c) => c.attribute === 'starts_at')).toEqual([]);
  });

  it('keeps mapper points of the wrong types out, numeric-string types read, unknown types marked', () => {
    const r = parseSnapshot(
      page(
        `new Mapper({"objectives":{"12":{"zone":5,"levels":[[{"type":"2","point":"start","name":"X","id":5,"coords":"nope","coord":[1,2,3]},{"type":"npc","point":"end","name":"Y","id":6,"coord":[1,2]},{"type":1,"point":"end","name":"Z","id":${HUGE}},{"type":1,"point":"end","name":7,"id":8}],"x",null,[[1]]]},"abc":{"levels":{"0":[]}},"99999999999":{"levels":[[{"type":1,"point":"requirement","name":"W","id":9}]]}}});`,
      ),
      QUEST,
    );
    const of = (a: string) => r.claims.find((c) => c.attribute === a)?.value;
    expect(of('starts_at')).toEqual([
      // Two array floors ("x" and null are not floors): the point says which.
      { kind: 'object', id: 5, name: 'X', wowheadZone: 12, zoneName: null, coords: [], floor: 0 },
    ]);
    expect(of('ends_at')).toEqual([
      {
        kind: 'unknown',
        id: 6,
        name: 'Y',
        wowheadZone: 12,
        zoneName: null,
        coords: [[1, 2]],
        floor: 0,
      },
    ]);
    expect(of('objective_spots')).toMatchObject([{ id: 9, wowheadZone: null }]);
    expect(r.problems).toContain('mapper: skipped 2 points with a bad id or name');
  });

  it('caps huge mapper arrays and coordinates', () => {
    const coords = Array.from({ length: 5000 }, (_, i) => [i % 100, 1]);
    const pts = Array.from({ length: 20000 }, (_, i) => ({
      type: 1,
      point: 'requirement',
      name: `n${i}`,
      id: i + 1,
      coords: i === 0 ? coords : [[1, 2]],
    }));
    const r = parseSnapshot(
      page(`new Mapper(${JSON.stringify({ objectives: { 12: { zone: 'Z', levels: [pts] } } })});`),
      QUEST,
    );
    const spots = r.claims.find((c) => c.attribute === 'objective_spots')?.value as {
      coords: unknown[];
    }[];
    expect(spots).toHaveLength(MAX_OBJECTIVE_SPOTS);
    expect(spots[0]!.coords).toHaveLength(MAX_COORDS);
    expect(r.problems).toContain(
      `mapper: ${20000 - MAX_OBJECTIVE_SPOTS} points over the caps dropped`,
    );
  });

  it('reads a horde-padded faction class in a series, and skips out-of-range quest links', () => {
    const r = parseSnapshot(
      page(
        '',
        `<table class="series"><tr><th>1.</th><td><div><span class="icon-horde-padded"><a href="/forever/quest=5">H</a></span><br><span class="icon-alliance"><a href="/forever/quest=6">A</a></span><a href="/forever/quest=${HUGE}">bad</a></div></td></tr></table>`,
      ),
      QUEST,
    );
    expect(r.claims.find((c) => c.attribute === 'series')?.value).toEqual([
      [
        { id: 5, name: 'H', side: 'Horde' },
        { id: 6, name: 'A', side: 'Alliance' },
      ],
    ]);
    expect(r.follow?.map((f) => f.entityId)).toEqual([5, 6]);
  });
});
